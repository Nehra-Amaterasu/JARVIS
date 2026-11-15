// The Almanac's arithmetic, pure and DOM free (package L01): dates, the six-row month grid, what a cell may show, the month
// reading, the year columns and the arrow-key moves. Dates are local calendar dates written YYYY-MM-DD; nothing here reads
// the clock, so every test names its own "today".
import { LAMP_SPECS, showsNumber, type LampState } from '../lamp'
import { KINDS, type CellView, type DayData, type Exam, type Kind, type MarkData } from './types'

export const pad = (n: number): string => String(n).padStart(2, '0')
export const ymd = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
/** A local date at noon, so a daylight-saving step never moves it across midnight. */
export const parseYmd = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1, 12)
}
export const addDays = (s: string, n: number): string => {
  const d = parseYmd(s)
  d.setDate(d.getDate() + n)
  return ymd(d)
}
export const monthOf = (date: string): string => date.slice(0, 7)
export const addMonths = (month: string, n: number): string => {
  const [y, m] = month.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`
}
export const firstOf = (month: string): string => `${month}-01`
export const yearOf = (date: string): number => Number(date.slice(0, 4))

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const
export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export const monthName = (month: string): string => MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? ''
export const monthLabel = (month: string): string => `${monthName(month)} ${month.slice(0, 4)}`
/** Monday is 0 (the grid's first column). */
export const weekdayIndex = (date: string): number => (parseYmd(date).getDay() + 6) % 7
export const shortDate = (date: string): string => `${WEEKDAY_SHORT[weekdayIndex(date)]} ${Number(date.slice(8, 10))} ${monthName(monthOf(date)).slice(0, 3)}`
export const longDate = (date: string): string => {
  const d = parseYmd(date)
  return `${WEEKDAYS[weekdayIndex(date)]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`
}

export interface GridCell {
  date: string
  inMonth: boolean
  col: number
  row: number
}

/** Six rows of seven days, Monday first, starting on the Monday on or before the 1st. */
export function monthGrid(month: string): GridCell[] {
  const first = firstOf(month)
  const start = addDays(first, -weekdayIndex(first))
  return Array.from({ length: 42 }, (_, i) => {
    const date = addDays(start, i)
    return { date, inMonth: monthOf(date) === month, col: i % 7, row: Math.floor(i / 7) }
  })
}

/** One dot per 15 minutes done, at most 12, then a plus. A day with any minutes shows at least one dot. */
export function dotsFor(minutes: number): { dots: number; more: boolean } {
  if (!(minutes > 0)) return { dots: 0, more: false }
  const raw = Math.max(1, Math.floor(minutes / 15))
  return { dots: Math.min(12, raw), more: raw > 12 }
}

// --------------------------------------------------------------------------------------------------- words

const NOUN: Record<Kind, [string, string]> = {
  study: ['study block', 'study blocks'],
  class: ['class', 'classes'],
  body: ['body session', 'body sessions'],
  water: ['water goal', 'water goals'],
  spend: ['spend', 'spends'],
  rest: ['rest day', 'rest days'],
  intent: ['intent due', 'intents due'],
  google: ['Google event', 'Google events'],
  classroom: ['Classroom item', 'Classroom items'],
}
export const nounOf = (kind: Kind, count: number): string => NOUN[kind][count === 1 ? 0 : 1]

const lampWord = (s: LampState): string => LAMP_SPECS[s].label.toLowerCase()

/** The weight of a mark when a cell has room for only one: done before planned, then the order of the kind table. */
export const markWeight = (m: { kind: Kind; done: boolean }): number => (m.done ? 0 : 100) + KINDS.indexOf(m.kind)

/**
 * What one cell may show. A count is drawn only when its own source lamp is LIVE or SIMULATED (20.6.1: a cell never shows a
 * number unless its source is read); a mark of a source that is only PLANNED is drawn hollow with no count, and a source that is
 * WAITING or FAULT draws nothing at all. Marks of a kind the student switched off in the Marks popover are left out.
 */
export function cellView(date: string, day: DayData | undefined, exam: Exam | undefined, kindsOn?: ReadonlySet<Kind>): CellView {
  const merged: MarkData[] = []
  const add = (m: MarkData) => {
    const at = merged.find((x) => x.kind === m.kind && x.done === m.done && x.state === m.state)
    if (at) at.count += m.count
    else merged.push({ ...m })
  }
  for (const m of day?.marks ?? []) if (m.state !== 'waiting' && m.state !== 'fault') add(m)
  if (exam) add({ kind: 'classroom', done: false, count: 1, state: 'planned' })
  const marks = merged
    .filter((m) => !kindsOn || kindsOn.has(m.kind))
    .sort((a, b) => markWeight(a) - markWeight(b))
    .map((m) => ({ kind: m.kind, done: m.done, count: showsNumber(m.state) ? m.count : null, state: m.state }))
  const rest = !!day?.rest && (!kindsOn || kindsOn.has('rest'))
  const live = !!day && showsNumber(day.state) && day.minutes != null
  const strip = live ? dotsFor(day!.minutes!) : null

  const parts: string[] = []
  if (rest) parts.push('rest day')
  for (const m of marks) {
    const noun = m.count == null ? NOUN[m.kind][0] : nounOf(m.kind, m.count)
    parts.push(m.count == null ? `${noun}, ${lampWord(m.state)}` : `${m.count} ${noun}${m.done ? '' : ' planned'}`)
  }
  if (exam) parts.push(`exam: ${exam.label}`)
  let text: string
  if (!day && !exam) text = 'no record read'
  else if (parts.length === 0) text = day && showsNumber(day.state) ? 'nothing logged' : `no figure, ${lampWord(day?.state ?? 'waiting')}`
  else text = parts.join(', ')
  return { date, marks, dots: strip ? strip.dots : null, more: strip ? strip.more : false, rest, text }
}

// ------------------------------------------------------------------------------------------------ the reading

const STATE_ORDER: LampState[] = ['simulated', 'live', 'fault', 'planned', 'waiting']

/** The one lamp of a set of days: SIMULATED first (a page holding any fixture says so), then LIVE, FAULT, PLANNED, WAITING. */
export function pageLamp(days: readonly DayData[], extra: readonly LampState[] = []): LampState {
  const seen = new Set<LampState>(extra)
  for (const d of days) {
    seen.add(d.state)
    for (const m of d.marks) seen.add(m.state)
  }
  return STATE_ORDER.find((s) => seen.has(s)) ?? 'waiting'
}

export interface KindCount {
  kind: Kind
  done: number
  planned: number
}
export interface MonthReading {
  perKind: KindCount[]
  done: number
  planned: number
  /** True when at least one counted mark was read from a LIVE or SIMULATED source (otherwise there is nothing to count). */
  counted: boolean
}

/** Counts by kind for a month (`2026-11`) or a whole year (`2026`): only the marks inside it, only counts a lamp allows, only the kinds switched on. */
export function monthReading(days: readonly DayData[], within: string, kindsOn?: ReadonlySet<Kind>, exams: readonly Exam[] = []): MonthReading {
  const by = new Map<Kind, KindCount>()
  let counted = false
  const bump = (kind: Kind, done: boolean, n: number) => {
    const row = by.get(kind) ?? { kind, done: 0, planned: 0 }
    if (done) row.done += n
    else row.planned += n
    by.set(kind, row)
    counted = true
  }
  for (const d of days) {
    if (!d.date.startsWith(within)) continue
    for (const m of d.marks) if (showsNumber(m.state) && (!kindsOn || kindsOn.has(m.kind))) bump(m.kind, m.done, m.count)
  }
  for (const e of exams) if (e.date.startsWith(within) && (!kindsOn || kindsOn.has('classroom'))) bump('classroom', false, 1)
  const perKind = KINDS.map((k) => by.get(k)).filter((r): r is KindCount => !!r)
  return { perKind, done: perKind.reduce((s, r) => s + r.done, 0), planned: perKind.reduce((s, r) => s + r.planned, 0), counted }
}

/** Put the days of several sources together. The first source wins a day's minutes and rest; marks add up by kind, state and doneness. */
export function mergeDays(...lists: readonly (readonly DayData[] | null | undefined)[]): DayData[] {
  const by = new Map<string, DayData>()
  for (const list of lists) {
    for (const d of list ?? []) {
      const at = by.get(d.date)
      if (!at) {
        by.set(d.date, { ...d, marks: d.marks.map((m) => ({ ...m })) })
        continue
      }
      for (const m of d.marks) {
        const same = at.marks.find((x) => x.kind === m.kind && x.done === m.done && x.state === m.state)
        if (same) same.count += m.count
        else at.marks.push({ ...m })
      }
      if (at.minutes == null && d.minutes != null) {
        at.minutes = d.minutes
        at.state = d.state
      }
      if (d.rest) at.rest = true
    }
  }
  return [...by.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}

// --------------------------------------------------------------------------------------------------- year

export interface YearCell {
  date: string
  inYear: boolean
  week: number
  weekday: number
}

/** Weeks as columns, Monday at the top, from the Monday on or before 1 January to the Sunday on or after 31 December. */
export function yearColumns(year: number): YearCell[][] {
  const jan1 = `${year}-01-01`
  const start = addDays(jan1, -weekdayIndex(jan1))
  const dec31 = `${year}-12-31`
  const end = addDays(dec31, 6 - weekdayIndex(dec31))
  const cols: YearCell[][] = []
  for (let d = start, w = 0; d <= end; d = addDays(d, 7), w++) {
    cols.push(Array.from({ length: 7 }, (_, i) => {
      const date = addDays(d, i)
      return { date, inYear: yearOf(date) === year, week: w, weekday: i }
    }))
  }
  return cols
}

/** Four stipple densities by minutes (0 is an empty well; a day with no figure to show stays 0). */
export function levelOf(day: DayData | undefined): 0 | 1 | 2 | 3 | 4 {
  if (!day || !showsNumber(day.state) || !day.minutes || day.minutes <= 0) return 0
  return day.minutes < 30 ? 1 : day.minutes < 60 ? 2 : day.minutes < 120 ? 3 : 4
}

// --------------------------------------------------------------------------------------------------- keys

/** The date an arrow, Home or End key moves to from `date` (Monday first), or null for any other key. */
export function nextFocus(date: string, key: string): string | null {
  switch (key) {
    case 'ArrowLeft': return addDays(date, -1)
    case 'ArrowRight': return addDays(date, 1)
    case 'ArrowUp': return addDays(date, -7)
    case 'ArrowDown': return addDays(date, 7)
    case 'Home': return addDays(date, -weekdayIndex(date))
    case 'End': return addDays(date, 6 - weekdayIndex(date))
    default: return null
  }
}
