// Plan 8.3: every emitted linear() sample is within 0.5 % of the closed form, and the emitted
// files equal what scripts/gen-springs.mjs writes (no hand-edited curve).
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DESIGN_DIR, read } from './_css'
import {
  CEILING_MS, SPRING_DEFS, TOLERANCE, buildCss, buildTs, closedForm, evalStops, horizonMs, maxError, overshoot, parseLinear, settleMs, zeta,
} from '../../ww/design/motion/springMath'
import { SPRINGS } from '../../ww/design/motion/springs.generated'

const cssText = read(join(DESIGN_DIR, 'motion/springs.generated.css'))
const tsText = read(join(DESIGN_DIR, 'motion/springs.generated.ts'))

describe('generated files', () => {
  it('springs.generated.css is exactly what gen-springs writes', () => expect(cssText).toBe(buildCss()))
  it('springs.generated.ts is exactly what gen-springs writes', () => expect(tsText).toBe(buildTs()))
})

describe.each(SPRING_DEFS)('spring $name (k $k, c $c, m $m)', (def) => {
  const curve = new RegExp(`--spring-${def.name}:\\s*(linear\\([^;]+\\));`).exec(cssText)![1]
  const stops = parseLinear(curve)
  it('the emitted polyline stays within 0.5 % of the closed form over its whole duration', () => {
    const err = maxError(def, stops)
    expect(err).toBeLessThanOrEqual(TOLERANCE)
  })
  it('every emitted stop is itself within 0.5 % of the closed form', () => {
    const T = horizonMs(def) / 1000
    for (const s of stops) expect(Math.abs(s.v - closedForm(def, s.p * T))).toBeLessThanOrEqual(TOLERANCE)
  })
  it('starts at 0 and the stops are in order', () => {
    expect(stops[0]).toEqual({ p: 0, v: 0 })
    for (let i = 1; i < stops.length; i++) expect(stops[i].p).toBeGreaterThan(stops[i - 1].p)
  })
  it('the duration token is the 2 % settle time, never above the 400 ms ceiling', () => {
    const ms = Number(new RegExp(`--spring-${def.name}-ms:\\s*(\\d+)ms`).exec(cssText)![1])
    expect(ms).toBe(Math.min(settleMs(def), CEILING_MS))
    expect(ms).toBeLessThanOrEqual(400)
  })
  it('the JS constants carry the same k, c, m', () => {
    const j = SPRINGS[def.name as keyof typeof SPRINGS]
    expect([j.stiffness, j.damping, j.mass]).toEqual([def.k, def.c, def.m])
  })
  // MEASURED, differs from the plan: the "2 % settle" is an envelope bound, so the value AT that
  // time can sit up to 2.5 % off (press ends at 1.025) and lively, cut at 400 ms, ends at 1.071,
  // not "under 5 %". The curve is left on the closed form rather than snapped, so the end is exact
  // to the spring and the snap-back to 1 at the animation's end is at most 7 % of the travel.
  it('the curve ends where the spring is: within 3 % of travel (8 % for the cut lively curve)', () => {
    const end = evalStops(stops, 1)
    expect(Math.abs(end - 1)).toBeLessThanOrEqual(def.name === 'lively' ? 0.08 : 0.03)
  })
})

describe('the plan 5.7.1 table', () => {
  const table: Record<string, [number, number, number]> = {
    // zeta, overshoot %, settle ms
    press: [0.75, 2.84, 267],
    settle: [0.868, 0.41, 286],
    calm: [0.844, 0.72, 364],
    heavy: [0.833, 0.88, 400],
    lively: [0.639, 7.35, 571],
  }
  it.each(Object.entries(table))('%s: zeta, overshoot and settle match', (name, [z, o, s]) => {
    const d = SPRING_DEFS.find((x) => x.name === name)!
    expect(zeta(d)).toBeCloseTo(z, 3)
    expect(overshoot(d) * 100).toBeCloseTo(o, 1)
    expect(settleMs(d)).toBe(s)
  })
  // MEASURED: calm's 0.72 % peak is at pi / wd = 449 ms, after its 364 ms window, so as a CSS
  // curve calm never overshoots; the same holds for settle. The emitted peak must equal the
  // closed-form maximum inside the window, whatever that is.
  it.each(SPRING_DEFS.map((d) => d.name))('%s: the emitted peak equals the closed-form peak inside its window', (name) => {
    const d = SPRING_DEFS.find((x) => x.name === name)!
    const m = new RegExp('--spring-' + name + ':\\s*(linear\\([^;]+\\));').exec(cssText)!
    const stops = parseLinear(m[1])
    const T = horizonMs(d) / 1000
    let peak = 0
    for (let i = 0; i <= 4000; i++) peak = Math.max(peak, closedForm(d, (i / 4000) * T))
    expect(Math.abs(Math.max(...stops.map((s) => s.v)) - peak)).toBeLessThanOrEqual(TOLERANCE)
  })
})
