// The pure half of the tables package (wave 6, D03): every number a layout or a key press needs, as a function of its
// inputs, so a unit test can check it without a browser. The components only read these and draw.
// Named constants carry the figures of spec 20.5.2: 32 px rows with a 44 px hit area, dense 28 px, cards under 900 px,
// a 320 px rack of 44 px rows.

export const ROW_PX = 32
export const DENSE_ROW_PX = 28
/** The hit area of every control (--hit). A 32 px row's button reaches into its neighbours by the difference. */
export const HIT_PX = 44
export const HEAD_PX = 44
export const NARROW_PX = 900
export const RACK_W = 320
export const RACK_ROW_PX = 44
export const CARD_FIELDS = 3
/** Typeahead keeps its buffer this long between keys; compared with timestamps, so no timer runs while idle. */
export const TYPEAHEAD_MS = 700
export const SPARK_CHARS = 12
export const METER_DOTS = 10
/** One slot of a SlotList: a 48 px row and a 4 px gap. The CSS reads the same number through --d3-slot-px. */
export const SLOT_PX = 52
export const SEAT_STAGGER_MS = 40
export const SEAT_STAGGER_CAP = 8
export const PAGE_STEP = 5

// ------------------------------------------------------------------------------------------------ columns and rows

export type ColKind = 'text' | 'number' | 'lamp' | 'spark' | 'meter'

export interface Col {
  key: string
  label: string
  kind?: ColKind
  /** F2 (or Enter) on the cell opens an input. Text and number columns only. */
  editable?: boolean
  /** Default true for text, number, meter and lamp; spark columns never sort. */
  sortable?: boolean
  unit?: string
  /** Decimals for a number column; a whole number prints bare when this is not given. */
  digits?: number
  /** A CSS width such as `12ch`; the last column takes the rest. */
  width?: string
  /** The column chooser cannot hide it. */
  pinned?: boolean
}

export type Row = { id: string } & Record<string, unknown>

export type SortDir = 'asc' | 'desc'
export type Sort = { key: string; dir: SortDir } | null

export const kindOf = (c: Col): ColKind => c.kind ?? 'text'
export const isSortable = (c: Col): boolean => (c.sortable ?? true) && kindOf(c) !== 'spark'
export const isEditable = (c: Col): boolean => !!c.editable && (kindOf(c) === 'text' || kindOf(c) === 'number')

/** Click order of a header: ascending, descending, then back to the stored order. */
export function nextSort(cur: Sort, key: string): Sort {
  if (!cur || cur.key !== key) return { key, dir: 'asc' }
  return cur.dir === 'asc' ? { key, dir: 'desc' } : null
}

/** The glyph is text so it survives greyscale and forced colours: ▲ ascending, ▼ descending, a dot when unsorted. */
export function sortGlyph(cur: Sort, key: string): '▲' | '▼' | '·' {
  if (!cur || cur.key !== key) return '·'
  return cur.dir === 'asc' ? '▲' : '▼'
}

export const ariaSort = (cur: Sort, key: string): 'ascending' | 'descending' | 'none' =>
  !cur || cur.key !== key ? 'none' : cur.dir === 'asc' ? 'ascending' : 'descending'

const LAMP_RANK: Record<string, number> = { live: 0, simulated: 1, waiting: 2, planned: 3, fault: 4 }

function sortKey(c: Col, v: unknown): number | string | null {
  if (v == null || v === '') return null
  switch (kindOf(c)) {
    case 'number':
    case 'meter':
      return typeof v === 'number' && Number.isFinite(v) ? v : null
    case 'lamp':
      return LAMP_RANK[String(v)] ?? 9
    default:
      return String(v)
  }
}

/** A stable sort. Empty values go last in either direction, so a half-filled column never hides its filled rows. */
export function sortRows(rows: readonly Row[], cols: readonly Col[], sort: Sort): Row[] {
  if (!sort) return [...rows]
  const col = cols.find((c) => c.key === sort.key)
  if (!col || !isSortable(col)) return [...rows]
  const sign = sort.dir === 'asc' ? 1 : -1
  return rows
    .map((row, i) => ({ row, i, k: sortKey(col, row[col.key]) }))
    .sort((a, b) => {
      if (a.k === null || b.k === null) return a.k === b.k ? a.i - b.i : a.k === null ? 1 : -1
      const d = typeof a.k === 'number' && typeof b.k === 'number' ? a.k - b.k : String(a.k).localeCompare(String(b.k), undefined, { numeric: true, sensitivity: 'base' })
      return d === 0 ? a.i - b.i : d * sign
    })
    .map((x) => x.row)
}

/** The text a number cell prints: a whole number bare, otherwise `digits` decimals; null and non-finite are empty. */
export function formatNumber(v: unknown, digits?: number): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return ''
  if (digits != null) return v.toFixed(digits)
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

/** Parse what a person typed into a number cell: a decimal comma is allowed, anything else non-numeric is refused. */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (t === '' || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

const BARS = '▁▂▃▄▅▆▇█'

/** An ASCII spark of at most `n` characters from the last n values; a flat series is a mid bar, an empty one is empty. */
export function sparkText(values: readonly number[] | undefined, n = SPARK_CHARS): string {
  const v = (values ?? []).filter((x) => Number.isFinite(x)).slice(-n)
  if (v.length === 0) return ''
  const lo = Math.min(...v)
  const hi = Math.max(...v)
  if (hi === lo) return BARS[3].repeat(v.length)
  return v.map((x) => BARS[Math.min(BARS.length - 1, Math.floor(((x - lo) / (hi - lo)) * BARS.length))]).join('')
}

/** How many of `dots` are filled for a 0..1 fraction: rounded, clamped, never more than the row holds. */
export function meterFill(fraction: unknown, dots = METER_DOTS): number {
  if (typeof fraction !== 'number' || !Number.isFinite(fraction)) return 0
  return Math.max(0, Math.min(dots, Math.round(fraction * dots)))
}

/** The columns left after the chooser: pinned columns cannot be hidden, and at least one column always stays. */
export function visibleColumns(cols: readonly Col[], hidden: ReadonlySet<string>): Col[] {
  const shown = cols.filter((c) => c.pinned || !hidden.has(c.key))
  return shown.length > 0 ? shown : cols.slice(0, 1)
}

/** What a card shows: the title column, the lamp column, then the next three plain fields. */
export function cardFields(cols: readonly Col[], max = CARD_FIELDS): { title: Col | null; lamp: Col | null; fields: Col[] } {
  const title = cols.find((c) => kindOf(c) === 'text') ?? null
  const lamp = cols.find((c) => kindOf(c) === 'lamp') ?? null
  const fields = cols.filter((c) => c !== title && c !== lamp).slice(0, max)
  return { title, lamp, fields }
}

// ------------------------------------------------------------------------------------------------ grid focus

/** A cell of the grid. r is -1 for the header row; c is 0 for the row-button gutter, then 1..n for the columns. */
export interface Pos { r: number; c: number }

export function moveFocus(p: Pos, key: string, rowCount: number, colCount: number, ctrl = false): Pos {
  const lastC = colCount
  const lastR = rowCount - 1
  const clampR = (r: number) => Math.max(-1, Math.min(lastR, r))
  const clampC = (c: number) => Math.max(0, Math.min(lastC, c))
  switch (key) {
    case 'ArrowDown': return { r: clampR(p.r + 1), c: p.c }
    case 'ArrowUp': return { r: clampR(p.r - 1), c: p.c }
    case 'ArrowRight': return { r: p.r, c: clampC(p.c + 1) }
    case 'ArrowLeft': return { r: p.r, c: clampC(p.c - 1) }
    case 'Home': return ctrl ? { r: -1, c: 0 } : { r: p.r, c: 0 }
    case 'End': return ctrl ? { r: lastR, c: lastC } : { r: p.r, c: lastC }
    case 'PageDown': return { r: clampR(p.r + PAGE_STEP), c: p.c }
    case 'PageUp': return { r: clampR(p.r - PAGE_STEP), c: p.c }
    default: return p
  }
}

// ------------------------------------------------------------------------------------------------ the select

export interface Opt {
  value: string
  label: string
  /** Group heading; used only when the rack is `grouped`. Options of one group must be adjacent. */
  group?: string
  /** A mono shortcut column, for example `Ctrl+1`. Text only: the rack does not bind it. */
  shortcut?: string
  disabled?: boolean
}

/** The next enabled option from `from` in direction `dir`, stopping at the ends (a rack does not wrap). */
export function stepEnabled(opts: readonly Opt[], from: number, dir: 1 | -1): number {
  for (let i = from + dir; i >= 0 && i < opts.length; i += dir) if (!opts[i].disabled) return i
  return from
}

export const firstEnabled = (opts: readonly Opt[]): number => Math.max(0, opts.findIndex((o) => !o.disabled))
export const lastEnabled = (opts: readonly Opt[]): number => {
  for (let i = opts.length - 1; i >= 0; i--) if (!opts[i].disabled) return i
  return 0
}

/** Move by `n` enabled options (PageUp, PageDown), landing on the last one that exists. */
export function stepBy(opts: readonly Opt[], from: number, n: number): number {
  const dir = n < 0 ? -1 : 1
  let at = from
  for (let k = 0; k < Math.abs(n); k++) at = stepEnabled(opts, at, dir)
  return at
}

/**
 * Typeahead: a buffer of what was typed within TYPEAHEAD_MS. One repeated letter cycles through the options that start
 * with it (as a native list does); a longer buffer finds the first option whose label starts with all of it.
 */
export function typeahead(opts: readonly Opt[], buffer: string, from: number): number {
  if (buffer === '') return from
  const b = buffer.toLowerCase()
  const starts = (o: Opt) => !o.disabled && o.label.toLowerCase().startsWith(b)
  const cycle = b.length > 1 && [...b].every((ch) => ch === b[0])
  if (cycle) {
    const ch = b[0]
    for (let k = 1; k <= opts.length; k++) {
      const i = (from + k) % opts.length
      if (!opts[i].disabled && opts[i].label.toLowerCase().startsWith(ch)) return i
    }
    return from
  }
  const hit = opts.findIndex((o, i) => i >= (b.length === 1 ? from + 1 : 0) && starts(o))
  if (hit >= 0) return hit
  const wrap = opts.findIndex(starts)
  return wrap >= 0 ? wrap : from
}

/** Grow the typeahead buffer: a key after TYPEAHEAD_MS starts a new one. */
export function growBuffer(buffer: string, lastAt: number, now: number, key: string): string {
  return (now - lastAt > TYPEAHEAD_MS ? '' : buffer) + key
}

/** The tree glyph in the left gutter of a grouped rack: `├─` for a group's rows, `└─` for its last. */
export function gutterGlyph(opts: readonly Opt[], i: number, grouped: boolean): '' | '├─' | '└─' {
  const g = opts[i].group
  if (!grouped || !g) return ''
  return opts[i + 1]?.group === g ? '├─' : '└─'
}

/** Runs of adjacent options sharing a group, in order. An option with no group is its own run with a null heading. */
export function groupRuns(opts: readonly Opt[], grouped: boolean): { heading: string | null; from: number; to: number }[] {
  const runs: { heading: string | null; from: number; to: number }[] = []
  opts.forEach((o, i) => {
    const h = grouped ? (o.group ?? null) : null
    const last = runs[runs.length - 1]
    if (last && last.heading === h && h !== null) last.to = i
    else runs.push({ heading: h, from: i, to: i })
  })
  return runs
}

// ------------------------------------------------------------------------------------------------ the slot list

export function reorder<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length) return [...items]
  const t = Math.max(0, Math.min(items.length - 1, to))
  const out = [...items]
  const [x] = out.splice(from, 1)
  out.splice(t, 0, x)
  return out
}

/** The slot a pointer is over: the list's top is `top`, each slot is SLOT_PX tall; clamped to the list. */
export function slotAtY(y: number, top: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.floor((y - top) / SLOT_PX)))
}

/** The Alt+arrow target, or null when the item is already at the end it was pushed towards. */
export function altTarget(from: number, key: string, count: number): number | null {
  const to = key === 'ArrowUp' ? from - 1 : key === 'ArrowDown' ? from + 1 : from
  return to === from || to < 0 || to >= count ? null : to
}

/** The seat-in delay of the nth row: a 40 ms stagger, capped at the eighth row. */
export const seatDelayMs = (i: number): number => Math.min(i, SEAT_STAGGER_CAP - 1) * SEAT_STAGGER_MS

/** The spoken line after a move, 1-based, for the live region. */
export const moveAnnouncement = (label: string, to: number, count: number): string => `${label} moved to position ${to + 1} of ${count}`
