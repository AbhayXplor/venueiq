/**
 * Gemini/Gemma probe — verify the user's key, list visible models, then test
 * real chat calls through BOTH the OpenAI-compatible endpoint (what the
 * VenueIQ engine uses) and the native generateContent API.
 * No assumptions: everything is measured. Run: node scripts/gemini-probe.mjs
 */
const KEY = process.argv[2] || ''
if (!KEY) {
  console.error('usage: node scripts/gemini-probe.mjs <API_KEY>')
  process.exit(1)
}
const results = []
function report(name, ok, detail) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(34)} ${detail}`)
}

// ---------------------------------------------------------------------------
// 1. ListModels — what can this key actually see?
// ---------------------------------------------------------------------------
let gemmaModels = []
let flashModels = []
try {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
    headers: { 'x-goog-api-key': KEY },
    signal: AbortSignal.timeout(15000),
  })
  const text = await res.text()
  if (!res.ok) {
    console.error(`ListModels HTTP ${res.status}: ${text.slice(0, 200)}`)
    process.exit(1)
  }
  const data = JSON.parse(text)
  const names = (data.models || []).map((m) => m.name.replace('models/', ''))
  gemmaModels = names.filter((n) => n.toLowerCase().includes('gemma'))
  flashModels = names.filter((n) => n.includes('flash-lite') || (n.includes('flash') && !n.includes('thinking')))
  console.log(`ListModels: ${names.length} models visible with this key`)
  console.log(`  gemma models : ${gemmaModels.length ? gemmaModels.join(', ') : '(none visible)'}`)
  console.log(`  flash models : ${flashModels.slice(0, 8).join(', ')}${flashModels.length > 8 ? ' …' : ''}`)
} catch (e) {
  console.error(`ListModels failed: ${String(e?.message || e)}`)
  process.exit(1)
}

// Candidates in tollgate's priority order, filtered to what actually exists
const preferred =
  gemmaModels.find((m) => m.includes('26b')) ||
  gemmaModels.find((m) => m.startsWith('gemma-4')) ||
  gemmaModels[0]
const fallbacks = [
  gemmaModels.find((m) => m.includes('31b')),
  flashModels.find((m) => m.includes('3.1')),
  flashModels[0],
].filter(Boolean)
const candidates = [...new Set([preferred, ...fallbacks])].filter(Boolean)
console.log(`\nTesting candidates in priority order: ${candidates.join(' -> ')}\n`)

// Strict-JSON prompt shaped like the VenueIQ agents use
const SYSTEM = 'You are a monitoring agent for a venue crowd-safety system. Reply ONLY with compact JSON: {"anomalies":[{"zone":"<name>","finding":"<one sentence>","severity":"warn"}]}. Maximum 2 anomalies.'
const USER = 'Main Stage: 2900/3200 (91%), 10-min change +180, status critical. Carnival: 1100/1200 (92%), +65, critical. Food Court: 640/1100 (58%), +30, filling.'

// ---------------------------------------------------------------------------
// 2. OpenAI-compatible endpoint (drop-in for the engine's callGemini)
// ---------------------------------------------------------------------------
async function probeOpenAiCompat(model) {
  const t0 = Date.now()
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: USER },
        ],
        temperature: 0.4,
        max_tokens: 1024,
        stream: false,
      }),
      signal: AbortSignal.timeout(30000),
    })
    const ms = Date.now() - t0
    const text = await res.text()
    if (!res.ok) return report(`${model} [openai-compat]`, false, `HTTP ${res.status} — ${text.slice(0, 110)}`)
    const data = JSON.parse(text)
    const msg = data?.choices?.[0]?.message
    const content = msg?.content
    const hasJson = typeof content === 'string' && content.includes('{')
    return report(`${model} [openai-compat]`, hasJson, `${ms} ms — ${content ? String(content).replace(/\s+/g, ' ').slice(0, 90) : '(empty content)'}`)
  } catch (e) {
    return report(`${model} [openai-compat]`, false, `${String(e?.message || e).slice(0, 90)} (${Date.now() - t0} ms)`)
  }
}

// ---------------------------------------------------------------------------
// 3. Native generateContent (what the google-genai SDK uses — LangGraph path)
// ---------------------------------------------------------------------------
async function probeNative(model) {
  const t0 = Date.now()
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: USER }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
      }),
      signal: AbortSignal.timeout(30000),
    })
    const ms = Date.now() - t0
    const text = await res.text()
    if (!res.ok) return report(`${model} [native]`, false, `HTTP ${res.status} — ${text.slice(0, 110)}`)
    const data = JSON.parse(text)
    const parts = data?.candidates?.[0]?.content?.parts || []
    const thoughtParts = parts.filter((p) => p.thought === true)
    const contentParts = parts.filter((p) => p.thought !== true)
    const joined = contentParts.map((p) => p.text || '').join(' ')
    const usage = data?.usageMetadata || {}
    const hasJson = joined.includes('{')
    const thoughtNote = thoughtParts.length ? ` (+${thoughtParts.length} thought part(s), ${usage.thoughtsTokenCount ?? '?'} think tokens)` : ''
    return report(`${model} [native]`, hasJson, `${ms} ms — ${joined.replace(/\s+/g, ' ').slice(0, 90) || '(empty)'}${thoughtNote}`)
  } catch (e) {
    return report(`${model} [native]`, false, `${String(e?.message || e).slice(0, 90)} (${Date.now() - t0} ms)`)
  }
}

for (const m of candidates) {
  await probeOpenAiCompat(m)
  await probeNative(m)
  console.log('')
}

// ---------------------------------------------------------------------------
// 4. Latency check: two back-to-back calls on the preferred model (tick budget)
// ---------------------------------------------------------------------------
if (preferred) {
  console.log(`Latency check — 2 back-to-back native calls on ${preferred}:`)
  for (let i = 0; i < 2; i++) await probeNative(preferred)
}

const passed = results.filter((r) => r.ok).length
console.log(`\n${passed}/${results.length} call checks passed`)
