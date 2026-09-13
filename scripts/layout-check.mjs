/**
 * Layout check — measures the real rendered geometry of every page in headless
 * Chrome and fails on the class of bug screenshots catch late: panels that
 * overlap, cards that escape their container, controls clipped by the viewport,
 * or a page that scrolls sideways.
 *
 * Zero dependencies. Node 22's global WebSocket speaks CDP directly.
 *
 *   node scripts/layout-check.mjs
 *   node scripts/layout-check.mjs --base http://127.0.0.1:3000 --verbose
 *
 * `--eval <js>` navigates to the base URL and prints one expression's result,
 * as JSON. Use it to ask a page-level question ("can this origin reach the
 * engine socket?") without leaving the terminal.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const BASE = flag("base", process.env.LAYOUT_BASE ?? "http://127.0.0.1:3000")
const VERBOSE = args.includes("--verbose")
const TIMEOUT_MS = Number(flag("timeout", "25000"))

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA ?? ""}/Google/Chrome/Application/chrome.exe`,
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean)

/* ---------------------------------------------------------------------------
   The measurement itself. Runs inside the page, returns plain data.
   --------------------------------------------------------------------------- */

const MEASURE = String.raw`(() => {
  const TEXT_TAGS = new Set(['BUTTON', 'A', 'H1', 'H2', 'H3', 'P', 'CODE', 'LI', 'SPAN', 'STRONG', 'B'])

  const rectOf = (el) => el.getBoundingClientRect()
  const area = (a, b) => {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
    return w > 0 && h > 0 ? w * h : 0
  }
  const label = (el) => {
    const t = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 42)
    return el.tagName.toLowerCase() + (el.className && typeof el.className === 'string'
      ? '.' + el.className.split(/\s+/).slice(0, 2).join('.')
      : '') + (t ? ' "' + t + '"' : '')
  }

  const vw = window.innerWidth
  const vh = window.innerHeight
  const doc = document.documentElement

  // 1. The whole document must not scroll sideways.
  const horizontalOverflow = Math.max(doc.scrollWidth, document.body.scrollWidth) - doc.clientWidth

  // 2. Panels must never overlap each other.
  const panels = [...document.querySelectorAll('.vq-panel')]
  const overlaps = []
  for (let i = 0; i < panels.length; i++) {
    for (let j = i + 1; j < panels.length; j++) {
      if (panels[i].contains(panels[j]) || panels[j].contains(panels[i])) continue
      const a = rectOf(panels[i]), b = rectOf(panels[j])
      const overlap = area(a, b)
      if (overlap > 4) overlaps.push({ a: label(panels[i]), b: label(panels[j]), px: Math.round(overlap) })
    }
  }

  // 3. Zone cards must stay inside their panel and clear of each other.
  const cards = [...document.querySelectorAll('[role="group"][aria-label]')]
  const escaped = []
  const cardOverlaps = []
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]
    const host = card.closest('.vq-panel')
    const r = rectOf(card)
    if (host) {
      const h = rectOf(host)
      const outBy = Math.max(0, h.left - r.left, r.right - h.right, h.top - r.top, r.bottom - h.bottom)
      if (outBy > 1) escaped.push({ card: label(card), px: Math.round(outBy) })
    }
    for (let j = i + 1; j < cards.length; j++) {
      const o = area(r, rectOf(cards[j]))
      if (o > 4) cardOverlaps.push({ a: label(card), b: label(cards[j]), px: Math.round(o) })
    }
  }

  // 4. Text and controls must not be pushed past the viewport edges.
  const offscreen = []
  const clipped = []
  for (const el of document.querySelectorAll('button, a, h1, h2, h3, p, code, li')) {
    if (el.closest('[aria-hidden="true"]')) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') continue
    const r = rectOf(el)
    if (r.width === 0 || r.height === 0) continue
    // ignore deliberately decorative off-frame layers
    if (el.closest('.vq-land-photo, .vq-land-grain')) continue
    if (r.right > vw + 1 || r.left < -1) {
      offscreen.push({ el: label(el), left: Math.round(r.left), right: Math.round(r.right), vw })
      continue
    }
    if (el.tagName === 'BUTTON' && TEXT_TAGS.has(el.tagName) && el.scrollWidth > el.clientWidth + 4) {
      clipped.push({ el: label(el), scroll: el.scrollWidth, client: el.clientWidth })
    }
  }

  // 5. Palette contract. Chrome is neutral; the only hue allowed is the
  // four-step status ramp (calm → filling → busy → critical).
  //
  // The rule this encodes is one of SCALE, not hue-abstinence. A coloured dot
  // or a 2px edge is data — it is how an operator reads six zones at a glance.
  // A large coloured fill is decoration, and a screen full of it is what makes
  // a UI read as generated rather than designed. So text may carry any
  // documented status hue, but a background or border may carry one only while
  // the element stays small. That is the difference the eye actually reacts to,
  // and it is checkable, which is why it lives here instead of in a style guide.
  //
  // Tailwind v4 emits many colours as oklab(). They are almost always white
  // or grey at partial alpha, and a colour-blind check here would report a
  // clean palette no matter what the page painted, so handle both forms.
  const rgbToHsl = (rgb, a) => {
    const [r, g, b] = rgb
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
    const l = (max + min) / 2
    let h = 0
    if (d > 0) {
      if (max === r) h = 60 * (((g - b) / d) % 6)
      else if (max === g) h = 60 * ((b - r) / d + 2)
      else h = 60 * ((r - g) / d + 4)
    }
    if (h < 0) h += 360
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
    return { h, s, l, a }
  }

  // oklab → linear sRGB → sRGB. Tailwind v4 emits most colours in oklab(), and
  // its a/b components are chroma axes: their ratio gives an OKLCH hue angle,
  // which is a different scale from the HSL hue of a hex colour. Comparing them
  // directly would be meaningless, so convert to real RGB first and derive HSL
  // from that. This is what stops a legitimate border-critical/30 reading as an
  // unrecognised hue.
  const oklabToRgb = (L, a, b) => {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b
    const l3 = l_ * l_ * l_, m3 = m_ * m_ * m_, s3 = s_ * s_ * s_
    const lin = [
      4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
      -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
      -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3,
    ]
    return lin.map((v) => {
      const c = Math.min(1, Math.max(0, v))
      return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
    })
  }

  const hsl = (str) => {
    const ok = /oklab\(([\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)(?:\s*\/\s*([\d.]+))?\)/.exec(str || '')
    if (ok) {
      return rgbToHsl(oklabToRgb(+ok[1], +ok[2], +ok[3]), ok[4] === undefined ? 1 : +ok[4])
    }
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(str || '')
    if (!m) return null
    return rgbToHsl([+m[1] / 255, +m[2] / 255, +m[3] / 255], m[4] === undefined ? 1 : +m[4])
  }
  // The documented ramp, as measured hues. Calm is deliberately absent: it is a
  // cool grey (chroma below the neutral threshold) and passes as a neutral.
  // NOTE: no backticks anywhere in this block — it lives inside a template
  // literal, so one would terminate the script's own source.
  const STATUS_HUES = [
    { name: 'filling', h: 41 },
    { name: 'busy', h: 24 },
    { name: 'critical', h: 3 },
  ]
  const HUE_TOLERANCE = 16
  const STATUS_AREA = 5000 // px² — above this a status fill stops being a mark
  const hueDelta = (a, b) => {
    const d = Math.abs(a - b) % 360
    return d > 180 ? 360 - d : d
  }
  const statusName = (h) => (STATUS_HUES.find((s) => hueDelta(h, s.h) <= HUE_TOLERANCE) || {}).name

  const hues = []
  for (const el of document.querySelectorAll('*')) {
    if (el.closest('[aria-hidden="true"], .vq-land-photo, .vq-land-grain')) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none') continue
    for (const prop of ['color', 'backgroundColor', 'borderTopColor', 'borderLeftColor']) {
      const info = hsl(cs[prop])
      if (!info) continue
      // Too faint to read as a coloured surface at all, and too dark to see.
      if (info.a <= 0.18 || info.l <= 0.1) continue
      if (info.s <= 0.22 || info.l >= 0.95) continue

      const status = statusName(info.h)

      // Text is small by construction, so any documented status hue is fine.
      if (prop === 'color') {
        if (status) continue
        hues.push({ el: label(el), prop, color: cs[prop], h: Math.round(info.h), s: +info.s.toFixed(2) })
        continue
      }

      // Backgrounds and borders must either be neutral or a small status mark.
      if (!status) {
        hues.push({ el: label(el), prop, color: cs[prop], h: Math.round(info.h), s: +info.s.toFixed(2) })
        continue
      }
      const r = el.getBoundingClientRect()
      // A background covers its box, so box area is the right measure. A border
      // only covers the perimeter — measuring the box would flag a 1px outline
      // on a large card as though it were a large fill.
      const isBorder = prop.startsWith('border')
      const bw = isBorder ? parseFloat(cs[prop === 'borderLeftColor' ? 'borderLeftWidth' : 'borderTopWidth']) || 1 : 0
      const area = isBorder
        ? Math.round((r.width + r.height) * 2 * bw)
        : Math.round(r.width * r.height)
      if (area > STATUS_AREA) {
        hues.push({
          el: label(el), prop, color: cs[prop], h: Math.round(info.h), s: +info.s.toFixed(2),
          why: status + ' used as a ' + area + 'px² fill, over the ' + STATUS_AREA + 'px² mark budget',
        })
      }
    }
  }
  const uniqueHues = [...new Map(hues.map((x) => [x.color + x.prop, x])).values()].slice(0, 12)

  // 6. Readability of controls.
  //
  // This check exists because the layout and palette checks both passed while a
  // primary call-to-action was rendering white text on a white button: neither
  // of them asks whether the label can actually be read. A control that exists,
  // sits on-palette and has no legible text is still broken, and that is the
  // kind of thing only a human eye normally catches — which is exactly why it
  // belongs in an automated pass rather than a style guide.
  const relLum = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const parseRgb = (str) => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(str || '')
    if (!m) return null
    return { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] }
  }
  const ratio = (a, b) => {
    const hi = Math.max(relLum(a), relLum(b))
    const lo = Math.min(relLum(a), relLum(b))
    return (hi + 0.05) / (lo + 0.05)
  }
  const lowContrast = []
  for (const el of document.querySelectorAll('a, button')) {
    if (el.closest('[aria-hidden="true"]')) continue
    if (!(el.textContent || '').trim()) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const fg = parseRgb(cs.color)
    if (!fg) continue
    // A control's surface may be a flat colour or a gradient. Gradients leave
    // background-color transparent, so fall back to the first stop — that is
    // the colour the label actually sits on.
    let surface = parseRgb(cs.backgroundColor)
    if ((!surface || surface.a < 0.6) && cs.backgroundImage !== 'none') {
      surface = parseRgb(cs.backgroundImage)
    }
    // Still transparent: the text sits on the page behind it, which this cannot
    // measure without sampling pixels. Those are judged by eye instead.
    if (!surface || surface.a < 0.6) continue
    const r = ratio(surface.rgb, fg.rgb)
    if (r < 4.5) lowContrast.push({ el: label(el), ratio: +r.toFixed(2), color: cs.color, bg: cs.backgroundColor })
  }

  return {
    vw, vh, horizontalOverflow, overlaps, escaped, cardOverlaps, offscreen, clipped,
    hueCount: hues.length, uniqueHues, lowContrast,
    bodyText: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 260),
    panels: panels.length, cards: cards.length,
    docHeight: Math.round(document.body.scrollHeight),
    hasLayout: !!document.querySelector('.vq-panel, .vq-land-hero, .vq-land-doc, .vq-film'),
  }
})()`

/* ---------------------------------------------------------------------------
   Minimal CDP client.
   --------------------------------------------------------------------------- */

class CDP {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.listeners = new Map()
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
      } else if (msg.method && this.listeners.has(msg.method)) {
        for (const fn of this.listeners.get(msg.method)) fn(msg.params)
      }
    })
  }

  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`${method} timed out`))
        }
      }, TIMEOUT_MS)
    })
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, [])
    this.listeners.get(method).push(fn)
  }

  once(method) {
    return new Promise((resolve) => this.on(method, resolve))
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchJson(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url)
      if (res.ok) return await res.json()
    } catch {
      /* not up yet */
    }
    await sleep(250)
  }
  throw new Error(`Chrome never answered ${url}`)
}

/* ---------------------------------------------------------------------------
   Routes × widths. Every surface, from a laptop to a cinema display.
   --------------------------------------------------------------------------- */

const ROUTES = [
  { path: "/operator", ready: ".vq-panel" },
  { path: "/visitor", ready: '[role="tablist"]' },
  { path: "/live", ready: ".vq-panel" },
  { path: "/how", ready: ".vq-land-doc" },
  // Either landing layout satisfies this: the film variant replaced the classic
  // hero as the default, and both are kept in the codebase.
  { path: "/", ready: ".vq-land-hero, .vq-film-hero" },
]

const WIDTHS = [1280, 1440, 1680, 1920]

async function main() {
  const chrome = CHROME_CANDIDATES.find((p) => p && existsSync(p))
  if (!chrome) {
    console.error("No Chrome found. Set CHROME_PATH.")
    process.exit(2)
  }

  const profile = await mkdtemp(join(tmpdir(), "vq-layout-"))
  const port = 9700 + Math.floor(Math.random() * 200)
  const child = spawn(
    chrome,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-gpu",
      "--hide-scrollbars",
      "about:blank",
    ],
    { stdio: "ignore" },
  )

  const cleanup = async () => {
    try { child.kill() } catch { /* already gone */ }
    await rm(profile, { recursive: true, force: true }).catch(() => {})
  }

  let failures = 0
  const rows = []

  try {
    await fetchJson(`http://127.0.0.1:${port}/json/version`)
    const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`)
    const page = targets.find((t) => t.type === "page")
    if (!page) throw new Error("no page target")

    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true })
      ws.addEventListener("error", () => reject(new Error("CDP socket failed")), { once: true })
    })
    const cdp = new CDP(ws)

    await cdp.send("Page.enable")
    await cdp.send("Runtime.enable")

    const evalExpr = flag("eval", null)
    if (evalExpr) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
      const loaded = cdp.once("Page.loadEventFired")
      await cdp.send("Page.navigate", { url: BASE })
      await loaded
      await sleep(1500)
      const res = await cdp.send("Runtime.evaluate", { expression: evalExpr, returnByValue: true, awaitPromise: true })
      console.log(JSON.stringify(res.result.value ?? res.result.description ?? res, null, 2))
      ws.close()
      await cleanup()
      process.exit(0)
    }

    // Page-side diagnostics, so "never rendered" comes with a reason attached
    // instead of sending the next person into the page with a debugger.
    let pageLog = []
    cdp.on("Runtime.consoleAPICalled", (p) => {
      pageLog.push(`[${p.type}] ` + p.args.map((a) => a.value ?? a.description ?? a.type).join(" "))
      if (pageLog.length > 40) pageLog.shift()
    })
    cdp.on("Runtime.exceptionThrown", (p) => {
      pageLog.push(`[throw] ${p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text}`)
      if (pageLog.length > 40) pageLog.shift()
    })

    // Failed requests are the usual reason a page "never renders", so name
    // them rather than leaving the next person to open a debugger.
    const requestUrls = new Map()
    let requestLog = []
    cdp.on("Network.requestWillBeSent", (p) => requestUrls.set(p.requestId, p.request.url))
    cdp.on("Network.loadingFailed", (p) => {
      const url = requestUrls.get(p.requestId) ?? "?"
      requestLog.push(`${p.errorText} ${p.type} ${url}`)
      if (requestLog.length > 30) requestLog.shift()
    })
    cdp.on("Network.webSocketCreated", (p) => {
      requestLog.push(`ws opened  ${p.url}`)
      if (requestLog.length > 30) requestLog.shift()
    })
    cdp.on("Network.webSocketFrameError", (p) => {
      requestLog.push(`ws frame error ${p.errorMessage}`)
      if (requestLog.length > 30) requestLog.shift()
    })
    await cdp.send("Network.enable")

    for (const route of ROUTES) {
      for (const width of WIDTHS) {
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 900,
          deviceScaleFactor: 1,
          mobile: false,
        })

        pageLog = []
        requestLog = []
        const loaded = cdp.once("Page.loadEventFired")
        await cdp.send("Page.navigate", { url: `${BASE}${route.path}` })
        await loaded

        // Panels only render once the engine snapshot lands, so wait for the
        // route's ready selector rather than the document's load event.
        let found = false
        for (let i = 0; i < 80; i++) {
          const r = await cdp.send("Runtime.evaluate", {
            expression: `!!document.querySelector(${JSON.stringify(route.ready)})`,
            returnByValue: true,
          })
          if (r.result.value) { found = true; break }
          await sleep(250)
        }
        await sleep(350) // let entrance animations settle at their resting state

        const res = await cdp.send("Runtime.evaluate", { expression: MEASURE, returnByValue: true })
        const m = res.result.value
        if (!m) throw new Error(`${route.path} measurement returned nothing`)

        const problems = []
        if (!found) problems.push(`never rendered ${route.ready} — body reads: "${m.bodyText}"`)
        if (m.horizontalOverflow > 1) problems.push(`page scrolls sideways by ${m.horizontalOverflow}px`)
        if (m.overlaps.length) problems.push(`${m.overlaps.length} panel overlap(s)`)
        if (m.cardOverlaps.length) problems.push(`${m.cardOverlaps.length} card overlap(s)`)
        if (m.escaped.length) problems.push(`${m.escaped.length} card(s) out of panel`)
        if (m.offscreen.length) problems.push(`${m.offscreen.length} element(s) past viewport edge`)
        if (m.clipped.length) problems.push(`${m.clipped.length} clipped control(s)`)
        if (m.hueCount) {
          const shown = (m.uniqueHues || [])
            .slice(0, 4)
            .map((o) => `${o.color} on ${o.prop} of ${o.el}${o.why ? ` (${o.why})` : ""}`)
            .join("; ")
          problems.push(`${m.hueCount} colour(s) outside the status contract${shown ? ` — ${shown}` : ""}`)
        }
        if (m.lowContrast.length) {
          const shown = (m.lowContrast || [])
            .slice(0, 3)
            .map((o) => `${o.ratio}:1 on ${o.el}`)
            .join("; ")
          problems.push(`${m.lowContrast.length} control(s) below 4.5:1 contrast — ${shown}`)
        }

        if (problems.length) failures++
        rows.push({ route: route.path, width, problems, m })

        const status = problems.length ? "FAIL" : "ok  "
        console.log(`${status} ${route.path.padEnd(10)} ${String(width).padStart(4)}px  panels=${m.panels} cards=${m.cards} docH=${m.docHeight}`)
        if (problems.length) {
          for (const p of problems) console.log(`       · ${p}`)
          if (VERBOSE) {
            for (const line of pageLog.slice(-12)) console.log(`         page: ${line}`)
            for (const line of requestLog.slice(-8)) console.log(`         net:  ${line}`)
            for (const o of m.overlaps) console.log(`         overlap ${o.px}px²: ${o.a} ↔ ${o.b}`)
            for (const o of m.cardOverlaps) console.log(`         card overlap ${o.px}px²: ${o.a} ↔ ${o.b}`)
            for (const o of m.escaped) console.log(`         escapes panel by ${o.px}px: ${o.card}`)
            for (const o of m.offscreen) console.log(`         offscreen [${o.left}..${o.right}] vw=${o.vw}: ${o.el}`)
            for (const o of m.clipped) console.log(`         clipped ${o.scroll}>${o.client}: ${o.el}`)
            for (const o of m.uniqueHues) console.log(`         hue ${o.color} (${o.h}°, sat ${o.s}) on ${o.prop} of ${o.el}`)
            for (const o of m.lowContrast) console.log(`         low contrast ${o.ratio}:1 ${o.color} on ${o.bg} — ${o.el}`)
          }
        }
      }
    }

    ws.close()
  } finally {
    await cleanup()
  }

  console.log(
    failures === 0
      ? `\nPASS — ${rows.length}/${rows.length} route×width combinations clean`
      : `\nFAIL — ${failures}/${rows.length} combinations have layout problems`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error("layout-check crashed:", err.message)
  process.exit(2)
})
