/**
 * End-to-end check of the LangGraph agent layer.
 *
 *   node scripts/langgraph-e2e.mjs
 *   RUN_MS=60000 SPEED=4 node scripts/langgraph-e2e.mjs
 *
 * Connects to the running engine exactly like a console does, plays the
 * scenario, and reports what the graph actually chose: which decisions came up,
 * how many hosted calls and network calls it spent, and the reasoning lines it
 * emitted. Assertions are honest — if the brain never engaged, this fails.
 */
import { io } from 'socket.io-client'

const URL = process.env.ENGINE_URL || 'http://127.0.0.1:3003'
const RUN_MS = Number(process.env.RUN_MS || 70000)
const SPEED = Number(process.env.SPEED || 4)

const traces = []
const snapshots = []
const decisions = new Map()
let lastSnapshot = null

const socket = io(URL, { transports: ['websocket'], reconnectionAttempts: 2 })

socket.on('connect', () => {
  console.log(`[e2e] connected to ${URL}`)
  socket.emit('control', { action: 'reset' })
  setTimeout(() => socket.emit('control', { action: 'speed', value: SPEED }), 250)
  setTimeout(() => socket.emit('control', { action: 'play' }), 600)
})

socket.on('connect_error', (e) => {
  console.error(`[e2e] cannot reach the engine at ${URL}: ${e.message}`)
  process.exit(1)
})

socket.on('snapshot', (s) => {
  lastSnapshot = s
  snapshots.push(s)
  const r = s.brain?.routing
  if (r) decisions.set(r, (decisions.get(r) ?? 0) + 1)
})

socket.on('trace', (e) => traces.push(e))

function label(e) {
  const badge = e.source === 'llm' ? 'LLM' : e.source === 'api' ? 'API' : 'tmpl'
  return `  ${e.atLabel}  [${e.agent.padEnd(9)} ${badge.padEnd(4)}] ${e.text}`
}

setTimeout(() => {
  const b = lastSnapshot?.brain
  console.log(`\n${'='.repeat(100)}`)
  console.log('  LangGraph agent layer — end-to-end result')
  console.log(`${'='.repeat(100)}`)

  if (!lastSnapshot) {
    console.error('  FAIL: the engine never sent a snapshot.')
    process.exit(1)
  }

  const clock = lastSnapshot.engine.clockLabel
  const zone = lastSnapshot.zones.slice().sort((a, b) => b.densityPct - a.densityPct)[0]

  console.log(`  clock reached    : ${clock} (phase: ${lastSnapshot.engine.phase})`)
  console.log(`  busiest zone     : ${zone.name} ${zone.densityPct}% — ${zone.status}`)
  console.log(`  agent mode       : ${b?.mode}   available: ${b?.available}   graph time: ${b?.graphMs}ms`)
  console.log(`  last decision    : ${b?.routing}${b?.routing !== b?.decision ? ` -> resolved ${b?.decision}` : ''}`)
  console.log(`  salience         : ${b?.salience}`)
  console.log(`  hosted LLM calls : ${b?.llmCalls} of ${b?.llmBudget} budget (brain ledger)`)
  console.log(`  network API calls: snapshot ${lastSnapshot.nac.calls} · brain ${b?.apiCalls}`)
  console.log(`  signals spent on : ${JSON.stringify(b?.signals ?? [])}`)
  console.log(`  probes           : ${b?.probes}   forecast error: ${b?.forecastErrorPct ?? '—'} pt`)
  console.log(`  budget exhausted : ${b?.budgetExhausted}`)
  if (b?.lastError) console.log(`  last error       : ${b.lastError}`)
  console.log(`  NaC mode         : ${lastSnapshot.nac.mode}`)
  console.log(`  per-endpoint     : ${lastSnapshot.nac.apis.map((a) => `${a.id}=${a.mode}`).join(' ')}`)

  console.log(`\n  decisions seen   : ${JSON.stringify(Object.fromEntries(decisions))}`)

  const byAgent = {}
  for (const t of traces) byAgent[t.agent] = (byAgent[t.agent] ?? 0) + 1
  console.log(`  trace events     : ${traces.length}  ${JSON.stringify(byAgent)}`)

  console.log(`\n  --- reasoning emitted by the graph (last 26, oldest first) ---`)
  const interesting = traces.filter((t) => ['BRAIN', 'NAC', 'GUARDIAN', 'ORACLE', 'NAVIGATOR'].includes(t.agent))
  for (const t of interesting.slice(-26)) console.log(label(t))

  // --- assertions ------------------------------------------------------
  const checks = [
    ['agent brain engaged (mode=langgraph and available)', b?.mode === 'langgraph' && b?.available === true],
    ['a routing decision was recorded', Boolean(b?.routing)],
    ['the graph emitted its own decision lines', traces.some((t) => t.agent === 'BRAIN' && t.kind === 'decision')],
    ['at least one hosted-model line reached the console', traces.some((t) => t.source === 'llm')],
    ['network API spending is visible', lastSnapshot.nac.calls > 0],
    ['budget accounting is present', typeof b?.llmBudget === 'number' && b.llmBudget > 0],
    // Per-endpoint truth, not one global flag: the console has to be able to
    // name the endpoint that degraded instead of implying everything is live.
    ['every endpoint reports its own live/sandbox state', lastSnapshot.nac.apis.every((a) => a.mode !== undefined)],
    ['a live endpoint is reported as live', lastSnapshot.nac.apis.some((a) => a.mode === 'live')],
    // Degradation has to be visible, so at least one degraded endpoint is a
    // PASS here rather than a failure — silence would be the bug.
    ['degraded endpoints are marked, not hidden', lastSnapshot.nac.apis.some((a) => a.mode === 'sandbox')],
    // The reframe. Naming "crowd density" as a carrier measurement is the
    // exact claim the mentor rejected, so no trace line may make it.
    ['no trace line calls the carrier signal "crowd density"', !traces.some((t) => /crowd density/i.test(t.text))],
    // The disclaimer can be the line's text or its detail — the console shows both.
    ['the carrier signal line states it is not a headcount', traces.some((t) => /not a headcount/i.test(`${t.text} ${t.detail ?? ''}`))],
  ]
  console.log(`\n${'='.repeat(100)}`)
  let failed = 0
  for (const [name, ok] of checks) {
    if (!ok) failed++
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
  }
  console.log(`${'='.repeat(100)}\n`)
  process.exit(failed ? 1 : 0)
}, RUN_MS)
