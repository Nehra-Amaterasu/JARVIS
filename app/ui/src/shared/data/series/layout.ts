// The pure geometry of the series forms (spec 20.5.2, package D02): Trace, DotHistogram and SkyLedger. Every picture
// these components draw is a function of the data and the box, so an edit or a delete moves the picture honestly and a
// test can pin it. Nothing here reads the clock, the DOM or a random source; the sky's jitter is seeded by a constant.
import { fnv1a32, mulberry32 } from '../../grammar'

// ------------------------------------------------------------------------------------------------ shared text

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** "13 Nov" in local time: the mono date label of a ruler and a callout. */
export function fmtDay(t: number): string {
  const d = new Date(t)
  return Number.isFinite(d.getTime()) ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : '?'
}

/** A value as a reader sees it: whole numbers stay whole, anything else gets one decimal (no false precision). */
export function fmtValue(v: number): string {
  if (!Number.isFinite(v)) return '?'
  const r = Math.round(v * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

const withUnit = (v: string, unit?: string) => (unit ? `${v} ${unit}` : v)

// ------------------------------------------------------------------------------------------------ Trace

export interface TracePoint {
  t: number
  v: number | null
}

/** A series keeps at most this many points (the latest): about two years of days, bounded memory and DOM. */
export const TRACE_MAX_POINTS = 720
/** The line draws once, on first view, in this long (spec 20.5.2); calm and the OS reduce flag show it drawn. */
export const TRACE_DRAW_MS = 320
/** Behind the last point (a disc) the previous seven are rings: a week of recent history at a glance. */
export const TRACE_RINGS = 7
/** Two neighbours further apart than this many typical steps are a gap too: a missing day is never bridged. */
export const TRACE_GAP_FACTOR = 1.5
/**
 * The plot box inside the screen: 34 px on top for the corner plates (7 px inset, 16 px tall, 11 px air), 54 px on
 * the right for "hi 128" in 11 px mono clear of the 10 px bracket, 22 px on the left so the first date label clears the
 * bracket, 42 px below for the ruler and the date row.
 */
export const TRACE_PAD = { l: 22, r: 54, t: 34, b: 42 } as const
/** Desktop and phone heights of the screen (spec: mobile 100 percent wide, 180 px high). */
export const TRACE_H = 228
export const TRACE_H_PHONE = 180
/** Under this measured width the screen takes its phone height. */
export const TRACE_PHONE_W = 600
/** One ruler character per this many px, and a tick every this many characters: `|····|····|`. */
export const RULER_PX_PER_CHAR = 8
export const RULER_TICK_EVERY = 5

export interface TraceDot {
  i: number
  t: number
  v: number | null
  x: number
  /** null for a gap point: it has a place on the time axis but no height. */
  y: number | null
}

export interface TraceGeom {
  w: number
  h: number
  plot: { x0: number; x1: number; y0: number; y1: number }
  dots: TraceDot[]
  /** One path per run of measured points; a gap ends a run and the next run starts fresh (never interpolated). */
  paths: string[]
  /** The halftone ground under each run of two or more points, closed on the base; it stops where the line stops. */
  areas: string[]
  /** Hatched bands where there is no data, merged and clipped to the plot. */
  gaps: { x0: number; x1: number }[]
  /** Index of the last measured point (the disc), or null when there is none. */
  last: number | null
  /** Indexes of up to seven measured points before the last (the rings). */
  rings: number[]
  medianY: number | null
  lo: number
  hi: number
  /** The measured minimum and maximum (the labels), null when nothing was measured. */
  min: number | null
  max: number | null
}

/** The latest TRACE_MAX_POINTS points, sorted by time, with anything that is not a finite time dropped. */
export function cleanPoints(points: readonly TracePoint[]): TracePoint[] {
  const ok = points.filter((p) => p && Number.isFinite(p.t)).map((p) => ({ t: p.t, v: typeof p.v === 'number' && Number.isFinite(p.v) ? p.v : null }))
  ok.sort((a, b) => a.t - b.t)
  return ok.length > TRACE_MAX_POINTS ? ok.slice(-TRACE_MAX_POINTS) : ok
}

/** The median of the positive steps between neighbours (the series' own cadence), 0 when there is none. */
export function typicalStep(ts: readonly number[]): number {
  const steps: number[] = []
  for (let i = 1; i < ts.length; i++) if (ts[i] > ts[i - 1]) steps.push(ts[i] - ts[i - 1])
  if (!steps.length) return 0
  steps.sort((a, b) => a - b)
  return steps[Math.floor((steps.length - 1) / 2)]
}

const r1 = (n: number) => Math.round(n * 10) / 10

export function traceLayout(input: readonly TracePoint[], box: { w: number; h: number }, median?: number): TraceGeom {
  const pts = cleanPoints(input)
  const w = Math.max(120, box.w)
  const h = Math.max(96, box.h)
  const plot = { x0: TRACE_PAD.l, x1: w - TRACE_PAD.r, y0: TRACE_PAD.t, y1: h - TRACE_PAD.b }
  const vals = pts.flatMap((p) => (p.v === null ? [] : [p.v]))
  const med = typeof median === 'number' && Number.isFinite(median) ? median : null
  const min = vals.length ? Math.min(...vals) : null
  const max = vals.length ? Math.max(...vals) : null
  let lo = Math.min(min ?? 0, med ?? min ?? 0)
  let hi = Math.max(max ?? 1, med ?? max ?? 1)
  if (hi - lo < 1e-9) { lo -= 1; hi += 1 }
  const padV = (hi - lo) * 0.12
  lo -= padV
  hi += padV
  const t0 = pts.length ? pts[0].t : 0
  const t1 = pts.length ? pts[pts.length - 1].t : 1
  const xOf = (t: number) => (t1 === t0 ? (plot.x0 + plot.x1) / 2 : plot.x0 + ((t - t0) / (t1 - t0)) * (plot.x1 - plot.x0))
  const yOf = (v: number) => plot.y1 - ((v - lo) / (hi - lo)) * (plot.y1 - plot.y0)
  const dots: TraceDot[] = pts.map((p, i) => ({ i, t: p.t, v: p.v, x: r1(xOf(p.t)), y: p.v === null ? null : r1(yOf(p.v)) }))

  const step = typicalStep(pts.map((p) => p.t))
  const paths: string[] = []
  const areas: string[] = []
  const rawGaps: { x0: number; x1: number }[] = []
  let run: TraceDot[] = []
  const flush = () => {
    if (run.length) {
      const line = run.map((d, k) => `${k ? 'L' : 'M'}${d.x} ${d.y}`).join('')
      paths.push(line)
      if (run.length > 1) areas.push(`M${run[0].x} ${plot.y1}${line.replace(/^M/, 'L')}L${run[run.length - 1].x} ${plot.y1}Z`)
    }
    run = []
  }
  let prevValid: TraceDot | null = null
  let gapOpen: number | null = null // x where an open gap (a run of nulls) started
  for (const d of dots) {
    if (d.y === null) {
      if (gapOpen === null) gapOpen = prevValid ? prevValid.x : plot.x0
      flush()
      continue
    }
    if (gapOpen !== null) {
      rawGaps.push({ x0: gapOpen, x1: d.x })
      gapOpen = null
    } else if (prevValid && step > 0 && d.t - prevValid.t > TRACE_GAP_FACTOR * step) {
      // a missing day with no row at all: the same hatch, the line breaks
      flush()
      rawGaps.push({ x0: prevValid.x, x1: d.x })
    }
    run.push(d)
    prevValid = d
  }
  if (gapOpen !== null) rawGaps.push({ x0: gapOpen, x1: plot.x1 })
  flush()

  const gaps: { x0: number; x1: number }[] = []
  for (const g of rawGaps.map((g) => ({ x0: Math.max(plot.x0, g.x0), x1: Math.min(plot.x1, g.x1) })).sort((a, b) => a.x0 - b.x0)) {
    const prev = gaps[gaps.length - 1]
    if (prev && g.x0 <= prev.x1) prev.x1 = Math.max(prev.x1, g.x1)
    else if (g.x1 > g.x0) gaps.push({ ...g })
  }

  const measured = dots.filter((d) => d.y !== null)
  const last = measured.length ? measured[measured.length - 1].i : null
  const rings = measured.slice(-1 - TRACE_RINGS, -1).map((d) => d.i)
  return { w, h, plot, dots, paths, areas, gaps, last, rings, medianY: med === null ? null : r1(yOf(med)), lo, hi, min, max }
}

/** The measured point nearest to x (a scrub never lands on a gap), or null when nothing was measured. */
export function nearestIndex(g: TraceGeom, x: number): number | null {
  let best: number | null = null
  let bd = Infinity
  for (const d of g.dots) {
    if (d.y === null) continue
    const dd = Math.abs(d.x - x)
    if (dd < bd) { bd = dd; best = d.i }
  }
  return best
}

/** The next measured index from `from` in direction `dir` (by `by` measured points), clamped to the ends. */
export function stepIndex(g: TraceGeom, from: number | null, dir: 1 | -1, by = 1): number | null {
  const ids = g.dots.filter((d) => d.y !== null).map((d) => d.i)
  if (!ids.length) return null
  if (from === null) return dir > 0 ? ids[0] : ids[ids.length - 1]
  let k = ids.indexOf(from)
  if (k < 0) k = dir > 0 ? -1 : ids.length
  return ids[Math.max(0, Math.min(ids.length - 1, k + dir * by))]
}

/** The ASCII ruler `|····|····|`: one character per slot, a tick every `every`, and always one at the end. */
export function rulerText(cols: number, every = RULER_TICK_EVERY): string {
  const n = Math.max(2, Math.min(240, Math.floor(cols)))
  const e = Math.max(2, Math.floor(every))
  let s = ''
  for (let i = 0; i < n; i++) s += i % e === 0 || i === n - 1 ? '|' : '·'
  return s
}

/** "+4 min from 10 Nov to 13 Nov": the two-point difference of a pinned scrub, signed, in the series' unit. */
export function diffText(a: { t: number; v: number }, b: { t: number; v: number }, unit?: string): string {
  const [p, q] = a.t <= b.t ? [a, b] : [b, a]
  const d = q.v - p.v
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±'
  return `${sign}${withUnit(fmtValue(Math.abs(d)), unit)} from ${fmtDay(p.t)} to ${fmtDay(q.t)}`
}

// ------------------------------------------------------------------------------------------------ DotHistogram

/** At most this many dots are drawn; past it one dot stands for several observations and the multiplier is written. */
export const HIST_MAX_DOTS = 200
/** A histogram reads at most this many values (the latest): bounded memory for a long log. */
export const HIST_MAX_VALUES = 10_000
export const HIST_DEFAULT_BINS = 8
/** The multipliers a dot may stand for, so the legend reads "one dot = 5", never "one dot = 3.7". */
const DOT_UNITS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000] as const

/** A step of 1, 2, 2.5 or 5 times a power of ten (1, 2 or 5 for whole-number data) at or above `raw`. */
export function niceStep(raw: number, integer = false): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const steps = integer && p < 10 ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10]
  for (const s of steps) if (s * p >= raw - 1e-12) return integer ? Math.max(1, Math.round(s * p)) : s * p
  return 10 * p
}

/** The q-th quantile of sorted values, linear between ranks (the usual "type 7"); NaN for an empty list. */
export function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return NaN
  const pos = (sorted.length - 1) * Math.max(0, Math.min(1, q))
  const a = Math.floor(pos)
  const b = Math.min(sorted.length - 1, a + 1)
  return sorted[a] + (sorted[b] - sorted[a]) * (pos - a)
}

export interface Bins {
  /** How many finite values were read, and how many inputs were not numbers (said, never hidden). */
  n: number
  dropped: number
  integer: boolean
  lo: number
  width: number
  counts: number[]
  /** [from, to) of each bin. */
  edges: [number, number][]
  q1: number
  median: number
  q3: number
}

export function binValues(values: readonly number[], bins = HIST_DEFAULT_BINS): Bins {
  const src = values.length > HIST_MAX_VALUES ? values.slice(-HIST_MAX_VALUES) : values
  const vs = src.filter((v) => typeof v === 'number' && Number.isFinite(v))
  const dropped = src.length - vs.length
  const sorted = [...vs].sort((a, b) => a - b)
  const integer = vs.every((v) => Number.isInteger(v))
  const k = Math.max(1, Math.min(40, Math.round(bins)))
  if (!vs.length) return { n: 0, dropped, integer, lo: 0, width: 1, counts: Array(k).fill(0), edges: Array.from({ length: k }, (_, i) => [i, i + 1] as [number, number]), q1: NaN, median: NaN, q3: NaN }
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  const width = niceStep((max - min) / k || 1, integer)
  const lo = Math.floor(min / width) * width
  // as many bins as the nice step needs to reach max (it can be one fewer or more than asked), never more than 40
  const count = Math.max(1, Math.min(40, Math.floor((max - lo) / width) + 1))
  const counts = Array(count).fill(0)
  for (const v of vs) counts[Math.min(count - 1, Math.floor((v - lo) / width + 1e-9))]++
  const edges = counts.map((_, i) => [lo + i * width, lo + (i + 1) * width] as [number, number])
  return { n: vs.length, dropped, integer, lo, width, counts, edges, q1: quantile(sorted, 0.25), median: quantile(sorted, 0.5), q3: quantile(sorted, 0.75) }
}

/** "20 to 29" for whole-number bins (both ends included), "2.5 to 5" otherwise (the upper end excluded). */
export function binLabel(edge: readonly [number, number], integer: boolean, unit?: string): string {
  const [a, b] = edge
  return withUnit(integer ? `${fmtValue(a)} to ${fmtValue(b - 1)}` : `${fmtValue(a)} to ${fmtValue(b)}`, unit)
}

/** The observations one dot stands for: the caller's choice when it keeps the drawing under 200 dots, else the next nice multiplier that does. */
export function dotUnit(n: number, asked?: number): number {
  const want = typeof asked === 'number' && Number.isFinite(asked) && asked >= 1 ? Math.round(asked) : 1
  if (Math.ceil(n / want) <= HIST_MAX_DOTS) return want
  for (const u of DOT_UNITS) if (u >= want && Math.ceil(n / u) <= HIST_MAX_DOTS) return u
  return Math.ceil(n / HIST_MAX_DOTS)
}

/** Per bin: whole dots, and whether one more dot is a part (drawn as a ring, never rounded up into a whole). */
export function dotStacks(counts: readonly number[], unit: number): { full: number; part: boolean }[] {
  return counts.map((c) => ({ full: Math.floor(c / unit), part: c % unit !== 0 }))
}

/** "6 blocks, 20 to 29 min": the callout and the accessible value of a bin. */
export function binText(count: number, edge: readonly [number, number], integer: boolean, noun: string, unit?: string): string {
  return `${count} ${count === 1 ? singular(noun) : noun}, ${binLabel(edge, integer, unit)}`
}

function singular(noun: string): string {
  if (noun.endsWith('ies')) return `${noun.slice(0, -3)}y`
  if (noun.endsWith('s') && !noun.endsWith('ss')) return noun.slice(0, -1)
  return noun
}

export interface HistGeom {
  w: number
  h: number
  plot: { x0: number; x1: number; y0: number; y1: number }
  /** Dots across a column, the pitch between dot centres, and the dot radius. */
  across: number
  pitch: number
  r: number
  /** Rows of sockets in the tallest column (the lit and the unlit dot grid share it). */
  rows: number
  cols: { i: number; x: number; cx: number; cw: number }[]
  /** Value to x along the base (for the median tick and the middle-half bracket). */
  xOf: (v: number) => number
}

/** 34 px on top for the corner plates (as the Trace), 46 px below for the bin edges and the middle-half bracket. */
export const HIST_PAD = { l: 18, r: 18, t: 34, b: 46 } as const
/** The largest dot pitch (a 12 px pitch gives a 3.8 px dot, the C02-11 LED size at this scale), and the share of the
 * height the tallest column aims for. */
export const HIST_PITCH_MAX = 12
export const HIST_FILL = 0.85
export const HIST_H = 232
export const HIST_H_PHONE = 200

export function histLayout(b: Bins, stacks: readonly { full: number; part: boolean }[], box: { w: number; h: number }): HistGeom {
  const w = Math.max(160, box.w)
  const h = Math.max(120, box.h)
  const plot = { x0: HIST_PAD.l, x1: w - HIST_PAD.r, y0: HIST_PAD.t, y1: h - HIST_PAD.b }
  const nCols = Math.max(1, b.counts.length)
  const cw = (plot.x1 - plot.x0) / nCols
  const tallest = Math.max(1, ...stacks.map((s) => s.full + (s.part ? 1 : 0)))
  const ph = plot.y1 - plot.y0
  // The biggest pitch (HIST_PITCH_MAX down to 4 px) at which the tallest stack fits, with as FEW dots across as that
  // allows, so the tallest column stands at about HIST_FILL of the height: a tower of dots (C02-11), not a low smear
  // under an empty grid. 640 entries at one dot = 5 measured 5 rows in a 21-row grid before this; now 11 of 13.
  let pitch = HIST_PITCH_MAX
  let across = 1
  for (; pitch >= 4; pitch--) {
    const fitRows = Math.max(1, Math.floor(ph / pitch))
    const maxAcross = Math.max(1, Math.floor((cw - 8) / pitch))
    across = Math.min(maxAcross, Math.max(1, Math.ceil(tallest / Math.max(1, Math.floor(fitRows * HIST_FILL)))))
    if (Math.ceil(tallest / across) <= fitRows) break
  }
  pitch = Math.max(4, pitch)
  const rows = Math.max(1, Math.floor(ph / pitch))
  const r = Math.max(1.2, pitch * 0.32)
  const cols = b.counts.map((_, i) => {
    const x = plot.x0 + i * cw
    return { i, x: r1(x), cx: r1(x + cw / 2), cw: r1(cw) }
  })
  const span = b.width * nCols
  const xOf = (v: number) => r1(plot.x0 + ((v - b.lo) / span) * (plot.x1 - plot.x0))
  return { w, h, plot, across, pitch, r: r1(r), rows, cols, xOf }
}

// ------------------------------------------------------------------------------------------------ SkyLedger

export type SkyKind = 'kept' | 'rest' | 'none'
export interface SkyDay {
  /** A local calendar date, YYYY-MM-DD. */
  date: string
  kind: SkyKind
  /** Optional: kept days that share a habit are joined by hairlines into one figure (a pure function of the data). */
  habit?: string
}
export type SkyWindow = 60 | 90
export const SKY_COLS = 10
/** The disc of a newly added day fades in over this long; calm and the OS reduce flag show it at once. */
export const SKY_FADE_MS = 200
/** How far a star may sit from its grid point, as a share of the cell: a sky, but the rows still read in order. */
export const SKY_JITTER = 0.26

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Days since 1970-01-01 of an ISO date, or null when it is not a real date. */
export function dayNumber(iso: string): number | null {
  const m = ISO_RE.exec(iso)
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const d = new Date(t)
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null
  return Math.round(t / 86_400_000)
}

export function isoOfDay(n: number): string {
  const d = new Date(n * 86_400_000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** Today's local date as YYYY-MM-DD; a parameter everywhere else, so a test pins it. */
export function localToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** "13 Nov" of an ISO date (UTC arithmetic, so no time zone can move it). */
export function fmtIso(iso: string): string {
  const n = dayNumber(iso)
  if (n === null) return '?'
  const d = new Date(n * 86_400_000)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

export interface SkySlot {
  i: number
  date: string
  kind: SkyKind
  habit?: string
}

/**
 * The window's slots, oldest first, today last. A date with no row is 'none' and keeps its place; a date given twice
 * takes the later row (the log is append-only, so the later row is the correction). Rows outside the window are ignored.
 */
export function skySlots(days: readonly SkyDay[], window: SkyWindow, today: string): SkySlot[] {
  const end = dayNumber(today)
  const n = window === 90 ? 90 : 60
  if (end === null) return []
  const start = end - n + 1
  const byDay = new Map<number, SkyDay>()
  for (const d of days) {
    const k = d ? dayNumber(d.date) : null
    if (k === null || k < start || k > end) continue
    if (d.kind !== 'kept' && d.kind !== 'rest' && d.kind !== 'none') continue
    byDay.set(k, d)
  }
  return Array.from({ length: n }, (_, i) => {
    const d = byDay.get(start + i)
    return { i, date: isoOfDay(start + i), kind: d?.kind ?? 'none', ...(d?.habit ? { habit: d.habit } : {}) }
  })
}

export function skyCounts(slots: readonly SkySlot[]): { kept: number; rest: number; none: number; window: number } {
  let kept = 0, rest = 0
  for (const s of slots) if (s.kind === 'kept') kept++; else if (s.kind === 'rest') rest++
  return { kept, rest, none: slots.length - kept - rest, window: slots.length }
}

/** The headline: a ratio over the whole window, so one day moves it by one sixtieth and it changes slowly. */
export const skyHeadline = (c: { kept: number; window: number }): string => `${c.kept} of the last ${c.window} days kept`

/** The fixed star positions of a window inside a w x h box: a 10-column grid with a seeded jitter that never changes. */
export function skyPositions(window: SkyWindow, w: number, h: number): { x: number; y: number }[] {
  const n = window === 90 ? 90 : 60
  const rows = n / SKY_COLS
  const cw = w / SKY_COLS
  const rh = h / rows
  const rnd = mulberry32(fnv1a32(`sky-ledger-${n}`))
  return Array.from({ length: n }, (_, i) => {
    const c = i % SKY_COLS
    const r = Math.floor(i / SKY_COLS)
    const jx = (rnd() * 2 - 1) * SKY_JITTER * cw
    const jy = (rnd() * 2 - 1) * SKY_JITTER * rh
    return { x: r1(cw * (c + 0.5) + jx), y: r1(rh * (r + 0.5) + jy) }
  })
}

/**
 * The figures: for each habit, the kept days that carry it joined by a minimum spanning tree over their star
 * positions (Prim's, a tie goes to the lower slot). Joined by nearness on the sky, not by order in time, so a figure never
 * reads as a run of consecutive days. Only the latest 12 stars per habit take part, and an edge longer than `maxEdge`
 * is left out, so a habit draws small figures (a forest) instead of a web across the whole sky: with no limit the
 * 90-day fixture drew 33 lines, many of them crossing the field; at 1.6 cells it draws short clusters.
 */
export const SKY_MAX_FIGURE = 12
/** The longest figure line, in cells (the larger of the cell width and the row height). */
export const SKY_FIGURE_REACH = 1.6
export function constellation(slots: readonly SkySlot[], pos: readonly { x: number; y: number }[], maxEdge = Infinity): { a: number; b: number; habit: string }[] {
  const groups = new Map<string, number[]>()
  for (const s of slots) {
    if (s.kind !== 'kept' || !s.habit) continue
    const g = groups.get(s.habit) ?? []
    g.push(s.i)
    if (g.length > SKY_MAX_FIGURE) g.shift()
    groups.set(s.habit, g)
  }
  const out: { a: number; b: number; habit: string }[] = []
  for (const habit of [...groups.keys()].sort()) {
    const ids = groups.get(habit)!
    if (ids.length < 2) continue
    // Prim's tree over all the habit's stars; the over-long edges are then dropped, which leaves the forest
    const inTree = new Set<number>([ids[0]])
    while (inTree.size < ids.length) {
      let best: { a: number; b: number; d: number } | null = null
      for (const a of inTree) {
        for (const b of ids) {
          if (inTree.has(b)) continue
          const d = Math.hypot(pos[a].x - pos[b].x, pos[a].y - pos[b].y)
          if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && b < best.b)) best = { a, b, d }
        }
      }
      if (!best) break
      inTree.add(best.b)
      if (best.d <= maxEdge) out.push({ a: Math.min(best.a, best.b), b: Math.max(best.a, best.b), habit })
    }
  }
  return out
}

/** A crescent (the rest day) of radius r at (x, y): an outer arc and a shallower inner arc, lit side on the left. */
export function crescentPath(x: number, y: number, r: number): string {
  const top = `${r1(x)} ${r1(y - r)}`
  const bot = `${r1(x)} ${r1(y + r)}`
  return `M${top}A${r} ${r} 0 0 0 ${bot}A${r1(r * 0.62)} ${r} 0 0 1 ${top}Z`
}
