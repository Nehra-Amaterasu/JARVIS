// Pure geometry and layout for the shared art components (spec 7.4, 7.5). Nothing here touches the DOM, a clock or
// a random source: every function is a pure map from the real data to shapes, so "growing" art cannot drift with
// time (spec 8) and each one is O(n) in its input with n capped by a named constant below. React files only draw
// what these return, which is also why the tests can check the hard rules (24 nodes, 150 dots, 60 meter dots,
// plates that never overlap) without rendering anything.

export const TAU = Math.PI * 2

/** Caps from the spec's component rows; an input past a cap is cut, never drawn past it. */
export const MAX_NODES = 24 // NodeRing (22) and Ring Bars (24)
export const MAX_ROWS = 24 // Ridge (25)
export const MAX_CALLOUTS = 6 // Callout (26)
export const MAX_TIMER_DOTS = 150 // Dot Timer (28): 5 columns of 30
export const TIMER_COLUMN = 30
export const MAX_STIPPLE = 120 // Stipple Ring (33)
export const METER_COLS = 12 // Dot-Matrix Meter (36): 5 x 12 = 60
export const METER_ROWS = 5
export const MAX_RIDGE_POINTS = 160 // 720 px canvas / 160 = 4.5 px per sample, finer than a hairline can show

const r2 = (v: number) => Math.round(v * 100) / 100

export const clamp = (v: number, lo: number, hi: number): number => (Number.isFinite(v) ? (v < lo ? lo : v > hi ? hi : v) : lo)

/** A point on a circle; `turn` runs 0..1 clockwise from twelve o'clock. */
export function polar(cx: number, cy: number, r: number, turn: number): { x: number; y: number } {
  const a = turn * TAU
  return { x: r2(cx + r * Math.sin(a)), y: r2(cy - r * Math.cos(a)) }
}

/** n points evenly around a ring, first at twelve o'clock; n is capped at MAX_NODES. */
export function ringPoints(n: number, cx: number, cy: number, r: number): { x: number; y: number; turn: number }[] {
  const k = Math.min(Math.max(0, Math.floor(n)), MAX_NODES)
  return Array.from({ length: k }, (_, i) => ({ ...polar(cx, cy, r, i / k), turn: i / k }))
}

/** SVG arc from turn t0 to t1 (t1 > t0). A full turn is drawn as two half arcs, since one arc cannot close on itself. */
export function arcPath(cx: number, cy: number, r: number, t0: number, t1: number): string {
  const span = clamp(t1 - t0, 0, 1)
  if (span <= 0) return ''
  if (span >= 0.9999) {
    const a = polar(cx, cy, r, t0)
    const b = polar(cx, cy, r, t0 + 0.5)
    return `M${a.x} ${a.y}A${r} ${r} 0 1 1 ${b.x} ${b.y}A${r} ${r} 0 1 1 ${a.x} ${a.y}`
  }
  const a = polar(cx, cy, r, t0)
  const b = polar(cx, cy, r, t0 + span)
  return `M${a.x} ${a.y}A${r} ${r} 0 ${span > 0.5 ? 1 : 0} 1 ${b.x} ${b.y}`
}

/** A ring segment (annulus slice) as a closed path, for the wheel's month cells. */
export function sectorPath(cx: number, cy: number, rIn: number, rOut: number, t0: number, t1: number): string {
  const large = t1 - t0 > 0.5 ? 1 : 0
  const a = polar(cx, cy, rOut, t0)
  const b = polar(cx, cy, rOut, t1)
  const c = polar(cx, cy, rIn, t1)
  const d = polar(cx, cy, rIn, t0)
  return `M${a.x} ${a.y}A${rOut} ${rOut} 0 ${large} 1 ${b.x} ${b.y}L${c.x} ${c.y}A${rIn} ${rIn} 0 ${large} 0 ${d.x} ${d.y}Z`
}

/** Left/Right/Up/Down/Home/End over a roving group; null when the key is not ours. Wraps, as a ring does. */
export function nextIndex(i: number, key: string, count: number, wrap = true): number | null {
  if (count <= 0) return null
  const last = count - 1
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return i >= last ? (wrap ? 0 : last) : i + 1
    case 'ArrowLeft':
    case 'ArrowUp':
      return i <= 0 ? (wrap ? last : 0) : i - 1
    case 'Home':
      return 0
    case 'End':
      return last
    default:
      return null
  }
}

// ---------------------------------------------------------------- Orbit (23)

export interface MilestoneIn {
  id: string
  label: string
  /** 0 = innermost orbit. */
  orbit: number
  /** 0..1 around the orbit, clockwise from twelve o'clock. */
  at: number
  status: 'reached' | 'upcoming' | 'planned'
}

export function orbitRadii(orbits: number, size: number): number[] {
  const n = clamp(Math.floor(orbits), 1, 6)
  const rMax = size / 2 - 14 // 14 px left for the marker half-width and its stroke
  const rMin = rMax * 0.34
  return Array.from({ length: n }, (_, i) => r2(n === 1 ? rMax : rMin + ((rMax - rMin) * i) / (n - 1)))
}

export function orbitMarkers(ms: readonly MilestoneIn[], size: number, orbits: number) {
  const radii = orbitRadii(orbits, size)
  const c = size / 2
  return ms.map((m) => {
    const ring = clamp(Math.round(m.orbit), 0, radii.length - 1)
    return { ...m, orbit: ring, ...polar(c, c, radii[ring], clamp(m.at, 0, 1)) }
  })
}

// ---------------------------------------------------------------- Ring Bars (24)

export interface RingBarIn {
  id: string
  label: string
  /** null = no reading for this bar: a flat stub, never a hidden bar. */
  value: number | null
}

export function ringBars(bars: readonly RingBarIn[], max: number, g: { cx: number; cy: number; rIn: number; rOut: number }) {
  const list = bars.slice(0, MAX_NODES)
  const top = max > 0 ? max : 1
  return list.map((b, i) => {
    const frac = b.value === null ? 0 : clamp(b.value / top, 0, 1)
    const len = Math.max(2, (g.rOut - g.rIn) * frac) // 2 px: an empty bar stays visible as a stub
    const turn = (i + 0.5) / list.length
    const p0 = polar(g.cx, g.cy, g.rIn, turn)
    const p1 = polar(g.cx, g.cy, g.rIn + len, turn)
    return { id: b.id, label: b.label, value: b.value, frac, empty: b.value === null || frac === 0, x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y }
  })
}

// ---------------------------------------------------------------- Ridge (25)

export interface RidgeRow {
  /** Row label (a date, a channel). */
  label: string
  values: readonly number[]
}

/** Mean-pool a series to at most `cap` samples in one pass, so a long series costs O(n) and draws at most `cap` points. */
export function downsample(values: readonly number[], cap: number): number[] {
  const n = values.length
  if (n <= cap) return values.map((v) => (Number.isFinite(v) ? v : 0))
  const out: number[] = []
  for (let k = 0; k < cap; k++) {
    const a = Math.floor((k * n) / cap)
    const b = Math.max(a + 1, Math.floor(((k + 1) * n) / cap))
    let s = 0
    for (let i = a; i < b; i++) s += Number.isFinite(values[i]) ? values[i] : 0
    out.push(s / (b - a))
  }
  return out
}

/**
 * One path per row, back row first. `fill` closes down to the canvas floor, so painting rows in order with the
 * ground colour hides the rows behind it (hidden-line occlusion with no clipping and no WebGL).
 */
export function ridgePaths(rows: readonly RidgeRow[], w: number, h: number) {
  const list = rows.slice(0, MAX_ROWS)
  const n = list.length
  if (n === 0) return { rows: [] as { line: string; fill: string; label: string; peak: number }[], max: 0 }
  const sampled = list.map((r) => downsample(r.values, MAX_RIDGE_POINTS))
  let max = 0
  for (const s of sampled) for (const v of s) if (v > max) max = v
  const scale = max > 0 ? max : 1
  const top = h * 0.12
  const pitch = (h - top - 4) / n
  const reach = pitch * 3.2 // a row may rise over three rows behind it, which is what makes the ridgeline read
  const out = sampled.map((s, i) => {
    const base = top + pitch * (i + 1)
    const amp = Math.min(reach, base - 4) // with one or two rows reach alone would draw above the frame (found by the bounds test)
    const step = s.length > 1 ? w / (s.length - 1) : 0
    let line = ''
    let peak = 0
    for (let k = 0; k < s.length; k++) {
      const v = clamp(s[k] / scale, 0, 1)
      if (v > peak) peak = v
      line += `${k === 0 ? 'M' : 'L'}${r2(k * step)} ${r2(base - v * amp)}`
    }
    const fill = s.length ? `${line}L${r2((s.length - 1) * step)} ${h}L0 ${h}Z` : ''
    return { line, fill, label: list[i].label, peak }
  })
  return { rows: out, max }
}

// ---------------------------------------------------------------- Callout (26)

export interface CalloutIn {
  id: string
  x: number
  y: number
}

export interface PlacedPlate {
  id: string
  side: 'left' | 'right'
  /** Plate top-left. */
  px: number
  py: number
  /** Where the leader meets the plate. */
  ax: number
  ay: number
  /** The target point. */
  x: number
  y: number
}

/**
 * Plates stack in a left and a right column, each sorted by the height of its target and pushed apart to at least
 * `plateH + gap`, so two plates cannot overlap by construction. If the column cannot fit, the gap shrinks to 0
 * (the spec caps a view at 6 plates, which fits any view taller than 6 plates).
 */
export function placePlates(points: readonly CalloutIn[], w: number, h: number, plateW: number, plateH: number, gap = 8): PlacedPlate[] {
  const list = points.slice(0, MAX_CALLOUTS)
  const place = (side: 'left' | 'right'): PlacedPlate[] => {
    const col = list.filter((p) => (p.x < w / 2 ? 'left' : 'right') === side).sort((a, b) => a.y - b.y || (a.id < b.id ? -1 : 1))
    const g = col.length * plateH + (col.length - 1) * gap > h ? 0 : gap
    const ys = col.map((p) => clamp(p.y - plateH / 2, 0, Math.max(0, h - plateH)))
    for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + plateH + g)
    const over = ys.length ? ys[ys.length - 1] + plateH - h : 0
    if (over > 0) {
      ys[ys.length - 1] -= over
      for (let i = ys.length - 2; i >= 0; i--) ys[i] = Math.min(ys[i], ys[i + 1] - plateH - g)
    }
    const px = side === 'left' ? 0 : w - plateW
    return col.map((p, i) => ({
      id: p.id, side, px, py: r2(Math.max(0, ys[i])),
      ax: side === 'left' ? plateW : w - plateW, ay: r2(Math.max(0, ys[i]) + plateH / 2), x: p.x, y: p.y,
    }))
  }
  return [...place('left'), ...place('right')]
}

// ---------------------------------------------------------------- Dot timer (28), Week strip (31)

export type TimerDotKind = 'filled' | 'next' | 'half' | 'ring'

/** Columns of 30 dots, columns = ceil(planned / 30) and at most 5; the last column holds the remainder (partial dots). */
export function timerLayout(plannedMin: number, elapsedMin: number, paused = false) {
  const total = Math.floor(clamp(plannedMin, 0, MAX_TIMER_DOTS))
  const capped = plannedMin > MAX_TIMER_DOTS
  const columns = Math.ceil(total / TIMER_COLUMN)
  const filled = Math.floor(clamp(elapsedMin, 0, total))
  const dots = Array.from({ length: total }, (_, i) => {
    const kind: TimerDotKind = i < filled ? 'filled' : i === filled ? (paused ? 'half' : 'next') : 'ring'
    return { col: Math.floor(i / TIMER_COLUMN), row: i % TIMER_COLUMN, kind }
  })
  return { total, columns, filled, capped, dots }
}

/** Dots under a day pill: one per started 30 minutes of logged time, at most 5. Zero minutes is zero dots, not a ring. */
export function weekDots(minutes: number): number {
  return minutes > 0 ? Math.min(5, Math.ceil(minutes / 30)) : 0
}

// ---------------------------------------------------------------- Date wheel (29)

export function parseIso(iso: string): { y: number; m: number; d: number } | null {
  const mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!mt) return null
  const y = +mt[1], m = +mt[2], d = +mt[3]
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return m >= 1 && m <= 12 && d >= 1 && d <= dim ? { y, m, d } : null
}

/** Position on the wheel, 0..1: twelve equal month segments, the day placed inside its month. null for a bad date. */
export function wheelTurn(iso: string): number | null {
  const p = parseIso(iso)
  if (!p) return null
  const dim = new Date(Date.UTC(p.y, p.m, 0)).getUTCDate()
  return (p.m - 1 + (p.d - 1) / dim) / 12
}

// ---------------------------------------------------------------- Pillars (30)

export interface Axis {
  id: string
  label: string
  /** 0..1 */
  value: number
}

export function spider(axes: readonly Axis[], cx: number, cy: number, r: number) {
  const list = axes.slice(0, 8)
  const n = list.length
  if (n < 3) return { points: '', spokes: [] as { id: string; label: string; x: number; y: number; vx: number; vy: number }[] }
  const spokes = list.map((a, i) => {
    const t = i / n
    const end = polar(cx, cy, r, t)
    const v = polar(cx, cy, r * clamp(a.value, 0, 1), t)
    return { id: a.id, label: a.label, x: end.x, y: end.y, vx: v.x, vy: v.y }
  })
  return { points: spokes.map((s) => `${s.vx},${s.vy}`).join(' '), spokes }
}

// ---------------------------------------------------------------- Dither (34)

export const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const

export type IdeaKind = 'ring' | 'ridge' | 'bloom' | 'bridge'

/** The idea, as a closed-form brightness field 0..1 over the unit square. No image, no random: the art is its formula. */
export function ideaField(kind: IdeaKind): (u: number, v: number) => number {
  switch (kind) {
    case 'ring':
      return (u, v) => {
        const d = Math.hypot(u - 0.5, v - 0.5)
        return clamp(1 - Math.abs(d - 0.3) / 0.14, 0, 1)
      }
    case 'ridge':
      return (u, v) => {
        const h = 0.62 - 0.22 * Math.sin(u * 7) * Math.cos(u * 2.3) - 0.1 * Math.sin(u * 17)
        return clamp(1 - (v - h) / 0.35, 0, 1) * (v > h ? 1 : 0)
      }
    case 'bloom':
      return (u, v) => clamp(1 - Math.hypot(u - 0.5, v - 0.5) * 2, 0, 1) ** 1.6
    case 'bridge':
      return (u, v) => {
        const deck = Math.abs(v - 0.58) < 0.03 ? 1 : 0
        const arch = clamp(1 - Math.abs(v - (0.58 - 0.34 * Math.sin(Math.PI * u) ** 2)) / 0.04, 0, 1)
        return Math.max(deck, arch)
      }
  }
}

/** Ordered dither of a field into horizontal runs of ink; one path string, run-length coded (a few KB, never a raster). */
export function ditherRuns(w: number, h: number, field: (u: number, v: number) => number): { path: string; on: number } {
  const cw = Math.floor(clamp(w, 1, 256))
  const ch = Math.floor(clamp(h, 1, 256))
  let path = ''
  let on = 0
  for (let y = 0; y < ch; y++) {
    let x = 0
    while (x < cw) {
      const lit = (xx: number) => field((xx + 0.5) / cw, (y + 0.5) / ch) > (BAYER4[y % 4][xx % 4] + 0.5) / 16
      if (!lit(x)) {
        x++
        continue
      }
      const s = x
      while (x < cw && lit(x)) x++
      path += `M${s} ${y}h${x - s}v1h-${x - s}z`
      on += x - s
    }
  }
  return { path, on }
}

// ---------------------------------------------------------------- ASCII (32, 35)

export const ASCII_RAMP = ' .:-=+*#'

/** One frame of the sweep: a diagonal band of denser characters, centre at `step`. cols is the 12-character group. */
export function sweepFrame(cols: number, rows: number, step: number): string[] {
  const w = Math.floor(clamp(cols, 4, 12))
  const h = Math.floor(clamp(rows, 3, 6))
  const span = w + 8
  const pos = (((step % span) + span) % span) - 4
  return Array.from({ length: h }, (_, r) => {
    let line = ''
    for (let c = 0; c < w; c++) {
      const d = Math.abs(c - (pos + r)) // +r tilts the band so it reads as a sweep, not a column
      const idx = clamp(ASCII_RAMP.length - 1 - d * 2, 1, ASCII_RAMP.length - 1)
      line += ASCII_RAMP[Math.round(idx)]
    }
    return line
  })
}

/** The static form: a fixed mid-density frame (the band parked at the middle), the same in Calm and forced colours. */
export const sweepStatic = (cols: number, rows: number): string[] => sweepFrame(cols, rows, Math.floor(clamp(cols, 4, 12) / 2) + 4)

export type EmptyVariant = 'tree' | 'memory' | 'console' | 'error'

// 12 to 16 lines each, at most 40 columns, drawn here as plain text (spec 7.5 #35); the reference pictures are
// mood only and are not traced.
export const ASCII_ART: Record<EmptyVariant, readonly string[]> = {
  tree: [
    '            .  *  .',
    '        .  \\  |  /  .',
    '          `--.|.--`',
    '       .-----\\|/-----.',
    '      /  `.   |   .`  \\',
    '     |     `. | .`     |',
    '      \\      `|`      /',
    '       `-.    |    .-`',
    '          `.  |  .`',
    '            \\ | /',
    '             \\|/',
    '              |',
    '              |',
    '        ______|______',
  ],
  memory: [
    '  . : . : . : . : . : . :',
    ' : . : . ,:, . : . ,:, . :',
    '  ,:;:, . ;:;:; . ,:;:, .',
    ' :;:;:;:,:;:;:;:,:;:;:;:;',
    '  ;:;:;:;:;;:;:;:;:;:;:;',
    ' . ;:;:;:. ;:;:;:. ;:;:;',
    '  : ;:;:  :  ;:;  :  ;:;',
    ' .   |:    .  |:    . |:',
    '     ||       ||       ||',
    '     ||       ||       ||',
    '  .  ||  .    ||  .    ||',
    ' ~~~~~~~~~~~~~~~~~~~~~~~~',
  ],
  console: [
    '.--------------------------.',
    '| o o o                    |',
    '|--------------------------|',
    '| > _                      |',
    '|                          |',
    '|                          |',
    '|   (nothing has run yet)  |',
    '|                          |',
    '|                          |',
    '|                          |',
    '|                          |',
    "'--------------------------'",
    '        .----------.',
    "       /____________\\",
  ],
  error: [
    '  ERROR  ERROR  ERROR  ERR',
    ' ERROR  ERROR  ERROR  ERRO',
    '  ----------------------',
    ' |                      |',
    ' |      /\\              |',
    ' |     /  \\             |',
    ' |    / !! \\            |',
    ' |   /______\\           |',
    ' |                      |',
    '  ----------------------',
    ' RROR  ERROR  ERROR  ERRO',
    'ERROR  ERROR  ERROR  ERRO',
  ],
}

// ---------------------------------------------------------------- Dot-matrix meter (36), stipple ring (33)

/** 60 dots in 12 columns of 5. The level fills whole dots from the left, bottom to top inside a column. */
export function meterDots(level: number | null, min: number, max: number) {
  const total = METER_COLS * METER_ROWS
  const span = max - min
  const frac = level === null || !(span > 0) ? 0 : clamp((level - min) / span, 0, 1)
  const filled = level === null ? 0 : Math.round(frac * total)
  const dots = Array.from({ length: total }, (_, i) => {
    const col = Math.floor(i / METER_ROWS)
    const row = METER_ROWS - 1 - (i % METER_ROWS) // row 0 is the top, so fill rises from the bottom
    return { col, row, on: i < filled }
  })
  return { total, filled, frac, dots }
}

export function stippleDots(frac: number, count: number, cx: number, cy: number, r: number) {
  const n = Math.floor(clamp(count, 12, MAX_STIPPLE))
  const filled = Math.round(clamp(frac, 0, 1) * n)
  return Array.from({ length: n }, (_, i) => ({ ...polar(cx, cy, r, i / n), on: i < filled }))
}

// ---------------------------------------------------------------- Cell skeleton (37)

export interface Block {
  x: number
  y: number
  w: number
  h: number
}

/** A tiny deterministic hash for the split decision; the same seed always gives the same mosaic. */
const mix = (a: number, b: number): number => {
  let h = (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)) >>> 0
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

/** Quadtree blocks on a 2^depth grid (depth at most 3, so at most 64 blocks); a cell splits while the hash says so. */
export function quadBlocks(depth: number, seed = 1): Block[] {
  const d = Math.floor(clamp(depth, 1, 3))
  const out: Block[] = []
  const go = (x: number, y: number, size: number, level: number) => {
    if (size > 1 && level < d && mix(seed, x * 131 + y * 17 + size) < 0.62) {
      const s = size / 2
      go(x, y, s, level + 1)
      go(x + s, y, s, level + 1)
      go(x, y + s, s, level + 1)
      go(x + s, y + s, s, level + 1)
    } else out.push({ x, y, w: size, h: size })
  }
  go(0, 0, 1 << d, 0)
  return out
}
