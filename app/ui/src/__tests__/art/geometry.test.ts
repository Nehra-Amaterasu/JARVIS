// B03c: the pure layout of the shared art components. The caps are the spec's (7.4, 7.5); the rules are that a
// shape is a pure function of its inputs, a cap is a cut and not a crash, and no layout can overlap or overflow.
import { describe, expect, it } from 'vitest'
import {
  ASCII_ART, BAYER4, MAX_CALLOUTS, MAX_NODES, MAX_RIDGE_POINTS, MAX_ROWS, MAX_STIPPLE, MAX_TIMER_DOTS, arcPath, clamp, ditherRuns, downsample,
  ideaField, meterDots, nextIndex, orbitMarkers, orbitRadii, parseIso, placePlates, polar, quadBlocks, ridgePaths, ringBars, ringPoints,
  sectorPath, spider, stippleDots, sweepFrame, sweepStatic, timerLayout, weekDots, wheelTurn, type EmptyVariant,
} from '../../shared/art/geometry'

describe('primitives', () => {
  it('clamp survives NaN and infinities by falling to the low bound', () => {
    expect(clamp(NaN, 0, 1)).toBe(0)
    expect(clamp(Infinity, 0, 1)).toBe(0)
    expect(clamp(5, 0, 1)).toBe(1)
    expect(clamp(-5, 0, 1)).toBe(0)
  })
  it('polar runs clockwise from twelve o clock', () => {
    expect(polar(0, 0, 10, 0)).toEqual({ x: 0, y: -10 })
    const q = polar(0, 0, 10, 0.25)
    expect(q.x).toBe(10)
    expect(Math.abs(q.y)).toBeLessThan(0.01)
    expect(polar(0, 0, 10, 0.5).y).toBe(10)
  })
  it('ringPoints is capped at 24 and starts at the top', () => {
    expect(ringPoints(40, 100, 100, 50)).toHaveLength(MAX_NODES)
    expect(ringPoints(-3, 0, 0, 1)).toHaveLength(0)
    expect(ringPoints(4, 100, 100, 50)[0]).toMatchObject({ x: 100, y: 50 })
  })
  it('arcPath closes a full turn with two arcs and draws nothing for an empty span', () => {
    expect(arcPath(0, 0, 10, 0, 0)).toBe('')
    expect((arcPath(0, 0, 10, 0, 1).match(/A/g) ?? []).length).toBe(2)
    expect(arcPath(0, 0, 10, 0, 0.75)).toContain(' 1 1 ')
    expect(sectorPath(0, 0, 5, 10, 0, 0.25).endsWith('Z')).toBe(true)
  })
  it('nextIndex wraps for a ring and stops at the ends for a strip', () => {
    expect(nextIndex(2, 'ArrowRight', 3)).toBe(0)
    expect(nextIndex(0, 'ArrowLeft', 3)).toBe(2)
    expect(nextIndex(2, 'ArrowRight', 3, false)).toBe(2)
    expect(nextIndex(0, 'ArrowLeft', 3, false)).toBe(0)
    expect(nextIndex(1, 'Home', 5)).toBe(0)
    expect(nextIndex(1, 'End', 5)).toBe(4)
    expect(nextIndex(1, 'a', 5)).toBeNull()
    expect(nextIndex(0, 'ArrowRight', 0)).toBeNull()
  })
})

describe('orbit (23)', () => {
  it('keeps every marker on its own orbit, inside the frame', () => {
    const ms = Array.from({ length: 9 }, (_, i) => ({ id: `m${i}`, label: `M${i}`, orbit: i % 6, at: i / 9, status: 'upcoming' as const }))
    const radii = orbitRadii(4, 280)
    expect(radii).toHaveLength(4)
    for (const m of orbitMarkers(ms, 280, 4)) {
      expect(m.orbit).toBeGreaterThanOrEqual(0)
      expect(m.orbit).toBeLessThanOrEqual(3)
      expect(Math.hypot(m.x - 140, m.y - 140)).toBeLessThanOrEqual(140)
    }
  })
  it('orbit counts are clamped to 1..6', () => {
    expect(orbitRadii(0, 160)).toHaveLength(1)
    expect(orbitRadii(99, 160)).toHaveLength(6)
  })
})

describe('ring bars (24)', () => {
  const g = { cx: 160, cy: 160, rIn: 74, rOut: 138 }
  it('an empty bar is a 2 px stub, not a hidden bar', () => {
    const [a, b] = ringBars([{ id: 'a', label: 'A', value: null }, { id: 'b', label: 'B', value: 0 }], 10, g)
    for (const bar of [a, b]) {
      expect(bar.empty).toBe(true)
      expect(Math.hypot(bar.x2 - bar.x1, bar.y2 - bar.y1)).toBeGreaterThanOrEqual(1.9)
    }
  })
  it('caps at 24 and scales a full bar to the full ring depth', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `${i}`, label: `${i}`, value: 10 }))
    const out = ringBars(many, 10, g)
    expect(out).toHaveLength(MAX_NODES)
    expect(Math.hypot(out[0].x2 - 160, out[0].y2 - 160)).toBeCloseTo(138, 0)
  })
  it('a zero or negative max does not divide by zero', () => {
    const [b] = ringBars([{ id: 'a', label: 'A', value: 5 }], 0, g)
    expect(Number.isFinite(b.x2)).toBe(true)
  })
})

describe('ridge (25)', () => {
  it('downsample is mean pooling, capped, and cleans non-finite values', () => {
    expect(downsample([1, 3, 5, 7], 2)).toEqual([2, 6])
    expect(downsample([1, NaN], 5)).toEqual([1, 0])
    expect(downsample(Array.from({ length: 5000 }, () => 1), MAX_RIDGE_POINTS)).toHaveLength(MAX_RIDGE_POINTS)
  })
  it('draws at most 24 rows and closes each fill for occlusion', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ label: `r${i}`, values: [1, 2, 3, 2, 1] }))
    const r = ridgePaths(rows, 720, 360)
    expect(r.rows).toHaveLength(MAX_ROWS)
    for (const row of r.rows) {
      expect(row.fill.endsWith('Z')).toBe(true)
      expect(row.line.startsWith('M')).toBe(true)
    }
  })
  it('stays inside the canvas: no row rises above the top edge', () => {
    const r = ridgePaths([{ label: 'a', values: [0, 100, 0] }], 720, 360)
    const ys = [...r.rows[0].line.matchAll(/[ML][\d.]+ (-?[\d.]+)/g)].map((m) => +m[1])
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0)
  })
  it('no rows is an empty result, an all-zero series does not divide by zero', () => {
    expect(ridgePaths([], 100, 100).rows).toEqual([])
    expect(ridgePaths([{ label: 'z', values: [0, 0, 0] }], 100, 100).rows[0].peak).toBe(0)
  })
})

describe('callout plates (26)', () => {
  const overlaps = (a: { py: number; px: number }, b: { py: number; px: number }, h: number) => a.px === b.px && Math.abs(a.py - b.py) < h - 1e-6
  it('never overlap, for 6 targets bunched at the same height', () => {
    const pts = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, x: 40 + i * 5, y: 150 }))
    const out = placePlates(pts, 560, 300, 140, 40)
    expect(out).toHaveLength(6)
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) expect(overlaps(out[i], out[j], 40), `${out[i].id} vs ${out[j].id}`).toBe(false)
  })
  it('keeps every plate inside the frame, including targets at the very bottom', () => {
    const pts = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, x: 10, y: 295 + i }))
    for (const p of placePlates(pts, 560, 300, 140, 40)) {
      expect(p.py).toBeGreaterThanOrEqual(0)
      expect(p.py + 40).toBeLessThanOrEqual(300 + 1e-6)
    }
  })
  it('splits by side and caps at 6', () => {
    const pts = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, x: i % 2 ? 500 : 20, y: 30 * i }))
    const out = placePlates(pts, 560, 300, 140, 40)
    expect(out).toHaveLength(MAX_CALLOUTS)
    expect(out.every((p) => (p.side === 'left' ? p.px === 0 : p.px === 420))).toBe(true)
  })
})

describe('dot timer (28) and week strip (31)', () => {
  it('columns are ceil(planned / 30), at most 5, and the last column is partial', () => {
    expect(timerLayout(25, 0).columns).toBe(1)
    expect(timerLayout(30, 0).columns).toBe(1)
    expect(timerLayout(31, 0).columns).toBe(2)
    expect(timerLayout(90, 0).columns).toBe(3)
    const l = timerLayout(100, 0)
    expect(l.columns).toBe(4)
    expect(l.dots.filter((d) => d.col === 3)).toHaveLength(10)
  })
  it('never draws more than 150 dots and says it was capped', () => {
    const l = timerLayout(500, 0)
    expect(l.total).toBe(MAX_TIMER_DOTS)
    expect(l.columns).toBe(5)
    expect(l.capped).toBe(true)
    expect(timerLayout(60, 0).capped).toBe(false)
  })
  it('one solid disc per elapsed minute, the next is a ring, a pause makes it a half disc', () => {
    const l = timerLayout(60, 32)
    expect(l.dots.filter((d) => d.kind === 'filled')).toHaveLength(32)
    expect(l.dots[32].kind).toBe('next')
    expect(timerLayout(60, 32, true).dots[32].kind).toBe('half')
    expect(timerLayout(60, 32).dots.filter((d) => d.kind === 'ring')).toHaveLength(27)
  })
  it('elapsed past the plan fills every dot and leaves no next dot; negative and NaN are zero', () => {
    const l = timerLayout(30, 99)
    expect(l.dots.every((d) => d.kind === 'filled')).toBe(true)
    expect(timerLayout(30, -4).filled).toBe(0)
    expect(timerLayout(30, NaN).filled).toBe(0)
    expect(timerLayout(0, 5).dots).toHaveLength(0)
  })
  it('week dots: one per started 30 minutes, at most 5, none for no time', () => {
    expect([0, 1, 30, 31, 60, 150, 151, 999].map(weekDots)).toEqual([0, 1, 1, 2, 2, 5, 5, 5])
    expect(weekDots(-5)).toBe(0)
  })
})

describe('date wheel (29)', () => {
  it('parses only real dates', () => {
    expect(parseIso('2027-02-28')).toEqual({ y: 2027, m: 2, d: 28 })
    expect(parseIso('2027-02-30')).toBeNull()
    expect(parseIso('2027-13-01')).toBeNull()
    expect(parseIso('27-02-01')).toBeNull()
    expect(parseIso('2028-02-29')).not.toBeNull()
    expect(parseIso('2027-02-29')).toBeNull()
  })
  it('places a date inside its month segment and is monotone through the year', () => {
    expect(wheelTurn('2027-01-01')).toBe(0)
    expect(wheelTurn('2027-07-01')).toBeCloseTo(0.5, 6)
    const t = wheelTurn('2027-03-16')!
    expect(t).toBeGreaterThan(2 / 12)
    expect(t).toBeLessThan(3 / 12)
    expect(wheelTurn('2027-12-31')!).toBeLessThan(1)
    expect(wheelTurn('2027-05-01')!).toBeLessThan(wheelTurn('2027-05-02')!)
    expect(wheelTurn('nope')).toBeNull()
  })
})

describe('pillars (30)', () => {
  it('needs three axes to draw and caps at eight', () => {
    expect(spider([{ id: 'a', label: 'A', value: 1 }], 0, 0, 10).points).toBe('')
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `${i}`, label: `${i}`, value: 0.5 }))
    expect(spider(many, 0, 0, 10).spokes).toHaveLength(8)
  })
  it('a full axis reaches the rim and an out-of-range value is clamped to it', () => {
    const s = spider([{ id: 'a', label: 'A', value: 9 }, { id: 'b', label: 'B', value: -2 }, { id: 'c', label: 'C', value: 0.5 }], 0, 0, 100)
    expect(Math.hypot(s.spokes[0].vx, s.spokes[0].vy)).toBeCloseTo(100, 0)
    expect(Math.hypot(s.spokes[1].vx, s.spokes[1].vy)).toBeCloseTo(0, 0)
  })
})

describe('dither (34)', () => {
  it('Bayer 4x4 holds each rank 0..15 exactly once', () => {
    expect([...BAYER4.flat()].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i))
  })
  it('is deterministic: the same idea gives byte-identical output', () => {
    for (const k of ['ring', 'ridge', 'bloom', 'bridge'] as const) expect(ditherRuns(64, 40, ideaField(k))).toEqual(ditherRuns(64, 40, ideaField(k)))
  })
  it('a plate is a few KB of path text, far under the 200 KB per route cap, and is neither blank nor solid', () => {
    for (const k of ['ring', 'ridge', 'bloom', 'bridge'] as const) {
      const r = ditherRuns(64, 40, ideaField(k))
      expect(r.path.length).toBeGreaterThan(50)
      expect(r.path.length).toBeLessThan(20_000)
      expect(r.on).toBeGreaterThan(0)
      expect(r.on).toBeLessThan(64 * 40)
    }
    expect(ditherRuns(256, 256, ideaField('bloom')).path.length).toBeLessThan(200_000)
  })
  it('a field of 0 is blank and a field of 1 is solid', () => {
    expect(ditherRuns(8, 8, () => 0).on).toBe(0)
    expect(ditherRuns(8, 8, () => 1).on).toBe(64)
  })
})

describe('ascii (32, 35)', () => {
  it('the sweep is 3 to 6 rows of at most 12 characters, from the density ramp only', () => {
    for (const step of [0, 5, 11, 50, -3]) {
      const f = sweepFrame(30, 9, step)
      expect(f.length).toBeGreaterThanOrEqual(3)
      expect(f.length).toBeLessThanOrEqual(6)
      for (const row of f) {
        expect(row.length).toBeLessThanOrEqual(12)
        expect(row).toMatch(/^[ .:\-=+*#]+$/)
      }
    }
  })
  it('the band moves between frames and the static form is a fixed frame', () => {
    expect(sweepFrame(12, 4, 0).join('\n')).not.toEqual(sweepFrame(12, 4, 6).join('\n'))
    expect(sweepStatic(12, 4)).toEqual(sweepStatic(12, 4))
    expect(sweepStatic(12, 4)).toHaveLength(4)
  })
  it.each(Object.keys(ASCII_ART) as EmptyVariant[])('the %s picture is 12 to 16 lines of at most 40 columns', (v) => {
    const a = ASCII_ART[v]
    expect(a.length).toBeGreaterThanOrEqual(12)
    expect(a.length).toBeLessThanOrEqual(16)
    for (const l of a) expect(l.length).toBeLessThanOrEqual(40)
  })
})

describe('meter and stipple ring (36, 33)', () => {
  it('60 dots: a full level lights all, the minimum lights none, a missing level lights none', () => {
    expect(meterDots(10, 0, 10).filled).toBe(60)
    expect(meterDots(0, 0, 10).filled).toBe(0)
    expect(meterDots(null, 0, 10).filled).toBe(0)
    expect(meterDots(5, 0, 10).dots).toHaveLength(60)
    expect(meterDots(5, 0, 10).filled).toBe(30)
  })
  it('a bad range (max not above min) reads as empty rather than NaN', () => {
    expect(meterDots(5, 10, 10).filled).toBe(0)
    expect(meterDots(5, 10, 0).filled).toBe(0)
  })
  it('fills rise from the bottom of each column', () => {
    const m = meterDots(2 / 60, 0, 1) // two dots: the bottom two of the first column
    const lit = m.dots.filter((d) => d.on)
    expect(lit).toHaveLength(2)
    expect(lit.every((d) => d.col === 0 && d.row >= 3)).toBe(true)
  })
  it('stipples are 12 to 120 and the filled share is the rounded fraction', () => {
    expect(stippleDots(0.5, 999, 0, 0, 10)).toHaveLength(MAX_STIPPLE)
    expect(stippleDots(0.5, 1, 0, 0, 10)).toHaveLength(12)
    const d = stippleDots(0.25, 60, 0, 0, 10)
    expect(d.filter((x) => x.on)).toHaveLength(15)
    expect(stippleDots(-1, 60, 0, 0, 10).some((x) => x.on)).toBe(false)
  })
})

describe('quadtree skeleton (37)', () => {
  it('is deterministic and tiles the grid exactly, with no gaps and no overlap', () => {
    for (const seed of [1, 2, 7, 99]) {
      for (const depth of [1, 2, 3]) {
        const a = quadBlocks(depth, seed)
        expect(a).toEqual(quadBlocks(depth, seed))
        const n = 1 << depth
        expect(a.length).toBeLessThanOrEqual(n * n)
        const cover = new Uint8Array(n * n)
        for (const b of a) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) cover[y * n + x]++
        expect([...cover].every((c) => c === 1)).toBe(true)
      }
    }
  })
  it('depth is clamped to 3, so at most 64 blocks', () => {
    expect(quadBlocks(99, 3).length).toBeLessThanOrEqual(64)
  })
  it('different seeds give different mosaics', () => {
    const sig = (s: number) => JSON.stringify(quadBlocks(3, s))
    expect(new Set([1, 2, 3, 4, 5, 6].map(sig)).size).toBeGreaterThan(1)
  })
})
