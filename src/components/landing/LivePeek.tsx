"use client";

/**
 * LivePeek — the landing page's signature element: a miniature of the real
 * operator console, fed live from the simulation engine. Zone density bars
 * plus the latest agent decisions, streaming.
 */
import { Activity, RadioTower } from "lucide-react";
import { useEngineStore } from "@/lib/engine-client";
import type { TraceEvent } from "@/lib/types";

/**
 * Same colour language as the console's trace panel: a luminance ramp, with the
 * safety agent as the only hue. A per-agent rainbow here would contradict the
 * one rule the whole product rests on — if something is coloured, it is a
 * warning. Kept in step with `operator/TracePanel.tsx`.
 */
const AGENT_STYLE: Record<string, { fg: string; dot: string }> = {
  BRAIN: { fg: "text-body", dot: "bg-body" },
  SENTINEL: { fg: "text-dim", dot: "bg-dim" },
  ORACLE: { fg: "text-dim", dot: "bg-dim" },
  NAVIGATOR: { fg: "text-dim", dot: "bg-dim" },
  GUARDIAN: { fg: "text-critical", dot: "bg-critical" },
  COORDINATOR: { fg: "text-mute", dot: "bg-mute" },
  NAC: { fg: "text-mute", dot: "bg-mute" },
  ENGINE: { fg: "text-mute", dot: "bg-mute" },
}

function statusColor(pct: number): string {
  if (pct >= 80) return "bg-critical"
  if (pct >= 60) return "bg-busy"
  if (pct >= 35) return "bg-filling"
  return "bg-calm"
}

export function LivePeek() {
  const snapshot = useEngineStore((s) => s.snapshot)
  const connected = useEngineStore((s) => s.connected)
  const traces = useEngineStore((s) => s.traces)

  const zones = (snapshot?.zones ?? []).slice(0, 6)
  const latest = traces.slice(-4).reverse()

  return (
    <div className="vq-panel relative overflow-hidden">
      {/* header */}
      <div className="flex items-center justify-between border-b border-white/6 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-live vq-pulse" : "bg-critical"}`} />
          <span className="font-mono text-[11px] tracking-[0.14em] text-dim uppercase">
            {connected ? "live demo · global village replay" : "engine offline"}
          </span>
        </div>
        <span className="vq-num text-sm font-semibold text-body">
          {snapshot?.engine.clockLabel ?? "--:--"}
        </span>
      </div>

      {/* zone density bars on a faint monitor grid */}
      <div className="vq-grid-bg grid gap-3 px-5 py-5">
        {zones.length === 0 && (
          <div className="flex h-44 items-center justify-center gap-2 text-[12px] text-mute">
            <RadioTower className="h-4 w-4" aria-hidden /> waiting for the engine…
          </div>
        )}
        {zones.map((z, i) => (
          <div key={z.id} className="grid grid-cols-[104px_1fr_84px] items-center gap-3" style={{ animationDelay: `${i * 60}ms` }}>
            <span className="truncate text-[12px] text-dim">{z.name}</span>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/6">
              <div
                className={`h-full rounded-full transition-all duration-700 ${statusColor(z.densityPct)}`}
                style={{ width: `${Math.min(100, z.densityPct)}%` }}
              />
            </div>
            <span className="text-right">
              <span className="vq-num text-[12.5px] font-semibold text-body">{z.densityPct}%</span>
              <span className="ml-1.5 font-mono text-[10px] text-mute">{(z.load / 1000).toFixed(1)}k</span>
            </span>
          </div>
        ))}
      </div>

      {/* agent ticker */}
      <div className="border-t border-white/6 bg-ink-950/40 px-4 py-3">
        <div className="mb-2 flex items-center gap-1.5">
          <Activity className="h-3 w-3 text-body" aria-hidden />
          <span className="font-mono text-[10px] tracking-[0.18em] text-mute uppercase">agent decisions</span>
        </div>
        <div className="grid gap-1.5">
          {latest.length === 0 && (
            <p className="text-[11px] text-mute">The evening hasn&apos;t started yet — press play in the operator console.</p>
          )}
          {latest.map((t: TraceEvent) => (
            <div key={t.id} className="vq-slide-in flex items-baseline gap-2 overflow-hidden">
              <span className="font-mono text-[10.5px] text-mute">{t.atLabel}</span>
              <span className={`h-1 w-1 shrink-0 translate-y-[-2px] rounded-full ${AGENT_STYLE[t.agent]?.dot ?? "bg-mute"}`} />
              <span className={`font-mono text-[10px] tracking-wider ${AGENT_STYLE[t.agent]?.fg ?? "text-mute"}`}>{t.agent}</span>
              <span className="truncate text-[11.5px] text-body/80">{t.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
