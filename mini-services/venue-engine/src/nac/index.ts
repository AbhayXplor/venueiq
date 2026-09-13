/**
 * Nokia Network as Code signal layer.
 *
 * One interface, two implementations:
 *  - live:   real HTTP calls to the NaC API on RapidAPI (only when NAC_API_KEY is set)
 *  - sandbox: deterministic simulator derived from the scenario state
 *
 * Endpoint paths, request bodies and response shapes follow Nokia's official
 * OpenAPI spec (github.com/nokia/network-as-code-sdks, openapi/rapid-spec-oas.json).
 * GATEWAY (verified live 2026-09-08): calls go to
 * https://network-as-code.p-eu.rapidapi.com with header
 * x-rapidapi-host: network-as-code.nokia.rapidapi.com — the legacy
 * network-as-code.p.rapidapi.com listing 403s "You are not subscribed".
 * Live-verified endpoints:
 *   POST /congestion-insights/v0/query
 *   POST /device-status/device-roaming-status/v1/retrieve
 *   POST /device-status/device-reachability-status/v1/retrieve
 *   POST /location-retrieval/v0/retrieve
 *   POST /geofencing-subscriptions/v0.3/subscriptions
 *   POST /qod/v0/sessions
 *   POST /passthrough/camara/v1/number-verification/number-verification/v0/verify
 * Simulator test devices use the documented +9999999100x range.
 */
import { config } from '../config'

export interface NacStats {
  calls: number
  errors: number
  /** Per-API truth, not a single global flag: one endpoint can be live while
   *  another is degraded, and the console has to be able to say so. */
  apis: { id: string; label: string; calls: number; mode: 'live' | 'sandbox' | 'unknown' }[]
  mode: 'live' | 'sandbox'
  lastStatus: string
}

export const NAC_APIS = [
  { id: 'congestion', label: 'Congestion Insights' },
  { id: 'geofence', label: 'Geofencing' },
  { id: 'location', label: 'Location Retrieval' },
  { id: 'roaming', label: 'Roaming Status' },
  { id: 'reachability', label: 'Device Reachability' },
  { id: 'qod', label: 'QoS on Demand' },
  { id: 'verify', label: 'Number Verification' },
] as const

/**
 * A device identity for the consented visitor sample, from config
 * (NAC_SAMPLE_DEVICE).
 *
 * It must resolve on the gateway. The TS chain used to pass a display-masked
 * string ('+9715••••42') into the reachability call, which the gateway answers
 * with 404 "Target not found" — so NAVIGATOR claimed to check reachability
 * before every push while silently reading the sandbox value.
 */
export const VISITOR_SAMPLE = config.nac.sampleDevice

/** Which endpoint each live call belongs to, so mode can be tracked per-API. */
function apiIdForPath(path: string): string {
  if (path.startsWith('/congestion-insights')) return 'congestion'
  if (path.startsWith('/geofencing-subscriptions')) return 'geofence'
  if (path.startsWith('/location-retrieval')) return 'location'
  if (path.includes('device-roaming-status')) return 'roaming'
  if (path.includes('device-reachability-status')) return 'reachability'
  if (path.startsWith('/qod')) return 'qod'
  if (path.includes('number-verification')) return 'verify'
  return 'other'
}

const perApiCalls: Record<string, number> = {}
// 'live' only once the gateway has actually answered for that endpoint.
const perApiMode: Record<string, 'live' | 'sandbox' | 'unknown'> = {}
// Calls the agent brain made with its own client. Counted separately and added
// in, so a shared counter can never lose either side's spending.
const perApiExternal: Record<string, number> = {}
const externalSeen: Record<string, number> = {}

for (const a of NAC_APIS) {
  perApiCalls[a.id] = 0
  perApiExternal[a.id] = 0
  perApiMode[a.id] = config.nac.apiKey && !config.nac.forceSandbox ? 'unknown' : 'sandbox'
}

const stats: NacStats = {
  calls: 0,
  errors: 0,
  apis: [],
  mode: config.nac.apiKey && !config.nac.forceSandbox ? 'live' : 'sandbox',
  lastStatus: config.nac.forceSandbox ? 'forced sandbox (NAC_FORCE_SANDBOX)' : '',
}

/** Circuit breaker: after repeated live failures (e.g. key not yet
 * subscribed) stop hammering the gateway and report sandbox honestly.
 * A background probe every 5 min flips back to live the moment it works. */
const breaker = { consecutiveFailures: 0, openedAt: 0, probing: false }
const BREAKER_THRESHOLD = 12
const BREAKER_RETRY_MS = 5 * 60 * 1000

function breakerOpen(): boolean {
  if (breaker.consecutiveFailures < BREAKER_THRESHOLD) return false
  if (Date.now() - breaker.openedAt > BREAKER_RETRY_MS) {
    // half-open: let exactly one probe through
    breaker.probing = true
    return false
  }
  return true
}

function breakerRecord(ok: boolean): void {
  if (ok) {
    if (breaker.consecutiveFailures >= BREAKER_THRESHOLD) {
      stats.mode = 'live'
      stats.lastStatus = 'recovered'
    }
    breaker.consecutiveFailures = 0
    breaker.probing = false
  } else {
    breaker.consecutiveFailures++
    if (breaker.consecutiveFailures >= BREAKER_THRESHOLD) {
      breaker.openedAt = Date.now()
      stats.mode = 'sandbox'
      if (stats.lastStatus === '') stats.lastStatus = 'live calls failing — fallback'
    }
  }
}

function record(id: string, err = false) {
  stats.calls++
  perApiCalls[id] = (perApiCalls[id] || 0) + 1
  if (err) stats.errors++
}

export function nacStats(): NacStats {
  stats.apis = NAC_APIS.map((a) => ({
    id: a.id,
    label: a.label,
    calls: (perApiCalls[a.id] || 0) + (perApiExternal[a.id] || 0),
    mode: perApiMode[a.id] ?? 'unknown',
  }))
  stats.calls = stats.apis.reduce((sum, a) => sum + a.calls, 0)
  return { ...stats, calls: stats.calls, errors: stats.errors }
}

/**
 * Adopt the agent brain's cumulative per-endpoint counts as *deltas*, so its
 * spending shows up in the console totals without clobbering the calls this
 * process makes itself (operator QoS boosts, fallback-path reads).
 */
export function adoptExternalNac(
  apiByEndpoint: Record<string, number>,
  mode?: 'live' | 'sandbox',
  signalModes?: Record<string, 'live' | 'sandbox'>,
): void {
  // A forced-sandbox run is a decision made here, and it outranks whatever the
  // brain reports: without this, a brain started without the same flag flipped
  // the console back to "live" while every endpoint was still sandbox.
  if (config.nac.forceSandbox) return

  for (const [id, total] of Object.entries(apiByEndpoint || {})) {
    const seen = externalSeen[id] ?? 0
    const delta = Math.max(0, Number(total) - seen)
    if (delta > 0) perApiExternal[id] = (perApiExternal[id] ?? 0) + delta
    externalSeen[id] = Math.max(seen, Number(total))
  }
  // The brain owns its own client, so it is the authority on whether *its*
  // signals came back live — adopt its per-signal verdict verbatim.
  for (const [id, m] of Object.entries(signalModes || {})) {
    if (id in perApiMode) perApiMode[id] = m
  }
  if (mode) stats.mode = mode
}

/** Clear everything, including the external ledger, on scenario reset. */
export function resetNac(): void {
  for (const a of NAC_APIS) {
    perApiCalls[a.id] = 0
    perApiExternal[a.id] = 0
    externalSeen[a.id] = 0
  }
  stats.calls = 0
  stats.errors = 0
  stats.lastStatus = ''
  breaker.consecutiveFailures = 0
  breaker.openedAt = 0
  for (const a of NAC_APIS) {
    perApiMode[a.id] = config.nac.apiKey && !config.nac.forceSandbox ? 'unknown' : 'sandbox'
  }
  stats.mode = config.nac.apiKey && !config.nac.forceSandbox ? 'live' : 'sandbox'
  stats.lastStatus = config.nac.forceSandbox ? 'forced sandbox (NAC_FORCE_SANDBOX)' : ''
}

/** Attempt a live NaC call; resolve null when unavailable so callers simulate. */
async function liveCall(path: string, body: any): Promise<any | null> {
  if (config.nac.forceSandbox) return null
  if (!config.nac.apiKey) return null
  if (breakerOpen()) return null
  try {
    const correlator =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const res = await fetch(`${config.nac.baseUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-key': config.nac.apiKey,
        'x-rapidapi-host': config.nac.rapidApiHost,
        'x-correlator': correlator,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.nac.timeoutMs),
    })
    stats.lastStatus = `HTTP ${res.status}`
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status} ${text.slice(0, 80)}`)
    }
    const data = await res.json()
    perApiMode[apiIdForPath(path)] = 'live'
    breakerRecord(true)
    return data
  } catch (e: any) {
    stats.lastStatus = String(e?.message || e).slice(0, 60)
    stats.errors++
    // The caller simulates from here on, so this endpoint is degraded — and the
    // console is told, rather than the fallback happening invisibly.
    perApiMode[apiIdForPath(path)] = 'sandbox'
    breakerRecord(false)
    return null
  }
}

export interface ZoneDensitySignal {
  zoneId: string
  people: number
  densityPct: number
  congestion: 'low' | 'medium' | 'high' | 'very-high'
}

function congestionOf(pct: number): ZoneDensitySignal['congestion'] {
  if (pct >= 85) return 'very-high'
  if (pct >= 65) return 'high'
  if (pct >= 40) return 'medium'
  return 'low'
}

/** Probe device per zone — the venue's own SIM fleet (NAC_ZONE_PROBES). */
const ZONE_PROBES = config.nac.zoneProbes

/**
 * Map a CAMARA congestion class onto a comparable percentage.
 *
 * The response field is `congestionLevel`. This previously read `congestion`,
 * which the API never returns, so every live reading parsed to nothing and the
 * endpoint silently fell back to the venue model while still reporting "live".
 */
function congestionPct(level: string): number | null {
  const key = level.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (key === 'veryhigh' || key === 'severe' || key === 'critical') return 95
  if (key === 'high') return 90
  if (key === 'medium' || key === 'moderate') return 55
  if (key === 'low') return 25
  return null
}

/** The API returns an interval history in unspecified order — take the latest. */
function latestInterval(report: unknown[]): Record<string, unknown> {
  let best: Record<string, unknown> = {}
  let bestStop = ''
  for (const entry of report) {
    if (!entry || typeof entry !== 'object') continue
    const rec = entry as Record<string, unknown>
    const stop = String(rec.timeIntervalStop ?? '')
    if (stop >= bestStop) {
      bestStop = stop
      best = rec
    }
  }
  return best
}

/**
 * CAMARA Congestion Insights — network congestion as an early indicator of
 * crowd pressure. Live mode polls the venue's own probe device in each zone
 * and lets the reported class refine the band; people counts stay sourced from
 * the venue model (the network API reports a congestion class, not headcount).
 */
export async function congestionInsights(zones: { id: string; load: number; capacity: number }[]): Promise<ZoneDensitySignal[]> {
  record('congestion')
  const liveResults = await Promise.all(
    zones.map(async (z, i) => {
      const live = await liveCall('/congestion-insights/v0/query', {
        device: { phoneNumber: ZONE_PROBES[i % ZONE_PROBES.length] },
      })
      if (!Array.isArray(live) || live.length === 0) return null
      const entry = latestInterval(live)
      const level = String(entry.congestionLevel ?? entry.congestion ?? '').toLowerCase()
      const pct = congestionPct(level)
      return pct === null ? null : { zoneId: z.id, level, pct }
    }),
  )
  const anyLive = liveResults.some((r) => r !== null)
  return zones.map((z, i) => {
    const pct = (z.load / z.capacity) * 100
    const lr = liveResults[i]
    // When the network reports a congestion class, let it refine the band.
    const blended = anyLive && lr ? Math.round((pct + lr.pct) / 2) : Math.round(pct)
    return { zoneId: z.id, people: z.load, densityPct: blended, congestion: congestionOf(blended) }
  })
}

/** CAMARA Geofencing — subscription around the busiest zone (area-entered). */
export async function geofenceCheck(zoneId: string, densityPct: number): Promise<{ zoneId: string; crossed: boolean; threshold: number }> {
  record('geofence')
  // Global Village is at ~25.0705N, 55.3095E (Dubai).
  await liveCall('/geofencing-subscriptions/v0.3/subscriptions', {
    protocol: 'HTTP',
    // The API validates DNS on the sink host — it must resolve publicly.
    sink: config.nac.geofenceSink,
    types: ['org.camaraproject.geofencing-subscriptions.v0.area-entered'],
    config: {
      subscriptionDetail: {
        device: { phoneNumber: VISITOR_SAMPLE },
        area: {
          areaType: 'CIRCLE',
          center: { latitude: 25.0705, longitude: 55.3095 },
          radius: 500,
        },
      },
      initialEvent: true,
      subscriptionMaxEvents: 10,
    },
  })
  const threshold = densityPct >= 80 ? 80 : densityPct >= 60 ? 60 : 40
  return { zoneId, crossed: densityPct >= threshold, threshold }
}

/** CAMARA Location Retrieval — network fix for the demo visitor. */
export async function locationRetrieval(visitorPhone: string, zoneName: string): Promise<{ zone: string; accuracyM: number }> {
  record('location')
  const live = await liveCall('/location-retrieval/v0/retrieve', {
    device: { phoneNumber: visitorPhone },
    maxAge: 60,
  })
  const radius = live?.area?.radius
  if (typeof radius === 'number' && radius > 0) return { zone: zoneName, accuracyM: radius }
  return { zone: zoneName, accuracyM: 25 }
}

/** CAMARA Device Status / Roaming — is the visitor roaming, from where. */
export async function roamingStatus(visitorPhone: string, country: string): Promise<{ country: string; roaming: boolean }> {
  record('roaming')
  const live = await liveCall('/device-status/device-roaming-status/v1/retrieve', {
    device: { phoneNumber: visitorPhone },
  })
  if (live && typeof live.roaming === 'boolean') {
    return { country: live.countryName ?? country, roaming: live.roaming }
  }
  return { country, roaming: true }
}

/** CAMARA Device Reachability — can we push to this device right now. */
export async function reachability(visitorPhone: string): Promise<{ reachable: boolean; latencyMs: number }> {
  record('reachability')
  const t0 = Date.now()
  const live = await liveCall('/device-status/device-reachability-status/v1/retrieve', {
    device: { phoneNumber: visitorPhone },
  })
  if (live) {
    const reachable = live.reachable !== false
    return { reachable, latencyMs: Math.max(5, Date.now() - t0) }
  }
  return { reachable: true, latencyMs: 62 }
}

/** CAMARA QoS on Demand — priority network slice for ops comms. */
export async function qodBoost(sessionId: string): Promise<{ session: string; qos: string; durationMin: number } | null> {
  record('qod')
  const live = await liveCall('/qod/v0/sessions', {
    device: { phoneNumber: VISITOR_SAMPLE },
    applicationServer: { ipv4Address: '1.1.1.1' },
    qosProfile: 'DOWNLINK_M_UPLINK_L',
    duration: 30 * 60,
  })
  if (live) return { session: live.sessionId ?? live.id ?? sessionId, qos: live.qosProfile ?? 'DOWNLINK_M_UPLINK_L', durationMin: 30 }
  return { session: sessionId, qos: 'QOS_L', durationMin: 30 }
}

/** CAMARA Number Verification — silent visitor opt-in check. */
export async function numberVerification(visitorPhone: string): Promise<{ verified: boolean }> {
  record('verify')
  const live = await liveCall('/passthrough/camara/v1/number-verification/number-verification/v0/verify', {
    device: { phoneNumber: visitorPhone },
  })
  if (live) return { verified: live.devicePhoneNumberVerified !== false }
  return { verified: true }
}

/**
 * Boot probe — touch every endpoint once, so the console can state the truth
 * about each signal from the first frame instead of showing "idle" for
 * whatever nothing has happened to call yet.
 *
 * This is also where Number Verification's fallback becomes a visible fact
 * rather than a silent one: it needs an enrolled test number plus an extra
 * OAuth2 step, so on this platform it degrades — and the probe reports that
 * instead of skipping the endpoint and letting the UI imply it works.
 */
export async function probeEndpoints(): Promise<{ id: string; label: string; mode: string }[]> {
  // A forced-sandbox run must not touch the gateway at all, probe included.
  if (config.nac.forceSandbox) {
    return nacStats().apis.map((a) => ({ id: a.id, label: a.label, mode: a.mode }))
  }
  await congestionInsights([{ id: 'probe', load: 1, capacity: 100 }])
  await geofenceCheck('entry', 10)
  await locationRetrieval(VISITOR_SAMPLE, 'Entry')
  await roamingStatus(VISITOR_SAMPLE, 'unknown')
  await reachability(VISITOR_SAMPLE)
  await qodBoost('boot-probe')
  await numberVerification(VISITOR_SAMPLE)
  return nacStats().apis.map((a) => ({ id: a.id, label: a.label, mode: a.mode }))
}
