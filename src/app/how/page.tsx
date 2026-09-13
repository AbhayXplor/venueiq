import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/landing/SiteHeader";

export const metadata: Metadata = {
  title: "How VenueIQ works — crowd intelligence on the mobile network",
  description:
    "What VenueIQ measures, how the agent cycle decides, where it is useful, and the limits we refuse to hide: network congestion as an early indicator of crowd pressure, not a per-zone headcount.",
};

/* --------------------------------------------------------------------------
   Every number on this page is sourced. Nothing here is invented.
   -------------------------------------------------------------------------- */

const NUMBERS = [
  {
    value: "10.5M",
    title: "visits in a single season",
    body: "Global Village closed Season 29 with a record 10.5 million visitors across roughly seven months. On a peak evening that is tens of thousands of people moving between six zones inside one site.",
    cite: "Global Village, Season 29 close announcement, May 2025.",
  },
  {
    value: "7 per m²",
    title: "where crush forces begin",
    body: "Crowd crushes are compressive asphyxia, not trampling — people die standing up. Once bodies are packed to roughly seven people per square metre, the pressure becomes mechanical and the people at the front cannot choose to move.",
    cite: "Fruin, cited in Risk Frontiers, “Behaviour and Mechanics of Crowd Crush Disasters”.",
  },
  {
    value: "1,300+",
    title: "lives lost at the 2024 Hajj",
    body: "The deadliest crowd incidents of the last decade have been at pilgrimage and religious gatherings, where exits are fixed and the flow is almost entirely one-directional. These deaths are preventable, and they keep repeating.",
    cite: "Reported death toll of the 2024 Hajj pilgrimage, June 2024.",
  },
];

const CYCLE = [
  {
    h: "Perceive",
    p: "The probe devices placed in each zone report how congested the radio network is there. Geofences confirm whether devices are inside the zone boundary. Nothing about this step is simulated in the running system — it is Nokia Network as Code answering live.",
  },
  {
    h: "Weigh",
    p: "The signal is compared against the venue's own baseline for that hour, not against a fixed global threshold. A quiet Tuesday and a sold-out Saturday have different definitions of “busy”, and a small online regression keeps correcting the forecast against what actually happened.",
  },
  {
    h: "Decide",
    p: "This is the step that is not a script, and it is a conditional edge in the graph rather than a fixed sequence. The router chooses: act now, spend one more API call on a signal it picks to gather evidence first, or hold the cycle entirely and spend nothing. There is a per-cycle budget for extra signal calls and a run-wide budget for hosted-model calls, so “is this worth spending on?” is a real trade-off. The choice and its reasoning stream straight into the console trace, marked with the branch it took.",
  },
  {
    h: "Act",
    p: "Guardian raises the operator alert and, on approval, throttles inflow or stages marshals. Navigator rebuilds the route around the predicted jam, and checks device reachability before pushing — so the app never reports a notification as delivered when the network says otherwise.",
  },
  {
    h: "Verify",
    p: "The next cycle re-reads the same zones. Every action is measured against its own outcome, and a zone that did not respond is treated as evidence, not as success.",
  },
  {
    h: "Fall back",
    p: "If the reasoning service, the LLM provider or a network API goes quiet, the engine drops to deterministic rules and prints the mode on screen. A degraded system that admits it is degraded is worth more than one that quietly guesses.",
  },
];

const USES = [
  {
    h: "Cultural villages & theme parks",
    p: "Queues form faster than floor staff can see them. A zone fills during a show while the next zone empties two minutes behind it.",
  },
  {
    h: "Expos & trade shows",
    p: "Session halls release thousands of people at once into corridors that were sized for a steady trickle.",
  },
  {
    h: "Pilgrimage & religious gatherings",
    p: "Fixed exits, enormous one-directional flows, and a death toll that is almost always a failure of planning and monitoring rather than of the crowd.",
  },
  {
    h: "Stadiums & arenas",
    p: "Ingress, half-time and egress are three different crowd problems inside two hours, and the second one is the one nobody staffs for.",
  },
  {
    h: "Transit hubs & crossings",
    p: "One stalled platform cascades into the street within minutes. Seeing it on the network beats seeing it on CCTV after the fact.",
  },
];

const APIS = [
  { name: "congestion-insights/v0/query", use: "The core signal — network congestion per location, read as an early indicator of crowd pressure." },
  { name: "geofencing-subscriptions/v0.3", use: "A circle around a zone; fires when a device crosses the boundary." },
  { name: "location-retrieval/v0/retrieve", use: "A carrier-verified position for a device, with a maximum age." },
  { name: "device-roaming-status/v1", use: "Whether a guest is roaming — they are largely unreachable, so they must be modelled as “not visible”, never as “not present”." },
  { name: "device-reachability-status/v1", use: "Checked before every push, so a reroute is never reported as delivered when it wasn't." },
  { name: "qod/v0/sessions", use: "Guaranteed priority connectivity for the ops and safety team during peak congestion." },
  { name: "number-verification/v0/verify", use: "Silent opt-in for the consented calibration sample without an SMS round-trip." },
];

const LIMITS = [
  {
    b: "Congestion is not a headcount.",
    p: "Congestion Insights reports how congested the radio network is as experienced by a device. A crowd with phones in pockets reads as quiet, and one heavy uploader reads as busy. We treat it as a proxy — an early indicator of crowd pressure — and we say so on every screen.",
  },
  {
    b: "Cells do not line up with zones.",
    p: "Radio cells are shaped by physics, not by where you put your fence. The zone picture is assembled from probe devices and geofenced boundaries, and it is an approximation. We describe it as one.",
  },
  {
    b: "Roaming guests are mostly invisible to us.",
    p: "Aggregating across operators is a per-market commercial arrangement, not a technical default. In a venue like Global Village that is a large share of the crowd, so “not visible” is a distinct state in our model.",
  },
  {
    b: "Aggregate density APIs exist — just not here.",
    p: "The wider CAMARA catalogue defines anonymised aggregate density endpoints. They are not available on this platform today. That is a platform constraint, not a design choice, and moving to them is a configuration change rather than a rewrite.",
  },
  {
    b: "Number Verification is showing its degraded state.",
    p: "It needs a separate OAuth step that is not wired up, so the console displays the fallback rather than hiding it. Degradation you can see is honest; degradation you cannot see is a lie with extra steps.",
  },
  {
    b: "The crowd here is a deterministic replay.",
    p: "One scripted evening at Global Village, minute by minute, so the demo is repeatable and every run is comparable. The APIs it calls are live; the guest movements are the script.",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="vq-land">
      <div className="vq-land-grain" aria-hidden="true" />

      <div className="vq-land-photo" aria-hidden="true">
        <div className="vq-land-field" />
      </div>

      {/* same monochrome ambient the other pages carry — no more flat black */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(1100px 480px at 72% -6%, rgba(255,255,255,0.045), transparent 60%)," +
            "radial-gradient(900px 500px at 12% 104%, rgba(255,255,255,0.04), transparent 60%)," +
            "radial-gradient(1400px 900px at 50% 50%, rgba(255,255,255,0.012), transparent 85%)",
        }}
      />

      <SiteHeader active="/how" />

      <main className="vq-land-doc">
        <section className="vq-land-doc-hero" style={{ paddingTop: 56 }}>
          <p className="vq-land-eyebrow">How it works</p>
          <h1 className="vq-land-doc-h1">
            The honest version, including <em>what we won&apos;t claim</em>.
          </h1>
          <p className="vq-land-doc-lead">
            VenueIQ reads mobile-network congestion as an early indicator of crowd pressure, decides with a
            multi-agent LangGraph brain whether that signal is worth acting on, and reroutes guests before a
            zone fills. Below is the whole pipeline — and every place it is weaker than a pitch deck would
            suggest.
          </p>
          <div className="vq-land-doc-actions">
            <Link href="/operator" className="vq-land-btn vq-land-btn-solid">
              Open the operator console
            </Link>
            <Link href="/live" className="vq-land-btn vq-land-btn-ghost">
              Watch the live screen
            </Link>
          </div>
        </section>

        {/* ---------------- the problem ---------------- */}
        <section className="vq-land-doc-section">
          <p className="vq-land-eyebrow">The problem</p>
          <h2 className="vq-land-doc-h2">Crowd disasters are a monitoring failure, not a behaviour failure.</h2>
          <p className="vq-land-doc-p">
            Large gatherings almost always pass without incident. When they don&apos;t, the cause is usually
            the venue&apos;s own density, exits and information flow — not panic. That makes it a sensing
            problem, and sensing problems are solvable.
          </p>

          <div className="vq-land-doc-grid vq-land-doc-grid-3">
            {NUMBERS.map((n) => (
              <article key={n.value} className="vq-land-doc-card">
                <p className="vq-land-doc-card-num">{n.value}</p>
                <h3 className="vq-land-doc-h3">{n.title}</h3>
                <p>{n.body}</p>
                <cite className="vq-land-doc-cite">{n.cite}</cite>
              </article>
            ))}
          </div>
        </section>

        {/* ---------------- what we measure ---------------- */}
        <section className="vq-land-doc-section">
          <p className="vq-land-eyebrow">What we actually measure</p>
          <h2 className="vq-land-doc-h2">A proxy, a probe fleet, and a calibration sample.</h2>
          <p className="vq-land-doc-p">
            The signal we start from is network congestion: how congested the radio network is at a place,
            as experienced by a device on it. It is not a person count, and any product that quietly claims
            otherwise is selling you a headcount it cannot produce.
          </p>
          <div className="vq-land-doc-steps">
            {CYCLE.map((s, i) => (
              <div className="vq-land-doc-step" key={s.h}>
                <span className="vq-land-doc-step-idx">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{s.h}</h3>
                  <p>{s.p}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------- architecture ---------------- */}
        <section className="vq-land-doc-section">
          <p className="vq-land-eyebrow">The architecture</p>
          <h2 className="vq-land-doc-h2">The venue&apos;s own SIMs are the sensors.</h2>
          <p className="vq-land-doc-p">
            Every zone gets a small set of venue-owned probe devices — ordinary SIMs on a shelf, reporting
            from a fixed position. They are the venue&apos;s own devices, so no visitor consent is involved
            and no personal data is read. They give a stable, comparable reading per zone instead of a
            random sample of whoever happens to be standing there.
          </p>
          <p className="vq-land-doc-p">
            On top of that sits a small consented visitor sample used as calibration ground truth: it tells
            us how a congestion reading at a given zone maps to how many people are actually there. That
            mapping is the thing that turns a radio measurement into an operational number — and it is
            also the thing that must be re-fitted per venue, because no two sites couple the same way.
          </p>
          <div className="vq-land-doc-api">
            {APIS.map((a) => (
              <div className="vq-land-doc-api-item" key={a.name}>
                <code>{a.name}</code>
                <span>{a.use}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------- use cases ---------------- */}
        <section className="vq-land-doc-section">
          <p className="vq-land-eyebrow">Where it&apos;s useful</p>
          <h2 className="vq-land-doc-h2">Anywhere people move in dense, predictable waves.</h2>
          <div className="vq-land-doc-grid vq-land-doc-grid-3">
            {USES.map((u) => (
              <article className="vq-land-doc-card" key={u.h}>
                <h3 className="vq-land-doc-h3">{u.h}</h3>
                <p>{u.p}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ---------------- why us ---------------- */}
        <section className="vq-land-doc-section">
          <p className="vq-land-eyebrow">Why the network, not cameras</p>
          <h2 className="vq-land-doc-h2">If the crowd has phones, you already have the sensor grid.</h2>
          <div className="vq-land-doc-grid vq-land-doc-grid-3">
            {[
              {
                h: "Nothing to install",
                p: "Cameras and people-counters cost millions across a site this size, and they go blind at night, indoors, and exactly where the crowd is thickest.",
              },
              {
                h: "Verified, not claimed",
                p: "Handset GPS drains batteries, fails indoors and can be spoofed. Carrier-side location is asserted by the network, not by whatever the device says about itself.",
              },
              {
                h: "No app to download",
                p: "App-based counting only ever sees the people who installed your app. On a peak evening that is a fraction of the gate — and a biased fraction at that.",
              },
              {
                h: "Carrier-side privacy",
                p: "We read aggregate, anonymised network state. The system never needs to know who a guest is to know that a zone is filling up.",
              },
              {
                h: "Works during the crunch",
                p: "The moment a zone is dangerously full is precisely when the network is congested. QoS on Demand is what lets the ops channel stay alive through it.",
              },
              {
                h: "Recurring, not one-off",
                p: "A venue buying guaranteed connectivity for its safety team across a full event calendar is a subscription, not a project. That is the commercial shape of this.",
              },
            ].map((c) => (
              <article className="vq-land-doc-card" key={c.h}>
                <h3 className="vq-land-doc-h3">{c.h}</h3>
                <p>{c.p}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ---------------- limits ---------------- */}
        <section className="vq-land-doc-section">
          <p className="vq-land-eyebrow">What it can&apos;t do yet</p>
          <h2 className="vq-land-doc-h2">The parts we would rather you heard from us.</h2>
          <div className="vq-land-doc-honest">
            <ul>
              {LIMITS.map((l) => (
                <li key={l.b}>
                  <b>{l.b}</b> {l.p}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <div className="vq-land-doc-foot">
          <span>MENA Ignite · GSMA Open Gateway · Nokia Network as Code</span>
          <Link href="/" className="vq-glass-pill">
            Back to the top
          </Link>
        </div>
      </main>
    </div>
  );
}
