// SigilMark (spec 20.5.2): a data sigil. 6 to 16 arms from a hub, one arm per topic, arm length is evidence, the tip says
// whether the topic was practised recently (disc), not recently (ring) or never (dashed ring), and an arm that stands on
// at least three pieces of evidence forks. Pure and deterministic: the same arms give the same bytes, which a golden test
// pins.
//
// It reuses the sigil engine of shared/grammar and does not re-implement it: the model is the engine's own `SigilModel`
// (same view box, same stroke classes `sg-w1`, `sg-w2`, `sg-dash`, `sg-fill`, same attribute order, so the .g-sigil
// stylesheet draws it and `modelToSvg` writes it), the tip circles come from the engine's `circleSub`, and the seed is the
// engine's FNV-1a hex of the arm ids. What is new here is only the radial placement by data, which the seed glyph
// generator (a pure function of one id) has no way to express.

import { modelToSvg, seedHex, type SigilModel } from '../../grammar'
import { circleSub, type Sub } from '../../grammar/sigil/primitives'

export type Recent = 'disc' | 'ring' | 'dashed'
export interface SigilArm {
  id: string
  /** Evidence, 0 to 1; anything else is clamped. */
  length: number
  recent: Recent
  /** Pieces of evidence behind the arm; three or more draw a fork near the tip. Optional (the contract's arm has three fields). */
  n?: number
}

export const MIN_ARMS = 6
export const MAX_ARMS = 16
/** Branch from this many pieces of evidence (spec: "arms branch at 3 pieces of evidence"). */
export const BRANCH_AT = 3
const VIEW = 48
const C = VIEW / 2
const HUB_R = 2.2
/** Where an arm of length 0 starts and where an arm of length 1 ends, in view units; the tip circle (r 2.4) stays inside 22.4. */
const R0 = 5
const R1 = 17.4
const TIP_R = 2.2
const GUIDE_R = R1 + TIP_R + 0.4

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0)
const num = (v: number): string => {
  const n = Math.round(v * 10) / 10
  return Object.is(n, -0) ? '0' : String(n)
}

/** The arms that will be drawn: at most MAX_ARMS, in the order given. */
export const armsDrawn = (arms: readonly SigilArm[]): SigilArm[] => arms.slice(0, MAX_ARMS)

/** The angle of arm i of n, in radians, the first at twelve o'clock and clockwise. */
export const armAngle = (i: number, n: number): number => -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, n)

/** Radius at which an arm of the given evidence ends. */
export const armRadius = (length: number): number => R0 + (R1 - R0) * clamp01(length)

const pt = (r: number, a: number): [number, number] => [C + r * Math.cos(a), C + r * Math.sin(a)]
const move = (x: number, y: number) => `M${num(x)} ${num(y)}`
const line = (x: number, y: number) => `L${num(x)} ${num(y)}`

function dOfSubs(subs: Sub[]): string {
  let d = ''
  for (const u of subs) {
    d += move(u.m[0], u.m[1])
    for (const s of u.segs) if (s.k === 'A') d += `A${num(s.r)} ${num(s.r)} 0 ${s.large} ${s.sweep} ${num(s.p[0])} ${num(s.p[1])}`
  }
  return d
}

/** The model of a sigil mark; `size` is the CSS size in px of the whole drawing. */
export function sigilMarkModel(input: readonly SigilArm[], size = 96): SigilModel {
  const arms = armsDrawn(input)
  const n = arms.length
  const w2: string[] = []
  const w1: string[] = []
  const dash: Sub[] = []
  const fill: Sub[] = []
  let segments = 0
  // the hub: a solid dot and the hairline guide ring that the longest possible arm touches
  fill.push(circleSub(C, C, HUB_R))
  w1.push(dOfSubs([circleSub(C, C, GUIDE_R)]))
  segments += 4
  arms.forEach((a, i) => {
    const th = armAngle(i, n)
    const r = armRadius(a.length)
    const [x0, y0] = pt(R0 - 1.2, th)
    const [x1, y1] = pt(r, th)
    w2.push(`${move(x0, y0)}${line(x1, y1)}`)
    segments += 1
    if ((a.n ?? 0) >= BRANCH_AT) {
      // a fork two thirds of the way out: two short strokes at 35 degrees either side, drawn as a hair
      const rb = R0 + (r - R0) * 0.62
      const [bx, by] = pt(rb, th)
      const spread = (35 * Math.PI) / 180
      const [lx, ly] = [bx + 3.4 * Math.cos(th - spread), by + 3.4 * Math.sin(th - spread)]
      const [rx, ry] = [bx + 3.4 * Math.cos(th + spread), by + 3.4 * Math.sin(th + spread)]
      w1.push(`${move(lx, ly)}${line(bx, by)}${line(rx, ry)}`)
      segments += 2
    }
    // the tip stands just past the arm's end
    const [tx, ty] = pt(r + TIP_R + 0.4, th)
    const tip = circleSub(tx, ty, a.recent === 'dashed' ? TIP_R + 0.2 : TIP_R)
    if (a.recent === 'disc') fill.push(tip)
    else if (a.recent === 'ring') w2.push(dOfSubs([tip]))
    else dash.push(tip)
    segments += 2
  })
  const paths: SigilModel['paths'] = []
  if (w2.length) paths.push({ cls: 'sg-w2', attrs: [['stroke-width', '1.5'], ['vector-effect', 'non-scaling-stroke'], ['pathLength', '1']], d: w2.join('') })
  if (w1.length) paths.push({ cls: 'sg-w1', attrs: [['stroke-width', '1'], ['vector-effect', 'non-scaling-stroke'], ['pathLength', '1']], d: w1.join('') })
  if (dash.length) paths.push({ cls: 'sg-dash', attrs: [['stroke-width', '1'], ['stroke-dasharray', '1.5 2'], ['vector-effect', 'non-scaling-stroke']], d: dOfSubs(dash) })
  if (fill.length) paths.push({ cls: 'sg-fill', attrs: [['fill', 'currentColor'], ['stroke', 'none']], d: dOfSubs(fill) })
  // the engine's seed: an 8-digit hash of the arm ids, never the ids themselves (a topic can be a person's subject)
  return { size, fold: n, seed: seedHex(arms.map((a) => a.id).join('|')), segments, paths }
}

/** The hollow form: a hub, the guide ring and six short dashed stubs, drawn when no evidence is allowed to speak. */
export function sigilMarkHollowModel(size = 96): SigilModel {
  const w1 = [dOfSubs([circleSub(C, C, GUIDE_R)])]
  const dash: Sub[] = []
  const stubs: string[] = []
  for (let i = 0; i < MIN_ARMS; i++) {
    const th = armAngle(i, MIN_ARMS)
    const [x0, y0] = pt(R0, th)
    const [x1, y1] = pt(R0 + 7, th)
    stubs.push(`${move(x0, y0)}${line(x1, y1)}`)
  }
  dash.push(circleSub(C, C, HUB_R + 1.6))
  const paths: SigilModel['paths'] = [
    { cls: 'sg-w1', attrs: [['stroke-width', '1'], ['vector-effect', 'non-scaling-stroke'], ['pathLength', '1']], d: w1.join('') },
    { cls: 'sg-dash', attrs: [['stroke-width', '1'], ['stroke-dasharray', '1.5 2'], ['vector-effect', 'non-scaling-stroke']], d: `${stubs.join('')}${dOfSubs(dash)}` },
  ]
  return { size, fold: MIN_ARMS, seed: seedHex('hollow'), segments: 4 + MIN_ARMS + 2, paths }
}

/** The byte-identical SVG string for an input (the golden test pins it). */
export const sigilMarkSvg = (arms: readonly SigilArm[], size = 96): string => modelToSvg(sigilMarkModel(arms, size))

/** Evidence as a word, for the text equivalent when no number is allowed. */
export const evidenceWord = (length: number): string => {
  const v = clamp01(length)
  return v >= 0.67 ? 'long arm, strong evidence' : v >= 0.34 ? 'medium arm, some evidence' : 'short arm, little evidence'
}
export const RECENT_WORD: Record<Recent, string> = { disc: 'practised recently', ring: 'not practised recently', dashed: 'never practised' }
