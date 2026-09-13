/**
 * Coordinator — runs the agent graph on a schedule and owns the trace feed.
 *
 * Graph shape (mirrors the LangGraph pattern from our pitch deck):
 *   SENTINEL -> ORACLE -> (risk?) -> NAVIGATOR + GUARDIAN -> ENGINE actions
 * Safety outranks comfort: a critical zone triggers Guardian first, then the
 * Navigator reroute, in the same cycle.
 */
import type { TraceAgent, TraceEvent, TraceKind, TraceSource } from '../types'
import { config } from '../config'
import { getState, patchBrain, setForecastOverride, venueTotals, zoneById } from '../state/venue'
import { adoptExternalNac, VISITOR_SAMPLE } from '../nac'
import { noteExternalLlm } from '../llm/provider'
import { clockLabel as simClock, phaseFor, visitorZoneAt } from '../scenario/timeline'
import { runSentinel, runOracle, runNavigator, runGuardian } from './agents'
import { brainReset, brainShouldTry, brainStatus, runBrainCycle } from './brain-client'
import type { BrainPayload } from './brain-types'

export interface TraceEmitOptions {
  source?: TraceSource
  level?: TraceEvent['level']
  detail?: string
}

export type TraceEmitter = (agent: TraceAgent, kind: TraceKind, text: string, opts?: TraceEmitOptions) => void

let traceId = 1
const traceBuffer: TraceEvent[] = []
const listeners = new Set<(e: TraceEvent) => void>()

export function emitTrace(agent: TraceAgent, kind: TraceKind, text: string, opts: TraceEmitOptions = {}): void {
  const event: TraceEvent = {
    id: traceId++,
    atLabel: `${String(Math.floor(getState().minuteOfDay / 60)).padStart(2, '0')}:${String(getState().minuteOfDay % 60).padStart(2, '0')}`,
    agent,
    kind,
    text,
    detail: opts.detail,
    source: opts.source ?? 'template',
    level: opts.level ?? 'info',
  }
  traceBuffer.push(event)
  if (traceBuffer.length > 400) traceBuffer.splice(0, traceBuffer.length - 400)
  for (const l of listeners) l(event)
}

export function onTrace(fn: (e: TraceEvent) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function recentTrace(n = 60): TraceEvent[] {
  return traceBuffer.slice(-n)
}

let running = false
let cycleCount = 0
let runId = config.agent.runId

export function agentRunId(): string {
  return runId
}

/** Tell the brain to forget the run, so a scenario reset cannot inherit a
 *  stale baseline or a half-spent budget. */
export async function resetAgents(nextRunId: string): Promise<void> {
  runId = nextRunId
  cycleCount = 0
  await brainReset(nextRunId)
}

// ---------------------------------------------------------------------------
// LangGraph path — the brain decides, this process applies.
// ---------------------------------------------------------------------------

async function runLanggraphCycle(): Promise<boolean> {
  const s = getState()
  const clock = simClock(s.minuteOfDay)
  const payload: BrainPayload = {
    cycle: ++cycleCount,
    runId,
    minuteOfDay: s.minuteOfDay,
    clockLabel: clock,
    phase: phaseFor(s.minuteOfDay),
    speed: s.speed,
    zones: s.zones.map((z) => ({
      id: z.id,
      name: z.name,
      short: z.short,
      capacity: z.capacity,
      load: z.load,
      loadDelta10: z.loadDelta10,
      densityPct: z.densityPct,
      waitMin: z.waitMin,
      status: z.status,
    })),
    venue: {
      ...venueTotals(),
      busiestZone: [...s.zones].sort((a, b) => b.densityPct - a.densityPct)[0]?.name ?? '—',
    },
    visitor: { zoneId: visitorZoneAt(s.minuteOfDay), phone: VISITOR_SAMPLE },
    budget: {
      llmCallsUsed: s.brain.llmCalls,
      llmCallsMax: s.brain.llmBudget,
      apiCallsUsed: s.brain.apiCalls,
    },
  }

  const res = await runBrainCycle(payload)
  if (!res) {
    const st = brainStatus()
    emitTrace('BRAIN', 'system', 'Agent brain unreachable — this cycle runs on the TypeScript chain', {
      source: 'api',
      level: 'warn',
      detail: st.lastError || st.url,
    })
    patchBrain({ available: false, mode: 'ts', lastError: st.lastError })
    return false
  }

  // 1. The reasoning itself, verbatim, into the console feed.
  for (const e of res.trace) {
    emitTrace(e.agent, e.kind, e.text, { source: e.source, level: e.level, detail: e.detail })
  }

  // 2. The forecast the graph formed from live signals.
  setForecastOverride(res.forecast, s.minuteOfDay)

  // 3. The safety actions it chose.
  if (res.guardian?.raise && res.guardian.zoneId) {
    const existing = s.guardianAlert
    const unchanged =
      existing?.zoneId === res.guardian.zoneId && existing?.severity === res.guardian.severity
    s.guardianAlert = {
      zoneId: res.guardian.zoneId,
      title: res.guardian.headline || existing?.title || 'Occupancy building',
      detail: res.guardian.detail || '',
      severity: res.guardian.severity,
      // Keep the original "since" while the situation is unchanged, so the
      // console shows how long the zone has been in trouble rather than
      // restarting the clock every cycle.
      sinceLabel: unchanged ? existing!.sinceLabel : clock,
      actions: res.guardian.actions.length ? res.guardian.actions : ['deploy-marshals', 'throttle-gates'],
    }
  } else if (res.guardianClear && s.guardianAlert) {
    // The brain already traced the clearance; just apply the state.
    s.guardianAlert = null
  }

  // 4. The visitor-facing consequence, if it decided to reroute.
  if (res.reroute?.targetZoneId) {
    applyReroute(res.reroute.targetZoneId, res.reroute.reason, res.reroute.visitorMessage)
  }

  // 5. Its accounting, so the spend is on screen.
  const byEndpoint = res.stats.apiByEndpoint ?? {}
  adoptExternalNac(byEndpoint, res.stats.nacMode, res.stats.signalModes)
  noteExternalLlm(res.stats.llmProvider, res.stats.llmTotalCalls ?? 0)
  const routing = res.stats.routing ?? res.decision
  patchBrain({
    mode: 'langgraph',
    available: true,
    decision: res.stats.decision,
    routing,
    reasoning: res.reasoning,
    salience: res.stats.salience,
    probes: res.stats.probes,
    signals: res.stats.signals,
    llmCalls: res.stats.llmTotalCalls ?? 0,
    llmBudget: res.stats.llmBudget ?? 0,
    apiCalls: Object.values(byEndpoint).reduce((a, b) => a + b, 0),
    forecastErrorPct: res.stats.forecastErrorPct,
    budgetExhausted: res.stats.budgetExhausted,
    graphMs: res.stats.graphMs,
    lastError: '',
  })

  emitTrace('COORDINATOR', 'system', `LangGraph cycle ${cycleCount} complete — ${routing} · ${res.stats.graphMs} ms`, {
    source: 'api',
    detail: routing === res.decision ? undefined : `resolved as ${res.decision} after spending a probe`,
  })
  return true
}

/** Apply the brain's reroute to the visitor app, choosing the alternate and the
 *  intermediate stop locally so the route always makes physical sense. */
function applyReroute(targetZoneId: string, reason: string, visitorMessage: string): void {
  const s = getState()
  const target = zoneById(targetZoneId) ?? [...s.zones].sort((a, b) => b.densityPct - a.densityPct)[0]
  if (!target) return
  const alt = s.zones
    .filter((z) => z.id !== target.id && z.id !== 'transit' && z.status !== 'critical')
    .sort((a, b) => a.densityPct - b.densityPct)[0]
  if (!alt) return
  const via =
    s.zones.find(
      (z) => z.id !== target.id && z.id !== alt.id && z.id !== 'transit' && z.status !== 'critical' && z.densityPct < 60,
    ) ?? s.zones.find((z) => z.id !== target.id && z.id !== alt.id)
  const savedMin = Math.max(12, Math.round((target.waitMin ?? 25) * 0.8))
  s.visitorReroute = {
    fromZone: target.name,
    toZone: alt.name,
    viaZone: via?.name ?? alt.name,
    reason,
    savedMin,
  }
  s.reroutesIssued++
  s.pushesSent++
  s.visitorNotifications.push({
    title: `Reroute: skip ${target.short}`,
    body:
      visitorMessage ||
      `${target.name} is at ${target.densityPct}%. Better route: ${alt.name} via ${via?.name ?? alt.name} — saves about ${savedMin} min.`,
    atLabel: simClock(s.minuteOfDay),
    kind: 'reroute',
  })
  emitTrace('NAVIGATOR', 'action', `Reroute live in the guest app: ${target.short} → ${alt.short} via ${via?.short ?? alt.short} (~${savedMin} min saved)`, {
    source: 'api',
    level: 'warn',
  })
}

// ---------------------------------------------------------------------------
// TypeScript path — the original chain, kept as the safety net.
// ---------------------------------------------------------------------------

async function runTsCycle(): Promise<void> {
  const emit: TraceEmitter = emitTrace
  emit('COORDINATOR', 'system', 'Agent cycle started — Sentinel observation pass', { source: 'template' })

  await runSentinel(emit)
  await runOracle(emit)

  const s = getState()
  const critical = s.zones.filter((z) => z.densityPct >= 80).sort((a, b) => b.densityPct - a.densityPct)[0]
  const warning = s.zones.filter((z) => z.densityPct >= 60 && z.densityPct < 80).sort((a, b) => b.densityPct - a.densityPct)[0]

  if (critical || warning) {
    await runGuardian(emit)
    if (critical) {
      await runNavigator(emit, critical.id)
    }
  }
  emit('COORDINATOR', 'system', 'Agent cycle complete', { source: 'template' })
}

/**
 * One pass of the agent layer. The graph decides when to act, when to buy more
 * evidence and when to do nothing; if it cannot be reached at all, the engine's
 * own chain runs instead so the console is never starved of reasoning.
 */
export async function runAgentCycle(): Promise<void> {
  if (running) return
  running = true
  try {
    if (brainShouldTry()) {
      const handled = await runLanggraphCycle()
      if (handled) return
    }
    await runTsCycle()
  } catch (e: any) {
    emitTrace('ENGINE', 'system', `Agent cycle error: ${String(e?.message || e).slice(0, 120)}`, { level: 'warn' })
  } finally {
    running = false
  }
}
