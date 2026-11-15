// The Life month on invented rows (package L01). Every row below is made up for the bench and the tests: no course, subject, spend
// or person is real, and every reply says SIMULATED. The port keeps its days in memory so Done, Move, Not now, Undo and Delete
// change what the calendar draws, which is what the gallery and the e2e spec need to show; nothing is stored anywhere.
import type { DayData, Exam, MarkData } from '../../../shared/almanac'
import { addDays, monthOf, parseYmd } from '../../../shared/almanac'
import type { DashRow, DayDetail, DayPort, EntryRow, IntentRow, IntentQuery, LogAction, PlannedRow, PortReply } from '../ports'

/** The fixture clock: Wednesday 18 November 2026. The gallery draws November so the month has a past, a today and a future. */
export const FIXTURE_TODAY = '2026-11-18'
export const FIXTURE_MONTH = '2026-11'
const SINCE = Date.UTC(2026, 10, 18, 9, 0, 0)
const WHY = 'invented rows, not your records'

interface FxEntry extends EntryRow { minutes?: number }
interface Script {
  happened: FxEntry[]
  planned: PlannedRow[]
  intents: IntentRow[]
  rest: boolean
}

const sim = <T,>(data: T): PortReply<T> => ({ state: 'simulated', reason: WHY, since: SINCE, data })

const weekday = (date: string) => (parseYmd(date).getDay() + 6) % 7

/** What an invented day holds, from its date alone (so it is the same on every run). */
function script(date: string, today: string): Script {
  const n = Number(date.slice(8, 10))
  const wd = weekday(date)
  const past = date < today
  const upcoming = date >= today
  const happened: FxEntry[] = []
  const planned: PlannedRow[] = []
  if (wd < 5 && (past || date === today)) {
    for (let i = 0; i <= n % 2; i++) happened.push({ id: `${date}-c${i}`, time: i ? '11:00' : '09:00', kind: 'class', text: `Class: fixture subject ${i ? 'B' : 'A'}` })
  }
  if (wd !== 6 && (past || (date === today && n % 2 === 0))) {
    for (let i = 0; i <= n % 3; i++) happened.push({ id: `${date}-s${i}`, time: i ? '16:00' : '14:00', kind: 'study', text: `Study block: fixture topic ${i + 1}`, minutes: 20 + ((n * 7 + i * 13) % 31) })
  }
  if (n % 3 === 0 && past) happened.push({ id: `${date}-b0`, time: '18:30', kind: 'body', text: 'Body: stretch and walk' })
  if (n % 4 === 1 && past) happened.push({ id: `${date}-w0`, time: '20:00', kind: 'water', text: 'Water goal met' })
  if (n % 5 === 2 && past) happened.push({ id: `${date}-p0`, time: '13:15', kind: 'spend', text: 'Spend logged: fixture item' })
  if (upcoming && wd !== 6) {
    for (let i = 0; i <= n % 2; i++) planned.push({ id: `${date}-ps${i}`, time: i ? '17:00' : '15:00', kind: 'study', text: `Study block: fixture topic ${i + 4}`, status: 'planned' })
    if (wd < 5 && date !== today) planned.push({ id: `${date}-pc0`, time: '09:00', kind: 'class', text: 'Class: fixture subject A', status: 'planned' })
  }
  const intents: IntentRow[] = n % 9 === 4 ? [{ id: `${date}-i0`, rule: 'Plan the week on Sunday evening', due: date }] : []
  return { happened, planned, intents, rest: wd === 6 }
}

function marksOf(s: Script): { marks: MarkData[]; minutes: number | null } {
  const marks: MarkData[] = []
  const add = (kind: MarkData['kind'], done: boolean) => {
    const at = marks.find((m) => m.kind === kind && m.done === done)
    if (at) at.count += 1
    else marks.push({ kind, done, count: 1, state: 'simulated' })
  }
  for (const h of s.happened) add(h.kind, true)
  for (const p of s.planned) add(p.kind, p.status === 'done')
  s.intents.forEach(() => add('intent', false))
  const minutes = s.happened.reduce((sum, h) => sum + (h.kind === 'study' ? h.minutes ?? 0 : 0), 0)
  return { marks, minutes: minutes > 0 ? minutes : null }
}

export interface FixturePort extends DayPort {
  /** Every call to `logs`, for the tests. */
  calls: LogAction[]
}

/** An in-memory Day port of invented rows. `today` is the fixture clock; `empty` makes a month with nothing read yet. */
export function createFixturePort(today: string = FIXTURE_TODAY, opts: { empty?: boolean } = {}): FixturePort {
  const days = new Map<string, Script>()
  const get = (date: string): Script => {
    let s = days.get(date)
    if (!s) {
      s = opts.empty ? { happened: [], planned: [], intents: [], rest: false } : script(date, today)
      days.set(date, s)
    }
    return s
  }
  const calls: LogAction[] = []
  const exams: Exam[] = opts.empty ? [] : [{ date: '2026-11-25', label: 'Fixture paper A' }, { date: '2026-11-27', label: 'Fixture deadline B' }]

  const monthDays = (month: string): DayData[] => {
    const out: DayData[] = []
    for (let d = `${month}-01`; monthOf(d) === month; d = addDays(d, 1)) {
      const s = get(d)
      const { marks, minutes } = marksOf(s)
      if (marks.length === 0 && !s.rest) continue
      out.push({ date: d, marks, minutes, state: 'simulated', rest: s.rest || undefined })
    }
    return out
  }

  return {
    calls,
    month: async (month) => sim(monthDays(month)),
    day: async (date) => {
      const s = get(date)
      const detail: DayDetail = {
        date,
        happened: s.happened.map((h) => ({ id: h.id, time: h.time, kind: h.kind, text: h.text })),
        planned: s.planned.map((p) => ({ ...p })),
        intents: s.intents.map((i) => ({ ...i })),
        nextTime: opts.empty ? [] : [weekday(date) === 0 ? 'Every Monday: plan the week' : 'Every day: a short walk after lunch'],
      }
      return sim(detail)
    },
    intake: async () => sim(exams),
    intents: async (q: IntentQuery) => {
      const rows: IntentRow[] = []
      for (let d = q.from; d <= q.to; d = addDays(d, 1)) rows.push(...get(d).intents)
      if (!opts.empty) rows.push({ id: 'fx-i-late', rule: 'Review the week plan', due: addDays(q.from, 2) })
      return sim(rows.filter((r) => !!r.due && r.due >= q.from && r.due <= q.to).sort((a, b) => ((a.due ?? '') < (b.due ?? '') ? -1 : 1)))
    },
    logs: async (a: LogAction) => {
      calls.push(a)
      const s = get(a.date)
      const row = s.planned.find((p) => p.id === a.id)
      if (a.op === 'undo' || a.op === 'delete') s.happened = s.happened.filter((h) => h.id !== a.id)
      else if (a.op === 'done' && row) row.status = 'done'
      else if (a.op === 'notNow' && row) row.status = 'carried'
      else if (a.op === 'move' && row && a.to) {
        s.planned = s.planned.filter((p) => p.id !== a.id)
        get(a.to).planned.push({ ...row, id: `${a.to}-m-${row.id}`, status: 'planned' })
      } else return sim({ applied: false, message: 'This fixture has no editor behind that key; nothing was saved.' })
      return sim({ applied: true, message: 'Changed in the fixture only.' })
    },
    reminders: async () => ({ state: 'waiting', reason: 'reminders are not part of this fixture', since: null, data: null }),
    gcal: async (month) => {
      const g: DayData[] = [3, 12, 20].map((n) => {
        const date = `${month}-${String(n).padStart(2, '0')}`
        return { date, marks: [{ kind: 'google', done: date < today, count: 1, state: 'simulated' }], minutes: null, state: 'simulated' } as DayData
      })
      return sim(opts.empty ? [] : g)
    },
    dashboards: async (): Promise<PortReply<DashRow[]>> => ({ state: 'planned', reason: 'dashboards are not built yet', since: null, data: null }),
  }
}
