"use client";

/**
 * VenueMap — schematic night map of the six zones.
 *
 * Layout is a plain 3×2 CSS grid, not hand-placed pixels. Each card is centred
 * in its own cell, which makes two things true by construction: cards can never
 * overlap each other, and the walkway lines always land on a card's centre
 * because both the grid and the SVG derive from the same LAYOUT table below.
 * The stage has a minimum width inside a scrolling wrapper, so a card can never
 * overflow the panel on a narrow screen either.
 *
 * On depth: the stage is a *recessed well* carrying faint floor markings, and
 * the cards are raised above it. That distinction is the whole reason the plan
 * reads as a place rather than a black rectangle — the floor sits below the
 * canvas, the cards above it, so the eye gets two directions of travel. The
 * landing page gets this for free from its photograph; a console has to build
 * it, which is why the well and the raised card class are load-bearing here and
 * not decoration.
 *
 * On colour: each card carries a 2px status edge and a status-coloured density
 * bar. Colour appears only at that scale. A supervisor scanning six zones needs
 * to see pressure without reading a number, and a coloured mark does that while
 * a coloured panel would not.
 */
import { TrendingDown, TrendingUp } from "lucide-react";
import type { Snapshot, ZoneState } from "@/lib/types";

const STATUS_FG: Record<string, string> = {
  calm: "text-calm",
  filling: "text-filling",
  busy: "text-busy",
  critical: "text-critical",
}
const STATUS_BG: Record<string, string> = {
  calm: "bg-calm",
  filling: "bg-filling",
  busy: "bg-busy",
  critical: "bg-critical",
}

type Cell = { col: 1 | 2 | 3; row: 1 | 2 }

/**
 * The single source of truth for where a zone sits. Both the grid placement and
 * the connector geometry are computed from this: a card centred in grid column
 * `col` of three has its centre at (col - 0.5) / 3 of the stage width, and one in
 * row `row` of two at (row - 0.5) / 2 of its height.
 */
const LAYOUT: Record<string, Cell> = {
  stage: { col: 1, row: 1 },
  transit: { col: 2, row: 1 },
  carnival: { col: 3, row: 1 },
  pavilions: { col: 1, row: 2 },
  food: { col: 2, row: 2 },
  entry: { col: 3, row: 2 },
}

const pctX = (col: number) => `${(((col - 0.5) / 3) * 100).toFixed(4)}%`
const pctY = (row: number) => `${(((row - 0.5) / 2) * 100).toFixed(4)}%`

const STATUS_WORD: Record<string, string> = {
  calm: "calm",
  filling: "filling",
  busy: "busy",
  critical: "critical",
}

function fmtDelta(d: number): string {
  return `${d >= 0 ? "+" : "−"}${Math.abs(d).toLocaleString()}`
}

function ZoneCard({ z }: { z: ZoneState }) {
  const cell = LAYOUT[z.id] ?? { col: 2, row: 2 }
  return (
    <div
      role="group"
      aria-label={`${z.name}: ${z.load.toLocaleString()} guests, ${z.densityPct}% of capacity, ${STATUS_WORD[z.status]}`}
      className="relative w-[148px] overflow-hidden rounded-xl border border-white/8 bg-ink-800 p-2.5 shadow-[0_16px_30px_-20px_rgba(0,0,0,0.95)]"
      style={{ gridColumn: cell.col, gridRow: cell.row }}
    >
      {/* The status edge. Two pixels on the leading side is enough for the eye
          to rank six cards without reading any of them. */}
      <span
        className={`absolute inset-y-2 left-0 w-[2px] rounded-r-full ${STATUS_BG[z.status]}`}
        aria-hidden
      />

      <div className="flex items-center justify-between gap-1.5">
        <p className="truncate text-[11.5px] font-medium text-body">{z.name}</p>
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_BG[z.status]} ${
            z.status === "critical" ? "vq-pulse" : ""
          }`}
        />
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="vq-num text-[18px] font-semibold leading-none text-body">{z.load.toLocaleString()}</span>
        <span className={`vq-num text-[11px] font-semibold ${STATUS_FG[z.status]}`}>{z.densityPct}%</span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all duration-700 ${STATUS_BG[z.status]}`}
          style={{ width: `${Math.min(100, z.densityPct)}%` }}
        />
      </div>
      {/* Trend is direction, not pressure, so it stays on the luminance ramp and
          never borrows a status hue — otherwise a rising *calm* zone would look
          like a warning. */}
      <div className="mt-1.5 flex items-center justify-between gap-1">
        <span className={`flex items-center font-mono text-[10px] font-medium ${z.loadDelta10 >= 0 ? "text-body" : "text-mute"}`}>
          {z.loadDelta10 >= 0 ? (
            <TrendingUp className="mr-0.5 h-3 w-3" aria-hidden />
          ) : (
            <TrendingDown className="mr-0.5 h-3 w-3" aria-hidden />
          )}
          {fmtDelta(z.loadDelta10)}
        </span>
        <span className="truncate font-mono text-[10px] text-mute">
          {z.waitMin !== null && z.waitMin > 0 ? `${z.waitMin}m wait` : `cap ${z.capacity.toLocaleString()}`}
        </span>
      </div>
    </div>
  )
}

export function VenueMap({ snapshot }: { snapshot: Snapshot }) {
  const zones = snapshot.zones
  const above = zones.filter((z) => z.status !== "calm").length

  return (
    <section className="vq-panel flex min-w-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-white/8 px-4 py-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-[14px] font-medium">
            Live <span className="vq-serif text-[15px] text-dim">venue</span>
          </h2>
          <span className="truncate font-mono text-[9.5px] uppercase tracking-[0.14em] text-mute">
            six zones · modelled occupancy
          </span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[9.5px] uppercase tracking-[0.08em] text-mute">
          {(["calm", "filling", "busy", "critical"] as const).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${STATUS_BG[s]}`} /> {s}
            </span>
          ))}
        </div>
      </div>

      <div className="vq-scroll overflow-x-auto px-4 py-4">
        <div className="relative min-w-[680px]">
          {/* The ground plane: recessed, with floor markings so a large dark area
              has a sense of scale instead of reading as empty screen. */}
          <div className="vq-well vq-grid-bg pointer-events-none absolute inset-0" aria-hidden="true" />
          <div
            className="pointer-events-none absolute inset-0 rounded-xl"
            style={{
              background: "radial-gradient(560px 280px at 50% 52%, rgba(255,255,255,0.05), transparent 72%)",
            }}
            aria-hidden="true"
          />

          {/* Walkways — drawn first so the cards always paint over them. */}
          <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
            {zones.map((z) => {
              const cell = LAYOUT[z.id] ?? { col: 2, row: 2 }
              return (
                <line
                  key={z.id}
                  x1="50%"
                  y1="50%"
                  x2={pctX(cell.col)}
                  y2={pctY(cell.row)}
                  stroke="rgba(255,255,255,0.15)"
                  strokeWidth="1"
                  strokeDasharray="3 5"
                />
              )
            })}
            <circle cx="50%" cy="50%" r="3.5" fill="rgba(255,255,255,0.55)" />
            <circle cx="50%" cy="50%" r="11" fill="none" stroke="rgba(255,255,255,0.18)" />
          </svg>

          {/*
            No gaps, deliberately: equal columns and rows with no gutters put
            every card centre at exactly W/6, W/2, 5W/6 and H/4, 3H/4, which is
            what the connector geometry above assumes. The breathing room comes
            from the card being narrower than its cell, not from a gutter.
          */}
          <div className="relative grid min-h-[420px] grid-cols-3 grid-rows-2 items-center justify-items-center">
            <p className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 font-mono text-[9px] uppercase tracking-[0.22em] text-mute/70 sm:block">
              main plaza
            </p>
            {zones.map((z) => (
              <ZoneCard key={z.id} z={z} />
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-white/8 px-4 py-2.5">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-mute">
          load vs capacity · trend = 10-min change
        </span>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-dim">
          {above === 0 ? "all zones calm" : `${above} zone${above > 1 ? "s" : ""} above calm`}
        </span>
      </div>
    </section>
  )
}
