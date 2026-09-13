/**
 * Screenshots — captures every route in headless Chrome so the design can be
 * reviewed as images. Zero dependencies: Node 22's global WebSocket speaks CDP.
 *
 *   node scripts/shots.mjs
 *   node scripts/shots.mjs --base http://127.0.0.1:3000 --width 1440
 *   node scripts/shots.mjs --full          # full-page instead of one viewport
 *
 * Writes to screenshots/<route>-<width>.png
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE = flag("base", process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const WIDTH = Number(flag("width", 1440));
const HEIGHT = Number(flag("height", 900));
const FULL = args.includes("--full");
const SETTLE_MS = Number(flag("settle", 2200));
const TIMEOUT_MS = 60000;

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "screenshots");

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA ?? ""}/Google/Chrome/Application/chrome.exe`,
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

/**
 * Waits for a route's own ready selector before shooting. The live pages render
 * their panels only once the engine snapshot lands, so a fixed delay would
 * capture empty boxes on a cold engine.
 */
const ROUTES = [
  { name: "home", path: "/", ready: ".vq-land-hero, .vq-film-hero" },
  { name: "how", path: "/how", ready: ".vq-land-doc" },
  { name: "live", path: "/live", ready: ".vq-panel" },
  { name: "operator", path: "/operator", ready: ".vq-panel" },
  { name: "visitor", path: "/visitor", ready: '[role="tablist"]' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} timed out`));
        }
      }, TIMEOUT_MS);
    });
  }
}

async function fetchJson(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error(`Chrome never answered ${url}`);
}

async function main() {
  const chrome = CHROME_CANDIDATES.find((p) => p && existsSync(p));
  if (!chrome) {
    console.error("No Chrome found. Set CHROME_PATH.");
    process.exit(2);
  }
  await mkdir(OUT_DIR, { recursive: true });

  const profile = await mkdtemp(join(tmpdir(), "vq-shots-"));
  const port = 9900 + Math.floor(Math.random() * 90);
  const child = spawn(
    chrome,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-gpu",
      "--hide-scrollbars",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const cleanup = async () => {
    try { child.kill() } catch { /* already gone */ }
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  };

  const written = [];
  try {
    await fetchJson(`http://127.0.0.1:${port}/json/version`);
    const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    const page = targets.find((t) => t.type === "page");
    if (!page) throw new Error("no page target");

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error("CDP socket failed")), { once: true });
    });
    const cdp = new CDP(ws);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    for (const route of ROUTES) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: WIDTH,
        height: HEIGHT,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await cdp.send("Page.navigate", { url: `${BASE}${route.path}` });

      // Wait for the route's own content, not the load event.
      let ready = false;
      for (let i = 0; i < 60; i++) {
        const r = await cdp.send("Runtime.evaluate", {
          expression: `!!document.querySelector(${JSON.stringify(route.ready)})`,
          returnByValue: true,
        });
        if (r.result.value) { ready = true; break; }
        await sleep(250);
      }
      await sleep(SETTLE_MS);

      const metrics = await cdp.send("Page.getLayoutMetrics");
      const contentH = Math.ceil(metrics.cssContentSize?.height ?? HEIGHT);
      if (FULL && contentH > HEIGHT) {
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width: WIDTH,
          height: Math.min(contentH, 6000),
          deviceScaleFactor: 1,
          mobile: false,
        });
        await sleep(400);
      }

      const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
      const file = join(OUT_DIR, `${route.name}-${WIDTH}px.png`);
      await writeFile(file, Buffer.from(shot.data, "base64"));
      written.push({ file, ready, height: contentH });
      console.log(`${ready ? "ok  " : "WARN"} ${route.path.padEnd(10)} -> ${file}${FULL ? ` (h=${contentH})` : ""}`);
    }

    ws.close();
  } finally {
    await cleanup();
  }

  const notReady = written.filter((w) => !w.ready);
  if (notReady.length) {
    console.log(`\nWARN — ${notReady.length} route(s) never rendered their ready selector; those shots may be empty.`);
  }
  console.log(`\n${written.length} screenshot(s) written to screenshots/`);
}

main().catch((err) => {
  console.error("shots failed:", err.message);
  process.exit(2);
});
