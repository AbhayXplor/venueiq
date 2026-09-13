/**
 * Fallback recovery — chaos test for the one promise the live demo depends on:
 * the console never dies because the reasoning service did.
 *
 * The engine claims two things in its comments. This proves both, against the
 * running system, by killing the brain mid-playback:
 *
 *   1. A dead brain costs reasoning quality, not the demo. The engine must keep
 *      ticking and keep deciding, on the in-process TypeScript chain, within a
 *      few cycles — and say so on screen.
 *   2. Recovery is automatic. When the brain comes back, the engine must go
 *      back to using it on its own, with no engine restart.
 *
 * Run the ENGINE with AGENT_MODE=langgraph first (the default), then:
 *
 *   node scripts/fallback-recovery.mjs
 *   node scripts/fallback-recovery.mjs --engine http://127.0.0.1:3003 --brain-port 3004
 *
 * Costs almost nothing: it plays from 18:00, when the venue is quiet, so most
 * cycles are HOLDs and no hosted model call is placed.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { io } from "socket.io-client";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const ENGINE_URL = flag("engine", process.env.ENGINE_URL || "http://127.0.0.1:3003");
const BRAIN_PORT = Number(flag("brain-port", process.env.BRAIN_PORT || 3004));
const BRAIN_URL = `http://127.0.0.1:${BRAIN_PORT}`;
const OUTAGE_WAIT_MS = Number(flag("outage-wait", 40000));
const RECOVER_WAIT_MS = Number(flag("recover-wait", 60000));
const VERBOSE = args.includes("--verbose");

const HERE = dirname(fileURLToPath(import.meta.url));
const BRAIN_DIR = join(HERE, "..", "..", "agent-brain");
const IS_WINDOWS = process.platform === "win32";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/* ---------------------------------------------------------------------------
   Process control. Only ever touches the process listening on the brain port.
   --------------------------------------------------------------------------- */

function pidOnPort(port) {
  try {
    if (IS_WINDOWS) {
      const out = execFileSync("netstat", ["-ano"], { encoding: "utf8" });
      const m = new RegExp(`:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`).exec(out);
      return m ? Number(m[1]) : null;
    }
    const out = execFileSync("lsof", ["-ti", `tcp:${port}`], { encoding: "utf8" });
    const pid = out.trim().split("\n")[0];
    return pid ? Number(pid) : null;
  } catch {
    return null;
  }
}

function killPid(pid) {
  if (IS_WINDOWS) execFileSync("taskkill", ["/F", "/PID", String(pid)], { stdio: "ignore" });
  else execFileSync("kill", ["-9", String(pid)], { stdio: "ignore" });
}

/**
 * Start the brain the same way a person would: `python -m app.main` from the
 * service directory. Output is kept rather than discarded — a restart that
 * dies on an import error must not look like "the brain is just slow".
 */
function startBrain() {
  const python = process.env.PYTHON || (IS_WINDOWS ? "python" : "python3");
  const child = spawn(python, ["-m", "app.main"], {
    cwd: BRAIN_DIR,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  const collect = (d) => {
    output.push(String(d));
    if (output.length > 40) output.shift();
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  child.on("error", (e) => output.push(`spawn error: ${e.message}`));
  child.unref();
  return async () => (output.join("").trim() || "(no output)");
}

async function brainStats(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BRAIN_URL}/stats`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  return null;
}

/* ---------------------------------------------------------------------------
   Engine observation.
   --------------------------------------------------------------------------- */

const socket = io(ENGINE_URL, { transports: ["websocket"], reconnectionDelay: 500 });
const state = { snapshot: null, traces: [], connected: false };

socket.on("connect", () => (state.connected = true));
socket.on("snapshot", (s) => (state.snapshot = s));
socket.on("trace", (t) => {
  state.traces.push(t);
  if (state.traces.length > 400) state.traces.shift();
  if (VERBOSE) console.log(`         ${t.atLabel} ${t.agent} ${t.text.slice(0, 90)}`);
});

const send = (msg) => socket.emit("control", msg);

async function waitFor(label, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return Date.now() - (deadline - timeoutMs);
    await sleep(400);
  }
  return null;
}

const brainUp = () => !!state.snapshot?.brain?.available;
const brainMode = () => state.snapshot?.brain?.mode ?? "?";

/** A decision stamped with the engine's own clock, proving cycles keep flowing. */
function latestEngineDecision() {
  return [...state.traces].reverse().find((t) => t.agent === "COORDINATOR");
}

async function main() {
  console.log(`\nfallback recovery — engine ${ENGINE_URL}, brain ${BRAIN_URL}\n`);

  const arrival = await waitFor("connect", () => state.connected && state.snapshot, 15000);
  if (arrival === null) {
    console.error("engine never delivered a snapshot — is it running?");
    process.exit(2);
  }

  console.log("baseline");
  check(
    "engine is talking to the brain",
    brainMode() === "langgraph" && brainUp(),
    `mode=${brainMode()} available=${brainUp()}`,
  );
  if (brainMode() !== "langgraph" || !brainUp()) {
    console.error("\nThis test needs the engine started with AGENT_MODE=langgraph and the brain up.");
    process.exit(2);
  }

  // Quiet early-evening cycles: the venue is still filling, so the router
  // mostly HOLDs and the test places no hosted model calls.
  send({ action: "reset" });
  await sleep(600);
  send({ action: "speed", value: 4 });
  send({ action: "play" });
  await sleep(1500);
  const before = latestEngineDecision()?.text ?? "";

  /* ---- 1. kill the brain ------------------------------------------------- */
  const pid = pidOnPort(BRAIN_PORT);
  if (!pid) {
    console.error(`\nno process is listening on :${BRAIN_PORT} — cannot run the outage`);
    process.exit(2);
  }
  console.log(`\noutage — killing the brain (pid ${pid})`);
  const killedAt = Date.now();
  killPid(pid);
  const goneAt = await waitFor("brain down", () => !brainUp(), 20000);
  check(
    "engine notices the brain is gone",
    goneAt !== null,
    goneAt === null ? "still reporting available after 20s" : `${((Date.now() - killedAt) / 1000).toFixed(1)}s after the kill`,
  );

  /* ---- 2. it must keep working, and say why ------------------------------ */
  const clockAtOutage = state.snapshot?.engine?.clockLabel;
  const degradedAt = await waitFor(
    "degraded trace",
    () => state.traces.some((t) => /fallback|unreachable|degrad|type?script|TS chain|rules/i.test(t.text)),
    OUTAGE_WAIT_MS,
  );
  check(
    "the degradation is stated on screen",
    degradedAt !== null,
    degradedAt === null ? "no trace line explained the fallback" : `${((Date.now() - killedAt) / 1000).toFixed(1)}s after the kill`,
  );

  const movedAt = await waitFor("clock advanced", () => state.snapshot?.engine?.clockLabel !== clockAtOutage, OUTAGE_WAIT_MS);
  check(
    "the engine keeps ticking with no brain",
    movedAt !== null,
    movedAt === null ? "the clock stalled" : `clock moved from ${clockAtOutage}`,
  );

  const tsAt = await waitFor("ts chain", () => brainMode() === "ts", OUTAGE_WAIT_MS);
  const tsTrace = [...state.traces].reverse().find((t) => /sentinel|oracle|guardian|navigator/i.test(t.text));
  check(
    "the in-process chain takes over",
    tsAt !== null,
    tsAt !== null
      ? `mode switched to ts${tsTrace ? ` — "${tsTrace.text.slice(0, 60)}"` : ""}`
      : `still reporting ${brainMode()}`,
  );

  /* ---- 3. bring it back -------------------------------------------------- */
  console.log(`\nrecovery — restarting the brain`);
  if (!existsSync(join(BRAIN_DIR, "app", "main.py"))) {
    console.error(`brain service not found at ${BRAIN_DIR}`);
    process.exit(2);
  }
  const brainLog = startBrain();
  const stats = await brainStats(25000);
  check(
    "brain answered /stats after restart",
    !!stats,
    stats ? `run ${stats.runId ?? "?"}` : await brainLog(),
  );

  const backAt = await waitFor("brain back", () => brainUp(), RECOVER_WAIT_MS);
  check(
    "engine returns to the brain on its own, with no restart",
    backAt !== null,
    backAt === null ? `still on ${brainMode()} after ${RECOVER_WAIT_MS / 1000}s` : "recovered",
  );

  const after = latestEngineDecision()?.text ?? "";
  check(
    "cycles are flowing again after recovery",
    after !== "" && after !== before,
    after ? after.slice(0, 80) : "no engine decisions recorded",
  );

  send({ action: "pause" });
  socket.close();
}

main()
  .then(() => {
    const failed = results.filter((r) => !r.ok);
    console.log(
      failed.length === 0
        ? `\nPASS — ${results.length}/${results.length} checks (the demo survives a dead brain)`
        : `\nFAIL — ${failed.length}/${results.length} checks`,
    );
    process.exit(failed.length === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("\nfallback-recovery crashed:", err.message);
    socket.close();
    process.exit(2);
  });
