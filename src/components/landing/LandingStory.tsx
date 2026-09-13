"use client";

/**
 * The landing story — what sits below the hero.
 *
 * The hero is a locked single viewport; this renders in a sibling container
 * after it, so the hero's layout contract is untouched. Everything here reads
 * from the shared engine store: when the engine is awake the numbers on this
 * page are the real running system's, and when it is asleep the page says so
 * instead of pretending. No figure on this page is invented — the three
 * problem stats carry their sources, and every live tile says where it is from.
 */
import Link from "next/link";
import { useEffect, useRef } from "react";
import { useEngine, useEngineStore } from "@/lib/engine-client";
import type { Snapshot } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Content                                                                     */
/* -------------------------------------------------------------------------- */

const PROBLEM = [
  {
    value: "10.5M",
    title: "visits in one season",
    body: "Global Village closed Season 29 with a record 10.5 million visitors. On a peak evening that is tens of thousands of people moving between zones inside one site.",
    cite: "Global Village, Season 29 close, May 2025",
  },
  {
    value: "7 / m²",
    title: "where crush begins",
    body: "Crowd crushes are compression, not trampling — people die standing up. Near seven people per square metre the pressure becomes mechanical and the front of the crowd cannot choose to move.",
    cite: "Fruin, via Risk Frontiers",
  },
  {
    value: "1,300+",
    title: "lives lost at Hajj 2024",
    body: "The deadliest crowd incidents of the decade were at gatherings with fixed exits and one-directional flow. They are monitoring failures, and they keep repeating.",
    cite: "Reported toll, June 2024",
  },
];

const PIPELINE = [
  { h: "Sense", p: "Probe devices per zone report live network congestion; geofences confirm boundaries." },
  { h: "Reason", p: "The signal is weighed against the venue's own baseline for this hour — not a global threshold." },
  { h: "Decide", p: "The graph's conditional edge: act now, probe one more signal, or hold and bank the budget.", key: true },
  { h: "Act", p: "Alerts, gate throttling, marshal staging — and reroutes with reachability checked first." },
  { h: "Verify", p: "The next cycle re-reads the zone. An action is measured against its outcome." },
];

const APIS = [
  { name: "congestion-insights", use: "The core signal — congestion as an early indicator of crowd pressure", match: "congestion" },
  { name: "geofencing-subscriptions", use: "A circle around each zone; fires when a device crosses", match: "geofen" },
  { name: "location-retrieval", use: "A carrier-verified position for a device, with max age", match: "location" },
  { name: "device-roaming-status", use: "Roaming guests are modelled as “not visible”, never “not present”", match: "roaming" },
  { name: "device-reachability", use: "Checked before every push, so a reroute is never a dead letter", match: "reachab" },
  { name: "qod — sessions", use: "Guaranteed priority connectivity for the ops team at peak", match: "qod" },
  { name: "number-verification", use: "Silent opt-in for the consented calibration sample", match: "number" },
];

/* -------------------------------------------------------------------------- */
/* Scroll reveal — armed only when JS is running, so no-JS never shows blank   */
/* -------------------------------------------------------------------------- */

function useStoryReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>(".vq-story-reveal"));
    if (!targets.length) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;

    root.classList.add("vq-story-armed");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).classList.add("vq-story-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    targets.forEach((t) => io.observe(t));
    return () => {
      io.disconnect();
      root.classList.remove("vq-story-armed");
    };
  }, []);
  return ref;
}

/* -------------------------------------------------------------------------- */
/* Live tiles fed by the real engine                                           */
/* -------------------------------------------------------------------------- */

function DecisionBadge({ decision }: { decision: Snapshot["brain"]["decision"] }) {
  if (!decision) return <span className="vq-story-live-value">—</span>;
  return (
    <span className="vq-story-live-value" data-decision={decision}>
      {decision}
    </span>
  );
}

function LiveEvidence() {
  useEngine(); // the landing joins the shared socket: numbers become live here too
  const snap = useEngineStore((s) => s.snapshot);

  if (!snap) {
    return (
      <div className="vq-story-live vq-story-reveal">
        <div className="vq-story-live-sleeping">
          <p className="vq-story-live-sleeping-title">The engine is asleep or waking.</p>
          <p className="vq-story-live-sleeping-body">
            These tiles stream live from the running simulation over one socket — agent decisions, network API
            calls, actions taken. On free hosting the engine spins down when idle; opening the console wakes it.
          </p>
          <Link href="/operator?play=1" className="vq-land-btn vq-land-btn-ghost">
            Wake it in the console
          </Link>
        </div>
      </div>
    );
  }

  const critical = snap.zones.filter((z) => z.status === "critical").length;
  const liveApis = snap.nac.apis.filter((a) => a.mode === "live").length;

  return (
    <div className="vq-story-live vq-story-reveal">
      <div className="vq-story-live-grid">
        <div className="vq-story-live-tile">
          <p className="vq-story-live-label">last agent decision</p>
          <DecisionBadge decision={snap.brain.decision} />
          <p className="vq-story-live-sub">{snap.brain.reasoning ? snap.brain.reasoning.slice(0, 90) : "the graph chose this cycle's branch"}</p>
        </div>
        <div className="vq-story-live-tile">
          <p className="vq-story-live-label">network API calls</p>
          <p className="vq-story-live-value">{snap.nac.calls}</p>
          <p className="vq-story-live-sub">
            {snap.nac.errors} errors · {liveApis}/{snap.nac.apis.length} endpoints live
          </p>
        </div>
        <div className="vq-story-live-tile">
          <p className="vq-story-live-label">actions taken</p>
          <p className="vq-story-live-value">{snap.guardian.actionsTaken.length}</p>
          <p className="vq-story-live-sub">
            {critical > 0 ? `${critical} zone${critical > 1 ? "s" : ""} at capacity now` : "no zone at capacity"}
          </p>
        </div>
        <div className="vq-story-live-tile">
          <p className="vq-story-live-label">agent mode</p>
          <p className="vq-story-live-value">{snap.brain.mode === "langgraph" ? "graph" : "fallback"}</p>
          <p className="vq-story-live-sub">
            {snap.engine.clockLabel} · {snap.engine.running ? "scenario running" : "scenario paused"}
          </p>
        </div>
      </div>
      <p className="vq-story-live-foot">
        Streamed live from the running engine over one socket — nothing on this strip is hardcoded. The venue is a
        deterministic replay; every API call it makes is real.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function LandingStory() {
  const ref = useStoryReveal();
  const snap = useEngineStore((s) => s.snapshot);

  const modeFor = (match: string): "live" | "sandbox" | null => {
    const hit = snap?.nac.apis.find((a) => a.id.toLowerCase().includes(match));
    if (!hit || hit.mode === "unknown") return null;
    return hit.mode;
  };

  return (
    <div className="vq-land-below" ref={ref}>
      {/* ------------------------------ the problem ------------------------------ */}
      <section className="vq-story-section" id="vq-problem">
        <p className="vq-story-kicker vq-story-reveal">The problem</p>
        <h2 className="vq-story-h2 vq-story-reveal">
          Crowds are sensed <em>after</em> they become dangerous.
        </h2>
        <p className="vq-story-lede vq-story-reveal">
          Cameras see a crush once it has formed. Ticketing counts entries, not pressure. The mobile network is the
          only sensor that is already everywhere in the venue — and it is the one nobody is watching.
        </p>
        <div className="vq-story-cards">
          {PROBLEM.map((n) => (
            <article className="vq-land-doc-card vq-story-reveal" key={n.value}>
              <p className="vq-land-doc-card-num">{n.value}</p>
              <h3 className="vq-land-doc-h3">{n.title}</h3>
              <p>{n.body}</p>
              <cite className="vq-land-doc-cite">{n.cite}</cite>
            </article>
          ))}
        </div>
      </section>

      {/* ------------------------------ the pipeline ----------------------------- */}
      <section className="vq-story-section" id="vq-pipeline">
        <p className="vq-story-kicker vq-story-reveal">How a cycle runs</p>
        <h2 className="vq-story-h2 vq-story-reveal">
          One step of this pipeline is <em>not a script</em>.
        </h2>
        <div className="vq-story-flow vq-story-reveal">
          {PIPELINE.map((s, i) => (
            <span className="vq-story-flow-step-wrap" key={s.h}>
              {i > 0 && <span className="vq-story-flow-arr" aria-hidden>→</span>}
              <span className={`vq-story-flow-step${s.key ? " vq-story-flow-step-key" : ""}`} title={s.p}>
                {s.h}
              </span>
            </span>
          ))}
        </div>
        <p className="vq-story-flow-note vq-story-reveal">
          <b>Decide</b> is a conditional edge in a LangGraph graph. Each cycle it weighs the evidence and chooses:
          act now, spend one more API call on a signal <em>it</em> picks, or hold and bank the budget. The choice and
          its reasoning stream into the console trace, live.
        </p>

        <div className="vq-story-duo">
          <article className="vq-land-doc-card vq-story-reveal">
            <p className="vq-story-tag">a threshold chain</p>
            <h3 className="vq-land-doc-h3">Acts on every spike</h3>
            <p>
              Density crosses a line, the chain fires — every time, even when the spike is a stadium wave or a
              stalled gate that clears itself. Actions are cheap, so it spends them blindly, and operators learn to
              ignore its alerts.
            </p>
          </article>
          <article className="vq-land-doc-card vq-story-reveal">
            <p className="vq-story-tag vq-story-tag-agent">an agent that decides</p>
            <h3 className="vq-land-doc-h3">Acts when it is worth it</h3>
            <p>
              It compares against the venue's own baseline, probes a second signal when the first is ambiguous, and
              holds when nothing needs doing — you can watch it choose HOLD on the live trace. Fewer actions, each
              one defensible, each one priced against a budget.
            </p>
          </article>
        </div>
      </section>

      {/* ------------------------------ the APIs --------------------------------- */}
      <section className="vq-story-section" id="vq-matrix">
        <p className="vq-story-kicker vq-story-reveal">Built on Nokia Network as Code</p>
        <h2 className="vq-story-h2 vq-story-reveal">
          Seven CAMARA APIs, <em>honestly labelled.</em>
        </h2>
        <p className="vq-story-lede vq-story-reveal">
          Every endpoint below is wired into the running system, and the badge next to it is its state in the live
          session right now — live means the gateway answered, sandbox means the call fell back and the console says
          so. No API is claimed that is not firing.
        </p>
        <div className="vq-story-matrix vq-story-reveal">
          {APIS.map((a) => {
            const mode = modeFor(a.match);
            return (
              <div className="vq-story-matrix-row" key={a.name}>
                <code>{a.name}</code>
                <span>{a.use}</span>
                <span className="vq-story-mode" data-mode={mode ?? "idle"}>
                  {mode === "live" ? "live" : mode === "sandbox" ? "sandbox" : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* --------------------------- live from the engine ------------------------ */}
      <section className="vq-story-section" id="vq-live">
        <p className="vq-story-kicker vq-story-reveal">Live from the engine</p>
        <h2 className="vq-story-h2 vq-story-reveal">
          Numbers from the <em>running system</em>, not a slide.
        </h2>
        <LiveEvidence />
      </section>

      {/* ------------------------------ the doors -------------------------------- */}
      <section className="vq-story-section" id="vq-doors">
        <p className="vq-story-kicker vq-story-reveal">The product</p>
        <h2 className="vq-story-h2 vq-story-reveal">
          Two doors. <em>Both live.</em>
        </h2>
        <div className="vq-story-duo">
          <Link href="/operator?play=1" className="vq-story-door vq-story-reveal">
            <p className="vq-story-tag">the control room</p>
            <h3>Run the operation →</h3>
            <p>
              Six zones, the agent's reasoning streaming in as it decides, interventions with one click. The
              gate-surge scenario starts itself.
            </p>
            <span className="vq-story-door-go">Open the operator console →</span>
          </Link>
          <Link href="/visitor" className="vq-story-door vq-story-reveal">
            <p className="vq-story-tag">the guest's phone</p>
            <h3>Walk in as a visitor →</h3>
            <p>
              The same engine, seen from inside the crowd: live zone pressure, queue waits, and the reroute landing
              as a notification before the jam forms.
            </p>
            <span className="vq-story-door-go">Open the guest view →</span>
          </Link>
        </div>
        <div className="vq-story-more vq-story-reveal">
          <Link href="/live" className="vq-glass-pill">
            Or watch the showcase screen
          </Link>
          <Link href="/how" className="vq-glass-pill">
            Read the full architecture — including what we won't claim
          </Link>
        </div>
      </section>

      <footer className="vq-story-foot">
        <span>VenueIQ · GSMA Open Gateway · Nokia Network as Code · MENA Ignite 2026</span>
        <span>Every number on this page is sourced or streamed. Nothing is invented.</span>
      </footer>
    </div>
  );
}
