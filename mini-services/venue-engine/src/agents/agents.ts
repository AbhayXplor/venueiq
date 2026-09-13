/**
 * Multi-agent brain: SENTINEL observes, ORACLE forecasts, NAVIGATOR steers,
 * GUARDIAN protects. The coordinator runs them as a graph — safety outranks
 * comfort, and every step is emitted to the on-screen reasoning trace.
 *
 * This is the *fallback* path. When the LangGraph brain answers, it drives the
 * cycle instead and this chain is only the safety net — see coordinator.ts.
 *
 * Each agent first asks the LLM provider chain for a decision; if no hosted
 * provider answers it falls back to deterministic rules, and the trace shows
 * which mode produced each line.
 */
import type { TraceAgent, TraceKind, TraceSource, ZoneState } from '../types'
import { getState, zoneById } from '../state/venue'
import { congestionInsights, geofenceCheck, reachability, VISITOR_SAMPLE } from '../nac'
import { complete, parseJsonLoose } from '../llm/provider'
import type { TraceEmitter } from './coordinator'

const ZONE_IDS = ['entry', 'stage', 'carnival', 'pavilions', 'food', 'transit']

function digest(): string {
  const s = getState()
  const lines = s.zones.map(
    (z) => `${z.name}: ${z.load}/${z.capacity} (${z.densityPct}%), 10-min change ${z.loadDelta10 >= 0 ? '+' : ''}${z.loadDelta10}, status ${z.status}`
  )
  return [
    `Sim clock ${Math.floor(s.minuteOfDay / 60)}:${String(s.minuteOfDay % 60).padStart(2, '0')}. Phase: evening at Global Village.`,
    ...lines,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// SENTINEL — watches the network signals and flags anomalies.
// ---------------------------------------------------------------------------
export async function runSentinel(emit: TraceEmitter): Promise<ZoneState[]> {
  const s = getState()
  const signals = await congestionInsights(s.zones.map((z) => ({ id: z.id, load: z.load, capacity: z.capacity })))
  emit('NAC', 'signal', `Congestion Insights polled · ${signals.length} zones`, { source: 'api', detail: signals.map((x) => `${x.zoneId} ${x.congestion}`).join(' · ') })

  const busiest = [...s.zones].sort((a, b) => b.densityPct - a.densityPct)[0]
  await geofenceCheck(busiest.id, busiest.densityPct)

  const system =
    'You are SENTINEL, the monitoring agent of a venue crowd-safety system. ' +
    'You watch telecom network signals (congestion insights, geofences) for a large evening venue. ' +
    'Reply ONLY with compact JSON: {"anomalies":[{"zone":"<name>","finding":"<one sentence>","severity":"info|warn|critical"}]} ' +
    'Only flag a zone when its density is at least 50% of capacity OR its 10-minute change is at least 200 people — early-evening growth is normal, not an anomaly. Maximum 3 anomalies. If nothing crosses those thresholds, return an empty list.'
  const res = await complete(system, digest())
  let anomalies: { zone: string; finding: string; severity: string }[] = []
  let source: TraceSource = 'template'
  if (res) {
    source = 'llm'
    const parsed = parseJsonLoose<{ anomalies?: any[] }>(res.text)
    if (parsed?.anomalies) anomalies = parsed.anomalies.slice(0, 3)
  }
  if (!res || anomalies.length === 0) {
    // Deterministic fallback: 3x-baseline rule from the pitch deck.
    for (const z of s.zones) {
      if (z.loadDelta10 > 120 || z.densityPct >= 80) {
        anomalies.push({
          zone: z.name,
          finding: `${z.name} at ${z.densityPct}% of capacity, ${z.loadDelta10 >= 0 ? '+' : ''}${z.loadDelta10} people in 10 minutes.`,
          severity: z.densityPct >= 80 ? 'critical' : 'warn',
        })
      }
    }
    anomalies = anomalies.slice(0, 3)
  }

  if (anomalies.length === 0) {
    emit('SENTINEL', 'observe', 'All six zones within baseline. No anomalies flagged.', { source })
  }
  for (const a of anomalies) {
    const level = a.severity === 'critical' ? 'critical' : a.severity === 'warn' ? 'warn' : 'info'
    emit('SENTINEL', 'observe', `${a.zone}: ${a.finding}`, { source, level, detail: `signal source · ${source === 'llm' ? 'agent assessment' : '3x-baseline rule'}` })
  }
  return s.zones
}

// ---------------------------------------------------------------------------
// ORACLE — forecasts zone density 30 minutes ahead.
// ---------------------------------------------------------------------------
export async function runOracle(emit: TraceEmitter): Promise<void> {
  const s = getState()
  const risky = s.zones
    .map((z) => {
      const plus = plus30(z.id)
      return { z, plus }
    })
    .sort((a, b) => b.plus - a.plus)[0]

  const system =
    'You are ORACLE, the forecasting agent of a venue crowd-safety system. ' +
    'Given current zone loads, forecast the next 30 minutes and answer with ONE short sentence (max 22 words) ' +
    'naming the single zone at greatest risk and why. No preamble, no quotes.'
  const res = await complete(system, digest())
  const source: TraceSource = res ? 'llm' : 'template'
  let text: string
  if (res) {
    text = res.text.trim().replace(/^["']|["']$/g, '').slice(0, 220)
  } else {
    text = risky.plus >= 80
      ? `${risky.z.name} is heading for ${Math.round(risky.plus)}% of capacity within 30 minutes — intervention window is now.`
      : `No zone exceeds 80% in the next 30 minutes; ${risky.z.name} peaks near ${Math.round(risky.plus)}%.`
  }
  emit('ORACLE', 'reason', text, { source, level: risky.plus >= 80 ? 'warn' : 'info', detail: `30-min outlook · ${risky.z.short} ${Math.round(risky.plus)}%` })
}

function plus30(zoneId: string): number {
  const s = getState()
  const z = zoneById(zoneId)
  if (!z) return 0
  // The curve already encodes the venue's real trajectory.
  const { curveAt, ZONES } = require('../scenario/timeline')
  const spec = ZONES.find((zz: any) => zz.id === zoneId)
  return ((curveAt(spec.curve, s.minuteOfDay + 30) as number) / z.capacity) * 100
}

// ---------------------------------------------------------------------------
// NAVIGATOR — reroutes visitors around predicted jams.
// ---------------------------------------------------------------------------
export async function runNavigator(emit: TraceEmitter, targetZoneId: string): Promise<void> {
  const s = getState()
  const target = zoneById(targetZoneId)
  if (!target) return

  const reach = await reachability(VISITOR_SAMPLE)
  emit('NAC', 'signal', `Reachability check · ${reach.reachable ? 'device reachable' : 'no response'} (${reach.latencyMs} ms)`, { source: 'api' })
  if (!reach.reachable) return

  // Best alternate zone: least loaded, non-critical, not a transit corridor.
  const alt = s.zones
    .filter((z) => z.id !== targetZoneId && z.id !== 'transit' && z.status !== 'critical')
    .sort((a, b) => a.densityPct - b.densityPct)[0]
  if (!alt) return
  // Via zone: a calm intermediate that is neither origin nor destination —
  // never route "Food → Entry via Food".
  const via =
    s.zones.find((z) => z.id !== targetZoneId && z.id !== alt.id && z.id !== 'transit' && z.status !== 'critical' && z.densityPct < 60) ??
    s.zones.find((z) => z.id !== targetZoneId && z.id !== alt.id)!
  const savedMin = Math.max(12, Math.round((target.waitMin ?? 25) * 0.8))

  const system =
    'You are NAVIGATOR, the routing agent of a venue crowd-safety system. ' +
    'A zone is overheating and visitors should be steered elsewhere. ' +
    `Current target to avoid: ${target.name}. Suggested alternative: ${alt.name} via ${via.name}. ` +
    'Answer with ONE short sentence (max 20 words) explaining the reroute recommendation. No preamble.'
  const res = await complete(system, digest())
  const source: TraceSource = res ? 'llm' : 'template'
  const reason = res ? res.text.trim().replace(/^["']|["']$/g, '').slice(0, 200) : `${target.name} is at ${target.densityPct}% capacity; steering visitors to ${alt.name} keeps queues balanced.`

  s.visitorReroute = {
    fromZone: target.name,
    toZone: alt.name,
    viaZone: via.name,
    reason,
    savedMin,
  }
  s.reroutesIssued++
  s.pushesSent++
  s.visitorNotifications.push({
    title: `Reroute: skip ${target.short}`,
    body: `${target.name} is at ${target.densityPct}% (${target.waitMin ?? '—'} min waits). Better route: ${alt.name} via ${via.name} — saves about ${savedMin} min.`,
    atLabel: nowLabel(),
    kind: 'reroute',
  })
  emit('NAVIGATOR', 'decision', `Reroute issued: ${target.short} → ${alt.short} via ${via.short} (saves ~${savedMin} min)`, { source, level: 'warn', detail: reason })
}

// ---------------------------------------------------------------------------
// GUARDIAN — thresholds, alerts, and one-click operator actions.
// ---------------------------------------------------------------------------
export async function runGuardian(emit: TraceEmitter): Promise<void> {
  const s = getState()
  const critical = s.zones.filter((z) => z.densityPct >= 80).sort((a, b) => b.densityPct - a.densityPct)[0]
  const warning = s.zones.filter((z) => z.densityPct >= 60 && z.densityPct < 80).sort((a, b) => b.densityPct - a.densityPct)[0]

  if (!critical && !warning) {
    if (s.guardianAlert) {
      emit('GUARDIAN', 'observe', `${s.guardianAlert.title} cleared — densities back within thresholds.`, { source: 'template' })
      s.guardianAlert = null
    }
    return
  }

  const z = critical ?? warning
  const severity: 'warn' | 'critical' = critical ? 'critical' : 'warn'
  const alreadyActive = s.guardianAlert?.zoneId === z.id && s.guardianAlert?.severity === severity
  if (alreadyActive) return

  const system =
    'You are GUARDIAN, the safety agent of a venue crowd-safety system. ' +
    `Zone ${z.name} is at ${z.densityPct}% of capacity with ${z.loadDelta10 >= 0 ? '+' : ''}${z.loadDelta10} people in 10 minutes. ` +
    'Write a two-sentence operator alert: first sentence states the risk plainly, second names the recommended immediate action. No preamble, no quotes.'
  const res = await complete(system, digest())
  const source: TraceSource = res ? 'llm' : 'template'
  const detail = res
    ? res.text.trim().replace(/^["']|["']$/g, '').slice(0, 300)
    : `${z.name} density ${z.densityPct}% and climbing — crush risk if the trend holds another 15 minutes. Recommend throttling inflow and staging marshals now.`

  s.guardianAlert = {
    zoneId: z.id,
    title: `${severity === 'critical' ? 'Critical density' : 'Density building'} — ${z.name}`,
    detail,
    severity,
    sinceLabel: nowLabel(),
    actions: ['Deploy marshals', 'Throttle gates', 'Reroute flow', 'Boost comms', 'Safety slice'],
  }
  emit('GUARDIAN', 'decision', `${severity === 'critical' ? 'CRITICAL' : 'WARN'} · ${z.name} at ${z.densityPct}% — alert raised to operators`, { source, level: severity, detail })
}

export function nowLabel(): string {
  const m = getState().minuteOfDay
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export { ZONE_IDS }
