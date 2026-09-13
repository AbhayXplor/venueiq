/**
 * Wire types for the agent brain contract.
 *
 * These mirror `mini-services/agent-brain/app/schemas.py`. They live in the
 * engine rather than in the shared snapshot types on purpose: the frontend
 * never speaks to the brain, so it has no business knowing about them.
 */
import type { TraceAgent, TraceEvent, TraceKind, TraceSource } from '../types'

export interface BrainPayload {
  cycle: number
  runId: string
  minuteOfDay: number
  clockLabel: string
  phase: string
  speed: number
  zones: {
    id: string
    name: string
    short: string
    capacity: number
    load: number
    loadDelta10: number
    densityPct: number
    waitMin: number | null
    status: string
  }[]
  venue: {
    onSite: number
    capacity: number
    arrivals10: number
    exits10: number
    busiestZone: string
  }
  visitor: { zoneId: string; phone: string }
  budget: { llmCallsUsed: number; llmCallsMax: number; apiCallsUsed: number }
}

export interface BrainForecastRow {
  zoneId: string
  label: string
  nowPct: number
  plus30Pct: number
  risk: 'low' | 'medium' | 'high'
}

export interface BrainGuardian {
  raise: boolean
  zoneId?: string
  severity: 'warn' | 'critical'
  headline: string
  detail: string
  actions: string[]
}

export interface BrainReroute {
  targetZoneId: string
  reason: string
  visitorMessage: string
}

export interface BrainTraceLine {
  agent: TraceAgent
  kind: TraceKind
  text: string
  source: TraceSource
  level: TraceEvent['level']
  detail?: string
}

export interface BrainStats {
  decision: 'ACT' | 'PROBE' | 'HOLD'
  routing?: 'ACT' | 'PROBE' | 'HOLD'
  confidence: number
  llmCalls: number
  llmProvider: string
  llmTotalCalls: number
  llmBudget: number
  apiCalls: number
  signals: string[]
  probes: number
  salience: number
  forecastErrorPct: number | null
  budgetExhausted: boolean
  nacMode: 'live' | 'sandbox'
  /** Per-endpoint verdict from the brain's own client. */
  signalModes?: Record<string, 'live' | 'sandbox'>
  graphMs: number
  apiByEndpoint: Record<string, number>
}

export interface BrainCycleResponse {
  mode: 'langgraph'
  decision: 'ACT' | 'PROBE' | 'HOLD'
  reasoning: string
  confidence: number
  forecast: BrainForecastRow[]
  guardian: BrainGuardian | null
  guardianClear: boolean
  reroute: BrainReroute | null
  trace: BrainTraceLine[]
  stats: BrainStats
}

export interface BrainHealth {
  ok: boolean
  mode: 'langgraph'
  llm: { mode: string; providers: { id: string; model: string; healthy: boolean; calls: number; errors: number }[] }
  nac: { mode: 'live' | 'sandbox'; lastStatus: string }
  budget: { llmBudget: number; llmCalls: number; llmRemaining: number; apiCalls: number }
  lastDecision: string
  runId: string
}
