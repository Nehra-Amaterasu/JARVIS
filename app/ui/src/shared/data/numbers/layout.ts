// Pure layout for the four number forms of package D01 (spec 20.5.2): the pixel numerals of the Odometer, the rail
// positions of the Dumbbell, the text lines and torn edge of the LedgerTape, the fill geometry of the Jar. Nothing here
// touches the DOM, so every number that decides how a form looks is a named constant with a unit test beside it.
import { fnv1a32, mulberry32 } from '../../grammar'

// ---------------------------------------------------------------------------------------------- pixel numerals

/** The digit shape is the pixel numeral of the owner's references (C01-05 and C02-34): a 5 x 7 grid of square pixels. */
export const GLYPH_COLS = 5
export const GLYPH_ROWS = 7
/** One pixel is 8 units, so a glyph is 40 x 56 units (the 40 x 56 of the spec) inside a 50 x 70 slot. */
export const PX = 8
export const SLOT_W = 50
export const SLOT_H = 70

const GLYPHS: readonly (readonly string[])[] = [
  ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
]
const DASH: readonly string[] = ['00000', '00000', '00000', '11111', '00000', '00000', '00000']

/** One path for a glyph: horizontal runs of lit pixels are merged, so a digit is at most 7 sub-paths, not 35 rects. */
export function glyphPath(rows: readonly string[], ox: number, oy: number, px: number = PX): string {
  let d = ''
  rows.forEach((row, r) => {
    let c = 0
    while (c < row.length) {
      if (row[c] !== '1') { c++; continue }
      let e = c
      while (e < row.length && row[e] === '1') e++
      d += `M${ox + c * px} ${oy + r * px}h${(e - c) * px}v${px}h${-(e - c) * px}z`
      c = e
    }
  })
  return d
}

const gx = (SLOT_W - GLYPH_COLS * PX) / 2
const gy = (SLOT_H - GLYPH_ROWS * PX) / 2

/** The drum of one wheel: the ten digits stacked, 0 on top. Computed once; every wheel draws the same path. */
export const STRIP_PATH: string = GLYPHS.map((g, i) => glyphPath(g, gx, i * SLOT_H + gy)).join('')
export const STRIP_HEIGHT = SLOT_H * 10
/** The dash a hollow well draws, one slot high. */
export const DASH_PATH: string = glyphPath(DASH, gx, gy)

export const MIN_CELLS = 4
export const MAX_CELLS = 7
/** A change rolls over 140 ms in three intermediate steps (spec 20.5.2): 4 jumps of the timing function make 3 stops between. */
export const ROLL_MS = 140
export const ROLL_STEPS = 4
export const HERO_H = 72
export const COMPACT_H = 28

/** How many wells a value needs: at least 4, at most 7 (a counter never grows past the rack it sits in). */
export function cellCount(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value) || value < 0) return MIN_CELLS
  const n = String(Math.round(value)).length
  return Math.min(MAX_CELLS, Math.max(MIN_CELLS, n))
}

/** The digits of a value, most significant first, padded with leading zeros to `cells`. Null when it cannot be drawn. A value past the rack reads as all nines. */
export function digitsOf(value: number | null | undefined, cells: number): number[] | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null
  const cap = 10 ** cells - 1
  const v = Math.min(cap, Math.round(value))
  return String(v).padStart(cells, '0').split('').map(Number)
}

/** True when the value does not fit the rack and the wells show the cap instead of the real figure. */
export const overflows = (value: number | null | undefined, cells: number): boolean => value != null && Number.isFinite(value) && Math.round(value) > 10 ** cells - 1

/** How many leading digits are padding zeros (drawn dim): all but the last digit, at most. */
export function leadingZeros(digits: readonly number[]): number {
  let n = 0
  while (n < digits.length - 1 && digits[n] === 0) n++
  return n
}

/** Whole-number text with comma grouping, the same everywhere. */
export function groupDigits(n: number): string {
  const s = String(Math.round(Math.abs(n)))
  return (n < 0 ? '-' : '') + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** The ASCII delta beside an Odometer: "+3 since 09:00", "-2 since 09:00", "no change since 09:00". */
export function deltaText(delta: number, since: string): string {
  if (!Number.isFinite(delta)) return ''
  const d = Math.round(delta)
  return d === 0 ? `no change since ${since}` : `${d > 0 ? '+' : '-'}${groupDigits(Math.abs(d))} since ${since}`
}

// ---------------------------------------------------------------------------------------------- dumbbell

export interface DumbbellRow { label: string; before: number; after: number }
export interface DumbbellPlaced extends DumbbellRow {
  /** after minus before, the number the rail prints. */
  gap: number
  /** 0 to 100, the position on the shared ruler; a value outside the scale sits on the nearest end. */
  beforePct: number
  afterPct: number
  beforeOff: boolean
  afterOff: boolean
  /** Left end and width of the 1 px bar, in percent. */
  barLeft: number
  barWidth: number
}

/** Where a value sits on a [lo, hi] ruler, in percent, and whether it had to be held at an end. */
export function placeOn(v: number, scale: readonly [number, number]): { pct: number; off: boolean } {
  const [lo, hi] = scale
  const span = hi - lo
  if (!(span > 0) || !Number.isFinite(v)) return { pct: 0, off: true }
  const raw = ((v - lo) / span) * 100
  return { pct: Math.max(0, Math.min(100, raw)), off: raw < 0 || raw > 100 }
}

/** Rows on one shared ruler, sorted by the size of the gap (largest first, ties keep their given order). Rows with a non-finite value are dropped. */
export function dumbbellLayout(rows: readonly DumbbellRow[], scale: readonly [number, number]): DumbbellPlaced[] {
  const placed = rows
    .filter((r) => Number.isFinite(r.before) && Number.isFinite(r.after))
    .map((r, i) => {
      const b = placeOn(r.before, scale)
      const a = placeOn(r.after, scale)
      const barLeft = Math.min(b.pct, a.pct)
      const p: DumbbellPlaced = { ...r, gap: r.after - r.before, beforePct: b.pct, afterPct: a.pct, beforeOff: b.off, afterOff: a.off, barLeft, barWidth: Math.abs(a.pct - b.pct) }
      return { i, p }
    })
  return placed.sort((x, y) => Math.abs(y.p.gap) - Math.abs(x.p.gap) || x.i - y.i).map((x) => x.p)
}

/** Equal-spaced ruler values across the scale; `count` ticks including both ends. */
export function rulerValues(scale: readonly [number, number], count = 5): number[] {
  const n = Math.max(2, Math.floor(count))
  return Array.from({ length: n }, (_, i) => scale[0] + ((scale[1] - scale[0]) * i) / (n - 1))
}

/** A number as short text: integers whole, others to one decimal. */
export const fmt = (n: number): string => (Number.isInteger(n) ? groupDigits(n) : (Math.round(n * 10) / 10).toFixed(1))

/** The signed difference a rail prints: "+12", "-4", "0". */
export const gapText = (gap: number): string => (gap === 0 ? '0' : `${gap > 0 ? '+' : '-'}${fmt(Math.abs(gap))}`)

// ---------------------------------------------------------------------------------------------- ledger tape

/** A line of the tape is this many mono characters wide; at 13 px that is about 250 px inside a 320 px strip. */
export const TAPE_COLS = 32
export const TAPE_WIDTH = 320
/** The most lines drawn; older ones are counted in one line of text, so a long day cannot grow the DOM without bound. */
export const TAPE_MAX_LINES = 60
export const TEARS = 22
export const TEAR_DEPTH = 12
export const LEADER = '·'

/** `chai ········· 120`: the label, dotted leaders as text, the amount. A long label is cut with an ellipsis and keeps 2 leader dots. */
export function tapeLine(label: string, amount: string, cols: number = TAPE_COLS): string {
  const room = cols - amount.length - 4
  let l = label.trim()
  if (l.length > room) l = room > 1 ? `${l.slice(0, room - 1)}…` : l.slice(0, Math.max(0, room))
  const dots = Math.max(2, cols - l.length - amount.length - 2)
  return `${l} ${LEADER.repeat(dots)} ${amount}`
}

export interface TapeEntry { label: string; amount: number }

/** The newest lines up to the cap, and how many older ones are folded into the count. */
export function tapeWindow<T>(entries: readonly T[], max: number = TAPE_MAX_LINES): { shown: T[]; hidden: number } {
  if (entries.length <= max) return { shown: [...entries], hidden: 0 }
  return { shown: entries.slice(entries.length - max), hidden: entries.length - max }
}

/** The sum of the amounts that are finite. */
export const tapeSum = (entries: readonly TapeEntry[]): number => entries.reduce((s, e) => s + (Number.isFinite(e.amount) ? e.amount : 0), 0)

/** The torn edge as a polyline: a zigzag whose tooth depths come from the seed, so the same tape always tears the same way. */
export function tornEdge(seed: string, width: number = TAPE_WIDTH, teeth: number = TEARS, depth: number = TEAR_DEPTH): string {
  const rnd = mulberry32(fnv1a32(seed))
  const step = width / teeth
  let d = ''
  for (let i = 0; i <= teeth; i++) {
    const x = Math.round(i * step * 10) / 10
    const y = i % 2 === 0 ? 1 + rnd() * (depth * 0.3) : depth * 0.55 + rnd() * (depth * 0.4)
    d += `${i === 0 ? 'M' : 'L'}${x} ${Math.round(y * 10) / 10}`
  }
  return d
}

/** The paper that hangs below the last line: the torn edge closed along the top. */
export const tornPath = (seed: string, width: number = TAPE_WIDTH, teeth: number = TEARS, depth: number = TEAR_DEPTH): string => `${tornEdge(seed, width, teeth, depth)}L${width} 0L0 0Z`

// ---------------------------------------------------------------------------------------------- jar

/** Where the planned notch sits up the well (share of its height); a jar past plan has the room above it to fill past. */
export const NOTCH_AT = 0.72

export interface JarGeometry {
  mode: 'empty' | 'under' | 'over'
  /** 0 to 1 of the well's height. */
  fill: number
  /** The notch height 0 to 1, or null when no plan was given. */
  notch: number | null
  /** The amount past the plan (0 when not over) and the amount left. */
  over: number
  left: number
}

/**
 * With a plan, `level` and `plan` are in the same unit (rupees spent against rupees planned) and the fill reaches the
 * notch exactly when level = plan. Without one, `level` is a share 0 to 1 of the well. Never throws on bad input: a
 * non-finite or negative level is an empty jar.
 */
export function jarGeometry(level: number, plan?: number): JarGeometry {
  const lv = Number.isFinite(level) && level > 0 ? level : 0
  const hasPlan = plan !== undefined && Number.isFinite(plan) && plan > 0
  if (!hasPlan) return { mode: lv <= 0 ? 'empty' : 'under', fill: Math.min(1, lv), notch: null, over: 0, left: 0 }
  const p = plan as number
  const fill = Math.min(1, (lv / p) * NOTCH_AT)
  const over = Math.max(0, lv - p)
  return { mode: lv <= 0 ? 'empty' : over > 0 ? 'over' : 'under', fill, notch: NOTCH_AT, over, left: Math.max(0, p - lv) }
}

/** The one text line under a jar: "80 left", "120 over", "nothing in it yet". No other wording, no scolding. */
export function jarLine(g: JarGeometry, unit = ''): string {
  const u = unit ? ` ${unit}` : ''
  if (g.mode === 'empty') return 'nothing in it yet'
  if (g.mode === 'over') return `${fmt(g.over)}${u} over`
  return g.notch === null ? '' : `${fmt(g.left)}${u} left`
}
