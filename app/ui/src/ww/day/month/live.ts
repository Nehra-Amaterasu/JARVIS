// What the existing Well Wisher stores already know about the month (package L01): the plan's log of minutes (any day) and today's
// classes as the left column reads them. They are LIVE because the student tapped or logged them; nothing is computed or guessed.
// Everything else on the month (intents, Google, history of classes and counters) arrives through the Day port, and until an
// adapter supplies it the calendar says WAITING for it rather than drawing it from nothing.
import type { DayData, MarkData } from '../../../shared/almanac'

export interface LiveLog { date: string; minutes?: number; kind: string }
export interface LiveClass { id: string; status: 'present' | 'absent' | 'cancelled' | null }

/** Study minutes by day from the plan log, and today's class marks (present = done, not yet tapped = planned, absent or cancelled = none). */
export function liveDays(today: string, logs: readonly LiveLog[] | null, classes: readonly LiveClass[] | null): DayData[] {
  const by = new Map<string, DayData>()
  const day = (date: string): DayData => {
    let d = by.get(date)
    if (!d) {
      d = { date, marks: [], minutes: null, state: 'live' }
      by.set(date, d)
    }
    return d
  }
  const bump = (d: DayData, kind: MarkData['kind'], done: boolean) => {
    const m = d.marks.find((x) => x.kind === kind && x.done === done)
    if (m) m.count += 1
    else d.marks.push({ kind, done, count: 1, state: 'live' })
  }
  for (const l of logs ?? []) {
    if (l.kind !== 'log' || !(l.minutes && l.minutes > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(l.date)) continue
    const d = day(l.date)
    d.minutes = (d.minutes ?? 0) + l.minutes
    bump(d, 'study', true)
  }
  for (const c of classes ?? []) {
    if (c.status === 'absent' || c.status === 'cancelled') continue
    bump(day(today), 'class', c.status === 'present')
  }
  return [...by.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}
