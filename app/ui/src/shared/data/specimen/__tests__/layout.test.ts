// The geometry of 20.5.1 as numbers: the 1366 x 768 canvas, the 900 px edge, the 390 px reflow, and the leader that bends
// once at 45 degrees. Pure functions, no DOM.
import { describe, expect, it } from 'vitest'
import {
  CALLOUT_H, CALLOUT_PITCH, DATUM_Y, DESIGN_H, DESIGN_W, FOOTER_H, MAX_CALLOUTS, REFLOW_BELOW, SPEC_H, SPEC_TOP, TICK,
  anchorPoint, datumTicks, defaultAnchors, layoutProblems, leaderBend, leaderPath, leadersFor, specimenGeometry,
} from '../layout'

describe('desktop geometry at the shell canvas (1302 x 720 inside 1366 x 768)', () => {
  const g = specimenGeometry(DESIGN_W, 5)
  it('is the spec table, number for number', () => {
    expect(g.mode).toBe('desktop')
    expect(g.specimen).toEqual({ x: 24, y: 8, w: 760, h: 560 })
    expect(g.callouts.map((c) => [c.x, c.w, c.h])).toEqual(Array(5).fill([808, 470, 88]))
    expect(g.footer).toEqual({ x: 0, y: 648, w: 1302, h: 72 })
    expect(g.datumY).toBe(288)
  })
  it('centres the specimen on the datum line', () => {
    expect(g.specimen.y + g.specimen.h / 2).toBe(DATUM_Y)
    expect(SPEC_TOP + SPEC_H / 2).toBe(DATUM_Y)
  })
  it('snaps every callout top and the specimen top to a datum tick', () => {
    const ticks = new Set(datumTicks())
    expect([g.specimen.y, ...g.callouts.map((c) => c.y)].every((y) => ticks.has(y))).toBe(true)
    expect(CALLOUT_PITCH % TICK).toBe(0)
    expect(DATUM_Y).toBe(SPEC_TOP + 7 * TICK)
  })
  it('stacks five callouts without overlap and clear of the footer', () => {
    for (let i = 0; i < 4; i++) expect(g.callouts[i].y + CALLOUT_H).toBeLessThanOrEqual(g.callouts[i + 1].y)
    expect(g.callouts[4].y + CALLOUT_H).toBeLessThanOrEqual(g.footer.y)
    expect(g.footer.h).toBe(FOOTER_H)
    expect(g.height).toBe(DESIGN_H)
  })
  it('caps the callouts at five', () => {
    expect(specimenGeometry(DESIGN_W, 9).callouts).toHaveLength(MAX_CALLOUTS)
    expect(specimenGeometry(DESIGN_W, -3).callouts).toHaveLength(0)
  })
  it('passes the acceptance check at 1366 x 768, with exactly one object wider than 40 percent', () => {
    expect(layoutProblems(g, 1366, 768)).toEqual([])
    expect(g.specimen.w / 1366).toBeGreaterThan(0.4)
    expect(g.callouts[0].w / 1366).toBeLessThan(0.4)
  })
})

describe('the narrowest desktop (900 px) and the widths between', () => {
  it('keeps the same ratio and never lets the margin collapse', () => {
    for (const w of [900, 1024, 1200, 1302, 1600]) {
      const g = specimenGeometry(w, 5)
      expect(g.mode).toBe('desktop')
      expect(g.callouts[0].w).toBeGreaterThanOrEqual(300)
      expect(g.callouts[0].x).toBeGreaterThanOrEqual(g.specimen.x + g.specimen.w + 24)
      expect(g.callouts[0].x + g.callouts[0].w + 24).toBe(w)
      expect(layoutProblems(g, w, 768)).toEqual([])
    }
  })
})

describe('reflow under 900 px', () => {
  for (const w of [390, 600, REFLOW_BELOW - 1]) {
    it(`${w} px: specimen first at the full width and 320 high, no stage wider than the viewport`, () => {
      const g = specimenGeometry(w, 4)
      expect(g.mode).toBe('reflow')
      expect(g.specimen).toEqual({ x: 0, y: 0, w, h: 320 })
      expect(g.callouts).toEqual([])
      expect(layoutProblems(g, w, 844)).toEqual([])
    })
  }
  it('the switch is exactly at 900', () => {
    expect(specimenGeometry(899).mode).toBe('reflow')
    expect(specimenGeometry(900).mode).toBe('desktop')
  })
})

describe('the leader', () => {
  const legs = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const b = leaderBend(from, to)
    return [[from, b], [b, to]].map(([p, q]) => ({ dx: q.x - p.x, dy: q.y - p.y }))
  }
  it('is two legs, one straight and one at exactly 45 degrees, whatever the target', () => {
    const from = { x: 500, y: 300 }
    for (const to of [{ x: 808, y: 52 }, { x: 808, y: 172 }, { x: 808, y: 300 }, { x: 808, y: 420 }, { x: 808, y: 532 }, { x: 520, y: 52 }]) {
      const [a, b] = legs(from, to)
      const straight = (s: { dx: number; dy: number }) => s.dx === 0 || s.dy === 0
      const diag = (s: { dx: number; dy: number }) => Math.abs(s.dx) === Math.abs(s.dy)
      expect(straight(a) && diag(b)).toBe(true)
      expect(a.dx + b.dx).toBe(to.x - from.x)
      expect(a.dy + b.dy).toBe(to.y - from.y)
    }
  })
  it('is a path of start, one bend, end', () => {
    expect(leaderPath({ x: 0, y: 0 }, { x: 100, y: 40 })).toBe('M0 0L60 0L100 40')
    expect(leaderPath({ x: 0, y: 0 }, { x: 100, y: -40 })).toBe('M0 0L60 0L100 -40')
  })
  it('every leader of a full layout ends on the left edge of its plate, at its mid line', () => {
    const g = specimenGeometry(DESIGN_W, 5)
    const ls = leadersFor(g, defaultAnchors(5))
    ls.forEach((l, i) => {
      expect(l.to).toEqual({ x: g.callouts[i].x, y: g.callouts[i].y + 44 })
      expect(l.from.x).toBeGreaterThan(g.specimen.x)
      expect(l.from.x).toBeLessThan(g.specimen.x + g.specimen.w)
    })
  })
  it('anchors are clamped inside the specimen and are a pure function of the index', () => {
    const g = specimenGeometry(DESIGN_W, 3)
    const p = anchorPoint(g.specimen, { fx: 9, fy: -4 })
    expect(p).toEqual({ x: 784, y: 8 })
    expect(defaultAnchors(3)).toEqual(defaultAnchors(3))
  })
})
