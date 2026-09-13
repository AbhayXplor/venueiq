/**
 * One-off: list geofencing subscriptions, delete the doctor's test ones.
 * Doubles as a lifecycle check: create (doctor) -> list -> delete all work.
 * Run: node scripts/nac-geofence-cleanup.mjs
 */
const fs = await import('node:fs')
const envFile = fs.readFileSync(new URL('../mini-services/venue-engine/.env', import.meta.url), 'utf8')
const env = {}
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}

const base = env.NAC_BASE_URL.replace(/\/$/, '')
const headers = () => ({
  'Content-Type': 'application/json',
  'x-rapidapi-key': env.NAC_API_KEY,
  'x-rapidapi-host': env.NAC_RAPIDAPI_HOST,
  'x-correlator': crypto.randomUUID(),
})

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12000),
  })
  const text = await res.text().catch(() => '')
  let data = null
  try { data = JSON.parse(text) } catch {}
  return { status: res.status, data, text }
}

// 1. List existing subscriptions
const list = await call('GET', '/geofencing-subscriptions/v0.3/subscriptions')
console.log(`list: HTTP ${list.status}`)
if (!Array.isArray(list.data)) {
  console.log('unexpected list response:', String(list.text).slice(0, 300))
  process.exit(1)
}
console.log(`found ${list.data.length} subscription(s)`)

// 2. Delete each one (they are all test subscriptions from the doctor run)
let deleted = 0
for (const sub of list.data) {
  const id = sub.subscriptionId || sub.id
  if (!id) continue
  const del = await call('DELETE', `/geofencing-subscriptions/v0.3/subscriptions/${encodeURIComponent(id)}`)
  const ok = del.status >= 200 && del.status < 300 || del.status === 404
  console.log(`${ok ? 'deleted' : 'FAILED '} ${id} (HTTP ${del.status})`)
  if (ok) deleted++
}
console.log(`\n${deleted}/${list.data.length} test subscription(s) cleaned up`)
