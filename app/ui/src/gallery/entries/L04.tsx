// L04, 14 Nov 2026: Today (the Day Arc, its callouts, the Capture Line and both rails) and the Proof relief, on invented
// rows. Every number is SIMULATED; the clock is fixed at 14:20 so the picture is the same each time. Taps change only the
// gallery's own copy of a counter. The box is the real canvas under the shell's view row: 664 px high on the desk.
import { useMemo, useState } from 'react'
import { LeftRail } from '../../ww/left/Rail'
import { ProofPins } from '../../ww/proof/ProofStrip'
import { ProofRelief } from '../../ww/proof/ProofRelief'
import type { Drill, ProofStat } from '../../ww/proof/relief'
import type { TodayActions, TodayCtx } from '../../ww/day/today/context'
import { FIX_NOW, fixtureRail, fixtureRaw } from '../../ww/day/today/fixtures'
import { buildToday } from '../../ww/day/today/model'
import { TodayView } from '../../ww/day/today/TodayView'
import type { GalleryEntryX } from '../types'

const merged = 'L04, 14 Nov 2026'
const noop = () => {}

function TodayFixture({ kind, rails = true }: { kind: 'day' | 'first' | 'waiting'; rails?: boolean }) {
  const [raw, setRaw] = useState(() => fixtureRaw(kind))
  const [last, setLast] = useState<string | null>(null)
  const model = useMemo(() => buildToday(raw), [raw])
  const actions: TodayActions = useMemo(() => ({
    startBlock: noop,
    openPlan: noop,
    go: noop,
    lastCount: last,
    tapCount: (id, d) => {
      setLast(d === 1 ? id : null)
      setRaw((r) => ({ ...r, counters: r.counters?.map((c) => (c.id === id ? { ...c, today: Math.max(0, (c.today ?? 0) + d) } : c)) ?? null }))
    },
  }), [last])
  const ctx: TodayCtx = { model, raw, actions }
  return (
    <div className="td-gallery-box">
      <TodayView ctx={ctx}
        left={rails ? <LeftRail omit={['now', 'counters']} go={noop} fixture={fixtureRail(kind)} today={FIX_NOW} /> : undefined}
        right={rails ? <ProofPins stats={kind === 'waiting' ? WAITING_STATS : STATS} open={false} onOpen={noop} /> : undefined} />
    </div>
  )
}

const STATS: ProofStat[] = [
  { id: 'kept', label: 'Counters kept', value: 0.62, n: 21, state: 'simulated', caption: '13 of 21 · 7 d' },
  { id: 'days', label: 'Days logged', value: 9 / 14, n: 14, state: 'simulated', caption: '9 of 14 · 14 d' },
  { id: 'recall', label: 'Recall held', value: 0, n: 0, state: 'planned', caption: 'arrives with recall review' },
  { id: 'practice', label: 'Questions matched', value: 0, n: 0, state: 'planned', caption: 'arrives with the question store' },
  { id: 'papers', label: 'Papers reviewed', value: 0, n: 0, state: 'planned', caption: 'arrives with the paper desk' },
]
const WAITING_STATS: ProofStat[] = STATS.map((s) => (s.state === 'simulated' ? { ...s, value: 0, n: 0, state: 'waiting', caption: 'reading' } : s))

const DRILL: Record<string, Drill> = {
  kept: {
    rows: [{ label: 'Water', before: 3, after: 5 }, { label: 'Pages', before: 8, after: 12 }, { label: 'Walk', before: 1, after: 1 }],
    scale: [0, 14], unit: 'a day', values: [5, 6, 2, 7, 4, 3], noun: 'counters', histUnit: 'days kept',
  },
  days: { rows: [], scale: [0, 1], unit: 'min', values: [40, 75, 60, 90, 45, 30, 55, 80, 25], noun: 'days', histUnit: 'min logged' },
}

function RailOnly() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'stretch' }}>
      <div style={{ width: 248, height: 664 }}><LeftRail go={noop} fixture={fixtureRail('day')} today={FIX_NOW} /></div>
      <div style={{ width: 64, height: 664 }}><ProofPins stats={STATS} open={false} onOpen={noop} /></div>
    </div>
  )
}

const entries: GalleryEntryX[] = [
  {
    id: 'L04',
    title: 'Today and Proof',
    group: 'section',
    merged,
    also: ['Today', 'DayArc', 'ProofRelief'],
    note: 'The Well Wisher home under shell v2: the Day Arc (06:00 to 24:00, classes solid, planned hollow, done filled, the notch at now steps once a minute) with the minutes Odometer, the 7-day Trace against his own median, four callouts on leaders (Now holds the one accent key, n starts a block), the Capture Line and the Plan key. Both rails are one clay instrument each: the left a recessed channel of forms (a numeral, a notch scale of sittings, raised class keys), the right the Proof relief in miniature. Fixture rows, stamped SIMULATED.',
    states: [
      { label: 'a full day', node: <TodayFixture kind="day" /> },
      { label: 'first run', node: <TodayFixture kind="first" /> },
      { label: 'nothing read yet', node: <TodayFixture kind="waiting" /> },
      { label: 'both rails, every part', node: <RailOnly /> },
      { label: 'proof relief, drill-down', node: <div style={{ maxWidth: 720 }}><ProofRelief stats={STATS} state="simulated" drill={(id) => DRILL[id] ?? null} initial="kept" /></div> },
    ],
  },
]

export default entries
