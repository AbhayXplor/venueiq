"use client";

/**
 * Visitor app — the guest experience inside a phone frame. Three tabs:
 * live map, wait times, alerts. The reroute lands as a banner.
 *
 * Same monochrome system as the console: white is "look at this", red is the
 * only hue and only ever means a zone is at capacity.
 */
import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, BatteryFull, Bell, MapPin, Navigation,
  SignalHigh, Smartphone, Timer, TrendingDown, TrendingUp, Wifi,
} from "lucide-react";
import { useEngine, useEngineStore, sendControl } from "@/lib/engine-client";
import type { Snapshot } from "@/lib/types";

const STATUS_BG: Record<string, string> = {
  calm: "border-white/10 bg-white/3",
  filling: "border-white/18 bg-white/6",
  busy: "border-white/30 bg-white/10",
  critical: "border-critical/45 bg-critical/12",
}
const STATUS_FG: Record<string, string> = {
  calm: "text-calm", filling: "text-filling", busy: "text-busy", critical: "text-critical",
}

type Tab = "map" | "waits" | "alerts"

function ZoneTile({ name, pct, status, you }: { name: string; pct: number; status: string; you?: boolean }) {
  return (
    <div className={`relative min-w-0 overflow-hidden rounded-xl border p-3 ${STATUS_BG[status]}`}>
      {you && (
        <span className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full border border-white bg-white px-1.5 py-px font-mono text-[8px] font-semibold uppercase tracking-wide text-black">
          <MapPin className="h-2 w-2" aria-hidden /> you
        </span>
      )}
      <p className="min-w-0 truncate pr-8 text-[11px] font-medium leading-tight text-body">{name}</p>
      <p className={`vq-num mt-1 text-[16px] font-semibold leading-none ${STATUS_FG[status]}`}>{pct}%</p>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full ${STATUS_FG[status].replace("text-", "bg-")}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  )
}

function MapTab({ snapshot }: { snapshot: Snapshot }) {
  const reroute = snapshot.visitor.reroute
  const ended = !snapshot.engine.running && snapshot.engine.minuteOfDay >= 1380
  return (
    <div className="grid min-w-0 gap-3">
      {ended && (
        <button
          type="button"
          onClick={() => {
            sendControl({ action: "reset" })
            setTimeout(() => sendControl({ action: "play" }), 400)
          }}
          className="vq-slide-in flex min-w-0 cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/25 bg-white/8 p-3 text-left"
        >
          <div className="min-w-0">
            <p className="text-[11.5px] font-medium text-body">
              The evening has <span className="vq-serif text-[12.5px] text-dim">wrapped</span>
            </p>
            <p className="mt-0.5 text-[10.5px] leading-relaxed text-mute">
              Gates closed at 23:00. Replay the full evening — gates, showtime, the reroute.
            </p>
          </div>
          <span className="shrink-0 rounded-lg border border-white bg-white px-2.5 py-1.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-black">
            Replay
          </span>
        </button>
      )}
      {reroute && (
        <div className="vq-slide-in min-w-0 rounded-xl border border-white/25 bg-white/8 p-3">
          <div className="flex items-center gap-1.5">
            <Navigation className="h-3.5 w-3.5 text-body" aria-hidden />
            <p className="text-[11.5px] font-medium text-body">
              Smart reroute <span className="vq-serif text-[12.5px] text-dim">active</span>
            </p>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-dim">
            {reroute.fromZone} is packed. Better route: <b className="text-body">{reroute.toZone}</b> via {reroute.viaZone} — saves about {reroute.savedMin} min.
          </p>
          <p className="mt-1 font-mono text-[9px] leading-relaxed text-mute">{reroute.reason}</p>
        </div>
      )}
      <div className="grid min-w-0 grid-cols-2 gap-2.5">
        {snapshot.zones.map((z) => (
          <ZoneTile key={z.id} name={z.short} pct={z.densityPct} status={z.status} you={z.id === snapshot.visitor.zoneId} />
        ))}
      </div>
      <p className="text-center font-mono text-[9px] uppercase leading-relaxed tracking-[0.14em] text-mute">
        occupancy modelled from the venue&apos;s probe devices
      </p>
    </div>
  )
}

function WaitsTab({ snapshot }: { snapshot: Snapshot }) {
  const waits = snapshot.visitor.waits
  return (
    <div className="grid min-w-0 gap-2.5">
      {waits.length === 0 && (
        <p className="py-8 text-center text-[12px] text-mute">No measurable queues right now — the evening is calm.</p>
      )}
      {waits.map((w) => (
        <div key={w.zone} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-white/3 p-3">
          <Timer className="h-4 w-4 shrink-0 text-mute" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium text-body">{w.zone}</p>
            <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-mute">estimated wait</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="vq-num text-[16px] font-semibold text-body">{w.waitMin}m</p>
            <p className={`flex items-center justify-end gap-1 font-mono text-[9px] ${w.trend === "up" ? "text-body" : w.trend === "down" ? "text-dim" : "text-mute"}`}>
              {w.trend === "up" ? <TrendingUp className="h-2.5 w-2.5" aria-hidden /> : w.trend === "down" ? <TrendingDown className="h-2.5 w-2.5" aria-hidden /> : null}
              {w.trend === "up" ? "rising" : w.trend === "down" ? "easing" : "steady"}
            </p>
          </div>
        </div>
      ))}
      <p className="text-center font-mono text-[9px] uppercase tracking-[0.14em] text-mute">
        waits predicted 30 min ahead by oracle
      </p>
    </div>
  )
}

function AlertsTab({ snapshot }: { snapshot: Snapshot }) {
  const notes = snapshot.visitor.notifications
  return (
    <div className="grid min-w-0 gap-2.5">
      {notes.length === 0 && (
        <p className="py-8 text-center text-[12px] text-mute">No alerts yet — you&apos;d be the first to know.</p>
      )}
      {[...notes].reverse().map((n, i) => (
        <div
          key={i}
          className={`vq-slide-in min-w-0 rounded-xl border p-3 ${
            n.kind === "reroute" ? "border-white/25 bg-white/8" : n.kind === "warn" ? "border-critical/40 bg-critical/10" : "border-white/10 bg-white/3"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-[11.5px] font-medium text-body">{n.title}</p>
            <span className="shrink-0 font-mono text-[9px] text-mute">{n.atLabel}</span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-dim">{n.body}</p>
        </div>
      ))}
      <p className="text-center font-mono text-[9px] uppercase leading-relaxed tracking-[0.14em] text-mute">
        pushes only when the network says you&apos;re reachable
      </p>
    </div>
  )
}

export default function VisitorPage() {
  useEngine()
  const snapshot = useEngineStore((s) => s.snapshot)
  const [tab, setTab] = useState<Tab>("map")
  const clock = snapshot?.engine.clockLabel ?? "--:--"

  return (
    <div className="min-h-screen bg-canvas">
      {/* minimal page chrome above the phone */}
      <div className="mx-auto flex w-full max-w-[1560px] flex-wrap items-center justify-between gap-2 px-4 py-3">
        <Link href="/" className="vq-glass-pill">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> VenueIQ
        </Link>
        <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-mute">guest view · live demo</p>
        <Link href="/operator" className="vq-glass-pill">
          Operator console <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>

      <div className="flex flex-1 items-start justify-center px-4 pb-10">
        {/* phone frame */}
        <div className="vq-rise w-[392px] max-w-full">
          <div className="rounded-[42px] border border-white/12 bg-white/4 p-2.5 shadow-[0_50px_100px_-50px_rgba(0,0,0,0.95)]">
            <div className="relative flex h-[740px] flex-col overflow-hidden rounded-[34px] bg-ink-950">
              {/* notch */}
              <div className="absolute left-1/2 top-2 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-black/80" aria-hidden />

              {/* status bar */}
              <div className="flex items-center justify-between px-6 pb-1 pt-3">
                <span className="font-mono text-[10.5px] font-medium text-body">{clock}</span>
                <div className="flex items-center gap-1.5 text-dim">
                  <SignalHigh className="h-3 w-3" aria-hidden />
                  <Wifi className="h-3 w-3" aria-hidden />
                  <BatteryFull className="h-3.5 w-3.5" aria-hidden />
                </div>
              </div>

              {snapshot ? (
                <>
                  {/* header */}
                  <div className="px-5 pb-3 pt-2">
                    <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-mute">good evening</p>
                    <h1 className="mt-1 text-[19px] font-medium leading-tight text-body">
                      Global Village, <span className="vq-serif text-[21px] text-dim">Dubai</span>
                    </h1>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="vq-chip vq-chip-xs">
                        <MapPin className="h-2.5 w-2.5 text-mute" aria-hidden />
                        <span className="truncate">
                          {snapshot.zones.find((z) => z.id === snapshot.visitor.zoneId)?.name ?? "—"}
                        </span>
                      </span>
                      <span className="vq-chip vq-chip-xs">roaming · {snapshot.visitor.roamingCountry}</span>
                      <span className="vq-chip vq-chip-xs">
                        <span className="flex items-center gap-0.5">
                          {[1, 2, 3, 4].map((b) => (
                            <span key={b} className={`h-1.5 w-[3px] rounded-sm ${b <= snapshot.visitor.netQuality.bars ? "bg-live" : "bg-white/15"}`} />
                          ))}
                        </span>
                        {snapshot.visitor.netQuality.label}
                      </span>
                    </div>
                  </div>

                  {/* tab content */}
                  <div className="vq-scroll flex-1 overflow-y-auto px-5 pb-4">
                    {tab === "map" && <MapTab snapshot={snapshot} />}
                    {tab === "waits" && <WaitsTab snapshot={snapshot} />}
                    {tab === "alerts" && <AlertsTab snapshot={snapshot} />}
                  </div>

                  {/* tab bar */}
                  <nav className="grid grid-cols-3 gap-1 border-t border-white/10 bg-white/3 px-4 py-2.5" role="tablist" aria-label="Visitor app sections">
                    {([
                      { id: "map", label: "Map", icon: MapPin },
                      { id: "waits", label: "Waits", icon: Timer },
                      { id: "alerts", label: "Alerts", icon: Bell },
                    ] as const).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={tab === t.id}
                        onClick={() => setTab(t.id)}
                        className={`flex cursor-pointer flex-col items-center gap-0.5 rounded-lg py-1.5 transition-colors ${
                          tab === t.id ? "bg-white/8 text-body" : "text-mute hover:text-dim"
                        }`}
                      >
                        <t.icon className="h-4 w-4" aria-hidden />
                        <span className="font-mono text-[9px] uppercase tracking-[0.1em]">{t.label}</span>
                      </button>
                    ))}
                  </nav>
                </>
              ) : (
                <div className="vq-grid-bg flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
                  <div className="relative grid h-12 w-12 place-items-center rounded-xl border border-white/12 bg-white/4">
                    <Smartphone className="h-5 w-5 text-dim" aria-hidden />
                    <span className="absolute inset-0 rounded-xl ring-1 ring-white/25 vq-ping" aria-hidden />
                  </div>
                  <p className="text-[13px] font-medium">
                    Getting you <span className="vq-serif text-[14px] text-dim">inside</span>
                  </p>
                  <p className="max-w-[220px] text-[11px] leading-relaxed text-mute">
                    Syncing with the venue network — this takes a moment.
                  </p>
                </div>
              )}
            </div>
          </div>
          <p className="mt-4 text-center font-mono text-[9.5px] uppercase tracking-[0.14em] text-mute">
            web app — no install, works on arrival
          </p>
        </div>
      </div>
    </div>
  )
}
