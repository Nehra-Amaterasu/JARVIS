// Invented rows for the gallery and the tests: neutral course words, no real course, institution or person. Every number
// here is drawn SIMULATED (TodayRaw.simulated), never as his day.
import type { RailFixture } from '../../left/Rail'
import type { TodayRaw } from './model'

/** A fixed clock, so the gallery and the tests draw the same picture: a weekday at 14:20. */
export const FIX_NOW = new Date(2026, 10, 12, 14, 20, 0)

const day = (offset: number) => {
  const d = new Date(FIX_NOW)
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const at = (offset: number, h: number, m: number) => {
  const d = new Date(FIX_NOW)
  d.setDate(d.getDate() + offset)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

/** 30 days of logged minutes, invented: a few gaps, no pattern meant. */
const PAST = [40, 0, 75, 60, 0, 90, 45, 30, 0, 55, 80, 25, 0, 60, 70, 35, 0, 50, 95, 40, 20, 0, 65, 45, 50, 0, 85, 30, 60]

export function fixtureRaw(kind: 'day' | 'first' | 'waiting'): TodayRaw {
  if (kind === 'waiting') {
    return { now: FIX_NOW, date: day(0), classes: null, plan: null, logs: null, papers: null, counters: null, step: null, simulated: true }
  }
  if (kind === 'first') {
    return {
      now: FIX_NOW, date: day(0), classes: [], plan: [], logs: [], papers: [],
      counters: [{ id: 'water', name: 'Water', today: 0 }, { id: 'reels', name: 'Reels', today: 0 }],
      step: null, simulated: true,
    }
  }
  const logs = PAST.map((m, i) => ({ t: at(-(PAST.length - i), 19, 30), date: day(-(PAST.length - i)), minutes: m, kind: 'log', title: 'Study block' }))
    .filter((e) => e.minutes > 0)
  logs.push({ t: at(0, 8, 40), date: day(0), minutes: 40, kind: 'log', title: 'Morning recall' })
  logs.push({ t: at(0, 13, 50), date: day(0), minutes: 25, kind: 'log', title: 'Practice set' })
  return {
    now: FIX_NOW,
    date: day(0),
    classes: [
      { id: 's1', start: '09:00', end: '10:00', name: 'Signals', status: 'present' },
      { id: 's2', start: '10:15', end: '11:15', name: 'Applied maths', status: 'present' },
      { id: 's3', start: '15:30', end: '17:30', name: 'Circuits', status: null },
    ],
    plan: [
      { id: 'b1', label: 'Library block', start: '14:00', minutes: 60 },
      { id: 'b2', label: 'Evening block', start: '19:00', minutes: 90 },
    ],
    logs,
    papers: [
      { id: 'p1', title: 'Applied maths, mid-term', days_left: 12 },
      { id: 'p2', title: 'Signals, end term', days_left: 26 },
      { id: 'p3', title: 'Circuits, end term', days_left: 31, approx: true },
    ],
    counters: [
      { id: 'water', name: 'Water', today: 4 },
      { id: 'reels', name: 'Reels', today: 1 },
      { id: 'pages', name: 'Pages', today: 12 },
      { id: 'walk', name: 'Walk', today: null },
      { id: 'calls', name: 'Calls', today: 0 },
    ],
    step: { title: 'Circuits, unit 3 problems', minutes: 50, kind: 'study' },
    simulated: true,
  }
}

export function fixtureRail(kind: 'day' | 'first' | 'waiting'): RailFixture {
  const raw = fixtureRaw(kind)
  return {
    leftTop: 'countdown',
    papers: raw.papers?.map((p) => ({ id: p.id, title: p.title, date: '', days_left: p.days_left, kind: p.id === 'p1' ? 'cie' : 'end', approx: p.approx })) ?? null,
    now: raw.step ? { kind: 'study', title: raw.step.title, minutes: raw.step.minutes, why: null, paper: null } : null,
    classes: raw.classes?.map((c) => ({ id: c.id, start: c.start, end: c.end, name: c.name, kind: c.id === 's3' ? 'lab' : 'lecture', status: c.status })) ?? null,
    counters: raw.counters,
    paired: kind === 'day' ? 1 : 0,
    lastCount: null,
  }
}
