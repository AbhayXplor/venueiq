"use client";

/**
 * Operator console — the control room view.
 *
 * Layout contract, because this page previously overlapped itself: the page is
 * a single column of panels, and above xl the map and the agent panels sit side
 * by side. Every grid child carries `min-w-0` and every panel `overflow-hidden`,
 * so no card can push the page sideways or slide under its neighbour. Panel
 * header titles use the same accented-serif treatment as the landing headline
 * so the console reads as the same product.
 */
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { ArrowLeft, Pause, Play, RotateCcw, Signal } from "lucide-react";
import { Mark } from "@/components/landing/SiteHeader";
import { sendControl, useEngine, useEngineStore } from "@/lib/engine-client";
import { VenueMap } from "@/components/operator/VenueMap";
import { SignalBoard } from "@/components/operator/SignalBoard";
import { GuardianPanel } from "@/components/operator/GuardianPanel";
import { OraclePanel } from "@/components/operator/OraclePanel";
import { TracePanel } from "@/components/operator/TracePanel";
import { ScenarioAutoplay } from "@/components/ScenarioAutoplay";

// 8× and 16× are for fast-forwarding a rehearsal; the demo narrative runs at 1–4×.
const SPEEDS = [0.5, 1, 2, 4, 8, 16]

/**
 * Whether the person reading this is on a deployment rather than a dev server.
 *
 * The waiting copy differs by audience: a deployment should be told the engine
 * is waking, a laptop should be told which process to start. Decided from the
 * hostname at runtime, not from a build flag, so a deployment that has not had
 * `NEXT_PUBLIC_ENGINE_URL` set yet still gets the useful message instead of Bun
 * commands it cannot run. An explicit engine URL counts as hosted too, which
 * covers running the app locally against a deployed engine.
 */
function useIsDeployment(): boolean {
  const [deployed, setDeployed] = useState(Boolean(process.env.NEXT_PUBLIC_ENGINE_URL))
  useEffect(() => {
    setDeployed((was) => was || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname))
  }, [])
  return deployed
}

function TopBar() {
  const snap = useEngineStore((s) => s.snapshot)
  if (!snap) return null
  const { engine, llm, nac, brain } = snap
  const running = engine.running

  return (
    <header className="sticky top-0 z-20 border-b border-white/8 bg-canvas/85 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1560px] flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
        <Link href="/" className="vq-glass-pill" aria-label="Back to the landing page">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          <Mark className="h-3 w-3 text-white" />
        </Link>

        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium leading-tight">Global Village · Ops</p>
          <p className="truncate font-mono text-[9px] uppercase tracking-[0.16em] text-mute">{engine.phase}</p>
        </div>

        <p className="vq-num text-[22px] font-semibold leading-none">{engine.clockLabel}</p>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => sendControl({ action: running ? "pause" : "play" })}
            className={`${running ? "vq-glass-pill" : "vq-glass-btn"} cursor-pointer`}
          >
            {running ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
            {running ? "Pause" : "Play scenario"}
          </button>

          <button
            type="button"
            onClick={() => sendControl({ action: "reset" })}
            className="vq-glass-pill cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reset 18:00
          </button>

          <div className="vq-seg" role="group" aria-label="Playback speed">
            {SPEEDS.map((sp) => (
              <button key={sp} type="button" data-on={engine.speed === sp} onClick={() => sendControl({ action: "speed", value: sp })}>
                {sp}×
              </button>
            ))}
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Link href="/how" className="vq-glass-pill hidden xl:inline-flex">
            How it works
          </Link>

          <span className="vq-chip">
            <Signal className="h-3 w-3 text-dim" aria-hidden />
            NaC {nac.calls} calls{nac.errors > 0 ? ` · ${nac.errors} err` : ""}
          </span>

          <span className="vq-chip">
            <span className={`h-1.5 w-1.5 rounded-full ${llm.mode === "templates" ? "bg-idle" : "bg-live"}`} />
            {llm.mode === "templates" ? "rule templates" : `${llm.mode} · ${llm.calls} calls`}
          </span>

          {/* The agent brain's spend, on screen rather than in a log: what it
              chose, and how much of its budget that choice cost. */}
          {brain.mode === "langgraph" && brain.available && (
            <span className="vq-chip" title={`Salience ${brain.salience.toFixed(2)} · graph ${brain.graphMs} ms`}>
              <span className={`h-1.5 w-1.5 rounded-full ${brain.budgetExhausted ? "bg-critical" : "bg-live vq-pulse"}`} />
              graph {brain.decision ?? "—"}
              <span className="text-mute">
                · LLM {brain.llmCalls}/{brain.llmBudget} · {brain.apiCalls} API
              </span>
            </span>
          )}
        </div>
      </div>
    </header>
  )
}

function KpiStrip() {
  const snap = useEngineStore((s) => s.snapshot)
  if (!snap) return null
  const { venue, zones } = snap
  const critical = zones.filter((z) => z.status === "critical").length
  const busy = zones.filter((z) => z.status === "busy").length
  const calm = zones.filter((z) => z.status === "calm").length

  const kpis = [
    {
      label: "on site now",
      value: venue.onSite.toLocaleString(),
      sub: `of ${Math.round(venue.capacity / 1000)}k cap · ${venue.arrivals10 >= 0 ? "+" : "−"}${Math.abs(venue.arrivals10).toLocaleString()}/10m`,
    },
    {
      label: "busiest zone",
      value: venue.busiestZone,
      sub: `${zones.find((z) => z.name === venue.busiestZone)?.densityPct ?? "—"}% of capacity`,
    },
    {
      label: "zone status",
      value: `${calm}/6 calm`,
      sub: `${critical} critical · ${busy} busy`,
      alert: critical > 0,
    },
    {
      label: "visitor pushes",
      value: String(venue.pushesSent),
      sub: `${venue.reroutesIssued} reroutes issued`,
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {kpis.map((k) => (
        <div key={k.label} className="vq-panel min-w-0 overflow-hidden px-4 py-3">
          <p className="truncate font-mono text-[9px] uppercase tracking-[0.18em] text-mute">{k.label}</p>
          <p className={`vq-num mt-1 truncate text-[20px] font-semibold leading-tight ${k.alert ? "text-critical" : "text-body"}`}>
            {k.value}
          </p>
          <p className="mt-0.5 truncate font-mono text-[9.5px] text-mute">{k.sub}</p>
        </div>
      ))}
    </div>
  )
}

export default function OperatorPage() {
  useEngine()
  const deployed = useIsDeployment()
  const snapshot = useEngineStore((s) => s.snapshot)

  return (
    <div className="min-h-screen bg-canvas">
      {/* ambient background — same treatment as /live, so no console page is flat black */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(1100px 480px at 72% -6%, rgba(255,255,255,0.05), transparent 60%)," +
            "radial-gradient(900px 500px at 12% 104%, rgba(255,255,255,0.045), transparent 60%)," +
            "radial-gradient(1400px 900px at 50% 50%, rgba(255,255,255,0.014), #000 85%)",
        }}
      />
      {/* ?play=1 — the landing doors deep-link here with the scenario already running */}
      <Suspense fallback={null}>
        <ScenarioAutoplay connected={Boolean(snapshot)} />
      </Suspense>
      <TopBar />
      <main className="mx-auto grid w-full max-w-[1560px] gap-3 px-3 py-3">
        {snapshot ? (
          <>
            <KpiStrip />
            <SignalBoard nac={snapshot.nac} />
            <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_384px]">
              <div className="grid min-w-0 content-start gap-3">
                <VenueMap snapshot={snapshot} />
                <TracePanel />
              </div>
              <div className="grid min-w-0 content-start gap-3">
                <GuardianPanel snapshot={snapshot} />
                <OraclePanel snapshot={snapshot} />
              </div>
            </div>
          </>
        ) : (
          <div className="flex min-h-[70vh] flex-col items-center justify-center gap-5 px-6 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-xl border border-white/12 bg-white/4">
              <Signal className="h-5 w-5 text-dim" aria-hidden />
            </div>
            <div className="max-w-md">
              <p className="text-[15px] font-medium">
                Waiting for the <span className="vq-serif text-[17px] text-dim">engine</span>
              </p>
              <p className="mt-2 text-[12px] leading-relaxed text-mute">
                {deployed
                  ? "The console streams venue state, Nokia NaC signals and agent decisions over one socket. On free hosting the engine spins down while idle, so the first visit can take up to a minute — this page keeps trying by itself."
                  : "The console streams venue state, Nokia NaC signals and agent decisions over one socket. Start the brain and the engine, then reload."}
              </p>
              {deployed ? (
                <p className="mt-5 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-dim">
                  <span className="h-1.5 w-1.5 rounded-full bg-live vq-pulse" />
                  waking the engine
                </p>
              ) : (
                <code className="vq-well mt-4 block px-4 py-3 text-left font-mono text-[11px] leading-relaxed text-dim">
                  cd mini-services/agent-brain && uvicorn app.main:app --port 3004
                  <br />
                  cd mini-services/venue-engine && bun --hot src/index.ts
                </code>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
