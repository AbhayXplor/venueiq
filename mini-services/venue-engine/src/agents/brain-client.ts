/**
 * Client for the Python LangGraph agent brain.
 *
 * The engine keeps its own TypeScript agent chain, and this module is the
 * switch between them. The contract is deliberately one-directional: the engine
 * describes the moment, the brain decides, the engine applies. If the brain is
 * slow, unreachable or returns nonsense, we mark it unavailable, fall back to
 * the TS chain for a cool-down window, and keep probing in the background — so
 * a dead brain costs a demo nothing but the reasoning quality.
 */
import { config } from '../config'
import type { BrainCycleResponse, BrainHealth, BrainPayload } from './brain-types'

let available = false
let lastError = ''
let lastCheckAt = 0
let consecutiveFailures = 0
let lastLatencyMs = 0

/**
 * How long to leave a failed brain alone before trying again. A dead service is
 * not hammered, but recovery is quick enough to see on stage: at the demo
 * cadence this means the engine is back on the graph within a cycle or two of
 * the service returning, with no engine restart.
 */
const RETRY_AFTER_MS = 10_000

function url(path: string): string {
  return `${config.agent.brainUrl.replace(/\/$/, '')}${path}`
}

async function fetchWithTimeout(path: string, init: RequestInit, ms: number): Promise<Response> {
  return fetch(url(path), { ...init, signal: AbortSignal.timeout(ms) })
}

export function brainAvailable(): boolean {
  return available
}

export function brainStatus() {
  return { available, lastError, lastLatencyMs, url: config.agent.brainUrl }
}

/** Should we bother trying the brain on this cycle? */
export function brainShouldTry(): boolean {
  if (config.agent.mode !== 'langgraph') return false
  if (available) return true
  return Date.now() - lastCheckAt > RETRY_AFTER_MS
}

export async function brainHealth(): Promise<BrainHealth | null> {
  lastCheckAt = Date.now()
  try {
    const res = await fetchWithTimeout('/health', { method: 'GET' }, Math.min(2500, config.agent.brainTimeoutMs))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as BrainHealth
    available = true
    consecutiveFailures = 0
    lastError = ''
    return data
  } catch (e: any) {
    available = false
    lastError = String(e?.message || e).slice(0, 120)
    return null
  }
}

export async function brainReset(runId: string): Promise<void> {
  try {
    await fetchWithTimeout(`/reset?runId=${encodeURIComponent(runId)}`, { method: 'POST' }, 2500)
    available = true
  } catch {
    /* the reset is best-effort; a runId change resets the brain anyway */
  }
}

/**
 * Run one graph cycle. Returns null when the brain could not answer, in which
 * case the caller must fall back — this function never throws.
 */
export async function runBrainCycle(payload: BrainPayload): Promise<BrainCycleResponse | null> {
  const t0 = Date.now()
  lastCheckAt = Date.now()
  try {
    const res = await fetchWithTimeout(
      '/cycle',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      config.agent.brainTimeoutMs,
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as BrainCycleResponse
    if (!data || typeof data.decision !== 'string') throw new Error('malformed response')
    lastLatencyMs = Date.now() - t0
    available = true
    consecutiveFailures = 0
    lastError = ''
    return data
  } catch (e: any) {
    consecutiveFailures++
    lastError = String(e?.message || e).slice(0, 120)
    if (consecutiveFailures >= 2) available = false
    return null
  }
}
