// Today (spec 20.16.1, 21.5.1; package L04): the pure reading of the day. No React, no fetch, so every rule below is
// tested on invented rows. The arc geometry is here too, so the SVG and the leader lines that start on it cannot
// disagree, and the 1366 and 358 px layouts can be checked without rendering.
import type { LampState } from '../../../shared/lamp'

/** One block on the arc: a class, a planned block or a logged (done) block. Times are local "HH:MM". */
export interface DayBlock {
  id: string
  from: string
  to: string
  kind: 'class' | 'planned' | 'done'
  label: string
}

/** The arc runs from 06:00 at the left end to 24:00 at the right end: 18 hour ticks, 10 degrees an hour. */
export const ARC_START_MIN = 6 * 60
export const ARC_END_MIN = 24 * 60
export const ARC_SPAN_MIN = ARC_END_MIN - ARC_START_MIN
export const ARC_HOURS = 18
/** A class row with no end time is drawn this long. 60 min is an assumption (A): one lecture hour; the row's label says so. */
export const CLASS_DEFAULT_MIN = 60
/** First run: the one primary action names a short block, because a first block that ends is the habit (20.16.1). */
export const FIRST_BLOCK_MIN = 10

const pad = (n: number) => String(n).padStart(2, '0')

/** "HH:MM" (or "H:MM", "HH:MM:SS", an ISO time) to minutes since midnight; null when it is not a time. */
export function toMin(t: string | null | undefined): number | null {
  if (!t) return null
  const m = /(?:T|^|\s)(\d{1,2}):(\d{2})/.exec(t)
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  if (h > 24 || mi > 59) return null
  return h * 60 + mi
}

export const hhmm = (min: number): string => {
  const m = Math.max(0, Math.min(24 * 60, Math.round(min)))
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

export const minOfDate = (d: Date): number => d.getHours() * 60 + d.getMinutes()

/** Position on the arc, 0 at 06:00 and 1 at 24:00, clamped. */
export function arcFrac(min: number): number {
  return Math.max(0, Math.min(1, (min - ARC_START_MIN) / ARC_SPAN_MIN))
}

export interface Pt { x: number; y: number }

/** A point on a half ring centred at (cx, cy) of radius r: 0 is the left end, 1 the right end, over the top. */
export function arcPoint(cx: number, cy: number, r: number, frac: number): Pt {
  const th = Math.PI - Math.max(0, Math.min(1, frac)) * Math.PI
  return { x: round(cx + r * Math.cos(th)), y: round(cy - r * Math.sin(th)) }
}

const round = (v: number) => Math.round(v * 100) / 100

/** The SVG path of the arc between two fractions (clockwise over the top, never more than half a turn). */
export function arcPath(cx: number, cy: number, r: number, a: number, b: number): string {
  const lo = Math.max(0, Math.min(a, b))
  const hi = Math.min(1, Math.max(a, b))
  const p = arcPoint(cx, cy, r, lo)
  const q = arcPoint(cx, cy, r, hi === lo ? Math.min(1, lo + 0.002) : hi)
  return `M${p.x} ${p.y}A${r} ${r} 0 0 1 ${q.x} ${q.y}`
}

export interface ArcGeom {
  w: number
  h: number
  cx: number
  cy: number
  /** Radii of the three tracks, outer to inner: class, planned, done. */
  r: { class: number; planned: number; done: number }
  /** Radius of the hour-tick dot ring and of its labels. */
  tickR: number
  labelR: number
  track: number
}

/** The half ring for a box w x h: centred, its flat side (the datum) 14 px above the bottom, hour labels inside the box. */
export function arcGeometry(w: number, h: number): ArcGeom {
  const cy = h - 14
  const R = Math.max(80, Math.min(Math.round(w / 2) - 46, cy - 42))
  const track = R > 180 ? 14 : 10
  const gap = track + 8
  return {
    w, h, cx: Math.round(w / 2), cy, track,
    r: { class: R, planned: R - gap, done: R - 2 * gap },
    tickR: R + track + 4,
    labelR: R + track + 22,
  }
}

/** The 19 hour marks 06..24; every third one is labelled. */
export function hourTicks(): { min: number; label: string | null }[] {
  return Array.from({ length: ARC_HOURS + 1 }, (_, i) => {
    const h = 6 + i
    return { min: h * 60, label: i % 3 === 0 ? pad(h) : null }
  })
}

/** Blocks clipped to the arc's window, with their fractions; a block wholly outside 06..24 is dropped. */
export function onArc(blocks: readonly DayBlock[]): (DayBlock & { a: number; b: number })[] {
  const out: (DayBlock & { a: number; b: number })[] = []
  for (const bl of blocks) {
    const f = toMin(bl.from)
    const t = toMin(bl.to)
    if (f === null || t === null || t <= ARC_START_MIN || f >= ARC_END_MIN) continue
    out.push({ ...bl, a: arcFrac(f), b: arcFrac(Math.max(t, f + 5)) })
  }
  return out
}

/* ------------------------------------------------------------------ raw inputs */

export interface RawClassRow { id: string; start: string; end?: string | null; name: string; status: 'present' | 'absent' | 'cancelled' | null }
export interface RawPlanBlock { id: string; label: string; start: string; minutes: number }
export interface RawLog { t: number; date: string; minutes?: number; title?: string; note?: string; kind: string }
export interface RawPaperRow { id: string; title: string; days_left: number | null; approx?: boolean }
export interface RawCounterRow { id: string; name: string; today: number | null | undefined }
export interface RawNowStep { title: string; minutes: number; kind: string }

/** Everything Today reads. `null` means "not read yet or could not be read"; an empty list means "read, none". */
export interface TodayRaw {
  now: Date
  /** ISO date of today (local). */
  date: string
  classes: RawClassRow[] | null
  plan: RawPlanBlock[] | null
  /** The plan log's events (any day); only `kind === 'log'` count as minutes. */
  logs: RawLog[] | null
  papers: RawPaperRow[] | null
  counters: RawCounterRow[] | null
  step: RawNowStep | null
  /** Every number here is a fixture: stamped SIMULATED. */
  simulated?: boolean
}

export const ymd = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function classBlocks(rows: readonly RawClassRow[] | null): DayBlock[] {
  return (rows ?? []).flatMap((c) => {
    const f = toMin(c.start)
    if (f === null || c.status === 'cancelled') return []
    const e = toMin(c.end ?? null)
    const to = e !== null && e > f ? e : f + CLASS_DEFAULT_MIN
    return [{ id: `c-${c.id}`, from: hhmm(f), to: hhmm(to), kind: 'class' as const, label: c.name }]
  })
}

export function plannedBlocks(rows: readonly RawPlanBlock[] | null): DayBlock[] {
  return (rows ?? []).flatMap((b) => {
    const f = toMin(b.start)
    if (f === null || !(b.minutes > 0)) return []
    return [{ id: `p-${b.id}`, from: hhmm(f), to: hhmm(f + b.minutes), kind: 'planned' as const, label: b.label }]
  })
}

/** A log event ends at its timestamp and began `minutes` before it (the log is written when a block ends). */
export function doneBlocks(logs: readonly RawLog[] | null, date: string): DayBlock[] {
  return (logs ?? []).flatMap((e, i) => {
    if (e.kind !== 'log' || e.date !== date || !(Number(e.minutes) > 0)) return []
    const ms = e.t > 1e11 ? e.t : e.t * 1000
    const end = minOfDate(new Date(ms))
    const from = Math.max(0, end - Number(e.minutes))
    return [{ id: `d-${i}`, from: hhmm(from), to: hhmm(end), kind: 'done' as const, label: e.title || e.note || 'logged block' }]
  })
}

/** Minutes logged on each of the `n` days ending today, oldest first. */
export function minutesByDay(logs: readonly RawLog[] | null, now: Date, n: number): { date: string; minutes: number }[] {
  const out: { date: string; minutes: number }[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const key = ymd(d)
    const m = (logs ?? []).filter((e) => e.kind === 'log' && e.date === key).reduce((s, e) => s + (Number(e.minutes) || 0), 0)
    out.push({ date: key, minutes: m })
  }
  return out
}

/** The median of the days that have any minutes; null below 3 such days (a median of one day says nothing). */
export function ownMedian(days: readonly { minutes: number }[]): number | null {
  const v = days.map((d) => d.minutes).filter((m) => m > 0).sort((a, b) => a - b)
  if (v.length < 3) return null
  const k = Math.floor(v.length / 2)
  return v.length % 2 ? v[k] : Math.round((v[k - 1] + v[k]) / 2)
}

export const gapText = (min: number): string => {
  const m = Math.max(0, Math.round(min))
  if (m < 60) return `${m} m`
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} m` : ''}`
}

/* ------------------------------------------------------------------ the view model */

export interface NowCard {
  /** "In class", "Planned block", "Gap", "Free evening" ... */
  head: string
  line: string
  /** The one primary label. */
  action: string
  state: LampState
  reason: string
}

export interface AheadCard { title: string | null; days: number | null; tentative: boolean; state: LampState; reason: string; more: number }

export interface CounterKey { id: string; name: string; value: number | null }

export interface TodayModel {
  firstRun: boolean
  state: LampState
  minutes: number | null
  minutesState: LampState
  minutesReason: string
  classes: DayBlock[]
  planned: DayBlock[]
  done: DayBlock[]
  /** No class rows were read or entered today: the outer track is dashed. */
  noClasses: boolean
  week: { date: string; minutes: number }[]
  median: number | null
  weekState: LampState
  now: NowCard
  ahead: AheadCard
  counters: CounterKey[]
  countersState: LampState
  classesTapped: { done: number; of: number }
}

const has = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

export function nowCard(raw: TodayRaw, classes: DayBlock[], planned: DayBlock[], firstRun: boolean, live: LampState): NowCard {
  const t = minOfDate(raw.now)
  if (firstRun) return { head: 'First block', line: 'Nothing logged yet. One short block starts the day.', action: `Start a ${FIRST_BLOCK_MIN}-minute block`, state: live, reason: 'no block logged today' }
  const inside = (b: DayBlock) => (toMin(b.from) ?? 0) <= t && t < (toMin(b.to) ?? 0)
  const cls = classes.find(inside)
  if (cls) return { head: 'In class', line: `${cls.label} until ${cls.to}`, action: 'Start a block', state: live, reason: 'from today\'s timetable' }
  const pl = planned.find(inside)
  if (pl) return { head: 'Planned now', line: `${pl.label}, until ${pl.to}`, action: 'Start this block', state: live, reason: 'from today\'s plan' }
  const next = classes.map((c) => toMin(c.from) ?? 0).filter((m) => m > t).sort((a, b) => a - b)[0]
  if (has(next)) return { head: 'Gap', line: `gap ${gapText(next - t)} to the next class`, action: 'Start a block', state: live, reason: 'from today\'s timetable' }
  if (raw.step) return { head: 'Next', line: `${raw.step.title}, ${raw.step.minutes} min`, action: 'Start a block', state: live, reason: 'the plan\'s next step' }
  if (raw.classes !== null && raw.classes.length === 0) return { head: 'No classes', line: 'Add today\'s classes, or start a block.', action: 'Start a block', state: live, reason: 'no class entered today' }
  return { head: 'Now', line: 'Free until the day ends.', action: 'Start a block', state: live, reason: 'nothing else is planned' }
}

export function aheadCard(papers: readonly RawPaperRow[] | null, live: LampState): AheadCard {
  if (papers === null) return { title: null, days: null, tentative: false, state: 'waiting', reason: 'date sheet not read yet', more: 0 }
  const dated = papers.filter((p) => has(p.days_left) && (p.days_left as number) >= 0).sort((a, b) => (a.days_left as number) - (b.days_left as number))
  if (!dated.length) return { title: null, days: null, tentative: false, state: 'waiting', reason: 'nothing dated', more: 0 }
  const p = dated[0]
  return { title: p.title, days: p.days_left as number, tentative: !!p.approx, state: live, reason: p.approx ? 'date tentative' : 'dates you entered', more: dated.length - 1 }
}

export function buildToday(raw: TodayRaw): TodayModel {
  const live: LampState = raw.simulated ? 'simulated' : 'live'
  const classes = classBlocks(raw.classes)
  const planned = plannedBlocks(raw.plan)
  const done = doneBlocks(raw.logs, raw.date)
  const week = minutesByDay(raw.logs, raw.now, 7)
  const minutes = raw.logs === null ? null : week[week.length - 1].minutes
  const month = minutesByDay(raw.logs, raw.now, 30)
  const median = ownMedian(month)
  const anyEver = (raw.logs ?? []).some((e) => e.kind === 'log' && Number(e.minutes) > 0)
  // first run: the log was read and holds no block at all (not "nothing today": that is an ordinary morning)
  const firstRun = raw.logs !== null && !anyEver
  const nothing = raw.logs === null && raw.classes === null && raw.plan === null
  const counters = (raw.counters ?? []).map((c) => ({ id: c.id, name: c.name, value: has(c.today) ? (c.today as number) : null }))
  const tapped = (raw.classes ?? []).filter((c) => c.status !== null).length
  return {
    firstRun,
    state: nothing ? 'waiting' : live,
    minutes,
    minutesState: minutes === null ? 'waiting' : live,
    minutesReason: minutes === null ? 'block log not read yet' : 'block log, today',
    classes, planned, done,
    noClasses: classes.length === 0,
    week,
    median,
    weekState: raw.logs === null ? 'waiting' : live,
    now: nowCard(raw, classes, planned, firstRun, live),
    ahead: aheadCard(raw.papers, live),
    counters,
    countersState: raw.counters === null ? 'waiting' : live,
    classesTapped: { done: tapped, of: (raw.classes ?? []).length },
  }
}

/** What the arc says in words: its text twin (a drawing always has one). */
export function arcText(m: Pick<TodayModel, 'classes' | 'planned' | 'done'>): string[] {
  const line = (b: DayBlock) => `${b.from} to ${b.to}, ${b.label}`
  return [
    ...m.classes.map((b) => `Class: ${line(b)}`),
    ...m.planned.map((b) => `Planned: ${line(b)}`),
    ...m.done.map((b) => `Done: ${line(b)}`),
  ]
}

/** Milliseconds to the next minute boundary: the arc's notch steps exactly once a minute, with one timeout, no loop. */
export const msToNextMinute = (d: Date): number => 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds())
