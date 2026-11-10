/**
 * The left column's view-model (plan 4.1, 4.14, 9.0 row 6). ONE pure function turns what the routes
 * returned into the four sections L1 to L4, and both pages draw from its answer: this window (ww/left/*)
 * and the phone (phone_page/ww.js carries a line-for-line copy of `buildLeft`, and left.test.tsx runs
 * both on the same fixture and compares the output, so "same view-model" is checked, not promised).
 *
 * No React, no clock, no fetch. The caller hands over already-normalised raw data; anything the routes
 * did not send arrives as null and comes out as words ("No dated paper ahead."), never as a made-up
 * number. Ids and order are fixed here: L1 Countdown or Horizon, L2 Now or Close the day, L3 Classes,
 * L4 Counters. L5 (the Phone pointer) belongs to the desktop only; the phone page IS the phone.
 *
 * "Next" is decided in exactly one place: `raw.now`, which is step 1 of the director
 * (/api/mission/director). Countdown's "Next: <paper>" is a different thing (the nearest sitting, by
 * date) and is never offered as what to do.
 */

export const LEFT_SECTION_IDS = ['L1', 'L2', 'L3', 'L4'] as const
export type LeftSectionId = (typeof LEFT_SECTION_IDS)[number]

export type ClassStatus = 'present' | 'absent' | 'cancelled'
export const PRESETS = [25, 50, 90] as const

export interface RawPaper {
  id: string
  title: string
  date: string
  start?: string | null
  days_left: number | null
  kind?: string | null
  approx?: boolean
}
export interface RawNow {
  kind: 'study' | 'recall' | 'habit' | 'build'
  title: string
  minutes: number
  why?: string | null
  paper?: string | null
}
export interface RawClass {
  id: string
  start: string
  name: string
  kind?: string | null
  status: ClassStatus | null
}
export interface RawCounter {
  id: string
  name: string
  today: number | null | undefined
}
export interface RawHorizon {
  deadline: { org: string; programme: string; days_left: number | null } | null
  first_step: string | null
  rung: string | null
}
export interface RawDay {
  /** Contracts or blocks done / planned today; null when the plan sent none. */
  done: number | null
  total: number | null
  /** Minutes logged today; null when unknown. */
  logged_minutes: number | null
  /** The first block of tomorrow's plan, as a sentence; null when there is none. */
  tomorrow: string | null
  /** Days away, from the welcome-back field (the only source of the number). */
  idle_days: number | null
  slipped: number
}
export interface RawLeft {
  season: { left_top: 'countdown' | 'horizon'; now_card: 'now' | 'close_the_day' }
  papers: RawPaper[] | null
  now: RawNow | null
  horizon: RawHorizon | null
  day: RawDay | null
  classes: RawClass[] | null
  counters: RawCounter[] | null
}

export interface PaperRow {
  id: string
  title: string
  days_left: number | null
  /** "in 12 d", "today" or "date unknown". */
  when: string
}
export interface L1 {
  id: 'L1'
  variant: 'countdown' | 'horizon'
  title: 'Countdown' | 'Horizon'
  /** The one sentence the card leads with. */
  headline: string
  /** CIE / End / Other counts, countdown only; null when there are no papers to count. */
  counts: { cie: number; end: number; other: number } | null
  /** The next sittings after the first, earliest first; at most three rows. */
  rows: PaperRow[]
  /** How many more dated papers exist than are listed: "+N more", never a silent cut. */
  more: number
  /** At least one listed or counted date is a tentative circular date: ONE line says so. */
  tentative: boolean
  /** Horizon only. */
  step: string | null
  rung: string | null
}
export interface L2 {
  id: 'L2'
  variant: 'now' | 'close'
  title: 'Now' | 'Close the day'
  /** now: the director's step 1 as a sentence; close: what moved today. */
  sentence: string
  /** The server's reason for that step, shown in the Why-this fold. Null hides the fold. */
  why: string | null
  /** Kind of step 1, which decides where Start goes. Null when there is no step. */
  kind: RawNow['kind'] | null
  minutes: number | null
  /** One welcome-back line; its day count is the idle-days field. */
  welcome: string | null
  /** now: "Logged today: 25 min" once something is logged. */
  logged: string | null
  /** "n of N done" meta line. */
  meta: string | null
  /** close: "Not done: kept, not lost." and tomorrow's first block. */
  kept: string | null
  tomorrow: string | null
  presets: readonly number[]
}
export interface L3Row {
  id: string
  when: string
  name: string
  lab: boolean
  status: ClassStatus | null
}
export interface L3 {
  id: 'L3'
  title: 'Classes today'
  rows: L3Row[]
  /** Words when there are no rows. */
  empty: string | null
}
export interface L4Tile {
  id: string
  name: string
  value: number | null
}
export interface L4 {
  id: 'L4'
  title: 'Counters'
  tiles: L4Tile[]
  empty: string | null
}
export interface LeftModel {
  ids: readonly LeftSectionId[]
  l1: L1
  l2: L2
  l3: L3
  l4: L4
}

const has = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
export const hm = (m: number): string => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}` : `${m} min`)
const dayWord = (n: number): string => `${n} ${n === 1 ? 'day' : 'days'}`

/** "in 12 d" / "today" / "date unknown": a missing date is said, never shown as 0. */
export function whenWord(days: number | null | undefined): string {
  if (!has(days)) return 'date unknown'
  return days <= 0 ? 'today' : `in ${days} d`
}

/** The three buckets of the Countdown line. Backlog papers are end-semester sittings. */
export function bucketOf(kind: string | null | undefined): 'cie' | 'end' | 'other' {
  if (kind === 'cie') return 'cie'
  if (kind === 'end_sem' || kind === 'backlog') return 'end'
  return 'other'
}

/** Upcoming (today or later) papers, the earlier sitting first; the same date orders by start time. */
export function upcoming(papers: RawPaper[] | null | undefined): RawPaper[] {
  return (papers ?? [])
    .filter((p) => has(p.days_left) && p.days_left >= 0)
    .slice()
    .sort((a, b) => (a.date === b.date ? (a.start ?? '').localeCompare(b.start ?? '') : a.date < b.date ? -1 : 1))
}

const MAX_ROWS = 3

export function buildL1(raw: Pick<RawLeft, 'season' | 'papers' | 'horizon'>): L1 {
  const variant = raw.season.left_top
  if (variant === 'horizon') {
    const h = raw.horizon
    const d = h?.deadline ?? null
    const headline = d
      ? `${d.org}${d.programme ? ` ${d.programme}` : ''} ${has(d.days_left) ? `in ${d.days_left} d` : 'date unknown'}`
      : h
        ? 'No application date ahead.'
        : 'Nothing read yet for the horizon.'
    return { id: 'L1', variant, title: 'Horizon', headline, counts: null, rows: [], more: 0, tentative: false, step: h?.first_step ?? null, rung: h?.rung ?? null }
  }
  const ahead = upcoming(raw.papers)
  const first = ahead[0]
  const rest = ahead.slice(1)
  const counts = ahead.length ? ahead.reduce((c, p) => ({ ...c, [bucketOf(p.kind)]: c[bucketOf(p.kind)] + 1 }), { cie: 0, end: 0, other: 0 }) : null
  return {
    id: 'L1',
    variant,
    title: 'Countdown',
    headline: first ? `Next: ${first.title} ${whenWord(first.days_left)}` : raw.papers === null ? 'Date sheet not read yet.' : 'No dated paper ahead.',
    counts,
    rows: rest.slice(0, MAX_ROWS).map((p) => ({ id: p.id, title: p.title, days_left: p.days_left, when: whenWord(p.days_left) })),
    more: Math.max(0, rest.length - MAX_ROWS),
    tentative: ahead.some((p) => p.approx),
    step: null,
    rung: null,
  }
}

export function buildL2(raw: Pick<RawLeft, 'season' | 'now' | 'day'>): L2 {
  const d = raw.day
  const welcome = d && has(d.idle_days) && d.idle_days > 0 ? `Back after ${dayWord(d.idle_days)}.${d.slipped ? ` ${d.slipped} slipped, none lost.` : ''}` : null
  const n = raw.now
  const meta = d && has(d.done) && has(d.total) && d.total > 0 ? `${d.done} of ${d.total} done` : null
  if (raw.season.now_card === 'close_the_day') {
    const logged = d?.logged_minutes
    return {
      id: 'L2',
      variant: 'close',
      title: 'Close the day',
      sentence: has(logged) ? (logged > 0 ? `Moved today: ${hm(logged)} logged.` : 'Nothing logged today yet.') : 'Today’s minutes are not read yet.',
      why: null,
      kind: null,
      minutes: null,
      welcome,
      logged: null,
      meta,
      kept: 'Not done: kept, not lost.',
      tomorrow: d?.tomorrow ?? null,
      presets: PRESETS,
    }
  }
  return {
    id: 'L2',
    variant: 'now',
    title: 'Now',
    sentence: n ? `${n.title}, ${hm(n.minutes)}.` : 'Nothing planned yet. Enter the date sheet to get a first step.',
    why: n?.why ?? null,
    kind: n?.kind ?? null,
    minutes: n?.minutes ?? null,
    welcome,
    logged: has(d?.logged_minutes) && d.logged_minutes > 0 ? `Logged today: ${hm(d.logged_minutes)}` : null,
    meta,
    kept: null,
    tomorrow: null,
    presets: PRESETS,
  }
}

export function buildL3(raw: Pick<RawLeft, 'classes'>): L3 {
  const rows = (raw.classes ?? []).map((c) => ({ id: c.id, when: c.start, name: c.name, lab: c.kind === 'lab', status: c.status ?? null }))
  return {
    id: 'L3',
    title: 'Classes today',
    rows,
    empty: rows.length ? null : raw.classes === null ? 'Classes not read yet.' : 'No classes today, or no timetable yet.',
  }
}

export function buildL4(raw: Pick<RawLeft, 'counters'>): L4 {
  const tiles = (raw.counters ?? []).map((c) => ({ id: c.id, name: c.name, value: has(c.today) ? c.today : null }))
  return { id: 'L4', title: 'Counters', tiles, empty: tiles.length ? null : raw.counters === null ? 'Counters not read yet.' : 'No counters set up.' }
}

export function buildLeft(raw: RawLeft): LeftModel {
  return { ids: LEFT_SECTION_IDS, l1: buildL1(raw), l2: buildL2(raw), l3: buildL3(raw), l4: buildL4(raw) }
}

/** The a11y name of a class tap: subject, time and the status it would set (or clear). */
export function classLabel(r: Pick<L3Row, 'name' | 'when' | 'status'>, s: ClassStatus): string {
  return `${r.name} at ${r.when}: ${r.status === s ? `clear ${s}` : `mark ${s}`}`
}
