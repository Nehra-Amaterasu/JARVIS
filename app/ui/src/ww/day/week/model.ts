// The pure side of the Week view (package L03): the week's dates, the timetable's free slots, the attendance margin arithmetic and
// the move of a planned block. No React, no clock, no fetch, so every rule below is tested on invented rows.
import { addDays, parseYmd } from '../../../shared/almanac'
import type { Kind } from '../../../shared/almanac'
import type { LampState } from '../../../shared/lamp'
import { MIN_SAMPLE } from '../../life/derive'
import type { PlanStatus } from '../ports'

// ------------------------------------------------------------------------------------------------ dates

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
/** 0 = Monday ... 6 = Sunday. */
export const weekdayIndex = (date: string): number => (parseYmd(date).getDay() + 6) % 7

/** The Monday of the week that holds `date`. */
export const weekStart = (date: string): string => addDays(date, -weekdayIndex(date))
export const weekDates = (start: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(start, i))
export const dayName = (date: string): string => WEEKDAY_SHORT[weekdayIndex(date)]
export const dayNum = (date: string): number => Number(date.slice(8, 10))

/** "16 to 22 Nov" (one month) or "28 Nov to 4 Dec" (across a month end). */
export function weekLabel(start: string): string {
  const end = addDays(start, 6)
  const m = (d: string) => parseYmd(d).toLocaleString('en-GB', { month: 'short' })
  return start.slice(5, 7) === end.slice(5, 7) ? `${dayNum(start)} to ${dayNum(end)} ${m(end)}` : `${dayNum(start)} ${m(start)} to ${dayNum(end)} ${m(end)}`
}

// ------------------------------------------------------------------------------------------------ blocks

/** One block drawn in a day column. A planned one is hollow, a done one solid; a carried one is a planned outline moved on. */
export interface WeekBlock {
  id: string
  date: string
  time: string | null
  kind: Kind
  text: string
  status: PlanStatus
  /** The lamp of the source it was read from. */
  state: LampState
  /** Minutes when the source says so (a study log); drawn only beside a LIVE or SIMULATED lamp. */
  minutes?: number
  /** Only a planned block that came through the port can be moved: the port knows its id. */
  movable: boolean
}

const hhmm = (t: string | null): number => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : 24 * 60
}

/** Time order, then planned before done at the same time, then the text (so the order never depends on the order of arrival). */
export const sortBlocks = (a: WeekBlock, b: WeekBlock): number =>
  hhmm(a.time) - hhmm(b.time) || (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0) || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0)

/** Planned minutes of a day: the sum of the planned blocks that carry minutes, or null when none does (so "planned" is never a guess). */
export function plannedMinutes(blocks: readonly WeekBlock[]): number | null {
  const m = blocks.filter((b) => b.status === 'planned' && typeof b.minutes === 'number' && b.minutes > 0)
  return m.length ? m.reduce((s, b) => s + (b.minutes ?? 0), 0) : null
}

/** "1 h 10 m", "45 m", "2 h". */
export function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h && m ? `${h} h ${m} m` : h ? `${h} h` : `${m} m`
}

// ------------------------------------------------------------------------------------------------ the move (the `m` key)

/** The day a planned block would land on after an arrow: one step left or right, held inside the week. */
export function moveTarget(dates: readonly string[], to: string, dir: -1 | 1): string {
  const i = dates.indexOf(to)
  if (i < 0) return to
  return dates[Math.max(0, Math.min(dates.length - 1, i + dir))]
}

// ------------------------------------------------------------------------------------------------ the timetable rack

export interface RackClass { id: string; start: string; end: string | null; name: string; room?: string | null; status: 'present' | 'absent' | 'cancelled' | null }
export type RackItem =
  | { type: 'class'; key: string; cls: RackClass }
  | { type: 'free'; key: string; from: string; to: string; minutes: number }

/** Gaps shorter than this are not offered as a free slot (a corridor walk is not a plate). */
export const MIN_FREE = 20

/** The classes in time order with a free-slot plate wherever two of them leave a gap of at least MIN_FREE minutes. */
export function rackItems(classes: readonly RackClass[]): RackItem[] {
  const sorted = [...classes].sort((a, b) => hhmm(a.start) - hhmm(b.start))
  const out: RackItem[] = []
  sorted.forEach((c, i) => {
    out.push({ type: 'class', key: `c-${c.id}`, cls: c })
    const next = sorted[i + 1]
    if (next && c.end) {
      const gap = hhmm(next.start) - hhmm(c.end)
      if (gap >= MIN_FREE) out.push({ type: 'free', key: `f-${c.id}`, from: c.end, to: next.start, minutes: gap })
    }
  })
  return out
}

// ------------------------------------------------------------------------------------------------ attendance margin

/**
 * Margin in classes: `floor((attended - r x held) / r)`. The number of classes that can still be left out with the share held at r:
 * leaving out m of them makes attended / (held + m) >= r exactly when m <= (attended - r x held) / r. A negative result means below the line.
 * A small epsilon keeps a share that sits exactly on the line (9 of 12 at 75 percent) from rounding down on floating point.
 */
export function marginOf(attended: number, held: number, r: number): number {
  if (!(r > 0)) return 0
  return Math.floor((attended - r * held) / r + 1e-9)
}

/** Classes that must be attended in a row to reach r: the least n with (attended + n) / (held + n) >= r, or 0 at or above the line. */
export function needOf(attended: number, held: number, r: number): number {
  if (!(r > 0) || r >= 1) return 0
  if (held === 0 || attended / held >= r - 1e-12) return 0
  return Math.ceil((r * held - attended) / (1 - r) - 1e-9)
}

export type MarginTone = 'none' | 'few' | 'above' | 'line' | 'below'
export interface MarginRow {
  subject: string
  name: string
  held: number
  attended: number
  last: string | null
}
export interface MarginLine {
  tone: MarginTone
  /** "margin +3", "margin 0", "needs 2 classes to reach 75%". Never a warning. */
  text: string
  /** The arithmetic of this row, shown on focus. */
  formula: string
  /** Of 20 dots, how many are filled (the attended share). */
  dots: number
  /** Where the required line falls among the 20 dots (0 to 20). */
  tick: number
  value: number | null
}

export const METER = 20
const pct = (r: number) => `${Math.round(r * 100)}%`
const plural = (n: number) => `${n} class${n === 1 ? '' : 'es'}`
const num = (x: number) => String(Math.round(x * 100) / 100)

/** What one subject's row says. Margin is local arithmetic; below the line the words say what reaches it, in the same flat tone. */
export function marginLine(r: MarginRow, req: number): MarginLine {
  const tick = Math.round(req * METER)
  if (!r.held) return { tone: 'none', text: 'no class entered yet', formula: 'nothing entered yet, so there is no margin to work out', dots: 0, tick, value: null }
  const dots = Math.round((r.attended / r.held) * METER)
  const base = `margin = floor((attended - r x held) / r) = floor((${r.attended} - ${num(req)} x ${r.held}) / ${num(req)})`
  if (r.held < MIN_SAMPLE) return { tone: 'few', text: `${r.held} entered so far`, formula: `${base}, shown after ${MIN_SAMPLE} classes`, dots, tick, value: null }
  const v = marginOf(r.attended, r.held, req)
  if (v < 0) {
    const n = needOf(r.attended, r.held, req)
    return { tone: 'below', text: `needs ${plural(n)} to reach ${pct(req)}`, formula: `${base} = ${v}, so ${plural(n)} in a row reach ${pct(req)}`, dots, tick, value: v }
  }
  return { tone: v === 0 ? 'line' : 'above', text: `margin ${v > 0 ? '+' : ''}${v}`, formula: `${base} = ${v}`, dots, tick, value: v }
}

/** Least margin first (below the line, then at it), then the rest; a subject with too few classes to judge goes last. Stable. */
export function byMargin(rows: readonly MarginRow[], req: number): MarginRow[] {
  const key = (r: MarginRow) => { const l = marginLine(r, req); return l.value === null ? Number.POSITIVE_INFINITY : l.value }
  return rows.map((r, i) => ({ r, i, k: key(r) })).sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.r)
}

/**
 * How long ago the student last entered a class, in whole days; null when never. The margin ledger is LIVE only when it was entered
 * today (spec 20.5.3): later it says WAITING and how long ago, and draws its figures as hollow forms.
 */
export function daysSince(last: string | null, today: string): number | null {
  if (!last || !/^\d{4}-\d{2}-\d{2}/.test(last)) return null
  return Math.round((parseYmd(today).getTime() - parseYmd(last.slice(0, 10)).getTime()) / 86_400_000)
}

/** How many days after the last entry the ledger still counts as read today. 0 = entered today; a later spec may widen it. */
export const LIVE_DAYS = 0

export interface LedgerReading { state: LampState; reason: string }
/** The lamp of the margin ledger from the rows' last-entered dates. */
export function ledgerReading(rows: readonly MarginRow[], today: string, simulated = false): LedgerReading {
  const ages = rows.map((r) => daysSince(r.last, today)).filter((n): n is number => n !== null)
  if (!ages.length) return { state: 'waiting', reason: 'no class entered yet' }
  const newest = Math.min(...ages)
  // a stale ledger is WAITING whether its rows are real or invented: the lamp says how old the entry is, not who made it
  if (newest > LIVE_DAYS) return { state: 'waiting', reason: `last entered ${newest} day${newest === 1 ? '' : 's'} ago` }
  return simulated ? { state: 'simulated', reason: 'invented rows, not your records' } : { state: 'live', reason: 'entered today' }
}
