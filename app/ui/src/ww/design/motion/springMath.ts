/**
 * Spring math for Well Wisher: the one place k, c, m turn into numbers.
 *
 * WHY ONE FILE (plan 5.1, 5.7.1): the CSS `linear()` curves and the JS spring constants used
 * to be typed twice and drifted (the old --spring-calm was sampled at zeta 0.75 while the JS
 * default is 0.84). scripts/gen-springs.mjs imports this module and writes both outputs, and
 * spring-curves.test.ts imports it again to check the written file, so a hand-edited curve
 * fails the build.
 *
 * Closed form of a damped spring released from rest toward 1 (zeta < 1):
 *   x(t) = 1 - e^(-zeta w0 t) (cos(wd t) + (zeta / sqrt(1 - zeta^2)) sin(wd t))
 *   w0 = sqrt(k / m), zeta = c / (2 sqrt(k m)), wd = w0 sqrt(1 - zeta^2)
 */

export interface SpringDef {
  name: string
  k: number
  c: number
  m: number
}

/** The five springs of plan 5.7.1, in the order they are emitted. */
export const SPRING_DEFS: readonly SpringDef[] = [
  { name: 'press', k: 400, c: 30, m: 1 },
  { name: 'settle', k: 260, c: 28, m: 1 },
  { name: 'calm', k: 170, c: 22, m: 1 },
  { name: 'heavy', k: 288, c: 40, m: 2 },
  { name: 'lively', k: 120, c: 14, m: 1 },
]

/** Nothing animates longer than 400 ms (plan 5.7.1 hard ceiling), so a curve is cut there. */
export const CEILING_MS = 400

/** Largest allowed gap, in output units, between the emitted polyline and the closed form (plan 8.3: 0.5 %). */
export const TOLERANCE = 0.005
/** The generator aims below the tolerance, because rounding to 3 decimals adds up to 0.0005 more. */
const TARGET = 0.002

export function zeta(d: SpringDef): number {
  return d.c / (2 * Math.sqrt(d.k * d.m))
}
export function omega0(d: SpringDef): number {
  return Math.sqrt(d.k / d.m)
}
/** Peak overshoot as a fraction of travel: exp(-pi zeta / sqrt(1 - zeta^2)). */
export function overshoot(d: SpringDef): number {
  const z = zeta(d)
  return Math.exp((-Math.PI * z) / Math.sqrt(1 - z * z))
}
/** Time to stay within 2 % of the target, in ms: 4 / (zeta w0). */
export function settleMs(d: SpringDef): number {
  return Math.round((4 / (zeta(d) * omega0(d))) * 1000)
}
/** The duration the curve is sampled over: the 2 % settle time, cut at the 400 ms ceiling. */
export function horizonMs(d: SpringDef): number {
  return Math.min(settleMs(d), CEILING_MS)
}

/** x(t), t in seconds. */
export function closedForm(d: SpringDef, t: number): number {
  const z = zeta(d)
  const w0 = omega0(d)
  const wd = w0 * Math.sqrt(1 - z * z)
  return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z / Math.sqrt(1 - z * z)) * Math.sin(wd * t))
}

export interface Stop {
  /** position along the curve, 0..1 */
  p: number
  /** output value */
  v: number
}

const round = (x: number, places: number) => Number(x.toFixed(places))

/** n + 1 evenly spaced stops on the closed form, positions rounded to 0.01 %, values to 3 decimals. */
export function sampleStops(d: SpringDef, n: number): Stop[] {
  const T = horizonMs(d) / 1000
  const out: Stop[] = []
  for (let i = 0; i <= n; i++) {
    const p = i / n
    out.push({ p: round(p, 4), v: round(closedForm(d, p * T), 3) })
  }
  return out
}

/** Evaluate a CSS linear() polyline at position p (0..1). */
export function evalStops(stops: readonly Stop[], p: number): number {
  if (p <= stops[0].p) return stops[0].v
  for (let i = 1; i < stops.length; i++) {
    if (p <= stops[i].p) {
      const a = stops[i - 1]
      const b = stops[i]
      return a.v + ((b.v - a.v) * (p - a.p)) / (b.p - a.p)
    }
  }
  return stops[stops.length - 1].v
}

/** Largest |polyline - closed form| over a fine grid. */
export function maxError(d: SpringDef, stops: readonly Stop[], grid = 4000): number {
  const T = horizonMs(d) / 1000
  let worst = 0
  for (let i = 0; i <= grid; i++) {
    const p = i / grid
    worst = Math.max(worst, Math.abs(evalStops(stops, p) - closedForm(d, p * T)))
  }
  return worst
}

/** The smallest stop count whose polyline stays under TARGET of the closed form. */
export function stopsFor(d: SpringDef): Stop[] {
  for (let n = 12; n <= 120; n++) {
    const s = sampleStops(d, n)
    if (maxError(d, s) <= TARGET) return s
  }
  throw new Error(`spring ${d.name}: no stop count up to 120 meets ${TARGET}`)
}

/** `linear(0, 0.054 3.1%, ..., 0.998)`: first stop at 0, last at 100 %, both implicit. */
export function toLinear(stops: readonly Stop[]): string {
  const parts = stops.map((s, i) => {
    if (i === 0 || i === stops.length - 1) return String(s.v)
    return `${s.v} ${round(s.p * 100, 2)}%`
  })
  return `linear(${parts.join(', ')})`
}

/** Parse what toLinear wrote (positions optional at the ends). */
export function parseLinear(text: string): Stop[] {
  const inner = text.trim().replace(/^linear\(/, '').replace(/\)$/, '')
  const items = inner.split(',').map((s) => s.trim())
  return items.map((it, i) => {
    const [v, pos] = it.split(/\s+/)
    const p = pos ? Number(pos.replace('%', '')) / 100 : i === 0 ? 0 : 1
    return { p, v: Number(v) }
  })
}

/** Everything gen-springs.mjs writes to springs.generated.css. */
export function buildCss(): string {
  const lines: string[] = [
    '/* GENERATED by scripts/gen-springs.mjs from ww/design/motion/springMath.ts. Do not edit.',
    '   Each curve is the closed-form damped spring sampled into CSS linear(); spring-curves.test.ts',
    '   checks the polyline against the closed form (within 0.5 %) and this file against the generator.',
    '   --spring-<name>-ms is the duration the curve is sampled over (2 % settle, cut at 400 ms). */',
    '.ww,',
    '.ww-portal {',
  ]
  for (const d of SPRING_DEFS) {
    const stops = stopsFor(d)
    lines.push(`  --spring-${d.name}: ${toLinear(stops)};`)
    lines.push(`  --spring-${d.name}-ms: ${horizonMs(d)}ms;`)
  }
  lines.push('}', '')
  return lines.join('\n')
}

/** Everything gen-springs.mjs writes to springs.generated.ts. */
export function buildTs(): string {
  const rows = SPRING_DEFS.map((d) => {
    const z = round(zeta(d), 3)
    const o = round(overshoot(d), 4)
    return `  ${d.name}: { stiffness: ${d.k}, damping: ${d.c}, mass: ${d.m}, zeta: ${z}, overshoot: ${o}, settleMs: ${settleMs(d)}, horizonMs: ${horizonMs(d)} },`
  })
  return [
    '// GENERATED by scripts/gen-springs.mjs from ww/design/motion/springMath.ts. Do not edit.',
    '// The same k, c, m produce the CSS linear() curves in springs.generated.css.',
    'export const SPRINGS = {',
    ...rows,
    '} as const',
    '',
    'export type SpringName = keyof typeof SPRINGS',
    '',
  ].join('\n')
}
