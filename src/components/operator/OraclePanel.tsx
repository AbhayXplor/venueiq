"use client";

/**
 * OraclePanel — 30-minute zone outlook with now → +30 density movement,
 * plus the Oracle agent's latest plain-language risk statement.
 */
import { LineChart } from "lucide-react";
import { useEngineStore } from "@/lib/engine-client";
import type { Snapshot } from "@/lib/types";

const RISK_FG: Record<string, string> = { low: "text-calm", medium: "text-filling", high: "text-critical" }
const RISK_BG: Record<string, string> = { low: "bg-calm", medium: "bg-filling", high: "bg-critical" }

export function OraclePanel({ snapshot }: { snapshot: Snapshot }) {
  const traces = useEngineStore((s) => s.traces)
  const oracleLine = [...traces].reverse().find((t) => t.agent === "ORACLE" && t.kind === "reason")

  return (
    <section className="vq-panel flex min-w-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-white/8 px-4 py-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <LineChart className="h-3.5 w-3.5 self-center text-dim" aria-hidden />
          <h2 className="text-[14px] font-medium">
            Forecast <span className="vq-serif text-[15px] text-dim">Oracle</span>
          </h2>
        </div>
        <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-[0.14em] text-mute">30-min outlook</span>
      </div>

      <div className="grid min-w-0 gap-3.5 p-4">
        {oracleLine && (
          <div className="min-w-0 rounded-xl border border-white/10 bg-ink-800 p-3">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-mute">latest call</span>
              <span className="rounded border border-white/12 bg-white/10 px-1.5 py-px font-mono text-[8.5px] uppercase tracking-wide text-dim">
                {oracleLine.source === "llm" ? "llm" : "rules"}
              </span>
            </div>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-dim">{oracleLine.text}</p>
          </div>
        )}

        <div className="grid min-w-0 gap-1">
          {snapshot.forecast.map((f) => (
            <div key={f.zoneId} className="grid min-w-0 grid-cols-[86px_minmax(0,1fr)_46px] items-center gap-2 py-0.5">
              <span className="truncate text-[11px] text-dim">{f.label}</span>
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="vq-num w-7 shrink-0 text-right text-[10.5px] text-mute">{f.nowPct}%</span>
                <span className="shrink-0 text-[10px] text-mute">→</span>
                <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${RISK_BG[f.risk]}`}
                    style={{ width: `${Math.min(100, f.plus30Pct)}%` }}
                  />
                </div>
                <span className={`vq-num w-7 shrink-0 text-[10.5px] ${RISK_FG[f.risk]}`}>{f.plus30Pct}%</span>
              </div>
              <span className={`truncate text-right font-mono text-[9px] uppercase ${RISK_FG[f.risk]}`}>{f.risk}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
