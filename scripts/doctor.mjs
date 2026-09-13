/**
 * VenueIQ doctor — quick credential health check.
 * Hits each external API endpoint once and reports online/offline + issues.
 * Node 18+ (uses global fetch). Run: node scripts/doctor.mjs
 */
const envFile = await import('node:fs').then(fs =>
  fs.readFileSync(new URL('../mini-services/venue-engine/.env', import.meta.url), 'utf8')
)
const env = {}
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}

const results = []
function report(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(28)} ${detail}`)
}

// ---------------------------------------------------------------------------
// 1. Ollama Cloud — OpenAI-compatible chat completions, reasoning_effort low
// ---------------------------------------------------------------------------
async function checkOllama() {
  const { OLLAMA_BASE_URL, OLLAMA_API_KEY, OLLAMA_MODEL } = env
  if (!OLLAMA_API_KEY) return report('Ollama Cloud (LLM)', false, 'no API key in .env')
  const t0 = Date.now()
  try {
    const res = await fetch(`${OLLAMA_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OLLAMA_API_KEY}` },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: 'You are a health probe.' },
          { role: 'user', content: 'Reply with the single word OK.' },
        ],
        reasoning_effort: 'low',
        max_tokens: 512,
        stream: false,
      }),
      signal: AbortSignal.timeout(25000),
    })
    const ms = Date.now() - t0
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return report('Ollama Cloud (LLM)', false, `HTTP ${res.status} — ${body.slice(0, 100)}`)
    }
    const data = await res.json()
    const text = data?.choices?.[0]?.message?.content
    if (!text) return report('Ollama Cloud (LLM)', false, 'empty completion')
    return report('Ollama Cloud (LLM)', true, `${OLLAMA_MODEL} replied "${String(text).trim().slice(0, 20)}" in ${ms} ms`)
  } catch (e) {
    return report('Ollama Cloud (LLM)', false, `${String(e?.message || e).slice(0, 90)} (${Date.now() - t0} ms)`)
  }
}

// ---------------------------------------------------------------------------
// 2. Nokia NaC — gateway detail: URL base and x-rapidapi-host are DIFFERENT
// ---------------------------------------------------------------------------
const NAC_HEADERS = () => ({
  'Content-Type': 'application/json',
  'x-rapidapi-key': env.NAC_API_KEY,
  'x-rapidapi-host': env.NAC_RAPIDAPI_HOST,
  'x-correlator': crypto.randomUUID(),
})

async function nacCall(name, path, body, expect) {
  if (!env.NAC_API_KEY) return report(name, false, 'no API key in .env')
  const t0 = Date.now()
  try {
    const res = await fetch(`${env.NAC_BASE_URL.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: NAC_HEADERS(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    })
    const ms = Date.now() - t0
    const text = await res.text().catch(() => '')
    if (!res.ok) return report(name, false, `HTTP ${res.status} — ${text.slice(0, 90)}`)
    let data = null
    try { data = JSON.parse(text) } catch {}
    const shape = expect ? expect(data) : null
    if (shape === false) return report(name, false, `HTTP 200 but unexpected shape: ${text.slice(0, 90)}`)
    return report(name, true, `HTTP 200 in ${ms} ms${shape ? ` — ${shape}` : ''}`)
  } catch (e) {
    return report(name, false, `${String(e?.message || e).slice(0, 90)} (${Date.now() - t0} ms)`)
  }
}

const PROBE = '+99999991000'

async function checkNac() {
  console.log(`\nNokia NaC gateway: ${env.NAC_BASE_URL} (host header: ${env.NAC_RAPIDAPI_HOST})\n`)

  // Congestion Insights — the core signal
  await nacCall(
    'Congestion Insights',
    '/congestion-insights/v0/query',
    { device: { phoneNumber: PROBE } },
    (d) => (Array.isArray(d) ? `${d.length} cell report(s)` : typeof d === 'object' && d ? 'object response' : false),
  )

  // Location Retrieval
  await nacCall(
    'Location Retrieval',
    '/location-retrieval/v0/retrieve',
    { device: { phoneNumber: PROBE }, maxAge: 60 },
    (d) => (d?.area ? `fix: lat ${d.area.center?.latitude ?? '?'} +/-${d.area.radius ?? '?'}m` : 'object response'),
  )

  // Roaming Status
  await nacCall(
    'Roaming Status',
    '/device-status/device-roaming-status/v1/retrieve',
    { device: { phoneNumber: PROBE } },
    (d) => `roaming=${d?.roaming} country=${d?.countryName ?? '?'}`,
  )

  // Reachability
  await nacCall(
    'Device Reachability',
    '/device-status/device-reachability-status/v1/retrieve',
    { device: { phoneNumber: PROBE } },
    (d) => `reachable=${d?.reachable}`,
  )

  // QoD session create
  await nacCall(
    'QoS on Demand',
    '/qod/v0/sessions',
    {
      device: { phoneNumber: PROBE },
      applicationServer: { ipv4Address: '1.1.1.1' },
      qosProfile: 'DOWNLINK_M_UPLINK_L',
      duration: 1800,
    },
    (d) => (d?.sessionId || d?.id ? `session ${String(d.sessionId || d.id).slice(0, 18)}…` : 'object response'),
  )

  // Geofencing subscription create (webhook sink must resolve publicly — example.com does)
  await nacCall(
    'Geofencing (subscription)',
    '/geofencing-subscriptions/v0.3/subscriptions',
    {
      protocol: 'HTTP',
      sink: 'https://example.com/webhook',
      types: ['org.camaraproject.geofencing-subscriptions.v0.area-entered'],
      config: {
        subscriptionDetail: {
          device: { phoneNumber: PROBE },
          area: { areaType: 'CIRCLE', center: { latitude: 25.0705, longitude: 55.3095 }, radius: 500 },
        },
        initialEvent: true,
        subscriptionMaxEvents: 10,
      },
    },
    (d) => (d?.subscriptionId || d?.id ? `subscription ${String(d.subscriptionId || d.id).slice(0, 18)}…` : 'object response'),
  )

  // Number Verification — documented to need extra OAuth2 step; expect graceful outcome
  await nacCall(
    'Number Verification',
    '/passthrough/camara/v1/number-verification/number-verification/v0/verify',
    { device: { phoneNumber: PROBE } },
    () => 'response received (OAuth2 caveat known)',
  )
}

// ---------------------------------------------------------------------------
await checkOllama()
console.log('')
await checkNac()

const passed = results.filter((r) => r.ok).length
console.log(`\n${passed}/${results.length} checks passed`)
