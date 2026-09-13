"use client";

/**
 * SignalBoard — one row per CAMARA endpoint, with the truth about where its
 * data came from this session.
 *
 * Two things this board exists to do:
 *
 * 1. Show the depth of the gateway integration without a slide. Seven
 *    endpoints, each with its own live/sandbox mark, because a single global
 *    "live" badge would hide the endpoint that quietly degraded.
 * 2. Carry the honesty of the measurement. Occupancy is the venue's own model;
 *    Congestion Insights reports how congested the network is, which is an
 *    early indicator of crowd pressure — not a headcount. The caption says so
 *    on screen, so the console can never imply a per-zone census.
 */
import { useEngineStore } from "@/lib/engine-client";
import type { Snapshot } from "@/lib/types";

/**
 * Only two states are worth a mark, and one of them is the honest failure:
 * live is a plain white dot, sandbox is the red one. `unknown` is the boot
 * state before the first probe answers.
 */
const MODE_META: Record<string, { dot: string; label: string; text: string }> = {
  // "Up" is a health state, not a pressure state, so it uses the neutral live
  // token and never borrows a status hue — otherwise a healthy endpoint would
  // look like a warming one. Sandbox is the honest failure, and red on an
  // endpoint that has degraded is exactly what an operator must be able to see.
  live: { dot: "bg-live", label: "live", text: "text-dim" },
  sandbox: { dot: "bg-critical", label: "sandbox", text: "text-critical" },
  unknown: { dot: "bg-idle", label: "idle", text: "text-mute" },
}

export function SignalBoard({ nac }: { nac: Snapshot["nac"] }) {
  const unreported = nac.apis.filter((a) => a.mode === "sandbox").length

  return (
    <section className="vq-panel min-w-0 overflow-hidden px-4 py-3" aria-label="Carrier signal board">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-[13.5px] font-medium">
            Carrier <span className="vq-serif text-[14.5px] text-dim">signals</span>
          </h2>
          <span className="truncate font-mono text-[9px] uppercase tracking-[0.14em] text-mute">Nokia NaC / CAMARA</span>
        </div>
        <p className="font-mono text-[9.5px] text-mute">
          {nac.calls} calls
          {unreported > 0 ? ` · ${unreported} on sandbox fallback` : " · all endpoints live"}
        </p>
      </div>

      <ul className="mt-2.5 grid min-w-0 grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {nac.apis.map((api) => {
          const meta = MODE_META[api.mode] ?? MODE_META.unknown
          return (
            <li
              key={api.id}
              className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-white/8 bg-ink-800 px-2.5 py-1.5"
            >
              <span className="min-w-0">
                <span className="block truncate text-[10.5px] font-medium text-dim">{api.label}</span>
                <span className="font-mono text-[8.5px] text-mute">{api.calls} calls</span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden />
                <span className={`font-mono text-[8px] uppercase tracking-[0.1em] ${meta.text}`}>{meta.label}</span>
              </span>
            </li>
          )
        })}
      </ul>

      <p className="mt-2 text-[10.5px] leading-relaxed text-mute">
        Zone occupancy is modelled from the venue&apos;s own probe devices. Congestion Insights reports
        <span className="text-dim"> network congestion as an early indicator of crowd pressure</span> — it is
        not a per-zone headcount, and an endpoint on sandbox fallback is marked as such rather than hidden.
      </p>
    </section>
  )
}
