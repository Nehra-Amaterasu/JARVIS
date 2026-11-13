// StrataCore geometry (spec 20.5.2): units drawn as geological strata, a stack of slabs where each slab is one unit and
// its thickness is evidence. A unit with no evidence is a flat dashed outline (never a thin lie of a slab); a unit with
// evidence has a thickness from its recall-weighted first-try rate. Every function is pure: the same units give the same
// slabs, so the picture moves only when the data does.
//
// The block is drawn in a light isometric projection (a top face and a right face on a front face), because that is how
// the owner's contour-block references (C04-23) read: the thickness of a layer is visible from the side.

import { fnv1a32, mulberry32 } from '../../grammar'

export interface StrataUnit { id: string; label: string; evidence: number; n: number }

export const MAX_UNITS = 12
/** The row pitch of the label list: a 44 px hit area per unit (spec 7.7 rule on targets). */
export const ROW_H = 44
export const BLOCK_W = 188
/** Isometric offsets of the depth: the top face rises DEPTH_DY and slides DEPTH_DX to the right. */
export const DEPTH_DX = 44
export const DEPTH_DY = 22
export const FLAT_T = 7
export const MIN_T = 14
export const MAX_T = 66
/** Below this many answered questions a slab edge is dashed: there is a layer, but it is thinly evidenced. */
export const THIN_N = 5
export const SVG_W = 360
/** x where the leaders leave the block and where they reach the label column. */
export const LEADER_FROM = BLOCK_W + DEPTH_DX
export const PAD_Y = 14

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0)

export const unitsDrawn = (units: readonly StrataUnit[]): StrataUnit[] => units.slice(0, MAX_UNITS)

/** A unit has evidence when at least one question was answered and its rate is above zero. */
export const hasEvidence = (u: StrataUnit): boolean => u.n > 0 && clamp01(u.evidence) > 0

/** Thickness of a slab in px: flat when there is no evidence, else 14 to 66 by the evidence. */
export const slabThickness = (u: StrataUnit): number => (hasEvidence(u) ? Math.round(MIN_T + (MAX_T - MIN_T) * clamp01(u.evidence)) : FLAT_T)

export interface Slab {
  id: string
  index: number
  /** Top of the front face and its thickness, in svg px. */
  y: number
  t: number
  flat: boolean
  thin: boolean
  /** Contour lines inside the front face, as svg path data. */
  contours: string
  /** The leader's start (right face, mid) and the label row's centre, and the leader as svg path data ending at the row. */
  from: { x: number; y: number }
  rowY: number
  leader: string
}

export interface StrataLayout {
  w: number
  h: number
  slabs: Slab[]
  /** Factor applied when the stack was taller than the rows allow (1 = not scaled). */
  scale: number
}

/** The wavy hairlines of a slab: k of them across the front face, seeded by the unit id so each slab keeps its own grain. */
export function contourPath(id: string, x0: number, y0: number, w: number, t: number): string {
  const k = Math.max(0, Math.floor(t / 5) - 1)
  const rnd = mulberry32(fnv1a32(id))
  const phase = rnd() * Math.PI * 2
  const amp = 0.9 + rnd() * 0.9
  let d = ''
  for (let i = 1; i <= k; i++) {
    const y = y0 + (t * i) / (k + 1)
    d += `M${x0} ${y.toFixed(1)}`
    for (let s = 1; s <= 8; s++) {
      const x = x0 + (w * s) / 8
      d += `L${x.toFixed(1)} ${(y + amp * Math.sin(phase + s * 0.9 + i * 1.3)).toFixed(1)}`
    }
  }
  return d
}

export const LEADER_STUB = 10

/**
 * A leader from a slab to its label row: a short stub, a 45 degree run that closes the height difference, then straight
 * into the row. When the difference is more than the run can take, the rest is a vertical step at the start of the run, so
 * the diagonal is always exactly 45 degrees. Pure; the test checks every segment is horizontal, vertical or 45 degrees.
 */
export function traceLeader(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dy = to.y - from.y
  const sgn = dy < 0 ? -1 : 1
  const room = Math.max(0, to.x - from.x - LEADER_STUB)
  const diag = Math.min(Math.abs(dy), room)
  const step = Math.abs(dy) - diag
  const p: [number, number][] = [[from.x, from.y], [from.x + LEADER_STUB, from.y]]
  if (step > 0) p.push([from.x + LEADER_STUB, from.y + sgn * step])
  if (diag > 0) p.push([from.x + LEADER_STUB + diag, to.y])
  p.push([to.x, to.y])
  return p.map(([x, yy], i) => `${i ? 'L' : 'M'}${x} ${Math.round(yy * 10) / 10}`).join('')
}

/**
 * The layout: the first unit is the bottom slab, the last the top one. Rows are listed top to bottom (the last unit first),
 * 44 px each, so a leader runs from a slab to the row at the same height and none crosses another. The block is centred on
 * the column of rows; if the slabs are taller than that column they are scaled down together (never one at a time).
 */
export function strataLayout(input: readonly StrataUnit[]): StrataLayout {
  const units = unitsDrawn(input)
  const n = units.length
  const rowsH = Math.max(1, n) * ROW_H
  const h = rowsH + 2 * PAD_Y
  const raw = units.map(slabThickness)
  const total = raw.reduce((a, b) => a + b, 0)
  const room = h - 2 * PAD_Y - DEPTH_DY
  const scale = total > room && total > 0 ? room / total : 1
  const ts = raw.map((t) => Math.max(3, Math.round(t * scale)))
  const stack = ts.reduce((a, b) => a + b, 0)
  const bottom = Math.round(h - PAD_Y - (room - Math.min(room, stack)) / 2)
  const slabs: Slab[] = []
  let y = bottom
  units.forEach((u, i) => {
    const t = ts[i]
    y -= t
    const flat = !hasEvidence(u)
    const rowIndex = n - 1 - i
    const from = { x: LEADER_FROM, y: Math.round(y + t / 2 - DEPTH_DY / 2) }
    const rowY = PAD_Y + rowIndex * ROW_H + ROW_H / 2
    slabs.push({
      id: u.id,
      index: i,
      y,
      t,
      flat,
      thin: !flat && u.n < THIN_N,
      contours: flat ? '' : contourPath(u.id, 0, y, BLOCK_W, t),
      from,
      rowY,
      leader: traceLeader(from, { x: SVG_W, y: rowY }),
    })
  })
  return { w: SVG_W, h, slabs, scale }
}

/** The evidence text of a unit; a number only when the state allows one (the caller decides). */
export const evidencePct = (u: StrataUnit): number => Math.round(clamp01(u.evidence) * 100)
