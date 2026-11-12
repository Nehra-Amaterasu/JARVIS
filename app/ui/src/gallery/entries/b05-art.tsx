// The shared art components (B03c): rings, ridges, dials and the ASCII and dot forms. Each draws its data from props only, shows
// a table twin for screen readers, and states the lamp it was drawn under.
import * as art from '../../shared/art'
import { LAMP_STATES } from '../../shared/lamp'
import { jarvisRegistry } from '../../jarvis/planned'
import type { GalleryEntryX } from '../types'
import { STATE_REASON, States, noop } from '../fixtures'

const merged = 'art components, 12 Nov'

const AXES: art.PillarsChartProps['axes'] = [
  { id: 'a', label: 'Recall', value: 0.7 },
  { id: 'b', label: 'Speed', value: 0.5 },
  { id: 'c', label: 'Accuracy', value: 0.8 },
  { id: 'd', label: 'Stamina', value: 0.4 },
  { id: 'e', label: 'Focus', value: 0.6 },
]
const RIDGE_ROWS = Array.from({ length: 5 }, (_, r) => ({ label: `Day ${r + 1}`, values: Array.from({ length: 24 }, (_, i) => Math.abs(Math.sin((i + r) / 3)) * 10) }))
const ORBIT_MS: art.OrbitProps['milestones'] = [
  { id: 'm1', label: 'First', orbit: 0, at: 0.1, status: 'reached' },
  { id: 'm2', label: 'Second', orbit: 1, at: 0.4, status: 'upcoming' },
  { id: 'm3', label: 'Third', orbit: 2, at: 0.7, status: 'planned' },
]
const RING_NODES: art.NodeRingProps['nodes'] = [
  { id: 'n1', label: 'Voice', status: 'done' },
  { id: 'n2', label: 'Memory', status: 'open' },
  { id: 'n3', label: 'Room', status: 'planned' },
  { id: 'n4', label: 'Senses', status: 'open' },
  { id: 'n5', label: 'Study', status: 'done' },
]
const DAYS: art.WeekStripProps['days'] = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'].map((iso, i) => ({
  iso,
  label: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i],
  minutes: [40, 25, 0, 60, 15, 0, 0][i],
  rest: i === 6,
}))
const WHEEL: art.DateWheelProps['items'] = [
  { id: 'w1', label: 'Mock paper', date: '2026-12-08' },
  { id: 'w2', label: 'Review day', date: '2026-11-20' },
  { id: 'w3', label: 'Later plan', date: '2027-02-02', planned: true },
]
const PLAIN = jarvisRegistry.byId('jarvis.agents')!
const WAITING_ENTRY = jarvisRegistry.byId('jarvis.library')!

const E = (id: string, title: string, note: string, states: GalleryEntryX['states'], also?: string[]): GalleryEntryX => ({ id: `art/${id}`, title, group: 'art', merged, note, states, also })

const entries: GalleryEntryX[] = [
  E('NodeRing', 'NodeRing', 'Subsystems on a ring; the centre carries one count with its lamp.', [{ label: 'live centre', node: <art.NodeRing caption="Subsystems" nodes={RING_NODES} centre={{ value: '3', caption: 'open', state: 'live' }} onOpen={noop} /> }]),
  E('Orbit', 'Orbit', 'Milestones on three orbits, with the present as a mark.', [
    { label: 'hero', node: <art.Orbit caption="Milestones" milestones={ORBIT_MS} now={{ orbit: 1, at: 0.3 }} onOpen={noop} /> },
    { label: 'compact', node: <art.Orbit caption="Milestones small" size="compact" milestones={ORBIT_MS} /> },
  ]),
  E('RingBars', 'RingBars', 'Bars around a ring. A missing value is a gap, never a zero.', [{ label: 'five states', node: <>{LAMP_STATES.map((s) => <art.RingBars key={s} caption={`Bars ${s}`} state={s} max={10} unit="h" reason={STATE_REASON[s]} showTable={s === 'live'} bars={[{ id: 'a', label: 'Mon', value: 4 }, { id: 'b', label: 'Tue', value: null }, { id: 'c', label: 'Wed', value: 9 }]} />)}</> }]),
  E('Ridge', 'Ridge', 'Stacked rows of a signal, nearest in front.', [{ label: 'five states', node: <>{LAMP_STATES.map((s) => <art.Ridge key={s} state={s} source="room sensor" reason={STATE_REASON[s]} width={360} height={180} unit="dB" rows={RIDGE_ROWS} />)}</> }]),
  E('Callout', 'Callout', 'Leader lines from a drawing to its labels.', [{ label: 'normal, planned, fault', node: <art.Callout caption="Room parts" width={400} height={220} points={[{ id: 'a', x: 60, y: 60, label: 'Lamp', value: '12 W' }, { id: 'b', x: 200, y: 140, label: 'Fan', value: 'off', status: 'planned' }, { id: 'c', x: 320, y: 70, label: 'Board', value: 'lost', status: 'fault' }]} /> }]),
  E('Spec', 'Spec', 'A dimension sheet. A size that was not measured prints "not fitted".', [{ label: 'fitted and not fitted', node: <art.Spec caption="Case dimensions" rows={[{ id: 'a', label: 'Width', mm: 120 }, { id: 'b', label: 'Depth', mm: 60, note: 'with lid' }, { id: 'c', label: 'Height', mm: null }]} /> }]),
  E('DotTimer', 'DotTimer', 'A session as dots, one per minute planned; the pause and the rest are drawn.', [{ label: 'running, paused, ended, resting', node: <><art.DotTimer plannedMin={25} elapsedMin={10} state="live" /><art.DotTimer plannedMin={25} elapsedMin={10} paused state="live" /><art.DotTimer plannedMin={25} elapsedMin={12} ended state="simulated" compact /><art.DotTimer plannedMin={25} elapsedMin={0} resting state="waiting" /></> }]),
  E('DateWheel', 'DateWheel', 'Dates ahead on a wheel, today marked, nothing flashing.', [{ label: 'items and today', node: <art.DateWheel caption="Dates ahead" items={WHEEL} today="2026-11-13" onOpen={noop} /> }]),
  E('PillarsChart', 'PillarsChart', 'Five pillars; a SIMULATED chart wears the word on its face.', [{ label: 'five states, sample, editable', node: <>{LAMP_STATES.map((s) => <art.PillarsChart key={s} state={s} caption={`Pillars ${s}`} axes={AXES} sample={s === 'simulated'} editable={s === 'live'} onChange={noop} />)}</> }]),
  E('WeekStrip', 'WeekStrip', 'Seven days of minutes with a rest day.', [{ label: 'selected and today', node: <art.WeekStrip days={DAYS} today="2026-11-13" selected="2026-11-12" onOpen={noop} /> }]),
  E('AsciiSweep', 'AsciiSweep and empty states', 'The only motion in this folder: a bounded text sweep, five seconds at most.', [
    { label: 'active sweep (bounded 5 s)', node: <art.AsciiSweep verb="reading memory" /> },
    { label: 'empty states', node: <>{(['tree', 'memory', 'console', 'error'] as const).map((v) => <art.AsciiEmptyState key={v} variant={v} message={`Nothing in ${v}`} action={{ label: `Open ${v}`, onAction: noop }} />)}</> },
  ], ['AsciiEmptyState']),
  E('StippleRing', 'StippleRing and DotMatrixMeter', 'A ring and a meter made of dots.', [
    { label: 'five states', node: <>{LAMP_STATES.map((s) => <art.StippleRing key={s} frac={0.6} value="60%" state={s} caption={`Ring ${s}`} reason={STATE_REASON[s]} size={120} />)}</> },
    { label: 'meter, five states', node: <>{LAMP_STATES.map((s) => <art.DotMatrixMeter key={s} level={s === 'live' ? 6 : null} min={0} max={10} unit="mm" state={s} caption={`Meter ${s}`} reason={STATE_REASON[s]} />)}</> },
  ], ['DotMatrixMeter']),
  E('Dither', 'Dither', 'Four dither textures, ordered, never random.', [{ label: 'four kinds', node: <>{(['ring', 'ridge', 'bloom', 'bridge'] as const).map((k) => <art.Dither key={k} kind={k} cols={32} rows={20} />)}</> }]),
  E('CellSkeleton', 'CellSkeleton', 'A loading cell and its ready form.', [{ label: 'loading and ready', node: <><art.CellSkeleton depth={2} seed={3} /><art.CellSkeleton ready>Loaded content</art.CellSkeleton></> }]),
  E('BlankingPlate', 'BlankingPlate', 'The plate over a feature that is not built, or built and not yet verified.', [{ label: 'planned and built-not-verified', node: <><art.BlankingPlate entry={PLAIN} onOpen={noop} /><art.BlankingPlate entry={WAITING_ENTRY} onOpen={noop} /></> }]),
  E('ArtTable', 'ArtTable, Figure and state marks', 'A figure with its visible table, and the five state marks and tags.', [
    { label: 'visible table inside a figure', node: <art.Figure component="bench-figure" state="live" caption="A figure and its table"><art.ArtTable caption="Rows" head={['Name', 'Value']} rows={[['a', 1], ['b', 2]]} visible /></art.Figure> },
    { label: 'marks and tags', node: <><States>{(s) => <art.StateTag state={s} reason={STATE_REASON[s]} />}</States><States>{(s) => <art.StateMark state={s} size={24} />}</States></> },
  ], ['Figure', 'StateMark', 'StateTag']),
]
export default entries
