// The states of the Y03 gallery entry (plan board, its four drawings, and the dMAT board), every one on INVENTED data. The entry file
// (gallery/entries/Y03.tsx) loads this module lazily and only where the build holds Well Wisher. Every reading drawn from a fixture is
// stamped SIMULATED; the states with no engine say WAITING with the reason. Nothing here reads a route or a store.
import { Chip, Lamp } from '../../../shared/kit'
import type { DmatSet } from '../api'
import { DmatBoard, type DmatState } from '../dmat/DmatBoard'
import { CLOCK, EXAMS, ORBIT_TOPICS, TODAY, UNITS_BARE, UNITS_MEASURED } from './fixtures'
import { ExamWheel } from './ExamWheel'
import { PlanBoard, type PlanBoardProps } from './PlanBoard'
import { RetentionOrbit } from './RetentionOrbit'
import { SigilGauge } from './SigilGauge'
import { SyllabusLandscape } from './SyllabusLandscape'

const noop = () => undefined
const SIM = { state: 'simulated' as const, reason: 'invented fixture' }

const base: PlanBoardProps = {
  today: TODAY, exams: EXAMS, paperId: 'p1', onPaper: noop, units: UNITS_MEASURED, unitsReading: SIM, clock: CLOCK, planLamp: SIM,
  retention: { state: 'simulated', reason: 'invented fixture', dueCount: 2, topics: ORBIT_TOPICS, dueIds: ['t7', 't8'] },
  onStart: noop, onRebuild: () => Promise.resolve(), onSwap: () => Promise.resolve('Swapped.'), onLog: noop, onDrill: noop,
}
const waitingPlan: PlanBoardProps = {
  ...base, exams: null, paperId: null, units: [], unitsReading: { state: 'waiting', reason: 'marks per unit need the paper engine' }, planLamp: SIM,
  retention: { state: 'waiting', reason: 'review cards need the paper engine', dueCount: null, topics: [], dueIds: [] },
}

const wheelPapers = EXAMS.papers.map((p) => ({ id: p.id, label: p.title, date: p.date, approx: p.approx }))

const eq = (i: number) => ({ i, kind: 'equation' as const, prompt: `Find A + ${i + 2}B`, equations: [`B - ${i} = 2`, '2A = 6'], ask: 'A', options: [{ text: '3' }, { text: '5' }, { text: '8' }] })
const SET: DmatSet = { set_id: 'g-1', kind: 'equation', label: 'Equations', seed: 1234, level: 1, n: 10, seconds_per_item: 60, time_limit_s: 600, rules: '', items: Array.from({ length: 10 }, (_, i) => eq(i)) }
const dmat = (o: Partial<DmatState>): DmatState => ({
  kind: 'equation', setKind: noop, n: '10', setN: noop, level: '1', setLevel: noop, timer: 'on', setTimer: noop, seedText: '', setSeedText: noop,
  hist: [], set: null, answers: [], at: 0, setAt: noop, left: null, result: null, err: null, busy: false, start: () => Promise.resolve(), finish: () => Promise.resolve(), pick: noop, last: null, ...o,
} as DmatState)

const Box = ({ children }: { children: React.ReactNode }) => <div className="y3-box">{children}</div>
const Small = ({ children }: { children: React.ReactNode }) => <div className="y3 y3-small"><section className="y3-card">{children}</section></div>

export function Y03State({ index }: { index: number }) {
  switch (index) {
    case 0: return <Box><PlanBoard {...base} /></Box>
    case 1: return <Box><PlanBoard {...waitingPlan} /></Box>
    case 2: return <Box><PlanBoard {...base} sheet="why" /></Box>
    case 3: return <Box><PlanBoard {...base} sheet="swap" /></Box>
    case 4: return <Small><div className="y3-gauge-row">{UNITS_MEASURED.map((u, i) => <SigilGauge key={u.id} unitId={u.id} proficiency={u.proficiency ?? 0} n={u.n} label={`Unit ${u.num}`} selected={i === 1} onSelect={noop} />)}</div><p className="y3-line"><Lamp state="simulated" reason="invented fixture" /> Unit 2 has the shortest arc, n = 8.</p></Small>
    case 5: return <Small><SyllabusLandscape units={UNITS_MEASURED} selectedId="p1:u2" onSelect={noop} caption="Height = your marks, footprint = the unit's share. Invented." /></Small>
    case 6: return <Small><SyllabusLandscape units={[]} caption="" /></Small>
    case 7: return <Small><ExamWheel papers={wheelPapers} today={CLOCK} selectedId="p1" onSelect={noop} /></Small>
    case 8: return <Small><RetentionOrbit topics={[]} dueIds={[]} dueCount={null} state="waiting" reason="review cards need the paper engine" /></Small>
    case 9: return <Small><RetentionOrbit topics={ORBIT_TOPICS} dueIds={['t7', 't8']} dueCount={2} state="simulated" reason="invented fixture" retention={90} onRetention={noop} /><Chip>SIMULATED</Chip></Small>
    case 10: return <Box><DmatBoard d={dmat({ last: { set_id: 'x', kind: 'equation', level: 1, n: 10, correct: 7, of: 10, seconds: 480, time_limit_s: 600, in_time: true, date: '' } })} /></Box>
    case 11: return <Box><DmatBoard d={dmat({ set: SET, answers: [0, 1, null, null, null, null, null, null, null, null], at: 2, left: 512 })} /></Box>
    case 12: return <Box><DmatBoard d={dmat({ result: { set_id: 'x', kind: 'equation', correct: 7, of: 10, unanswered: 1, pct: 0, seconds: 480, time_limit_s: 600, in_time: true } })} /></Box>
    default: return <Box><PlanBoard {...waitingPlan} units={UNITS_BARE} unitsReading={{ state: 'waiting', reason: 'marks per unit need the paper engine' }} exams={EXAMS} paperId="p1" /></Box>
  }
}

export const Y03_LABELS = [
  'Plan board, invented data (SIMULATED)',
  'Plan board, no engine and no papers (WAITING)',
  'Plan board, the Why sheet open',
  'Plan board, the Swap sheet open',
  'Sigil gauges: measured, selected and too few answers',
  'Syllabus landscape: measured and not measured',
  'Syllabus landscape: no units (empty slab)',
  'Exam wheel, four papers, one tentative date',
  'Retention orbit: no cards (WAITING)',
  'Retention orbit: four bands, DEFAULT chip (SIMULATED)',
  'dMAT setup with a last set',
  'dMAT, a set running',
  'dMAT, a scored set',
  'Plan board, papers on file but no marks yet (units not measured)',
]
