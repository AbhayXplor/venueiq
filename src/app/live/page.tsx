"use client";

/**
 * Live screen — the product showcase. The hero IS the live product: the engine
 * feed runs on the page itself. Same markup that used to live at `/`, now a
 * dedicated route so the marketing landing can stay a single clean viewport.
 */
import Link from "next/link";
import { ArrowRight, Bell, BrainCircuit, Compass, Fingerprint, GitBranch, Radio, ScanEye, Satellite, ShieldCheck, Signal, Smartphone, Siren, Waypoints } from "lucide-react";
import { useEngine, useEngineStore } from "@/lib/engine-client";
import { LivePeek } from "@/components/landing/LivePeek";
import { Mark } from "@/components/landing/SiteHeader";
import { ConsoleWakeNote } from "@/components/ConsoleWakeNote";

const AGENTS = [
  {
    name: "Router",
    role: "decides",
    line: "The LangGraph branch point. Act on the evidence it already has, spend one more API call on a signal it chooses, or hold the cycle and bank the budget. Nothing here is a fixed threshold.",
    accent: "text-body",
    ring: "ring-white/20",
    icon: BrainCircuit,
  },
  {
    name: "Sentinel",
    role: "watches",
    line: "Reads congestion insights from the venue's own probe device in every zone and watches geofences; flags anything running 3× off baseline.",
    accent: "text-dim",
    ring: "ring-white/12",
    icon: ScanEye,
  },
  {
    name: "Oracle",
    role: "predicts",
    line: "Forecasts zone occupancy 30–60 minutes ahead from the live trajectory, and says which zone to worry about.",
    accent: "text-dim",
    ring: "ring-white/12",
    icon: GitBranch,
  },
  {
    name: "Navigator",
    role: "steers",
    line: "Rebuilds visitor routes around predicted jams — reachability checked before every push, never a dead letter.",
    accent: "text-dim",
    ring: "ring-white/12",
    icon: Waypoints,
  },
  {
    name: "Guardian",
    role: "protects",
    line: "Owns the thresholds. Raises operator alerts, throttles gates, boosts comms with a QoD slice.",
    accent: "text-critical",
    ring: "ring-critical/25",
    icon: Siren,
  },
]

const SIGNALS = [
  { id: "congestion", label: "Congestion Insights", use: "network congestion, as an early indicator of crowd pressure", icon: Radio },
  { id: "geofence", label: "Geofencing", use: "zone thresholds", icon: Compass },
  { id: "location", label: "Location Retrieval", use: "visitor fixes", icon: Satellite },
  { id: "roaming", label: "Roaming Status", use: "guest origin", icon: Signal },
  { id: "reach", label: "Reachability", use: "push readiness", icon: Bell },
  { id: "qod", label: "QoS on Demand", use: "priority comms", icon: ShieldCheck },
  { id: "verify", label: "Number Verification", use: "silent opt-in", icon: Fingerprint },
]

function LiveChips() {
  const snapshot = useEngineStore((s) => s.snapshot)
  if (!snapshot) return null
  const { engine, llm, nac, venue } = snapshot
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="vq-chip">
        <span className="h-1.5 w-1.5 rounded-full bg-live vq-pulse" />
        {engine.phase} · {engine.clockLabel}
      </span>
      <span className="vq-chip">
        <Satellite className="h-3 w-3 text-mute" aria-hidden />
        {venue.onSite.toLocaleString()} on site
      </span>
      <span className="vq-chip">
        <Radio className="h-3 w-3 text-mute" aria-hidden />
        NaC {nac.calls} calls · {nac.apis.length} APIs
      </span>
      <span className="vq-chip">
        <ShieldCheck className="h-3 w-3 text-mute" aria-hidden />
        agent brain · {llm.mode === "templates" ? "rule templates" : `${llm.mode} live`}
      </span>
    </div>
  )
}

function LiveNumbers() {
  const snapshot = useEngineStore((s) => s.snapshot)
  const traces = useEngineStore((s) => s.traces)
  const rows = snapshot
    ? [
        { label: "guests on site (simulated)", value: snapshot.venue.onSite.toLocaleString() },
        { label: "zones reporting", value: `${snapshot.zones.length} / 6` },
        { label: "agent decisions this session", value: String(traces.length) },
        { label: "network API calls", value: String(snapshot.nac.calls) },
      ]
    : [
        { label: "guests on site (simulated)", value: "—" },
        { label: "zones reporting", value: "0 / 6" },
        { label: "agent decisions this session", value: "—" },
        { label: "network API calls", value: "—" },
      ]
  return (
    <div className="grid grid-cols-2 gap-x-10 gap-y-6 md:grid-cols-4">
      {rows.map((r) => (
        <div key={r.label}>
          <p className="vq-num text-[34px] font-semibold leading-none text-body">{r.value}</p>
          <p className="mt-2 font-mono text-[10px] tracking-[0.14em] uppercase text-mute">{r.label}</p>
        </div>
      ))}
    </div>
  )
}

export default function LiveScreenPage() {
  useEngine()

  return (
    <div className="min-h-screen bg-canvas text-body">
      {/* ambient background — the warm room, shared with the console and visitor view */}
      <div aria-hidden className="vq-ambient" />

      {/* nav */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-85" aria-label="VenueIQ — home">
          <div className="grid h-8 w-8 place-items-center rounded-lg border border-white/12 bg-white/6">
            <Mark className="h-4 w-4 text-white" />
          </div>
          <div className="leading-tight">
            <p className="text-[15px] font-medium tracking-tight">VenueIQ</p>
            <p className="font-mono text-[9px] tracking-[0.2em] uppercase text-mute">live screen</p>
          </div>
        </Link>
        <nav className="flex items-center gap-2.5">
          <Link href="/visitor" className="vq-glass-pill">
            <Smartphone className="h-3.5 w-3.5" aria-hidden /> Visitor app
          </Link>
          <Link href="/operator" className="vq-glass-btn">
            Operator console
          </Link>
        </nav>
      </header>

      <main className="relative z-10">
        {/* hero — asymmetric: thesis left, the live product right */}
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-10 lg:grid-cols-[1fr_1.15fr] lg:pt-16">
          <div className="vq-rise">
            <p className="vq-eyebrow">for the venues this region is famous for</p>
            <h1 className="mt-4 text-[clamp(2.5rem,5.2vw,4rem)] font-medium leading-[1.06] tracking-[-0.03em]">
              Venues count tickets.
              <br />
              We read the <span className="vq-serif text-[1.06em] text-mute">pressure</span> first.
            </h1>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-dim">
              The venue&apos;s own probe devices sit in every zone, and the carrier already knows how
              loaded the network is around each one. VenueIQ turns those Nokia Network as Code signals
              into an early read on crowd pressure, forecasts it 30 minutes ahead, and steers visitors
              before zones jam — no cameras, no app install, no guesswork.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href="/operator" className="vq-btn vq-btn-primary">
                Enter the operator console <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link href="/visitor" className="vq-btn vq-btn-ghost">
                <Smartphone className="h-4 w-4" aria-hidden /> See the visitor app
              </Link>
            </div>

            {/* Only appears while the engine is spun down and waking up. */}
            <ConsoleWakeNote className="mt-4 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-dim" />
            <div className="mt-7">
              <LiveChips />
            </div>
          </div>

          <div className="vq-rise" style={{ animationDelay: "120ms" }}>
            <LivePeek />
            <p className="mt-3 text-center font-mono text-[10px] tracking-[0.14em] uppercase text-mute">
              same engine, same feed — this is the operator console, live
            </p>
          </div>
        </section>

        {/* agent pipeline */}
        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="mb-10 max-w-xl">
            <p className="vq-eyebrow">the brain</p>
            <h2 className="mt-3 font-display text-[clamp(1.6rem,2.6vw,2.1rem)] font-semibold tracking-tight">
              Four specialists. One router. Zero <span className="vq-serif text-[1.06em] text-mute">panic</span>.
            </h2>
            <p className="mt-3 text-[14px] leading-relaxed text-dim">
              A LangGraph brain orchestrates the network APIs as trusted, real-time data sources. Each
              cycle the router chooses — <span className="text-body">act now</span>,{" "}
              <span className="text-body">spend one more API call on a signal it picks</span>, or{" "}
              <span className="text-body">hold and save the budget</span> — and the reasoning stays
              visible on screen the whole time.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {AGENTS.map((a, i) => (
              <div key={a.name} className={`vq-panel group p-5 ring-1 ring-inset ${a.ring} transition-transform duration-200 hover:-translate-y-1`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`grid h-8 w-8 place-items-center rounded-lg border border-white/8 bg-white/4`}>
                      <a.icon className={`h-4 w-4 ${a.accent}`} aria-hidden />
                    </span>
                    <p className={`font-display text-[17px] font-semibold ${a.accent}`}>{a.name}</p>
                  </div>
                  <span className="font-mono text-[9.5px] tracking-[0.18em] uppercase text-mute">
                    {String(i + 1).padStart(2, "0")} · {a.role}
                  </span>
                </div>
                <p className="mt-3 text-[12.5px] leading-relaxed text-dim">{a.line}</p>
              </div>
            ))}
          </div>
          <p className="mt-5 font-mono text-[10.5px] tracking-[0.06em] text-mute">
            perceive → forecast → route (act / probe / hold) → guard — safety outranks comfort, every cycle
          </p>
        </section>

        {/* CAMARA signals */}
        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-xl">
              <p className="vq-eyebrow">the eyes</p>
              <h2 className="mt-3 font-display text-[clamp(1.6rem,2.6vw,2.1rem)] font-semibold tracking-tight">
                Seven <span className="vq-serif text-[1.06em] text-mute">signals</span>, straight off the network
              </h2>
              <p className="mt-3 text-[14px] leading-relaxed text-dim">
                Standardised CAMARA APIs on Nokia Network as Code — 6 of them live in this build, with
                Number Verification degrading to a labelled fallback. What the network reports is
                congestion around a place, not a headcount: we treat it as an early indicator of crowd
                pressure and pair it with the venue&apos;s own per-zone probe devices.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            {SIGNALS.map((s) => (
              <div key={s.id} className="vq-panel px-3.5 py-4">
                <s.icon className="h-4 w-4 text-mute" aria-hidden />
                <p className="mt-2.5 font-mono text-[10.5px] leading-tight tracking-[0.02em] text-body">{s.label}</p>
                <p className="mt-1.5 text-[11.5px] leading-snug text-mute">{s.use}</p>
              </div>
            ))}
          </div>
        </section>

        {/* why the network */}
        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { h: "Cameras go blind", b: "Indoors, at night, in crowds — and they cost millions to install across a mega-venue. Network-side sensing works everywhere a phone works, with no consent flow to run." },
              { h: "GPS is spoofable", b: "Handset GPS drains batteries, fails indoors and can be faked. Network-level location is verified by the carrier, not claimed by the device." },
              { h: "No app install", b: "WiFi counting only sees people who installed your app. The network sees the devices that are on it — and where a guest is roaming or off-network, we mark them not visible rather than absent." },
            ].map((c) => (
              <div key={c.h} className="vq-panel p-6">
                <h3 className="font-display text-[16px] font-semibold text-body">{c.h}</h3>
                <p className="mt-3 text-[12.5px] leading-relaxed text-dim">{c.b}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center font-mono text-[10.5px] tracking-[0.1em] uppercase text-mute">
            privacy by design — venue-owned probe devices need no consent; roaming guests are marked not visible, not absent
          </p>
        </section>

        {/* live numbers band */}
        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="vq-panel px-8 py-10">
            <div className="mb-8 flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-live vq-pulse" />
              <p className="vq-eyebrow">live from the simulated venue floor</p>
            </div>
            <LiveNumbers />
          </div>
        </section>

        {/* closing CTA */}
        <section className="mx-auto max-w-6xl px-6 pb-24 pt-8">
          <div className="vq-panel relative overflow-hidden px-8 py-10 text-center">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{ background: "radial-gradient(600px 260px at 50% 120%, rgba(255,255,255,0.09), transparent 70%)" }}
            />
            <h2 className="relative font-display text-[clamp(1.7rem,3vw,2.4rem)] font-semibold tracking-tight">
              See the venue the way the <span className="vq-serif text-[1.06em] text-mute">network</span> sees it
            </h2>
            <p className="relative mx-auto mt-3 max-w-md text-[13.5px] leading-relaxed text-dim">
              An evening at Global Village, replayed minute by minute — gates open, showtime peak,
              the Guardian firing, and one visitor rerouted before the crush forms.
            </p>
            <div className="relative mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link href="/operator" className="vq-btn vq-btn-primary">
                Replay the evening <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link href="/visitor" className="vq-btn vq-btn-ghost">
                <Smartphone className="h-4 w-4" aria-hidden /> Walk in as a visitor
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/6 py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6">
          <p className="font-mono text-[10px] tracking-[0.12em] uppercase text-mute">
            MENA Ignite Hackathon · GSMA Open Gateway · Theme 3 — Tourism & Cultural Experience
          </p>
          <p className="font-mono text-[10px] tracking-[0.12em] uppercase text-mute">
            built on Nokia Network as Code + CAMARA APIs
          </p>
        </div>
      </footer>
    </div>
  )
}
