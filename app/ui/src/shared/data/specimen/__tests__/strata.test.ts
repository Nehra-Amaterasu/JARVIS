// StrataCore geometry: thickness is evidence, no evidence is a flat layer, nothing is taller than the rows allow, and the
// leaders are horizontal, vertical or exactly 45 degrees.
import { describe, expect, it } from 'vitest'
import {
  FLAT_T, MAX_T, MAX_UNITS, MIN_T, ROW_H, THIN_N, contourPath, hasEvidence, slabThickness, strataLayout, traceLeader, unitsDrawn, type StrataUnit,
} from '../strata'

const U = (id: string, evidence: number, n: number): StrataUnit => ({ id, label: id, evidence, n })

describe('slabThickness', () => {
  it('is flat with no evidence, and 14 to 66 px by the evidence otherwise', () => {
    expect(slabThickness(U('a', 0, 0))).toBe(FLAT_T)
    expect(slabThickness(U('a', 0.9, 0))).toBe(FLAT_T) // a rate with no answers behind it is not evidence
    expect(slabThickness(U('a', 0, 12))).toBe(FLAT_T)
    expect(slabThickness(U('a', 0.001, 1))).toBe(MIN_T)
    expect(slabThickness(U('a', 1, 40))).toBe(MAX_T)
  })
  it('grows with the evidence and clamps nonsense', () => {
    const t = [0.1, 0.3, 0.5, 0.7, 0.9].map((e) => slabThickness(U('a', e, 10)))
    expect([...t].sort((a, b) => a - b)).toEqual(t)
    expect(slabThickness(U('a', 7, 10))).toBe(MAX_T)
    expect(slabThickness(U('a', NaN, 10))).toBe(FLAT_T)
    expect(hasEvidence(U('a', -1, 10))).toBe(false)
  })
})

describe('strataLayout', () => {
  const units = [U('u1', 0.8, 30), U('u2', 0.6, 20), U('u3', 0.4, 4), U('u4', 0, 0)]
  const lay = strataLayout(units)
  it('stacks the first unit at the bottom and the last on top, each above the one before', () => {
    for (let i = 1; i < lay.slabs.length; i++) expect(lay.slabs[i].y + lay.slabs[i].t).toBeLessThanOrEqual(lay.slabs[i - 1].y)
  })
  it('marks the flat layer flat with no contours, and the thinly evidenced one thin', () => {
    expect(lay.slabs[3].flat).toBe(true)
    expect(lay.slabs[3].contours).toBe('')
    expect(lay.slabs[2].thin).toBe(units[2].n < THIN_N)
    expect(lay.slabs[0].thin).toBe(false)
  })
  it('gives each unit a 44 px row, the last unit in the first row', () => {
    expect(lay.h).toBe(4 * ROW_H + 28)
    expect(lay.slabs[3].rowY).toBeLessThan(lay.slabs[0].rowY)
    expect(lay.slabs[0].rowY - lay.slabs[1].rowY).toBe(ROW_H)
  })
  it('is pure: the same units give the same layout', () => {
    expect(strataLayout(units)).toEqual(lay)
  })
  it('scales a tall stack down together so it never outgrows its rows, keeping the order of the thicknesses', () => {
    const tall = strataLayout(Array.from({ length: 12 }, (_, i) => U(`t${i}`, 1, 50)))
    const total = tall.slabs.reduce((a, s) => a + s.t, 0)
    expect(tall.scale).toBeLessThan(1)
    expect(total).toBeLessThanOrEqual(tall.h)
    expect(new Set(tall.slabs.map((s) => s.t)).size).toBe(1)
  })
  it('draws at most 12 units and survives none', () => {
    expect(unitsDrawn(Array.from({ length: 30 }, (_, i) => U(`x${i}`, 0.5, 5)))).toHaveLength(MAX_UNITS)
    expect(strataLayout([]).slabs).toEqual([])
  })
})

describe('contours and leaders', () => {
  it('contour lines are a pure function of the unit id and grow with the thickness', () => {
    expect(contourPath('u1', 0, 10, 188, 40)).toBe(contourPath('u1', 0, 10, 188, 40))
    expect(contourPath('u1', 0, 10, 188, 40)).not.toBe(contourPath('u2', 0, 10, 188, 40))
    const count = (d: string) => (d.match(/M/g) ?? []).length
    expect(count(contourPath('u1', 0, 0, 188, 60))).toBeGreaterThan(count(contourPath('u1', 0, 0, 188, 20)))
    expect(contourPath('u1', 0, 0, 188, 8)).toBe('')
  })
  it('every leader leg is horizontal, vertical or exactly 45 degrees, for any height difference', () => {
    for (const dy of [0, 6, -6, 44, -44, 130, -130, 300, -300]) {
      const d = traceLeader({ x: 232, y: 100 }, { x: 360, y: 100 + dy })
      const pts = [...d.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])])
      expect(pts[0]).toEqual([232, 100])
      expect(pts[pts.length - 1]).toEqual([360, 100 + dy])
      for (let i = 1; i < pts.length; i++) {
        const ddx = Math.abs(pts[i][0] - pts[i - 1][0])
        const ddy = Math.abs(pts[i][1] - pts[i - 1][1])
        expect(ddx === 0 || ddy === 0 || ddx === ddy).toBe(true)
      }
    }
  })
})
