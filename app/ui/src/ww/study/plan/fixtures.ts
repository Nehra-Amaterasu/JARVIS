// Invented data for the plan board's gallery states and tests (package Y03). Every figure here is drawn, never read from a file: the
// papers, units and plan are made up, and every state that shows them is stamped SIMULATED. No real subject, date sheet or student.
import type { Today } from '../../../germoney/game/plan'
import type { ExamPaper, ExamsAnswer } from '../../../germoney/pages/Exams'
import type { OrbitTopic, UnitReading } from './model'

export const CLOCK = '2027-02-10'

const contract = (key: string, slot: string, title: string, minutes: number, extra: object = {}) => ({
  key, source: 'tree', slot, node_id: `n-${key}`, node_name: `Topic ${key.toUpperCase()}`, branch: null, title, minutes, xp: 0, context: '', steps: [], hint: '',
  success_check: '', why: '', done: false, verified: false, ...extra,
})

export const TODAY = {
  date: CLOCK, weekday: 3, track: null, track_label: null,
  blocks: [
    { id: 'b1', kind: 'library', label: 'Library', start: '09:00', minutes: 120 },
    { id: 'b2', kind: 'protected', label: 'Rest', start: '12:00', minutes: 60 },
    { id: 'b3', kind: 'evening', label: 'Evening', start: '18:00', minutes: 90 },
  ],
  contracts: [
    contract('a1', 'library', 'Worked examples, set A', 50, { done: true }),
    contract('a2', 'library', 'Read the next section and note three questions', 45),
    contract('a3', 'library', 'Past-paper style set, ten questions', 25),
    contract('e1', 'evening', 'Recall the morning topics from memory', 30, { source: 'academics' }),
  ],
  alternatives: [
    contract('x1', 'library', 'A shorter set on the same topic', 30),
    contract('x2', 'library', 'Re-read the notes, then one worked example', 40),
  ],
  exam: { subject: { id: 's1', name: 'Subject A', kind: 'current', exam_date: '2027-03-04', strategy: '' }, days_left: 22, date_kind: null, forced: false, queue: [], advice: 'Subject A comes first because its date is the nearest on file and two of its topics are still marked to do.', phase: { n: 1, name: 'Build phase', days_left: 22, anchor: '' }, milestone: 'Every unit of Subject A marked learned', rescue_week: null },
} as unknown as Today

const topic = (unit: number, i: number, state: 'none' | 'learned' | 'solid') => ({ key: `u${unit}t${i}`, unit, unit_title: ['Foundations', 'Methods', 'Systems', 'Applications'][unit - 1], topic: `Topic ${unit}.${i}`, weight: 'med' as const, state })
const paper = (id: string, title: string, date: string, states: ('none' | 'learned' | 'solid')[][], extra: object = {}) => ({
  id, subject: `s-${id}`, title, code: id.toUpperCase(), date, start: null, end: null, units: [1, 2, 3, 4], may_miss: false, days_left: 0, coverage: null,
  topics: states.flatMap((row, u) => row.map((s, i) => topic(u + 1, i + 1, s))), work_minutes: 600, planned_minutes: 480, logged_minutes: 180,
  paper_score: null, counts: { none: 0, learned: 0, solid: 0 }, forecast: { half_plan: 0, full_plan: 0, assumption: '' }, kind: 'end_sem', approx: false, ...extra,
}) as unknown as ExamPaper

export const EXAMS = {
  status: 'ok', date: CLOCK, say: '', risks: [],
  papers: [
    paper('p1', 'Subject A', '2027-03-04', [['solid', 'learned', 'none'], ['learned', 'none'], ['none', 'none', 'none'], ['none', 'none']], { days_left: 22 }),
    paper('p2', 'Subject B', '2027-03-11', [['learned', 'none'], ['none', 'none'], ['none']], { days_left: 29, approx: true, logged_minutes: 40 }),
    paper('p3', 'Subject C', '2027-04-02', [['none', 'none'], ['none'], ['none', 'none']], { days_left: 51 }),
    paper('p0', 'Subject Z', '2027-01-20', [['solid', 'solid'], ['solid']], { days_left: -21, logged_minutes: 480 }),
  ],
  days: [{
    date: CLOCK,
    slots: [
      { label: 'Morning', minutes: 120, light: false, reserved: false, blocks: [{ paper: 'p1', title: 'Subject A: units 1 and 2', minutes: 75, focus: [{ kind: 'learn', title: 'Topic 2.1', unit: 2, minutes: 40 }, { kind: 'revise', title: 'Topic 1.2', unit: 1, minutes: 35 }] }, { paper: 'p2', title: 'Subject B: unit 1', minutes: 45, focus: [] }] },
      { label: 'Evening', minutes: 60, light: true, reserved: false, blocks: [{ paper: 'p3', title: 'Subject C: first look', minutes: 30, focus: [{ kind: 'learn', title: 'Topic 1.1', unit: 1, minutes: 30 }] }] },
    ],
  }],
} as unknown as ExamsAnswer

/** Units of the first paper, partly measured, for the gauges and the landscape (SIMULATED). */
export const UNITS_MEASURED: UnitReading[] = [
  { id: 'p1:u1', name: 'Foundations', num: 1, share: 0.27, proficiency: 0.82, n: 14, trees: 2 },
  { id: 'p1:u2', name: 'Methods', num: 2, share: 0.18, proficiency: 0.34, n: 8, trees: 1 },
  { id: 'p1:u3', name: 'Systems', num: 3, share: 0.27, proficiency: 0.6, n: 3, trees: 0 },
  { id: 'p1:u4', name: 'Applications', num: 4, share: 0.18, proficiency: null, n: 0, trees: 0 },
]
export const UNITS_BARE: UnitReading[] = UNITS_MEASURED.map((u) => ({ ...u, proficiency: null, n: 0 }))

export const ORBIT_TOPICS: OrbitTopic[] = [
  { id: 't1', label: 'Topic 1.1', band: 'fresh' }, { id: 't2', label: 'Topic 1.2', band: 'fresh' }, { id: 't3', label: 'Topic 2.1', band: 'settled' },
  { id: 't4', label: 'Topic 2.2', band: 'settled' }, { id: 't5', label: 'Topic 3.1', band: 'fading' }, { id: 't6', label: 'Topic 3.2', band: 'fading' },
  { id: 't7', label: 'Topic 4.1', band: 'due' }, { id: 't8', label: 'Topic 4.2', band: 'due' },
]
