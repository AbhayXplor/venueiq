/**
 * VenueIQ engine — simulation clock + NaC signal layer + multi-agent brain,
 * streamed to every connected console over socket.io.
 */
import { Server } from 'socket.io'
import { createServer } from 'http'
import { config } from './config'
import { advanceMinute, buildSnapshot, getState, patchBrain, resetState } from './state/venue'
import { runAgentCycle, emitTrace, onTrace, recentTrace, resetAgents } from './agents/coordinator'
import { brainAvailable, brainHealth, brainStatus, brainWarm } from './agents/brain-client'
import { probeEndpoints, qodBoost, resetNac } from './nac'
import { probeProviders, clearExternalLlm, llmStats, noteExternalLlm } from './llm/provider'
import { appendHealth } from './recorder'

/** When this process came up — reported by `/health`, so a restart is visible. */
const startedAt = Date.now()

/** Requests served on `/health`. Counted so a keep-alive ping is proven, not assumed. */
let healthHits = 0

/**
 * A host has to be able to ask this process whether it is alive.
 *
 * This server previously had no request handler at all. A platform health
 * check — or the keep-alive ping that stops a free instance spinning down
 * mid-demo — therefore got no reply and read as "dead" while the engine was
 * streaming perfectly. socket.io attaches its own listener and hands every
 * non-socket request to this one, so both share the port and the URL.
 */
const http = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0]

  if (path === '/health') {
    healthHits++
    const s = getState()
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(
      JSON.stringify({
        ok: true,
        service: 'venueiq-engine',
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        healthHits,
        agentMode: config.agent.mode,
        brain: brainStatus(),
        llm: llmStats().mode,
        scenario: { running: s.running, minuteOfDay: s.minuteOfDay, speed: s.speed },
        clients: io.engine.clientsCount,
      }),
    )
    return
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('VenueIQ engine — live crowd-risk simulation. Health: /health\n')
})

const io = new Server(http, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e6,
})

resetState()
computeAndBroadcast()

function computeAndBroadcast(): void {
  const snap = buildSnapshot()
  io.emit('snapshot', snap)
}

let tickTimer: ReturnType<typeof setTimeout> | null = null
let lastAgentMinute = -999

/** Playback speeds the engine will accept. The console offers the first four. */
const SPEED_STEPS = [0.5, 1, 2, 4, 8, 16]

function scheduleTick(): void {
  if (tickTimer) clearTimeout(tickTimer)
  if (!getState().running) return
  tickTimer = setTimeout(() => {
    const m = advanceMinute()
    computeAndBroadcast()
    if (m - lastAgentMinute >= config.agentEveryMinutes || m < lastAgentMinute) {
      lastAgentMinute = m
      runAgentCycle()
    }
    scheduleTick()
  }, Math.max(120, config.tickRealMs / getState().speed))
}

io.on('connection', (socket) => {
  emitTrace('ENGINE', 'system', `Console connected (${socket.id.slice(0, 6)})`, { source: 'api' })
  // Someone is watching, so the reasoning service is about to be needed. On
  // free hosting the brain sleeps when idle and takes about a minute to wake,
  // and the graph only runs once they press play — starting the wake-up now
  // usually means it is ready by then, instead of the first cycle landing on
  // the fallback chain.
  void wakeBrain('console opened')
  socket.emit('snapshot', buildSnapshot())
  for (const e of recentTrace(40)) socket.emit('trace', e)

  socket.on('control', (msg: any) => {
    const s = getState()
    switch (msg?.action) {
      case 'play':
        if (!s.running && s.minuteOfDay < 1380) {
          s.running = true
          emitTrace('ENGINE', 'system', 'Scenario playback started', { source: 'api' })
          scheduleTick()
        }
        break
      case 'pause':
        s.running = false
        emitTrace('ENGINE', 'system', 'Scenario playback paused', { source: 'api' })
        break
      case 'reset':
        resetState()
        resetNac()
        clearExternalLlm()
        lastAgentMinute = -999
        emitTrace('ENGINE', 'system', 'Scenario reset to 18:00 — gates about to open', { source: 'api' })
        void reportEndpointProbe()
        // The brain forgets the run too: a stale learned baseline or a half
        // spent budget from the previous replay would poison the next one.
        void resetAgents(`run-${Date.now().toString(36)}`)
        computeAndBroadcast()
        break
      case 'speed':
        // 8× and 16× exist for fast-forward rehearsals and for offline capture,
        // which needs a whole evening in well under a minute. Bounded, so a
        // stray value cannot spin the tick loop.
        if (typeof msg.value === 'number' && SPEED_STEPS.includes(msg.value)) {
          s.speed = msg.value
          emitTrace('ENGINE', 'system', `Playback speed ${msg.value}×`, { source: 'api' })
          if (s.running) scheduleTick()
          computeAndBroadcast()
        }
        break
    }
  })

  socket.on('guardian-action', async (msg: any) => {
    const s = getState()
    const zone = s.zones.find((z) => z.id === (msg?.zoneId ?? s.guardianAlert?.zoneId))
    const zoneName = zone?.name ?? 'venue'
    const at = `${String(Math.floor(s.minuteOfDay / 60)).padStart(2, '0')}:${String(s.minuteOfDay % 60).padStart(2, '0')}`

    switch (msg?.action) {
      case 'deploy-marshals':
        s.guardianActions.push({ label: `Marshals deployed · ${zoneName}`, atLabel: at })
        emitTrace('GUARDIAN', 'action', `Field team dispatched — 6 marshals staged at ${zoneName} approach points`, { source: 'api', level: 'warn' })
        break
      case 'throttle-gates':
        s.guardianActions.push({ label: `Gates throttled · ${zoneName}`, atLabel: at })
        emitTrace('GUARDIAN', 'action', `Inflow to ${zoneName} throttled to 40% — turnstiles at reduced rate`, { source: 'api', level: 'warn' })
        break
      case 'reroute-flow': {
        s.guardianActions.push({ label: `Flow rerouted · ${zoneName}`, atLabel: at })
        emitTrace('GUARDIAN', 'action', `Signage and app routes now steer guests away from ${zoneName}`, { source: 'api', level: 'warn' })
        const target = zone ?? s.zones.sort((a, b) => b.densityPct - a.densityPct)[0]
        if (target) {
          const { runNavigator } = await import('./agents/agents')
          await runNavigator(emitTrace, target.id)
        }
        break
      }
      case 'boost-comms': {
        s.guardianActions.push({ label: 'Comms boosted · QoD', atLabel: at })
        const q = await qodBoost(`venueiq-ops-${s.minuteOfDay}`)
        s.qodActive = true
        emitTrace('GUARDIAN', 'action', `QoS on Demand session active (${q?.qos ?? 'QOS_L'}) — operator channel prioritised for 30 min`, { source: 'api', level: 'warn', detail: 'Nokia NaC QoD API' })
        break
      }
      case 'safety-slice':
        s.guardianActions.push({ label: 'Safety slice active', atLabel: at })
        s.qodActive = true
        emitTrace('GUARDIAN', 'action', 'Dedicated network slice reserved for safety communications', { source: 'api', level: 'critical', detail: 'Network slicing via NaC' })
        break
    }
    computeAndBroadcast()
  })

  socket.on('disconnect', () => {
    emitTrace('ENGINE', 'system', `Console disconnected (${socket.id.slice(0, 6)})`, { source: 'api' })
  })
})

/**
 * Wake a brain that is not answering, and report the recovery on screen.
 *
 * A hosted free instance is spun down when idle and can take a minute to answer
 * again — far longer than a health check budget, which is deliberately short so
 * a dead brain costs one cycle rather than blocking anything. Fired at boot and
 * again whenever a console connects, so a waking brain is a visible recovery
 * instead of a demo that quietly runs the fallback chain all evening.
 *
 * Best-effort: a failure here changes nothing, because a cycle falls back on its
 * own and will try again.
 */
let brainWakeInFlight = false

async function wakeBrain(trigger: string): Promise<void> {
  if (config.agent.mode !== 'langgraph' || brainWakeInFlight || brainAvailable()) return
  brainWakeInFlight = true
  try {
    const woke = await brainWarm()
    if (!woke) return
    patchBrain({ mode: 'langgraph', available: true, llmBudget: woke.budget.llmBudget })
    noteExternalLlm(woke.llm.mode, 0)
    emitTrace('ENGINE', 'system', `Agent brain answered after ${Math.round(woke.tookMs / 1000)}s · ${trigger} — reasoning on the LangGraph graph`, {
      source: 'api',
      detail: `reasoning via ${woke.llm.mode} · hosted budget ${woke.budget.llmBudget} calls/run · network ${woke.nac.mode}`,
    })
  } finally {
    brainWakeInFlight = false
  }
}

/**
 * Ask every endpoint once and say what came back.
 *
 * Run at boot and again after every scenario reset, because a reset clears the
 * per-endpoint ledger — and a console that shows "idle" for six endpoints it
 * has not touched yet is worse than one that names the one that degraded.
 */
async function reportEndpointProbe(): Promise<void> {
  const probed = await probeEndpoints()
  for (const p of probed) {
    const label = p.mode === 'live' ? 'live' : p.mode === 'sandbox' ? 'sandbox fallback' : 'idle'
    emitTrace('NAC', 'signal', `${p.label} — ${label}`, {
      source: 'api',
      level: p.mode === 'sandbox' ? 'warn' : 'info',
      detail:
        p.id === 'verify' && p.mode !== 'live'
          ? 'needs an enrolled test number and an extra OAuth2 step — the venue pass is used instead, and the console says so'
          : undefined,
    })
  }
}

onTrace((e) => io.emit('trace', e))

async function boot(): Promise<void> {
  // Bind the port before anything slow happens. The endpoint probe below makes
  // seven live gateway calls and can take tens of seconds on a slow network; on
  // a host that health-checks this port, listening only afterwards would make a
  // perfectly healthy boot look like a failed deploy.
  http.listen(config.port, () => {
    console.log(`VenueIQ engine listening on :${config.port} (agent: ${config.agent.mode})`)
  })
  setInterval(() => appendHealth({ mode: llmStats().mode, clients: io.engine.clientsCount }), 30000)

  // Keep an eye on a reasoning service that is not answering. On free hosting
  // it can be asleep, still waking, or briefly mid-redeploy — all of which read
  // as "unavailable" for a moment and then stop being true. Without this the
  // engine stayed on the fallback chain until someone opened a console or a
  // cycle happened to retry, which looks like the agent layer is switched off.
  setInterval(() => {
    if (config.agent.mode === 'langgraph' && !brainAvailable()) void wakeBrain('background retry')
  }, 30_000)

  if (config.agent.mode === 'langgraph') {
    const health = await brainHealth()
    if (health) {
      // Publish the probe's result straight away. Without this the console's
      // brain chip stays hidden until the first cycle completes, which reads
      // as "no reasoning service" on a perfectly healthy boot.
      patchBrain({ mode: 'langgraph', available: true, llmBudget: health.budget.llmBudget })
      noteExternalLlm(health.llm.mode, 0)
      emitTrace('ENGINE', 'system', `LangGraph agent brain online · reasoning via ${health.llm.mode}`, {
        source: 'api',
        detail: `hosted budget ${health.budget.llmBudget} calls/run · network ${health.nac.mode} · ${brainStatus().url}`,
      })
      const reachable = health.llm.providers.filter((p) => p.healthy).map((p) => p.model)
      emitTrace('ENGINE', 'system', `Agent graph ready: sense → features → recall → forecast → route(ACT | PROBE | HOLD)`, {
        source: 'api',
        detail: reachable.length ? `hosted models reachable: ${reachable.join(' → ')}` : 'no hosted model — the graph decides by policy, and says so',
      })
    } else {
      patchBrain({ mode: 'ts', available: false, lastError: brainStatus().lastError })
      emitTrace('ENGINE', 'system', 'Agent brain unreachable — running the in-process TypeScript agent chain', {
        source: 'api',
        level: 'warn',
        detail: `${brainStatus().url} (${brainStatus().lastError}) · a hosted brain may simply be waking — retrying in the background; locally, start it with: cd mini-services/agent-brain && python -m app.main`,
      })
      await probeProviders()

      // The 2.5s check above is deliberately short so a dead brain costs one
      // cycle rather than blocking the boot. This is the patient second attempt.
      void wakeBrain('at boot')
    }
  } else {
    await probeProviders()
  }

  const mode = llmStats().mode
  emitTrace('ENGINE', 'system', `VenueIQ engine online · agent mode: ${config.agent.mode} · LLM: ${mode}`, {
    source: 'api',
    detail:
      config.agent.mode === 'langgraph'
        ? 'reasoning and API spending decisions are made by the LangGraph brain'
        : mode === 'templates'
          ? 'No hosted LLM reachable — agents run deterministic rule templates'
          : `Agent reasoning live via ${mode}`,
  })
  emitTrace('ENGINE', 'system', 'Nokia NaC signal layer armed · 7 CAMARA APIs', {
    source: 'api',
    detail: 'Congestion Insights · Geofencing · Location Retrieval · Roaming · Reachability · QoD · Number Verification',
  })

  await reportEndpointProbe()
}

void boot()
