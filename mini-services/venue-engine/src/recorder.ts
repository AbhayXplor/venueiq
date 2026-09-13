/** Minimal session recorder — health lines appended to data/session-log.jsonl. */
import { appendFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

const LOG = join(dirname(new URL(import.meta.url).pathname), '..', 'data', 'session-log.jsonl')

export function appendHealth(payload: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(LOG), { recursive: true })
    appendFileSync(LOG, `${JSON.stringify({ t: new Date().toISOString(), kind: 'health', payload })}\n`)
  } catch {
    // Recording must never break the engine.
  }
}
