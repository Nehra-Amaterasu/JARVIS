// The geometry of the specimen composition (spec 20.5.1), as pure functions of the container width. Nothing here touches
// the DOM: the React file only places boxes at the numbers returned, so the leader lines and the boxes they join cannot
// disagree, and the test can check the 1366 x 768 and 390 px layouts without rendering anything.
//
// Design canvas: the shell leaves 1302 x 720 at 1366 x 768 (rail 64, title bar 48). The specimen box is 560 high, centred
// on the datum line (y = 288); the margin column holds up to five 88 px callouts joined to the specimen by a 1 px leader
// that bends once at 45 degrees; the footer is 72 px. Every y below sits on a datum tick (every 40 px from y = 8), so the
// eye reads one horizontal.

export const DESIGN_W = 1302
export const DESIGN_H = 720
/** Below this container width the composition reflows to one column (spec: "under 900 px"). */
export const REFLOW_BELOW = 900
export const GUTTER = 24
export const SPEC_TOP = 8
export const SPEC_H = 560
export const DATUM_Y = 288
export const TICK = 40
export const CALLOUT_H = 88
/** 88 px plate plus a 32 px gap: every plate top lands on a datum tick (8, 128, 248, 368, 488). */
export const CALLOUT_PITCH = 120
export const MAX_CALLOUTS = 5
export const FOOTER_H = 72
export const FOOTER_Y = DESIGN_H - FOOTER_H
export const REFLOW_SPEC_H = 320
/** The widest specimen of the design canvas and the margin that goes with it: 760 + 470 = 1302 - 3 x 24. */
const SPEC_W_DESIGN = 760
const BODY_W_DESIGN = DESIGN_W - 3 * GUTTER

export interface Box { x: number; y: number; w: number; h: number }
export interface Pt { x: number; y: number }

export interface SpecimenGeometry {
  mode: 'desktop' | 'reflow'
  width: number
  height: number
  specimen: Box
  /** Desktop only: one box per callout. In the reflow the callouts are cards in a carousel and these are empty. */
  callouts: Box[]
  footer: Box
  datumY: number
  /** The x of every datum tick is the same set of y values; these are the y values (desktop) of the 40 px ticks. */
  ticks: number[]
}

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v) ? v : lo)))

export function calloutCount(n: number): number {
  return clampInt(n, 0, MAX_CALLOUTS)
}

/** Datum ticks of the desktop stage, from the top margin down in steps of TICK. */
export function datumTicks(height: number = DESIGN_H): number[] {
  const out: number[] = []
  for (let y = SPEC_TOP; y <= height; y += TICK) out.push(y)
  return out
}

/**
 * The boxes for a container `width` wide holding `count` callouts. Desktop widths split the body in the ratio of the
 * design canvas (760 : 470), so 1302 gives exactly 24 / 760 / 24 / 470 / 24 and 900 gives a 512 px specimen with a
 * 316 px margin; the heights never change.
 */
export function specimenGeometry(width: number, count = 0): SpecimenGeometry {
  const w = Math.max(280, Math.round(Number.isFinite(width) ? width : DESIGN_W))
  const n = calloutCount(count)
  if (w < REFLOW_BELOW) {
    // Reflow: the specimen first at the full width and 320 px high; the carousel and the footer follow in the flow.
    return {
      mode: 'reflow',
      width: w,
      height: REFLOW_SPEC_H + FOOTER_H,
      specimen: { x: 0, y: 0, w, h: REFLOW_SPEC_H },
      callouts: [],
      footer: { x: 0, y: REFLOW_SPEC_H, w, h: FOOTER_H },
      datumY: 0,
      ticks: [],
    }
  }
  const body = w - 3 * GUTTER
  const specW = Math.round((body * SPEC_W_DESIGN) / BODY_W_DESIGN)
  const marginX = GUTTER + specW + GUTTER
  const marginW = w - marginX - GUTTER
  return {
    mode: 'desktop',
    width: w,
    height: DESIGN_H,
    specimen: { x: GUTTER, y: SPEC_TOP, w: specW, h: SPEC_H },
    callouts: Array.from({ length: n }, (_, i) => ({ x: marginX, y: SPEC_TOP + i * CALLOUT_PITCH, w: marginW, h: CALLOUT_H })),
    footer: { x: 0, y: FOOTER_Y, w, h: FOOTER_H },
    datumY: DATUM_Y,
    ticks: datumTicks(),
  }
}

/** Where a leader starts on the specimen: a fraction of the specimen box (0 to 1 each way), clamped inside it. */
export interface AnchorFrac { fx: number; fy: number }

/**
 * Default anchors for n callouts: spread down the specimen, alternating between the right third and the middle, so no two
 * leaders start at the same point. A pure function of n and the index, so a layout is the same on every render.
 */
export function defaultAnchors(n: number): AnchorFrac[] {
  const k = calloutCount(n)
  return Array.from({ length: k }, (_, i) => ({ fx: i % 2 === 0 ? 0.78 : 0.56, fy: (i + 0.5) / Math.max(1, k) }))
}

export function anchorPoint(spec: Box, a: AnchorFrac): Pt {
  const fx = Math.max(0, Math.min(1, Number.isFinite(a.fx) ? a.fx : 0.5))
  const fy = Math.max(0, Math.min(1, Number.isFinite(a.fy) ? a.fy : 0.5))
  return { x: Math.round(spec.x + fx * spec.w), y: Math.round(spec.y + fy * spec.h) }
}

/** The corner of a leader that goes from `from` to `to` and bends once, the second leg at exactly 45 degrees. */
export function leaderBend(from: Pt, to: Pt): Pt {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const ady = Math.abs(dy)
  if (Math.abs(dx) >= ady) return { x: from.x + Math.sign(dx || 1) * (Math.abs(dx) - ady), y: from.y } // straight along x, then the diagonal
  return { x: from.x, y: from.y + Math.sign(dy) * (ady - Math.abs(dx)) } // too close in x: straight along y, then the diagonal
}

/** The leader as an SVG path: start, one bend, end. */
export function leaderPath(from: Pt, to: Pt): string {
  const b = leaderBend(from, to)
  return `M${from.x} ${from.y}L${b.x} ${b.y}L${to.x} ${to.y}`
}

/** The point a leader ends on: the left edge of its callout plate, on the plate's own mid line. */
export function plateEnd(box: Box): Pt {
  return { x: box.x, y: box.y + Math.round(box.h / 2) }
}

export interface Leader { d: string; from: Pt; to: Pt; bend: Pt }

export function leadersFor(g: SpecimenGeometry, anchors: readonly AnchorFrac[]): Leader[] {
  return g.callouts.map((box, i) => {
    const from = anchorPoint(g.specimen, anchors[i] ?? defaultAnchors(g.callouts.length)[i])
    const to = plateEnd(box)
    return { from, to, bend: leaderBend(from, to), d: leaderPath(from, to) }
  })
}

/**
 * The checks of the acceptance line, as a list of problems (empty = the layout holds). An "object" is a block that carries
 * content: the specimen and the margin column of callouts. The footer is a rail and the reflow carousel is a control strip,
 * so neither counts; at most one object may be wider than 40 percent of the viewport.
 */
export function layoutProblems(g: SpecimenGeometry, viewportW: number, viewportH: number): string[] {
  const p: string[] = []
  const boxes: [string, Box][] = [['specimen', g.specimen], ['footer', g.footer], ...g.callouts.map((b, i) => [`callout ${i + 1}`, b] as [string, Box])]
  for (const [name, b] of boxes) {
    if (b.x < 0 || b.x + b.w > g.width) p.push(`${name} leaves the width`)
    if (b.w <= 0 || b.h <= 0) p.push(`${name} is empty`)
  }
  if (g.width > viewportW) p.push(`the stage ${g.width} is wider than the viewport ${viewportW}`)
  if (g.mode === 'desktop') {
    if (g.height > viewportH) p.push(`the stage ${g.height} is higher than the viewport ${viewportH}`)
    for (let i = 0; i < g.callouts.length; i++) {
      const a = g.callouts[i]
      if (a.x < g.specimen.x + g.specimen.w) p.push(`callout ${i + 1} overlaps the specimen`)
      const next = g.callouts[i + 1]
      if (next && a.y + a.h > next.y) p.push(`callout ${i + 1} overlaps callout ${i + 2}`)
      if (a.y + a.h > g.footer.y) p.push(`callout ${i + 1} reaches the footer`)
    }
    if (g.specimen.y + g.specimen.h > g.footer.y) p.push('the specimen reaches the footer')
  }
  const objects = [g.specimen, ...(g.callouts.length ? [g.callouts[0]] : [])]
  if (objects.filter((b) => b.w > 0.4 * viewportW).length > 1) p.push('more than one object is wider than 40 percent')
  return p
}
