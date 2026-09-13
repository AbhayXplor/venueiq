/**
 * Capture a full evening's zone trajectory from the engine, for offline work.
 *
 *   # in one shell — no gateway calls, and no agent cycle at all:
 *   NAC_FORCE_SANDBOX=1 AGENT_EVERY_MINUTES=999 bun --hot src/index.ts
 *   # in another:
 *   node ../../scripts/capture-trajectory.mjs
 *
 * Why this exists: tuning the forecast needs many full-evening replays, and
 * doing that against the live engine would spend hundreds of gateway calls and
 * hundreds of hosted-model calls to measure arithmetic. The scenario is a
 * deterministic function of the clock, so one capture is enough to evaluate a
 * forecaster against the real trajectory as often as we like.
 *
 * With AGENT_EVERY_MINUTES=999 no agent cycle ever fires, so this costs
 * nothing at all: no Nokia calls, no LLM calls.
 */
import { io } from 'socket.io-client'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const URL = process.env.ENGINE_URL || 'http://127.0.0.1:3003'
const SPEED = Number(process.env.SPEED || 8)
const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../mini-services/agent-brain/tests/reference-evening.json',
)

const samples = new Map() // minuteOfDay -> { zones: [{id, densityPct}], onSite }
let lastMinute = -1

const socket = io(URL, { transports: ['websocket'], reconnectionAttempts: 2 })
socket.on('connect_error', (e) => {
  console.error(`cannot reach the engine at ${URL}: ${e.message}`)
  process.exit(1)
})

socket.on('connect', () => {
  socket.emit('control', { action: 'reset' })
  setTimeout(() => socket.emit('control', { action: 'speed', value: SPEED }), 200)
  setTimeout(() => socket.emit('control', { action: 'play' }), 600)
})

let loggedAt = 0

socket.on('snapshot', (s) => {
  const m = s.engine.minuteOfDay
  // One sample per simulated minute, whatever the tick rate does.
  if (m === lastMinute) return
  // Progress, so a stalled capture is obvious rather than looking like a hang.
  if (m - loggedAt >= 30) {
    loggedAt = m
    console.log(`  ... ${s.engine.clockLabel}  (${samples.size} minutes, running=${s.engine.running}, speed=${s.engine.speed})`)
  }
  lastMinute = m
  samples.set(m, {
    minuteOfDay: m,
    clock: s.engine.clockLabel,
    onSite: s.venue.onSite,
    zones: s.zones.map((z) => ({ id: z.id, name: z.name, short: z.short, capacity: z.capacity, densityPct: z.densityPct })),
  })
})

socket.on('disconnect', () => {})

function finish() {
  const ordered = [...samples.values()].sort((a, b) => a.minuteOfDay - b.minuteOfDay)
  if (ordered.length < 50) {
    console.error(`only ${ordered.length} minutes captured — is the scenario playing?`)
    process.exit(1)
  }
  const payload = {
    note: 'Deterministic evening at Global Village, captured from the engine. Used to score forecasters offline.',
    speed: SPEED,
    from: ordered[0].minuteOfDay,
    to: ordered[ordered.length - 1].minuteOfDay,
    zoneIds: ordered[0].zones.map((z) => z.id),
    minutes: ordered,
  }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(payload))
  console.log(`captured ${ordered.length} simulated minutes -> ${OUT}`)
  console.log(`  window: ${ordered[0].clock} → ${ordered[ordered.length - 1].clock}`)
  console.log(`  zones : ${payload.zoneIds.join(', ')}`)
  process.exit(0)
}

// The scenario is 18:00 → 23:00. Stop shortly after 22:55, or as soon as the
// engine reports it has finished its own window.
const clockCheck = setInterval(() => {
  if (lastMinute >= 1375) {
    clearInterval(clockCheck)
    finish()
  }
}, 500)
