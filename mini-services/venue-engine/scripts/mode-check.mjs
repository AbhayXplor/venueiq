/**
 * Which agent layer is actually driving the cycle?
 *
 *   node scripts/mode-check.mjs            # whatever the engine is running
 *   AGENT_MODE=ts node scripts/mode-check.mjs
 *
 * `AGENT_MODE` is the demo's safety switch: if the Python brain is unreachable
 * the engine must fall back to the in-process TypeScript agents instead of
 * producing nothing. This asserts the running engine is genuinely driving
 * cycles in its configured mode, and names the agents that produced lines.
 */
import { io } from 'socket.io-client'

const URL = process.env.ENGINE_URL || 'http://127.0.0.1:3003'
const RUN_MS = Number(process.env.RUN_MS || 30000)
const EXPECT = process.env.AGENT_MODE || ''

const traces = []
let last = null

const socket = io(URL, { transports: ['websocket'], reconnectionAttempts: 2 })
socket.on('connect_error', (e) => {
  console.error(`cannot reach the engine at ${URL}: ${e.message}`)
  process.exit(1)
})
socket.on('snapshot', (s) => {
  last = s
})
socket.on('trace', (e) => traces.push(e))
socket.on('connect', () => {
  socket.emit('control', { action: 'reset' })
  setTimeout(() => socket.emit('control', { action: 'speed', value: 8 }), 200)
  setTimeout(() => socket.emit('control', { action: 'play' }), 500)
})

setTimeout(() => {
  if (!last) {
    console.error('FAIL: no snapshot — the engine never spoke.')
    process.exit(1)
  }
  const brain = last.brain ?? {}
  const byAgent = {}
  for (const t of traces) byAgent[t.agent] = (byAgent[t.agent] ?? 0) + 1
  const agentLines = (byAgent.SENTINEL ?? 0) + (byAgent.ORACLE ?? 0) + (byAgent.GUARDIAN ?? 0) + (byAgent.NAVIGATOR ?? 0)
  const brainLines = byAgent.BRAIN ?? 0

  console.log(`\n${'='.repeat(78)}`)
  console.log(`  agent mode report   expected: ${EXPECT || 'any'}`)
  console.log(`${'='.repeat(78)}`)
  console.log(`  snapshot brain      : mode=${brain.mode} available=${brain.available}`)
  console.log(`  decision            : ${brain.routing ?? brain.decision ?? '—'}  salience=${brain.salience ?? '—'}`)
  console.log(`  LLM spend           : ${brain.llmCalls ?? 0}/${brain.llmBudget ?? 0}`)
  console.log(`  per-endpoint        : ${(last.nac.apis ?? []).map((a) => `${a.id}=${a.mode}`).join(' ')}`)
  console.log(`  trace events        : ${traces.length}  ${JSON.stringify(byAgent)}`)
  console.log(`  brain lines         : ${brainLines}   ts-agent lines: ${agentLines}`)

  const checks = [
    ['the engine produced snapshots', Boolean(last)],
    ['cycles ran and emitted reasoning', traces.length > 0],
    ['per-endpoint state is reported', (last.nac.apis ?? []).every((a) => a.mode !== undefined)],
    // Each mode records its decision in its own place: the graph in the
    // snapshot's brain block, the TS chain through the coordinator's cycles.
    [
      EXPECT === 'ts' ? 'the coordinator ran its cycles' : 'a routing decision was recorded',
      EXPECT === 'ts' ? (byAgent.COORDINATOR ?? 0) > 0 : Boolean(brain.routing ?? brain.decision),
    ],
  ]
  if (EXPECT) {
    checks.push([`the engine is running in ${EXPECT} mode`, brain.mode === EXPECT])
    checks.push([
      EXPECT === 'ts' ? 'the TypeScript agents produced lines' : 'the graph produced lines',
      EXPECT === 'ts' ? agentLines > 0 : brainLines > 0,
    ])
  }
  console.log(`\n${'='.repeat(78)}`)
  let failed = 0
  for (const [name, ok] of checks) {
    if (!ok) failed++
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
  }
  console.log(`${'='.repeat(78)}\n`)
  process.exit(failed ? 1 : 0)
}, RUN_MS)
