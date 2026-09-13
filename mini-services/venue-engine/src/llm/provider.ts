/**
 * LLM provider chain for the agent brain.
 *
 * Order: ollama (Ollama Cloud, gpt-oss:20b — verified working 2026-08-30)
 * -> gemini -> deterministic templates.
 *
 * A third hosted provider used to sit in this chain, backed by an SDK that only
 * exists in one particular sandbox and needs a config file that is not shipped
 * here. It could therefore never report healthy, and it forced a dependency on
 * anybody who cloned the repo — a provider that cannot answer is not a
 * fallback, it is a failure mode with a name. Removed.
 *
 * Every agent call goes through `complete()`. When all hosted providers
 * are unavailable the caller falls back to rule-based reasoning, so the
 * demo never stalls — exactly what the official hackathon tips ask for.
 */
import { config } from '../config'

export type LlmMode = 'ollama' | 'gemini' | 'templates'

interface CompletionResult {
  text: string
  provider: LlmMode
}

interface ProviderState {
  id: LlmMode
  healthy: boolean
  lastError: string
  failures: number
  lastFailureAt: number
  calls: number
  errors: number
  model: string
}

const RETRY_AFTER_MS = 90_000

const state: Record<'ollama' | 'gemini', ProviderState> = {
  ollama: { id: 'ollama', healthy: false, lastError: '', failures: 0, lastFailureAt: 0, calls: 0, errors: 0, model: config.llm.ollama.model },
  gemini: { id: 'gemini', healthy: false, lastError: '', failures: 0, lastFailureAt: 0, calls: 0, errors: 0, model: config.llm.gemini.model },
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ])
}

/** OpenAI-compatible chat call, used for both Ollama Cloud and Gemini. */
async function openAiCompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  system: string,
  user: string,
  extraBody: Record<string, unknown> = {},
): Promise<string> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.4,
      max_tokens: 1000,
      stream: false,
      ...extraBody,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} ${body.slice(0, 120)}`)
  }
  const data: any = await res.json()
  const text = data?.choices?.[0]?.message?.content
  if (typeof text !== 'string' || text.length === 0) throw new Error('empty completion')
  return text
}

async function callOllama(system: string, user: string): Promise<string> {
  const { baseUrl, apiKey, model } = config.llm.ollama
  if (!apiKey) throw new Error('no api key')
  // gpt-oss is a reasoning model: at default effort it thinks for ~10s per
  // call, which blew the old 12s timeout. Low effort answers in ~3s with
  // the same JSON quality (measured live 2026-08-30), so the agents stay
  // inside the tick budget.
  return openAiCompatible(baseUrl, apiKey, model, system, user, {
    reasoning_effort: 'low',
  })
}

async function callGemini(system: string, user: string): Promise<string> {
  const { baseUrl, apiKey, model } = config.llm.gemini
  if (!apiKey) throw new Error('no api key')
  return openAiCompatible(baseUrl, apiKey, model, system, user)
}

/** Try a provider with timeout and health bookkeeping (half-open recovery). */
async function attempt(p: ProviderState, fn: () => Promise<string>): Promise<string | null> {
  const cooledDown = Date.now() - p.lastFailureAt > RETRY_AFTER_MS
  if (!p.healthy && p.failures >= 3 && !cooledDown) return null
  try {
    p.calls++
    const text = await withTimeout(fn(), config.llm.timeoutMs)
    p.healthy = true
    p.failures = 0
    return text
  } catch (e: any) {
    p.errors++
    p.failures++
    p.lastFailureAt = Date.now()
    p.lastError = String(e?.message || e).slice(0, 200)
    if (p.failures >= 3) p.healthy = false
    return null
  }
}

/** Run one completion through the provider chain. Null => use templates. */
export async function complete(system: string, user: string): Promise<CompletionResult | null> {
  const chain: [ProviderState, () => Promise<string>][] = [
    [state.ollama, () => callOllama(system, user)],
    [state.gemini, () => callGemini(system, user)],
  ]
  for (const [p, fn] of chain) {
    const text = await attempt(p, fn)
    if (text !== null) return { text, provider: p.id }
  }
  return null
}

/** Fast synchronous view of the currently active provider (for snapshots). */
export function activeMode(): LlmMode {
  if (state.ollama.healthy) return 'ollama'
  if (state.gemini.healthy) return 'gemini'
  return 'templates'
}

/**
 * The agent brain calls its own LLM chain in Python. When it is driving, the
 * console should report that chain, not this process's idle one — otherwise the
 * screen would claim "templates" while the brain is visibly reasoning.
 */
let external: { provider: LlmMode; calls: number } | null = null

export function noteExternalLlm(provider: string, runCalls: number): void {
  const id: LlmMode =
    provider === 'ollama' || provider === 'gemini' ? provider : 'templates'
  external = { provider: id, calls: runCalls }
}

export function clearExternalLlm(): void {
  external = null
}

export function llmStats() {
  const totalCalls = state.ollama.calls + state.gemini.calls
  const totalErrors = state.ollama.errors + state.gemini.errors
  if (external) {
    const model =
      external.provider === 'ollama' ? state.ollama.model
      : external.provider === 'gemini' ? state.gemini.model
      : 'rule templates'
    return { mode: external.provider, model, calls: external.calls, errors: totalErrors }
  }
  const mode = activeMode()
  const model =
    mode === 'ollama' ? state.ollama.model
    : mode === 'gemini' ? state.gemini.model
    : 'rule templates'
  return { mode, model, calls: totalCalls, errors: totalErrors }
}

/** Boot-time probe so the mode shown on screen reflects reality. */
export async function probeProviders(): Promise<void> {
  const ping: [ProviderState, () => Promise<string>][] = [
    [state.ollama, () => callOllama('You are a health probe.', 'Reply with the single word OK.')],
    [state.gemini, () => callGemini('You are a health probe.', 'Reply with the single word OK.')],
  ]
  await Promise.allSettled(ping.map(([p, fn]) => attempt(p, fn)))
}

/** Parse a JSON object out of an LLM reply (agents ask for strict JSON). */
export function parseJsonLoose<T = any>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced ? fenced[1] : text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1)) as T
  } catch {
    return null
  }
}
