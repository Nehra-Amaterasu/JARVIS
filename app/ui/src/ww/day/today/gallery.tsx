// The L04 gallery states, drawn on invented rows (gallery/entries/L04.tsx loads this file lazily and only in a build that
// holds Well Wisher). Every number is SIMULATED; the clock is fixed at 14:20; a tap changes only the gallery's own copy.
import { useMemo, useState } from 'react'
import { LeftRail } from '../../left/Rail'
import { ProofPins } from '../../proof/ProofStrip'
import { ProofRelief } from '../../proof/ProofRelief'
import type { Drill, ProofStat } from '../../proof/relief'
import type { TodayActions, TodayCtx } from './context'
import { FIX_NOW, fixtureRail, fixtureRaw } from './fixtures'
import { buildToday } from './model'
import { TodayView } from './TodayView'

const noop = () => {}

export function TodayFixture({ kind, rails = true }: { kind: 'day' | 'first' | 'waiting'; rails?: boolean }) {
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

export function RailOnly() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'stretch' }}>
      <div style={{ width: 248, height: 664 }}><LeftRail go={noop} fixture={fixtureRail('day')} today={FIX_NOW} /></div>
      <div style={{ width: 64, height: 664 }}><ProofPins stats={STATS} open={false} onOpen={noop} /></div>
    </div>
  )
}


export type L04StateId = 'day' | 'first' | 'waiting' | 'rails' | 'relief'

/** One gallery state by id. */
export function L04State({ state }: { state: L04StateId }) {
  if (state === 'rails') return <RailOnly />
  if (state === 'relief') return <div style={{ maxWidth: 720 }}><ProofRelief stats={STATS} state="simulated" drill={(id) => DRILL[id] ?? null} initial="kept" /></div>
  return <TodayFixture kind={state} />
}
