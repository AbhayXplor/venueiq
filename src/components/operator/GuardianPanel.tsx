"use client";

/**
 * GuardianPanel — the safety agent's surface: live alert, one-click operator
 * actions, and the actions already taken this evening.
 */
import { Bell, CheckCircle2, ShieldAlert, Zap } from "lucide-react";
import { sendGuardianAction } from "@/lib/engine-client";
import type { Snapshot } from "@/lib/types";

const ACTIONS: { id: string; label: string; hint: string }[] = [
  { id: "deploy-marshals", label: "Deploy marshals", hint: "field team" },
  { id: "throttle-gates", label: "Throttle gates", hint: "inflow 40%" },
  { id: "reroute-flow", label: "Reroute flow", hint: "steer away" },
  { id: "boost-comms", label: "Boost comms", hint: "QoD slice" },
  { id: "safety-slice", label: "Safety slice", hint: "priority" },
]

export function GuardianPanel({ snapshot }: { snapshot: Snapshot }) {
  const alert = snapshot.guardian.activeAlert
  const actions = snapshot.guardian.actionsTaken

  return (
    <section className="vq-panel flex min-w-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-white/8 px-4 py-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <ShieldAlert className={`h-3.5 w-3.5 self-center ${alert ? "text-critical" : "text-calm"}`} aria-hidden />
          <h2 className="text-[14px] font-medium">
            Safety <span className="vq-serif text-[15px] text-dim">Guardian</span>
          </h2>
        </div>
        <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-[0.14em] text-mute">thresholds · gates</span>
      </div>

      <div className="grid min-w-0 gap-3.5 p-4">
        {alert ? (
          <div
            className={`vq-slide-in rounded-xl border p-3.5 ${
              alert.severity === "critical" ? "border-critical/40 bg-ink-800" : "border-filling/35 bg-ink-800"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${alert.severity === "critical" ? "bg-critical vq-pulse" : "bg-filling"}`} />
              <p className={`truncate text-[12.5px] font-medium ${alert.severity === "critical" ? "text-critical" : "text-body"}`}>
                {alert.title}
              </p>
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-dim">{alert.detail}</p>
            <p className="mt-2 font-mono text-[9.5px] text-mute">since {alert.sinceLabel}</p>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-ink-800 p-3.5">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-calm" aria-hidden />
            <div className="min-w-0">
              <p className="text-[12px] text-body">
                All densities within <span className="vq-serif text-[13px] text-dim">thresholds</span>
              </p>
              <p className="mt-0.5 text-[11px] text-mute">Guardian is watching — alerts land here.</p>
            </div>
          </div>
        )}

        <div className="min-w-0">
          <p className="mb-2 font-mono text-[9.5px] uppercase tracking-[0.16em] text-mute">one-click actions</p>
          <div className="grid min-w-0 grid-cols-2 gap-2">
            {ACTIONS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => sendGuardianAction(a.id, alert?.zoneId)}
                disabled={!alert}
                className="flex min-w-0 cursor-pointer flex-col gap-0.5 rounded-lg border border-white/10 bg-ink-800 px-3 py-2.5 text-left transition-colors enabled:hover:border-white/45 enabled:hover:bg-hover disabled:cursor-not-allowed disabled:opacity-35"
              >
                <span className="truncate text-[11.5px] font-medium text-body">{a.label}</span>
                <span className="truncate font-mono text-[9px] uppercase tracking-[0.1em] text-mute">{a.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {actions.length > 0 && (
          <div className="min-w-0">
            <p className="mb-2 font-mono text-[9.5px] uppercase tracking-[0.16em] text-mute">actions taken tonight</p>
            <div className="grid min-w-0 gap-1.5">
              {actions.map((a, i) => (
                <div key={`${a.label}-${i}`} className="flex items-center gap-2 text-[11px] text-dim">
                  <Zap className="h-3 w-3 shrink-0 text-mute" aria-hidden />
                  <span className="min-w-0 truncate">{a.label}</span>
                  <span className="ml-auto shrink-0 font-mono text-[9.5px] text-mute">{a.atLabel}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {snapshot.visitor.notifications.length > 0 && (
          <div className="min-w-0">
            <p className="mb-2 font-mono text-[9.5px] uppercase tracking-[0.16em] text-mute">visitor pushes</p>
            <div className="grid min-w-0 gap-1.5">
              {snapshot.visitor.notifications.slice(-3).reverse().map((n, i) => (
                <div key={i} className="flex min-w-0 items-start gap-2 rounded-lg border border-white/8 bg-ink-800 px-2.5 py-2">
                  <Bell className="mt-0.5 h-3 w-3 shrink-0 text-mute" aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-medium text-body">{n.title}</p>
                    <p className="truncate text-[10.5px] text-mute">{n.body}</p>
                  </div>
                  <span className="ml-auto shrink-0 font-mono text-[9px] text-mute">{n.atLabel}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
