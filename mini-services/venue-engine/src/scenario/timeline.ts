/**
 * Deterministic "evening at Global Village" scenario.
 *
 * Every zone load is a smooth keyframed curve — no randomness, no jitter.
 * The same simulated minute always produces the same numbers, so the demo
 * is fully replayable and every figure on screen is defensible.
 */

export interface ZoneSpec {
  id: string
  name: string
  short: string
  hue: 'stage' | 'pavilion' | 'carnival' | 'transit' | 'entry' | 'food'
  capacity: number
  x: number
  y: number
  /** minuteOfDay -> people. Interpolated with smoothstep. */
  curve: [number, number][]
}

const S = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)))
  return x * x * (3 - 2 * x)
}

/** Smooth keyframe interpolation. */
export function curveAt(curve: [number, number][], m: number): number {
  if (m <= curve[0][0]) return curve[0][1]
  const last = curve[curve.length - 1]
  if (m >= last[0]) return last[1]
  for (let i = 0; i < curve.length - 1; i++) {
    const [m0, v0] = curve[i]
    const [m1, v1] = curve[i + 1]
    if (m >= m0 && m <= m1) {
      return Math.round(v0 + (v1 - v0) * S(m0, m1, m))
    }
  }
  return last[1]
}

export const ZONES: ZoneSpec[] = [
  {
    id: 'entry',
    name: 'Entry Plaza',
    short: 'Entry',
    hue: 'entry',
    capacity: 1500,
    x: 50,
    y: 88,
    curve: [
      [1080, 0], [1088, 620], [1098, 1150], [1110, 980], [1125, 640],
      [1150, 420], [1200, 300], [1290, 260], [1310, 420], [1330, 640],
      [1355, 380], [1370, 180], [1380, 60],
    ],
  },
  {
    id: 'stage',
    name: 'Main Stage',
    short: 'Stage',
    hue: 'stage',
    capacity: 3200,
    x: 50,
    y: 30,
    curve: [
      [1080, 0], [1140, 380], [1190, 880], [1220, 1580], [1235, 2520],
      [1250, 3060], [1265, 2900], [1278, 1980], [1292, 940], [1310, 360],
      [1380, 80],
    ],
  },
  {
    id: 'carnival',
    name: 'Carnival',
    short: 'Carnival',
    hue: 'carnival',
    capacity: 1200,
    x: 82,
    y: 52,
    curve: [
      [1080, 0], [1110, 240], [1140, 510], [1170, 740], [1200, 920],
      [1225, 1100], [1250, 1165], [1275, 1030], [1300, 760], [1330, 430],
      [1380, 110],
    ],
  },
  {
    id: 'pavilions',
    name: 'World Pavilions',
    short: 'Pavilions',
    hue: 'pavilion',
    capacity: 2800,
    x: 18,
    y: 52,
    curve: [
      [1080, 0], [1120, 580], [1160, 1180], [1200, 1780], [1240, 2280],
      [1262, 2490], [1290, 2330], [1320, 1880], [1350, 1180], [1380, 480],
    ],
  },
  {
    id: 'food',
    name: 'Food Court',
    short: 'Food',
    hue: 'food',
    capacity: 1100,
    x: 50,
    y: 62,
    curve: [
      [1080, 0], [1100, 170], [1130, 510], [1160, 810], [1185, 940],
      [1215, 690], [1245, 510], [1272, 640], [1290, 810], [1312, 690],
      [1340, 410], [1380, 130],
    ],
  },
  {
    id: 'transit',
    name: 'Transit Hub',
    short: 'Transit',
    hue: 'transit',
    capacity: 6000,
    x: 50,
    y: 10,
    curve: [
      [1080, 180], [1100, 1380], [1130, 1880], [1170, 2180], [1210, 2380],
      [1250, 2260], [1290, 2560], [1305, 3350], [1325, 2760], [1345, 4150],
      [1365, 2350], [1380, 850],
    ],
  },
]

/** People on walkways and in between zones — a fixed share of zone load. */
export const DISTRIBUTED_SHARE = 0.18

export const VENUE_CAPACITY = 69000

export function phaseFor(m: number): string {
  if (m < 1100) return 'Gates open'
  if (m < 1190) return 'Evening builds'
  if (m < 1225) return 'Pre-show drift'
  if (m < 1275) return 'Showtime peak'
  if (m < 1310) return 'Show egress'
  if (m < 1350) return 'Late evening'
  return 'Closing'
}

/** Deterministic queue waits (minutes) where queues physically exist. */
export function waitFor(zoneId: string, densityPct: number): number | null {
  switch (zoneId) {
    case 'carnival':
      return Math.round(4 + densityPct * 0.3)
    case 'food':
      return Math.round(densityPct * 0.11)
    case 'stage':
      return Math.round(Math.max(0, densityPct * 0.06))
    default:
      return null
  }
}

/** The demo visitor's journey through the evening. */
export const VISITOR_JOURNEY: { from: number; zoneId: string }[] = [
  { from: 1088, zoneId: 'entry' },
  { from: 1140, zoneId: 'pavilions' },
  { from: 1175, zoneId: 'food' },
  { from: 1215, zoneId: 'carnival' },
  { from: 1252, zoneId: 'pavilions' }, // rerouted away from Carnival peak
  { from: 1290, zoneId: 'food' },
  { from: 1330, zoneId: 'transit' },
]

export function visitorZoneAt(m: number): string {
  let z = 'entry'
  for (const step of VISITOR_JOURNEY) if (m >= step.from) z = step.zoneId
  return z
}

export function clockLabel(m: number): string {
  const h = Math.floor(m / 60) % 24
  const min = m % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

export function fmtNum(n: number): string {
  return n.toLocaleString('en-US')
}
