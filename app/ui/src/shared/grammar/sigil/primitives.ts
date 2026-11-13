// The 14 sigil primitives of spec 20.4.1, hand-drawn as own paths (no catalogue picture is read or embedded).
// Reference families, by catalogue id only: C01-18 (bracket, cross, diamond, chain, X, dashed arc, stripes, ticks),
// C03-06 (nested triangle, circle, hexagon, spiral), C04-127 (lettered ring), C04-08 (thorn).
//
// Each primitive is drawn in a LOCAL frame at its anchor: x runs along the tangent (clockwise positive), y runs
// along the radius (outward positive), units are px of the 48 x 48 view box. The generator rotates the frame
// around the centre n times (and mirrors it for the dihedral forms), so a primitive is drawn once and placed by
// geometry, never copied by hand. `r` is the anchor radius, which the concentric primitives (arc, ticks, letters)
// need so their curves stay centred on the glyph.

export type Pt = readonly [number, number]
export type Seg =
  | { k: 'L'; p: Pt }
  | { k: 'Q'; c: Pt; p: Pt }
  | { k: 'C'; c1: Pt; c2: Pt; p: Pt }
  | { k: 'A'; r: number; large: 0 | 1; sweep: 0 | 1; p: Pt }
  | { k: 'Z' }
export interface Sub {
  m: Pt
  segs: Seg[]
}
/** 1 = hair (decorative), 2 = structural, 3 = state marks and seals (the 1, 1.5, 2 px of --sigil-w-*). */
export type Weight = 1 | 2 | 3
/** line: stroked; fill: a filled cell or blade (fill only on cells of at most 4 px, or thorns); dash: dashed hair. */
export type Style = 'line' | 'fill' | 'dash'
export interface Mark {
  w: Weight
  style: Style
  subs: Sub[]
}

export type PrimitiveName =
  | 'bracket' | 'cross' | 'diamond' | 'chain' | 'xmark' | 'arc' | 'stripes'
  | 'ticks' | 'tri' | 'circle' | 'hex' | 'spiral' | 'thorn' | 'letters'

export interface Primitive {
  name: PrimitiveName
  /** True when the local drawing is symmetric about x = 0, so a mirror copy on the axis would overlap itself. */
  sym: boolean
  /** Draw at scale `s` (0.7 to 1.3), anchor radius `r`, variant `v` in [0, 1). */
  draw(s: number, r: number, v: number): Mark[]
}

const L = (x: number, y: number): Seg => ({ k: 'L', p: [x, y] })
const Z: Seg = { k: 'Z' }
const sub = (x: number, y: number, ...segs: Seg[]): Sub => ({ m: [x, y], segs })
/** A full circle as two arcs (a path has no circle command); 2 segments. */
export const circleSub = (cx: number, cy: number, r: number): Sub => ({
  m: [cx, cy - r],
  segs: [
    { k: 'A', r, large: 1, sweep: 1, p: [cx, cy + r] },
    { k: 'A', r, large: 1, sweep: 1, p: [cx, cy - r] },
  ],
})

/** The 8 runes of the lettered ring: tiny 2-stroke marks, a glyph alphabet drawn as paths so no font is needed. */
const RUNES: ((s: number) => Sub[])[] = [
  (s) => [sub(0, -2 * s, L(0, 2 * s)), sub(-1.2 * s, -0.6 * s, L(1.2 * s, 0.6 * s))],
  (s) => [sub(-1.2 * s, 2 * s, L(0, -2 * s), L(1.2 * s, 2 * s))],
  (s) => [sub(0, -2 * s, L(0, 2 * s)), sub(0, -0.4 * s, L(1.2 * s, -1.6 * s))],
  (s) => [sub(-1.2 * s, -2 * s, L(1.2 * s, 2 * s)), sub(-1.2 * s, 0, L(1.2 * s, 0))],
  (s) => [sub(-1 * s, -2 * s, L(1 * s, 0), L(-1 * s, 2 * s))],
  (s) => [sub(0, 2 * s, L(0, -1 * s)), sub(-1.2 * s, -2 * s, L(0, -1 * s), L(1.2 * s, -2 * s))],
  (s) => [sub(-1.2 * s, -1.4 * s, L(1.2 * s, -1.4 * s)), sub(0, -1.4 * s, L(0, 2 * s))],
  (s) => [sub(-1.2 * s, 2 * s, L(-1.2 * s, -2 * s), L(1.2 * s, 2 * s), L(1.2 * s, -2 * s))],
]

export const PRIMITIVES: Record<PrimitiveName, Primitive> = {
  // a pair of corner caps facing outward, the C01-18 target bracket split across the axis: 4 segments
  bracket: {
    name: 'bracket', sym: true,
    draw: (s) => [{ w: 2, style: 'line', subs: [
      sub(-3 * s, 0.5 * s, L(-3 * s, 3 * s), L(-1 * s, 3 * s)),
      sub(3 * s, 0.5 * s, L(3 * s, 3 * s), L(1 * s, 3 * s)),
    ] }],
  },
  // the target cross, weight 3 so it reads as a mark: 2 segments
  cross: {
    name: 'cross', sym: true,
    draw: (s) => [{ w: 3, style: 'line', subs: [sub(0, -2.6 * s, L(0, 2.6 * s)), sub(-2.6 * s, 0, L(2.6 * s, 0))] }],
  },
  // a radially elongated diamond, a blade point; filled only when it is a 4 px cell: 4 segments
  diamond: {
    name: 'diamond', sym: true,
    draw: (s, _r, v) => {
      const small = v < 0.3
      const h = (small ? 2 : 4.4 + v * 2.2) * s
      const w = (small ? 2 : 1.5) * s
      return [{ w: small ? 3 : 2, style: small ? 'fill' : 'line', subs: [sub(0, -h, L(w, 0), L(0, h), L(-w, 0), Z)] }]
    },
  },
  // three diamonds in a radial chain (C01-18), drawn as two zigzags: 12 segments
  chain: {
    name: 'chain', sym: true,
    draw: (s) => {
      const d = 1.6 * s
      const side = (sx: number) => sub(0, -4.8 * s, L(sx * d, -3.2 * s), L(0, -1.6 * s), L(sx * d, 0), L(0, 1.6 * s), L(sx * d, 3.2 * s), L(0, 4.8 * s))
      return [{ w: 1, style: 'line', subs: [side(-1), side(1)] }]
    },
  },
  // the heavy X mark: 2 segments
  xmark: {
    name: 'xmark', sym: true,
    draw: (s) => [{ w: 3, style: 'line', subs: [sub(-2 * s, -2 * s, L(2 * s, 2 * s)), sub(2 * s, -2 * s, L(-2 * s, 2 * s))] }],
  },
  // a dashed arc concentric with the glyph, 90 or 180 degrees in total: 1 segment
  arc: {
    name: 'arc', sym: true,
    draw: (_s, r, v) => {
      const a = (v < 0.5 ? Math.PI / 4 : Math.PI / 2) * 0.98
      const x = r * Math.sin(a)
      const y = r * Math.cos(a) - r
      return [{ w: 1, style: 'dash', subs: [{ m: [-x, y], segs: [{ k: 'A', r, large: 0, sweep: 1, p: [x, y] }] }] }]
    },
  },
  // the stripe block: three tangential bars stacked outward (the "≡" of C01-18): 3 segments
  stripes: {
    name: 'stripes', sym: true,
    draw: (s) => {
      const w = 3 * s
      return [{ w: 3, style: 'line', subs: [sub(-w, -2 * s, L(w, -2 * s)), sub(-w, 0, L(w, 0)), sub(-w * 0.6, 2 * s, L(w * 0.6, 2 * s))] }]
    },
  },
  // a short tick ruler on the anchor circle: 4 radial ticks, the middle two long: 4 segments
  ticks: {
    name: 'ticks', sym: true,
    draw: (s, r) => {
      const subs: Sub[] = []
      const step = (3.2 * s) / Math.max(r, 4)
      for (let i = 0; i < 4; i++) {
        const a = (i - 1.5) * step
        const len = i === 1 || i === 2 ? 3 * s : 1.6 * s
        const x0 = r * Math.sin(a), y0 = r * Math.cos(a) - r
        const x1 = (r + len) * Math.sin(a), y1 = (r + len) * Math.cos(a) - r
        subs.push(sub(x0, y0, L(x1, y1)))
      }
      return [{ w: 1, style: 'line', subs }]
    },
  },
  // the nested triangle of C03-06, pointing outward or inward: 6 segments
  tri: {
    name: 'tri', sym: true,
    draw: (s, _r, v) => {
      const k = v < 0.5 ? 1 : -1
      return [
        { w: 2, style: 'line', subs: [sub(0, -3.4 * s * k, L(3 * s, 2 * s * k), L(-3 * s, 2 * s * k), Z)] },
        { w: 1, style: 'line', subs: [sub(0, -0.8 * s * k, L(1.2 * s, 1.2 * s * k), L(-1.2 * s, 1.2 * s * k), Z)] },
      ]
    },
  },
  // a small circle, or a filled dot when it is a cell: 2 segments
  circle: {
    name: 'circle', sym: true,
    draw: (s, _r, v) => (v < 0.35
      ? [{ w: 3, style: 'fill', subs: [circleSub(0, 0, 1.3 * s)] }]
      : [{ w: 2, style: 'line', subs: [circleSub(0, 0, 2 * s)] }]),
  },
  // the hexagon with a vertex on the axis: 6 segments
  hex: {
    name: 'hex', sym: true,
    draw: (s) => {
      const R = 3 * s
      const p = (i: number): [number, number] => [R * Math.sin((i * Math.PI) / 3), -R * Math.cos((i * Math.PI) / 3)]
      const [x0, y0] = p(0)
      return [{ w: 2, style: 'line', subs: [sub(x0, y0, L(...p(1)), L(...p(2)), L(...p(3)), L(...p(4)), L(...p(5)), Z)] }]
    },
  },
  // the spiral flourish: one stroke curling in on itself, two cubics: 2 segments
  spiral: {
    name: 'spiral', sym: false,
    draw: (s) => [{ w: 1, style: 'line', subs: [{
      m: [-0.5 * s, -3.6 * s],
      segs: [
        { k: 'C', c1: [3.6 * s, -3.6 * s], c2: [3.6 * s, 1.8 * s], p: [0.4 * s, 1.8 * s] },
        { k: 'C', c1: [-1.8 * s, 1.8 * s], c2: [-1.8 * s, -1 * s], p: [0.4 * s, -1 * s] },
      ],
    }] }],
  },
  // the thorn: a filled tapered blade curving to a point (the chrome-tribal family of C04-08): 3 segments
  thorn: {
    name: 'thorn', sym: false,
    draw: (s, _r, v) => {
      const bend = (1.8 + v * 2.6) * s
      const len = (7.5 + v * 4) * s
      return [{ w: 3, style: 'fill', subs: [{
        m: [-1.25 * s, -2.2 * s],
        segs: [
          { k: 'Q', c: [-1.5 * s, len * 0.6], p: [bend, len] },
          { k: 'Q', c: [0.1 * s, len * 0.42], p: [1.05 * s, -2.2 * s] },
          Z,
        ],
      }] }]
    },
  },
  // one rune of the lettered ring (C04-127); the ring itself is laid by the generator once: 2 to 3 segments
  letters: {
    name: 'letters', sym: false,
    draw: (s, _r, v) => [{ w: 1, style: 'line', subs: RUNES[Math.floor(v * RUNES.length) % RUNES.length](0.9 * s) }],
  },
}

export const PRIMITIVE_NAMES = Object.keys(PRIMITIVES) as PrimitiveName[]

/**
 * How much ink a primitive puts down, 0 to 5. A 16 px day cell keeps only the heaviest layer and a 24 px node the
 * two heaviest: a hairline arc or a tick ruler vanishes at that size, a blade or an X still reads.
 */
export const HEFT: Record<PrimitiveName, number> = {
  thorn: 5, diamond: 4, xmark: 4, stripes: 4, tri: 3, cross: 3, bracket: 3, hex: 2, chain: 2, spiral: 1, circle: 1, arc: 0, ticks: 0, letters: 0,
}

/** Segments of one mark list: every L, Q, C, A and Z is one drawn segment (M only moves the pen). */
export function segmentsOf(marks: readonly Mark[]): number {
  let n = 0
  for (const m of marks) for (const s of m.subs) n += s.segs.length
  return n
}
