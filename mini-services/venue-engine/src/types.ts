/** Shared types for the VenueIQ engine and its clients. */

export type ZoneStatus = 'calm' | 'filling' | 'busy' | 'critical'
export type ZoneHue = 'stage' | 'pavilion' | 'carnival' | 'transit' | 'entry' | 'food'

export interface ZoneState {
  id: string
  name: string
  short: string
  hue: ZoneHue
  capacity: number
  load: number
  /** Change over the last 10 simulated minutes. */
  loadDelta10: number
  densityPct: number
  waitMin: number | null
  status: ZoneStatus
  /** Map coordinates on a 0-100 grid. */
  x: number
  y: number
}

export interface ForecastRow {
  zoneId: string
  label: string
  nowPct: number
  plus30Pct: number
  risk: 'low' | 'medium' | 'high'
}

export interface GuardianAlert {
  zoneId: string
  title: string
  detail: string
  severity: 'warn' | 'critical'
  sinceLabel: string
  actions: string[]
}

export interface GuardianAction {
  label: string
  atLabel: string
}

export interface VisitorNotification {
  title: string
  body: string
  atLabel: string
  kind: 'info' | 'warn' | 'reroute'
}

export interface VisitorWait {
  zone: string
  waitMin: number
  trend: 'up' | 'down' | 'flat'
}

export interface VisitorReroute {
  fromZone: string
  toZone: string
  viaZone: string
  reason: string
  savedMin: number
}

export interface Snapshot {
  engine: {
    clockLabel: string
    minuteOfDay: number
    phase: string
    running: boolean
    speed: number
  }
  llm: {
    mode: 'ollama' | 'gemini' | 'templates'
    model: string
    calls: number
    errors: number
  }
  venue: {
    onSite: number
    capacity: number
    arrivals10: number
    exits10: number
    busiestZone: string
    alertsActive: number
    pushesSent: number
    reroutesIssued: number
  }
  zones: ZoneState[]
  forecast: ForecastRow[]
  guardian: {
    activeAlert: GuardianAlert | null
    actionsTaken: GuardianAction[]
  }
  visitor: {
    label: string
    zoneId: string
    roamingCountry: string
    roamingOk: boolean
    netQuality: { label: string; bars: number }
    reroute: VisitorReroute | null
    notifications: VisitorNotification[]
    /** Queue waits, longest first. Only zones where a queue physically exists. */
    waits: VisitorWait[]
  }
  nac: {
    calls: number
    errors: number
    /** `mode` is per-API: an endpoint that fell back to the sandbox says so. */
    apis: { id: string; label: string; calls: number; mode: 'live' | 'sandbox' | 'unknown' }[]
    mode: 'live' | 'sandbox'
  }
  /** The agent brain's own accounting, so its spend and its choices are on
   *  screen rather than buried in a log. Present only in langgraph mode. */
  brain: {
    mode: 'langgraph' | 'ts'
    available: boolean
    decision: 'ACT' | 'PROBE' | 'HOLD' | null
    routing: 'ACT' | 'PROBE' | 'HOLD' | null
    reasoning: string
    salience: number
    probes: number
    signals: string[]
    llmCalls: number
    llmBudget: number
    apiCalls: number
    forecastErrorPct: number | null
    budgetExhausted: boolean
    graphMs: number
    lastError?: string
  }
}

export type TraceAgent = 'BRAIN' | 'SENTINEL' | 'ORACLE' | 'NAVIGATOR' | 'GUARDIAN' | 'COORDINATOR' | 'NAC' | 'ENGINE'
export type TraceKind = 'observe' | 'reason' | 'decision' | 'action' | 'signal' | 'system'
export type TraceSource = 'llm' | 'template' | 'api'

export interface TraceEvent {
  id: number
  atLabel: string
  agent: TraceAgent
  kind: TraceKind
  text: string
  detail?: string
  source: TraceSource
  level: 'info' | 'warn' | 'critical'
}

export type ControlAction =
  | { action: 'play' }
  | { action: 'pause' }
  | { action: 'reset' }
  | { action: 'speed'; value: number }
