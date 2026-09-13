"use client";

/**
 * TracePanel — the agent reasoning feed: newest first, one row per decision,
 * agent chips, level accents, source badges. This is the panel judges watch, so
 * it must read at a glance — which is why the router's own decision line is the
 * only row that gets a highlight.
 */
import { useState } from "react";
import { Bot, BrainCircuit, CircuitBoard, GitBranch, ScanEye, Siren, Waypoints } from "lucide-react";
import { useEngineStore } from "@/lib/engine-client";
import type { TraceAgent, TraceEvent } from "@/lib/types";

/**
 * Agents are distinguished by icon and by weight, not by hue — the one hue in
 * this system belongs to the Guardian, whose business is safety.
 */
const AGENT_META: Record<string, { fg: string; bg: string; icon: typeof Bot }> = {
  // BRAIN is the LangGraph router — the node that decides ACT / PROBE / HOLD.
  // It gets the brightest chip because that decision is the thing to watch.
  BRAIN: { fg: "text-body", bg: "bg-white/12 border-white/30", icon: BrainCircuit },
  SENTINEL: { fg: "text-dim", bg: "bg-white/5 border-white/15", icon: ScanEye },
  ORACLE: { fg: "text-dim", bg: "bg-white/5 border-white/15", icon: GitBranch },
  NAVIGATOR: { fg: "text-dim", bg: "bg-white/5 border-white/15", icon: Waypoints },
  GUARDIAN: { fg: "text-critical", bg: "bg-critical/12 border-critical/30", icon: Siren },
  COORDINATOR: { fg: "text-mute", bg: "bg-white/4 border-white/12", icon: CircuitBoard },
  NAC: { fg: "text-mute", bg: "bg-white/4 border-white/10", icon: CircuitBoard },
  ENGINE: { fg: "text-mute", bg: "bg-white/4 border-white/10", icon: CircuitBoard },
}

const LEVEL_BORDER: Record<string, string> = {
  info: "border-l-white/10",
  warn: "border-l-white/40",
  critical: "border-l-critical/80",
}

const FILTERS: { id: string; label: string; agents: TraceAgent[] }[] = [
  { id: "all", label: "All", agents: [] },
  { id: "agents", label: "Agents", agents: ["BRAIN", "SENTINEL", "ORACLE", "NAVIGATOR", "GUARDIAN"] },
  { id: "decisions", label: "Decisions", agents: ["BRAIN"] },
  { id: "guardian", label: "Safety", agents: ["GUARDIAN"] },
  { id: "network", label: "Network", agents: ["NAC"] },
]

function TraceRow({ e }: { e: TraceEvent }) {
  const meta = AGENT_META[e.agent] ?? AGENT_META.ENGINE
  const Icon = meta.icon
  // A decision line is the graph choosing, not merely reporting — mark it so a
  // reviewer can find the moment the system was not scripted to make.
  const isDecision = e.agent === "BRAIN" && e.kind === "decision"
  return (
    <div
      className={`flex min-w-0 items-start gap-2.5 border-l-2 py-[7px] pl-3 pr-2 ${LEVEL_BORDER[e.level]} ${
        isDecision ? "bg-white/8" : ""
      }`}
    >
      <span className="mt-px shrink-0 font-mono text-[9.5px] leading-4 text-mute">{e.atLabel}</span>
      <span className={`mt-0.5 flex shrink-0 items-center gap-1 rounded border px-1.5 py-px font-mono text-[8.5px] tracking-[0.08em] ${meta.bg} ${meta.fg}`}>
        <Icon className="h-2.5 w-2.5" aria-hidden />
        {e.agent}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] leading-snug text-dim">{e.text}</p>
        {e.detail && <p className="mt-0.5 truncate font-mono text-[9px] text-mute">{e.detail}</p>}
      </div>
      {e.source === "llm" && (
        <span className="mt-1 shrink-0 rounded border border-white/12 bg-white/8 px-1.5 py-px font-mono text-[8px] tracking-[0.1em] text-dim">
          LLM
        </span>
      )}
      {e.source === "api" && (
        <span className="mt-1 shrink-0 rounded border border-white/10 bg-white/4 px-1.5 py-px font-mono text-[8px] tracking-[0.1em] text-mute">
          API
        </span>
      )}
    </div>
  )
}

export function TracePanel() {
  const traces = useEngineStore((s) => s.traces)
  const [filter, setFilter] = useState("all")
  const activeFilter = FILTERS.find((f) => f.id === filter)!
  const rows = [...traces]
    .reverse()
    .filter((t) => activeFilter.agents.length === 0 || activeFilter.agents.includes(t.agent))
    .slice(0, 40)

  return (
    <section className="vq-panel flex h-[300px] min-w-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-white/8 px-4 py-2.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-[14px] font-medium">
            Agent <span className="vq-serif text-[15px] text-dim">trace</span>
          </h2>
          <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-[0.12em] text-mute">{traces.length} events</span>
        </div>
        <div className="vq-seg" role="group" aria-label="Filter the trace">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" data-on={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="vq-scroll grid min-w-0 content-start gap-0.5 overflow-y-auto px-3 py-2">
        {rows.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-[11.5px] text-mute">
            No events yet — press play and the reasoning stream starts here.
          </div>
        ) : (
          rows.map((e) => <TraceRow key={e.id} e={e} />)
        )}
      </div>
    </section>
  )
}
