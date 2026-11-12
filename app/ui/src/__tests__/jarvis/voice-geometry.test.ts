// Signal to geometry (spec 9.5, 9.7): every constant named in the spec is checked here, apart from the golden file.
import { describe, expect, it } from 'vitest'
import { bandEdges, bandOfFrequency, dbToByte, levelFill, lerpBand, rint } from '../../jarvis/voice/bands'
import {
  HILL_ALPHA, HILL_BASELINE, HILL_MAX_H, N_BANDS, PH_BREATH_MS, QUALITY, RING_BARS, RING_BASE_R, RING_CX, RING_CY, T0_COLS,
} from '../../jarvis/voice/constants'
import {
  breathFactor, colBand, colX, envelopeGeometry, hillGeometry, jitterTable, layerBase, layerScale, mulberry32, peakShown, peakUpdate, placeholderHill, placeholderValue,
  ringBars, ringBreath, ringLengthsBands, ringLengthsLevel, ringLengthsPlaceholder, testPatternBands, thinkingMarker,
} from '../../jarvis/voice/geometry'
import { bandsOf, flat, speechRow } from './voice-helpers'

describe('the band map (9.2)', () => {
  it('has 25 log-spaced edges from 100 Hz to 8 kHz with the spec checkpoints', () => {
    const e = bandEdges()
    expect(e).toHaveLength(25)
    expect(e[0]).toBeCloseTo(100, 6)
    expect(e[8]).toBeCloseTo(431, 0)
    expect(e[12]).toBeCloseTo(894, 0)
    expect(e[16]).toBeCloseTo(1857, 0)
    expect(e[20]).toBeCloseTo(3854, 0)
    expect(e[23]).toBeCloseTo(6665, 0)
    expect(e[24]).toBeCloseTo(8000, 6)
  })
  it('P-1/P-7: 1,700 Hz is band 15, 1 kHz is band 12, and the geometric centre of bands 0, 4, 8, 12, 16, 20, 23 lands in its own band', () => {
    expect(bandOfFrequency(1700)).toBe(15)
    expect(bandOfFrequency(1000)).toBe(12)
    for (const i of [0, 4, 8, 12, 16, 20, 23]) expect(bandOfFrequency(100 * Math.pow(80, (i + 0.5) / 24))).toBe(i)
    expect(bandOfFrequency(99)).toBeNull()
    expect(bandOfFrequency(8000)).toBeNull()
    expect(bandOfFrequency(NaN)).toBeNull()
  })
  it('maps dB linearly over 60 dB: output -60..0, input -70..-10, no automatic gain, clamped, NaN is the floor', () => {
    expect(dbToByte(-60, 'out')).toBe(0)
    expect(dbToByte(0, 'out')).toBe(255)
    expect(dbToByte(-30, 'out')).toBe(128) // 127.5 rounds half to even, like numpy rint: 128
    expect(dbToByte(-70, 'in')).toBe(0)
    expect(dbToByte(-10, 'in')).toBe(255)
    expect(dbToByte(-10, 'out')).toBe(212) // 212.5 -> 212, the value Python gives (Math.round would say 213)
    expect(dbToByte(40, 'out')).toBe(255)
    expect(dbToByte(NaN, 'out')).toBe(0)
    expect(dbToByte(-48, 'out', 12)).toBe(102) // the +12 dB display shift moves the window: (-36 + 60) / 60 * 255
    expect(dbToByte(-60, 'out', 12)).toBe(51)
  })
  it('rounds half to even like numpy', () => {
    expect([0.5, 1.5, 2.5, 3.5, 212.5, 2.4, 2.6].map(rint)).toEqual([0, 2, 2, 4, 212, 2, 3])
  })
  it('level fill is 0 for a missing or non-finite level, never a made-up value', () => {
    expect(levelFill(null, 'in')).toBe(0)
    expect(levelFill(undefined, 'out')).toBe(0)
    expect(levelFill(-40, 'in')).toBeCloseTo(0.5, 6)
  })
  it('interpolates band rows linearly and clamps the position', () => {
    expect(lerpBand([0, 100, 200], 0.5)).toBe(50)
    expect(lerpBand([0, 100, 200], 9)).toBe(200)
    expect(lerpBand([0, 100, 200], -3)).toBe(0)
  })
})

describe('the hill (9.5)', () => {
  const eight = (row: number[]) => Array.from({ length: 8 }, () => row)
  it('V-11: 3,072 points at high, 1,280 at low, and none are drawn when there is no real row', () => {
    expect(QUALITY.high.points).toBe(3072)
    expect(QUALITY.low.points).toBe(1280)
    expect(hillGeometry(eight(speechRow()), 'high').count).toBe(3072)
    expect(hillGeometry(eight(speechRow()), 'low').count).toBe(1280)
    expect(hillGeometry([], 'high').count).toBe(0)
    expect(hillGeometry(Array(8).fill(null), 'high').count).toBe(0)
  })
  it('a row that is null is absent while the others are drawn (no invented history)', () => {
    const p = hillGeometry([speechRow(), null, speechRow(), null, null, null, null, null], 'high')
    expect(p.count).toBe(2 * 96 * 4)
    expect(new Set(Array.from(p.layer.slice(0, p.count)))).toEqual(new Set([0, 2]))
  })
  it('mirrors left and right: column c and 95 - c have the same height, up to the seeded jitter', () => {
    const p = hillGeometry([speechRow()], 'high')
    const ground = HILL_BASELINE
    for (const c of [0, 10, 47, 60]) {
      const a = ground - p.y[c * 4 + 3] // stipple 3 has fraction 1.0 + jitter
      const b = ground - p.y[(95 - c) * 4 + 3]
      expect(Math.abs(a - b)).toBeLessThan(HILL_MAX_H * 0.1 + 1)
    }
  })
  it('has no taper: a flat spectrum gives a flat top, and silence sits on the baseline', () => {
    const p = hillGeometry([flat(255)], 'high')
    const tops = Array.from({ length: 96 }, (_, c) => HILL_BASELINE - p.y[c * 4 + 3])
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(HILL_MAX_H * 0.09)
    const z = hillGeometry([flat(0)], 'high')
    for (let i = 0; i < z.count; i++) expect(z.y[i]).toBe(HILL_BASELINE)
  })
  it('puts low frequencies at the centre: a bass-only row is tallest in the middle columns', () => {
    const p = hillGeometry([bandsOf((i) => (i < 3 ? 255 : 0))], 'high')
    const h = (c: number) => HILL_BASELINE - p.y[c * 4 + 3]
    expect(h(47)).toBeGreaterThan(h(5) + 100)
  })
  it('perspective: layer j sits 9 px higher and shrinks 4.5 % per layer (0.685 at j = 7)', () => {
    expect(layerBase(0)).toBe(300)
    expect(layerBase(7)).toBe(300 - 63)
    expect(layerScale(7)).toBeCloseTo(0.685, 3)
    expect(HILL_ALPHA).toHaveLength(8)
  })
  it('V-05: the same rows give byte-identical arrays, and the jitter table is the seeded one', () => {
    const a = hillGeometry(eight(speechRow()), 'high')
    const b = hillGeometry(eight(speechRow()), 'high')
    expect(Buffer.from(a.x.buffer).equals(Buffer.from(b.x.buffer))).toBe(true)
    expect(Buffer.from(a.y.buffer).equals(Buffer.from(b.y.buffer))).toBe(true)
    const r1 = mulberry32(0x5eed)
    const r2 = mulberry32(0x5eed)
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()])
    expect(jitterTable()).toBe(jitterTable())
    for (const v of jitterTable().x) expect(Math.abs(v)).toBeLessThanOrEqual(0.8)
    for (const v of jitterTable().y) expect(Math.abs(v)).toBeLessThanOrEqual(0.04)
  })
  it('column positions span [-1, 1] and the band position reaches band 23 at the edges', () => {
    expect(colX(0, 96)).toBe(-1)
    expect(colX(95, 96)).toBe(1)
    expect(colBand(1)).toBe(N_BANDS - 1)
    expect(colBand(0)).toBe(0)
  })
})

describe('tier 0 envelope (9.5)', () => {
  const samples: [number, number][] = Array.from({ length: 31 }, (_, i) => [i * 80, 5])
  it('is one layer of at most 384 points with time on x: the centre is now, the edges 2.4 s ago', () => {
    const p = envelopeGeometry(samples, 2400)
    expect(p.count).toBe(T0_COLS * 4)
    expect(p.count).toBeLessThanOrEqual(384)
    expect(new Set(Array.from(p.layer))).toEqual(new Set([0]))
  })
  it('draws nothing for time before the first real sample, and nothing with no samples', () => {
    expect(envelopeGeometry([], 1000).count).toBe(0)
    const p = envelopeGeometry([[1000, 5]], 1100) // one sample, 100 ms old: only the columns newer than it can be drawn
    expect(p.count).toBeLessThan(T0_COLS * 4)
    expect(p.count).toBeGreaterThan(0)
  })
  it('a louder sample gives a taller column', () => {
    const quiet = envelopeGeometry([[0, 1], [2400, 1]], 2400)
    const loud = envelopeGeometry([[0, 9], [2400, 9]], 2400)
    expect(loud.y[3]).toBeLessThan(quiet.y[3])
  })
})

describe('the ring (9.5)', () => {
  it('has 96 bars, bar 0 at the top, clockwise, 3.75 degrees apart, from radius 128', () => {
    const r = ringBars(ringLengthsPlaceholder(0))
    expect(r.count).toBe(RING_BARS)
    expect(r.x0[0]).toBeCloseTo(RING_CX, 4)
    expect(r.y0[0]).toBeCloseTo(RING_CY - RING_BASE_R, 4)
    expect(r.x0[24]).toBeCloseTo(RING_CX + RING_BASE_R, 3) // 24 bars = 90 degrees clockwise = 3 o'clock
    expect(r.y0[24]).toBeCloseTo(RING_CY, 3)
  })
  it('mirrors the bands about the vertical axis: bar k and bar 96 - k have the same length', () => {
    const l = ringLengthsBands(speechRow())
    for (const k of [1, 7, 30, 47]) expect(l[k]).toBeCloseTo(l[96 - k], 6)
    expect(l[0]).toBeGreaterThanOrEqual(4)
    expect(Math.max(...l)).toBeLessThanOrEqual(36)
  })
  it('lengths run from 4 px (silence) to 36 px (full scale), and the tier-0 level ring is uniform', () => {
    expect(ringLengthsBands(flat(0))[10]).toBe(4)
    expect(ringLengthsBands(flat(255))[10]).toBe(36)
    expect(new Set(Array.from(ringLengthsLevel(0.5))).size).toBe(1)
    expect(ringLengthsLevel(2)[0]).toBe(36)
  })
  it('marks the bars whose middle is below the hill baseline for half alpha', () => {
    const r = ringBars(ringLengthsPlaceholder(0))
    expect(r.below[0]).toBe(0)
    expect(r.below[48]).toBe(1) // the bottom bar: 176 + 128 + 2 = 306 > 300
  })
})

describe('the placeholder (9.7) and its breath (V-06)', () => {
  it('follows v_ph(u) = 0.10 + 0.08 cos^2(pi u / 2): 18 % at the centre, 10 % at the edge, identical every time', () => {
    expect(placeholderValue(0)).toBeCloseTo(0.18, 6)
    expect(placeholderValue(1)).toBeCloseTo(0.1, 6)
    const a = placeholderHill('high', 1)
    const b = placeholderHill('high', 1)
    expect(Array.from(a.y)).toEqual(Array.from(b.y))
    expect(a.count).toBe(96 * 4)
  })
  it('breath is off by default, multiplies by 1 + 0.25 sin for two cycles, and then is exactly 1', () => {
    expect(breathFactor(1000, false)).toBe(1)
    expect(breathFactor(625, true)).toBeCloseTo(1.25, 6) // a quarter of 2.5 s
    expect(breathFactor(1875, true)).toBeCloseTo(0.75, 6)
    expect(breathFactor(PH_BREATH_MS, true)).toBe(1)
    expect(breathFactor(60_000, true)).toBe(1)
    expect(PH_BREATH_MS).toBe(5000)
  })
  it('V-06: after 5.0 s the geometry equals the static table', () => {
    const st = placeholderHill('high', breathFactor(0, false))
    const after = placeholderHill('high', breathFactor(5000, true))
    expect(Array.from(after.y)).toEqual(Array.from(st.y))
    expect(ringBreath(5000, true)).toBe(0)
    expect(ringBreath(1250, true)).toBeCloseTo(1, 6)
    expect(ringLengthsPlaceholder(ringBreath(5000, true))[0]).toBe(4)
    expect(ringLengthsPlaceholder(1)[0]).toBe(6)
  })
})

describe('the thinking marker (9.6 row 6)', () => {
  it('orbits once per 2.4 s for at most 5 s, then sits fixed at the top, three bars', () => {
    expect(thinkingMarker(0)).toEqual([95, 0, 1])
    expect(thinkingMarker(1200)).toEqual([47, 48, 49])
    expect(thinkingMarker(5000)).toEqual([95, 0, 1])
    expect(thinkingMarker(99_999)).toEqual([95, 0, 1])
    expect(thinkingMarker(-5)).toEqual([95, 0, 1])
  })
})

describe('the peak tick (9.5)', () => {
  it('is held 800 ms, then falls 40 dB a second, and a louder level restarts it', () => {
    let p = peakUpdate(null, -20, 0)
    expect(peakShown(p, 800)).toBe(-20)
    expect(peakShown(p, 1800)).toBeCloseTo(-60, 6)
    p = peakUpdate(p, -45, 1800) // quieter than the falling tick? the tick is at -60, so -45 is a new peak
    expect(p.db).toBe(-45)
    expect(peakShown(null, 0)).toBeNull()
  })
})

describe('the test pattern', () => {
  it('is a fixed sequence: the same time gives the same row, and it moves with time', () => {
    expect(testPatternBands(1234)).toEqual(testPatternBands(1234))
    expect(testPatternBands(0)).not.toEqual(testPatternBands(1000))
    expect(testPatternBands(777)).toHaveLength(N_BANDS)
    for (const v of testPatternBands(3000)) expect(v >= 0 && v <= 255).toBe(true)
  })
})
