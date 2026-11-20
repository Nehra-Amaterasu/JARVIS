// Invented stores for the bench and the tests (package L03): water, a month of spending, and two habits, kept in memory so a tap, an
// entry or a "Log one" changes what the drawer draws. Every reply is SIMULATED, and nothing is stored anywhere.
import { addDays } from '../../../shared/almanac'
import type { PortReply, LogResult } from '../ports'
import type { Habit, HabitEvent, LedgerStores, SpendRow } from './stores'

const SINCE = Date.UTC(2026, 10, 18, 9, 0, 0)
const WHY = 'invented rows, not your records'
const sim = <T,>(data: T): PortReply<T> => ({ state: 'simulated', reason: WHY, since: SINCE, data })
const done = (message: string): PortReply<LogResult> => sim({ applied: true, message })

export interface FixtureStores extends LedgerStores {
  calls: string[]
}

export function createFixtureStores(today: string, opts: { empty?: boolean } = {}): FixtureStores {
  const calls: string[] = []
  let water = opts.empty ? 0 : 3
  let seq = 0
  const spend: SpendRow[] = opts.empty ? [] : [
    { id: 'p1', date: `${today.slice(0, 7)}-02`, amount: 120, category: 'food', note: 'fixture' },
    { id: 'p2', date: `${today.slice(0, 7)}-04`, amount: 40, category: 'travel', note: '' },
    { id: 'p3', date: `${today.slice(0, 7)}-04`, amount: 300, category: 'books', note: 'fixture' },
    { id: 'p4', date: `${today.slice(0, 7)}-09`, amount: 80, category: 'food', note: '' },
    { id: 'p5', date: `${today.slice(0, 7)}-13`, amount: 60, category: 'travel', note: '' },
    { id: 'p6', date: `${today.slice(0, 7)}-16`, amount: 150, category: 'food', note: '' },
  ]
  const habits: Habit[] = opts.empty ? [] : [{ id: 'h1', name: 'Fixture habit one', limit: 2 }, { id: 'h2', name: 'Fixture habit two', limit: null }]
  const events: HabitEvent[] = opts.empty ? [] : [-1, -2, -2, -3, -5, -5, -5, -9, -12, -12, -13, -20].map((d, i) => ({ id: `e${i}`, habit: i % 3 === 2 ? 'h2' : 'h1', at: addDays(today, d), chip: null }))
  return {
    calls,
    water: {
      read: async () => sim({ count: water }),
      set: async (_d, count) => { calls.push(`water:${count}`); water = count; return done('Changed in the fixture only.') },
    },
    spend: {
      month: async () => sim([...spend]),
      add: async (row) => { calls.push(`spend:${row.amount}`); spend.push({ id: `n${seq++}`, ...row }); return done('Added in the fixture only.') },
      categories: async () => sim(['food', 'travel', 'books', 'other']),
    },
    habits: {
      list: async () => sim(habits.map((h) => ({ ...h }))),
      events: async (from, to) => sim(events.filter((e) => e.at >= from && e.at <= to)),
      log: async (habit, date, chip) => { calls.push(`log:${habit}`); events.push({ id: `n${seq++}`, habit, at: date, chip }); return done('Logged in the fixture only.') },
      undo: async (habit, date) => {
        calls.push(`undo:${habit}`)
        const i = events.map((e) => e.habit === habit && e.at === date).lastIndexOf(true)
        if (i >= 0) events.splice(i, 1)
        return done('Removed in the fixture only.')
      },
      setLimit: async (habit, limit) => { calls.push(`limit:${habit}:${limit}`); const h = habits.find((x) => x.id === habit); if (h) h.limit = limit; return done('Changed in the fixture only.') },
    },
  }
}
