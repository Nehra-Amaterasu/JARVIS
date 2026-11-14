// SigilMark: the same arms give the same bytes (golden), the figure is the engine's own model, no id reaches the markup, and
// the arm length, tip and fork each mean what the spec says.
import { describe, expect, it } from 'vitest'
import { modelToSvg, seedHex, sigilStats } from '../../../grammar'
import {
  BRANCH_AT, MAX_ARMS, armAngle, armRadius, armsDrawn, sigilMarkHollowModel, sigilMarkModel, sigilMarkSvg, type SigilArm,
} from '../markModel'

const FIXTURE: SigilArm[] = [
  { id: 'motion', length: 0.9, recent: 'disc', n: 5 },
  { id: 'forces', length: 0.5, recent: 'ring', n: 2 },
  { id: 'energy', length: 0.2, recent: 'dashed', n: 0 },
  { id: 'waves', length: 0.7, recent: 'disc', n: 3 },
  { id: 'heat', length: 0.35, recent: 'ring' },
  { id: 'optics', length: 1, recent: 'dashed', n: 9 },
]

// The golden: written once from the first run and read by eye (six arms, a fork on three of them, two discs, two rings, two
// dashed rings). A change to the drawing changes this string on purpose, in the same commit as the reason.
const GOLDEN = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 48 48\" width=\"96\" height=\"96\" fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"butt\" stroke-linejoin=\"miter\" aria-hidden=\"true\" focusable=\"false\" data-seed=\"2fea37ad\" data-fold=\"6\"><path class=\"sg-w2\" stroke-width=\"1.5\" vector-effect=\"non-scaling-stroke\" pathLength=\"1\" d=\"M24 20.2L24 7.8M27.3 22.1L33.7 18.4M36 14.9A2.2 2.2 0 1 1 36 19.3A2.2 2.2 0 1 1 36 14.9M27.3 25.9L30.5 27.7M24 27.8L24 37.7M20.7 25.9L15.9 28.7M13.7 27.8A2.2 2.2 0 1 1 13.7 32.2A2.2 2.2 0 1 1 13.7 27.8M20.7 22.1L8.9 15.3\"/><path class=\"sg-w1\" stroke-width=\"1\" vector-effect=\"non-scaling-stroke\" pathLength=\"1\" d=\"M24 4A20 20 0 1 1 24 44A20 20 0 1 1 24 4M22 9.3L24 12.1L26 9.3M26 37.2L24 34.4L22 37.2M9.6 18L13 17.7L11.6 14.6\"/><path class=\"sg-dash\" stroke-width=\"1\" stroke-dasharray=\"1.5 2\" vector-effect=\"non-scaling-stroke\" d=\"M32.7 26.6A2.4 2.4 0 1 1 32.7 31.4A2.4 2.4 0 1 1 32.7 26.6M6.7 11.6A2.4 2.4 0 1 1 6.7 16.4A2.4 2.4 0 1 1 6.7 11.6\"/><path class=\"sg-fill\" fill=\"currentColor\" stroke=\"none\" d=\"M24 21.8A2.2 2.2 0 1 1 24 26.2A2.2 2.2 0 1 1 24 21.8M24 3A2.2 2.2 0 1 1 24 7.4A2.2 2.2 0 1 1 24 3M24 38.1A2.2 2.2 0 1 1 24 42.5A2.2 2.2 0 1 1 24 38.1\"/></svg>"

describe('SigilMark bytes', () => {
  it('matches the golden SVG for the fixture, byte for byte', () => {
    expect(sigilMarkSvg(FIXTURE, 96)).toBe(GOLDEN)
  })
  it('is byte-identical for the same input, however often it is asked and however the input object is built', () => {
    const a = sigilMarkSvg(FIXTURE, 96)
    const copy = JSON.parse(JSON.stringify(FIXTURE)) as SigilArm[]
    expect(sigilMarkSvg(copy, 96)).toBe(a)
    for (let i = 0; i < 20; i++) expect(sigilMarkSvg(FIXTURE, 96)).toBe(a)
  })
  it('changes when the data changes, and only the size attributes change with the size', () => {
    const base = sigilMarkSvg(FIXTURE, 96)
    expect(sigilMarkSvg([{ ...FIXTURE[0], length: 0.91 }, ...FIXTURE.slice(1)], 96)).not.toBe(base)
    expect(sigilMarkSvg(FIXTURE, 160).replace('width="160" height="160"', 'width="96" height="96"')).toBe(base)
  })
  it('is the engine model: the same writer, the stroke classes of the grammar stylesheet, the engine seed of the ids', () => {
    const m = sigilMarkModel(FIXTURE, 96)
    expect(modelToSvg(m)).toBe(sigilMarkSvg(FIXTURE, 96))
    expect(m.paths.map((p) => p.cls)).toEqual(['sg-w2', 'sg-w1', 'sg-dash', 'sg-fill'])
    expect(m.seed).toBe(seedHex('motion|forces|energy|waves|heat|optics'))
    expect(m.fold).toBe(6)
  })
  it('never puts an id in the markup, only its hash', () => {
    const svg = sigilMarkSvg(FIXTURE, 96)
    for (const a of FIXTURE) expect(svg).not.toContain(a.id)
    expect(svg).toContain('data-seed="' + seedHex(FIXTURE.map((a) => a.id).join('|')) + '"')
  })
})

describe('SigilMark meaning', () => {
  it('arm length is evidence: longer evidence, longer arm', () => {
    expect(armRadius(0)).toBeLessThan(armRadius(0.5))
    expect(armRadius(0.5)).toBeLessThan(armRadius(1))
    expect(armRadius(5)).toBe(armRadius(1))
    expect(armRadius(NaN)).toBe(armRadius(0))
  })
  it('lays the arms evenly from twelve oclock, clockwise', () => {
    expect(armAngle(0, 6)).toBeCloseTo(-Math.PI / 2)
    expect(armAngle(3, 6) - armAngle(0, 6)).toBeCloseTo(Math.PI)
  })
  it('a recent topic ends in a disc, a not-recent one in a ring, a never-practised one in a dashed ring', () => {
    const one = (recent: SigilArm['recent']) => sigilMarkModel([{ id: 'a', length: 0.5, recent }], 48).paths.map((p) => p.cls)
    expect(one('disc')).toContain('sg-fill')
    expect(one('ring')).not.toContain('sg-dash')
    expect(one('dashed')).toContain('sg-dash')
    // the hub is a disc too, so the disc tip is one more subpath in the fill path, a ring tip is a second circle in the arm path
    const fill = (recent: SigilArm['recent']) => (sigilMarkModel([{ id: 'a', length: 0.5, recent }], 48).paths.find((p) => p.cls === 'sg-fill')?.d.match(/M/g) ?? []).length
    expect(fill('disc')).toBe(fill('ring') + 1)
  })
  it('forks only from three pieces of evidence', () => {
    const hair = (n?: number) => sigilMarkModel([{ id: 'a', length: 0.6, recent: 'disc', n }], 48).paths.find((p) => p.cls === 'sg-w1')?.d ?? ''
    expect(BRANCH_AT).toBe(3)
    expect(hair(2)).toBe(hair(undefined))
    expect(hair(3)).not.toBe(hair(2))
    expect(hair(3).length).toBeGreaterThan(hair(2).length)
  })
  it('draws at most 16 arms and stays small', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, length: 0.8, recent: 'disc' as const, n: 4 }))
    expect(armsDrawn(many)).toHaveLength(MAX_ARMS)
    const stats = sigilStats(sigilMarkSvg(many, 160))
    expect(stats.bytes).toBeLessThan(6000)
    expect(sigilMarkModel(many, 160).fold).toBe(16)
  })
  it('keeps every tip inside the 48 unit view box', () => {
    const full = Array.from({ length: 16 }, (_, i) => ({ id: `t${i}`, length: 1, recent: 'dashed' as const }))
    const d = sigilMarkModel(full, 48).paths.find((p) => p.cls === 'sg-dash')!.d
    const xs = [...d.matchAll(/M([-\d.]+) ([-\d.]+)A/g)].map((m) => [Number(m[1]), Number(m[2])])
    expect(xs.length).toBe(16)
    for (const [x, y] of xs) { expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(48); expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(48) }
  })
  it('the hollow form has no arm lengths in it: it is the same for any data', () => {
    expect(modelToSvg(sigilMarkHollowModel(96))).toBe(modelToSvg(sigilMarkHollowModel(96)))
    expect(sigilMarkHollowModel(96).paths.map((p) => p.cls)).toEqual(['sg-w1', 'sg-dash'])
  })
})
