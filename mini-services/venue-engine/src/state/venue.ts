/**
 * Venue state store — everything derives from the deterministic scenario
 * plus whatever the agent layer decides (alerts, reroutes, pushes).
 */
import type { ForecastRow, GuardianAction, GuardianAlert, Snapshot, VisitorNotification, VisitorReroute, ZoneState, ZoneStatus } from '../types'
import { config } from '../config'
import {
  ZONES, VENUE_CAPACITY, DISTRIBUTED_SHARE, curveAt, phaseFor, waitFor,
  clockLabel, visitorZoneAt,
} from '../scenario/timeline'
import { nacStats } from '../nac'
import { llmStats } from '../llm/provider'

/**
 * Public-safe rendering of a device number for the console: the head of the
 * number and its last two digits, nothing in between. Derived from the
 * configured sample rather than written out as a literal, so the label can
 * never name a device the gateway does not actually know.
 */
function maskDevice(phone: string): string {
  if (phone.length <= 6) return phone
  return `${phone.slice(0, phone.length - 4)}••${phone.slice(-2)}`
}

export interface EngineState {
  minuteOfDay: number
  running: boolean
  speed: number
  zones: ZoneState[]
  /** The agent brain's own 30-minute forecast. Preferred over the scenario's
   *  curve look-ahead while it is fresh, because it is the one that was formed
   *  from live signals and then scored against reality. */
  forecastOverride: { atMinute: number; rows: ForecastRow[] } | null
  brain: Snapshot['brain']
  guardianAlert: GuardianAlert | null
  guardianActions: GuardianAction[]
  visitorReroute: VisitorReroute | null
  visitorNotifications: VisitorNotification[]
  visitorRoamingCountry: string
  qodActive: boolean
  pushesSent: number
  reroutesIssued: number
}

function statusOf(pct: number): ZoneStatus {
  if (pct >= 80) return 'critical'
  if (pct >= 60) return 'busy'
  if (pct >= 35) return 'filling'
  return 'calm'
}

const state: EngineState = {
  minuteOfDay: 1080,
  running: false,
  speed: 1,
  zones: [],
  forecastOverride: null,
  brain: {
    mode: config.agent.mode,
    available: false,
    decision: null,
    routing: null,
    reasoning: '',
    salience: 0,
    probes: 0,
    signals: [],
    llmCalls: 0,
    llmBudget: 0,
    apiCalls: 0,
    forecastErrorPct: null,
    budgetExhausted: false,
    graphMs: 0,
  },
  guardianAlert: null,
  guardianActions: [],
  visitorReroute: null,
  visitorNotifications: [],
  visitorRoamingCountry: 'India',
  qodActive: false,
  pushesSent: 0,
  reroutesIssued: 0,
}

export function getState(): EngineState {
  return state
}

export function setForecastOverride(rows: ForecastRow[] | null, minuteOfDay: number): void {
  state.forecastOverride = rows && rows.length ? { atMinute: minuteOfDay, rows } : null
}

/** Merge the agent brain's accounting into the snapshot the console reads. */
export function patchBrain(patch: Partial<Snapshot['brain']>): void {
  state.brain = { ...state.brain, ...patch }
}

export function resetState(): void {
  state.minuteOfDay = 1080
  state.running = false
  state.speed = 1
  state.forecastOverride = null
  state.guardianAlert = null
  state.guardianActions = []
  state.visitorReroute = null
  state.visitorNotifications = []
  state.qodActive = false
  state.pushesSent = 0
  state.reroutesIssued = 0
  computeZones()
}

export function computeZones(): void {
  state.zones = ZONES.map((z) => {
    const load = curveAt(z.curve, state.minuteOfDay)
    const loadPrev = curveAt(z.curve, state.minuteOfDay - 10)
    const densityPct = (load / z.capacity) * 100
    return {
      id: z.id,
      name: z.name,
      short: z.short,
      hue: z.hue,
      capacity: z.capacity,
      load,
      loadDelta10: load - loadPrev,
      densityPct: Math.round(densityPct),
      waitMin: waitFor(z.id, densityPct),
      status: statusOf(densityPct),
      x: z.x,
      y: z.y,
    }
  })
}

/** Advance the clock; returns the new minute. */
export function advanceMinute(): number {
  state.minuteOfDay += 1
  if (state.minuteOfDay > 1380) {
    state.minuteOfDay = 1380
    state.running = false
  }
  computeZones()
  return state.minuteOfDay
}

export function zoneById(id: string): ZoneState | undefined {
  return state.zones.find((z) => z.id === id)
}

/** Venue-wide totals. Shared with the agent payload so the brain and the
 *  console can never disagree about how many people are on site. */
export function venueTotals(): { onSite: number; capacity: number; arrivals10: number; exits10: number } {
  const zoneLoad = state.zones.reduce((a, z) => a + z.load, 0)
  const onSite = Math.round(zoneLoad * (1 + DISTRIBUTED_SHARE))
  const prevLoad = ZONES.reduce((a, z) => a + curveAt(z.curve, state.minuteOfDay - 10), 0)
  const prevOnSite = Math.round(prevLoad * (1 + DISTRIBUTED_SHARE))
  return {
    onSite,
    capacity: VENUE_CAPACITY,
    arrivals10: Math.max(0, onSite - prevOnSite),
    exits10: Math.max(0, prevOnSite - onSite),
  }
}

export function buildSnapshot(): Snapshot {
  computeZones()
  const zones = state.zones
  const { onSite, arrivals10, exits10 } = venueTotals()
  const busiest = [...zones].sort((a, b) => b.densityPct - a.densityPct)[0]

  // Forecast rows: the agent brain's live-signal forecast while it is fresh,
  // otherwise the deterministic curve look-ahead so the panel is never empty.
  const fresh =
    state.forecastOverride !== null &&
    state.minuteOfDay - state.forecastOverride.atMinute <= config.agentEveryMinutes * 2
  const forecast = fresh
    ? state.forecastOverride!.rows
    : ZONES.map((z) => {
        const now = (curveAt(z.curve, state.minuteOfDay) / z.capacity) * 100
        const plus = (curveAt(z.curve, state.minuteOfDay + 30) / z.capacity) * 100
        const risk: 'low' | 'medium' | 'high' = plus >= 80 || plus - now >= 25 ? 'high' : plus >= 60 ? 'medium' : 'low'
        return { zoneId: z.id, label: z.short, nowPct: Math.round(now), plus30Pct: Math.round(plus), risk }
      }).sort((a, b) => b.plus30Pct - a.plus30Pct)

  const m = state.minuteOfDay
  const visitorZone = visitorZoneAt(m)
  const z = zones.find((zz) => zz.id === visitorZone)
  const netBars = state.qodActive ? 4 : z && z.status === 'critical' ? 2 : 3

  return {
    engine: {
      clockLabel: clockLabel(m),
      minuteOfDay: m,
      phase: phaseFor(m),
      running: state.running,
      speed: state.speed,
    },
    llm: llmStats(),
    venue: {
      onSite,
      capacity: VENUE_CAPACITY,
      arrivals10,
      exits10,
      busiestZone: busiest ? busiest.name : '—',
      alertsActive: state.guardianAlert ? 1 : 0,
      pushesSent: state.pushesSent,
      reroutesIssued: state.reroutesIssued,
    },
    zones,
    forecast,
    guardian: {
      activeAlert: state.guardianAlert,
      actionsTaken: state.guardianActions.slice(-6),
    },
    visitor: {
      label: `Visitor · ${maskDevice(config.nac.sampleDevice)}`,
      zoneId: visitorZone,
      roamingCountry: state.visitorRoamingCountry,
      roamingOk: true,
      netQuality: { label: state.qodActive ? 'QoD boost active' : '5G · du', bars: netBars },
      reroute: state.visitorReroute,
      notifications: state.visitorNotifications.slice(-5),
      waits: zones
        .filter((zz) => zz.waitMin !== null && zz.load > 30)
        .map((zz) => ({ zone: zz.short, waitMin: zz.waitMin as number, trend: zz.loadDelta10 > 40 ? ('up' as const) : zz.loadDelta10 < -40 ? ('down' as const) : ('flat' as const) }))
        .sort((a, b) => b.waitMin - a.waitMin)
        .slice(0, 4),
    },
    nac: nacStats(),
    brain: { ...state.brain, available: state.brain.available },
  }
}
