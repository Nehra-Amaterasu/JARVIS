// Invented rows for the bench and the tests (package L03). Nothing below is a real subject, class, session or record: every name says
// "fixture" and every reply is stamped SIMULATED by the page's own lamp. The fixture clock is Wednesday 18 November 2026, the same as L01's.
import { addDays } from '../../../shared/almanac'
import type { AttendanceAnswer, SubjectRow, TodayClass } from '../../life/derive'
import { FIXTURE_TODAY, createFixturePort, type FixturePort } from '../month/fixtures'
import type { DayPort, PortReply, ReminderRow } from '../ports'
import type { SessionLike } from '../body/model'

export { FIXTURE_TODAY }
export const FIXTURE_NOW = new Date(2026, 10, 18, 10, 20)

const subject = (n: string, held: number, attended: number, weekly: number): SubjectRow => ({
  subject: `F${n}`, name: `Fixture subject ${n}`, held, attended, weekly, pct: held ? attended / held : null, can_miss: 0, need: 0, last: FIXTURE_TODAY,
})

const cls = (id: string, start: string, end: string, n: string, room: string, status: TodayClass['status']): TodayClass => ({ id, start, end, subject: `F${n}`, name: `Fixture subject ${n}`, kind: 'lecture', room, status })

/** An attendance answer of invented subjects: one above its line, one on it, one below, one with too few classes entered, one with none. */
export const FIXTURE_ATTENDANCE: AttendanceAnswer = {
  status: 'ok', date: FIXTURE_TODAY, say: '', risks: [],
  rule: { threshold: 0.75, scope: 'per_subject', confirmed: true },
  today: [
    cls('a', '09:00', '09:50', 'A', 'Room 1', 'present'),
    cls('b', '11:00', '11:50', 'B', 'Room 2', null),
    cls('c', '13:10', '14:00', 'C', 'Room 3', null),
    cls('d', '14:00', '14:50', 'D', 'Room 1', null),
    cls('e', '16:00', '16:50', 'E', 'Lab', null),
  ],
  subjects: [subject('A', 12, 11, 3), subject('B', 12, 9, 3), subject('C', 11, 7, 2), subject('D', 3, 2, 2), subject('E', 0, 0, 1)],
  overall: null,
}

/** The same answer when it was last entered some days ago: the ledger then says WAITING and how long ago. */
export const FIXTURE_STALE: AttendanceAnswer = { ...FIXTURE_ATTENDANCE, subjects: FIXTURE_ATTENDANCE.subjects.map((s) => ({ ...s, last: addDays(FIXTURE_TODAY, -9) })) }

export const FIXTURE_MINUTES: Readonly<Record<string, number>> = {
  [addDays(FIXTURE_TODAY, -1)]: 50, [addDays(FIXTURE_TODAY, -2)]: 35, [addDays(FIXTURE_TODAY, -4)]: 80, [FIXTURE_TODAY]: 45,
}

const at = (n: number, h = 18) => new Date(2026, 10, 18 + n, h, 0).toISOString()
export const FIXTURE_SESSIONS: SessionLike[] = [
  { id: 's1', date: at(-1), muscles: ['legs', 'core'], entries: [{ sets: 4 }, { sets: 3 }] },
  { id: 's2', date: at(-3), muscles: ['chest', 'back'], entries: [{ sets: 3 }, { sets: 3 }, { sets: 2 }] },
  { id: 's3', date: at(-5), muscles: ['legs'], entries: [] },
  { id: 's4', date: at(-6, 7), muscles: ['shoulders'], entries: [{ sets: 5 }] },
]

const SINCE = Date.UTC(2026, 10, 18, 9, 0, 0)
const sim = <T,>(data: T): PortReply<T> => ({ state: 'simulated', reason: 'invented rows, not your records', since: SINCE, data })

export const FIXTURE_REMINDERS: ReminderRow[] = [
  { id: 'r1', time: '08:30', label: 'Fixture reminder one' },
  { id: 'r2', time: '21:00', label: 'Fixture reminder two' },
]

/** The month's fixture port with the day's reminders filled (the month port leaves them WAITING). */
export function createWeekPort(): FixturePort {
  const base = createFixturePort(FIXTURE_TODAY)
  const port: DayPort = { ...base, reminders: async () => sim(FIXTURE_REMINDERS) }
  return Object.assign(port, { calls: base.calls }) as FixturePort
}
