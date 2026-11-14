// Today, the Well Wisher home under shell v2 (spec 20.16.1, 21.5.1; A.L04). Registered by shell/views/day-today.view.ts, so it
// replaces the frame on Day / Today only; with the shell flag off the classic frame and its Life page are exactly as before.
//
// Nothing here is new logic: the rows come from the stores that already read them (the left column's store for classes,
// counters, the date sheet and the director's step; the plan store for the plan blocks and the block log), and the plan
// editor, add-to-day, attendance and quests are the existing Life cards, opened in one drawer by the Plan key (moved, not
// rewritten). The page owns one timeout: the arc's notch steps on the minute.
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Drawer } from '../../../shared/kit'
import type { Parsed } from '../../../shared/capture'
import { usePlan } from '../../../germoney/game/plan'
import { useStore } from '../../../lib/store'
import { useShell } from '../../../shell/store'
import { OverlayHost } from '../../frame/OverlayHost'
import { useLeft } from '../../left/store'
import { LeftRail } from '../../left/Rail'
import { ProofStrip } from '../../proof/ProofStrip'
import { AddToDay } from '../../life/AddToDay'
import { Attendance } from '../../life/Attendance'
import { QuestCard } from '../../life/QuestCard'
import { classProgress } from '../../life/derive'
import { useAttendance, useLifeDay } from '../../life/useLife'
import '../../life/life.css'
import type { TodayActions, TodayCtx } from './context'
import { buildToday, msToNextMinute, ymd, type TodayRaw } from './model'
import { TodayView } from './TodayView'

/** The frame's overlays (date sheet, phone, log minutes) register themselves on import; loaded with the page, not before. */
const Overlays = lazy(() => import('../../overlays/setupOverlays').then(() => ({ default: OverlayHost })))

/** A Date that changes once a minute, on the minute: one timeout re-armed after each step, never an interval or a frame loop. */
export function useMinute(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setTimeout(() => setNow(new Date()), msToNextMinute(now))
    return () => clearTimeout(id)
  }, [now])
  return now
}

function useTodayRaw(now: Date): TodayRaw {
  const classes = useLeft((s) => s.classes)
  const papers = useLeft((s) => s.papers)
  const counters = useLeft((s) => s.counters)
  const step = useLeft((s) => s.now)
  const blocks = usePlan((s) => s.today?.blocks ?? null)
  const events = usePlan((s) => s.state?.events ?? null)
  const day = ymd(now)
  return useMemo(() => ({
    now,
    date: day,
    classes,
    plan: blocks ? blocks.map((b) => ({ id: b.id, label: b.label, start: b.start, minutes: b.minutes })) : null,
    logs: events,
    papers,
    counters,
    step: step ? { title: step.title, minutes: step.minutes, kind: step.kind } : null,
  }), [now, day, classes, blocks, events, papers, counters, step])
}

/** The Plan drawer: the Life page's own cards, unchanged, in the order the Life page shows them. */
function PlanDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const day = useLifeDay()
  const att = useAttendance()
  const pending = classProgress(att.data?.today).pending > 0
  return (
    <Drawer open={open} onClose={onClose} title="Plan the day" place="right" className="td-plan">
      <div className="ww ww-life td-plan-body" data-ww-life="">
        <AddToDay state={day} index={0} />
        <QuestCard classPending={pending} index={1} />
        <Attendance state={att} index={2} />
      </div>
    </Drawer>
  )
}

export default function Today() {
  const now = useMinute()
  const raw = useTodayRaw(now)
  const model = useMemo(() => buildToday(raw), [raw])
  const lastCount = useLeft((s) => s.lastCount)
  const [plan, setPlan] = useState(false)

  // the reads already exist; Today only asks for them when nothing has yet (the frame asks on its own mount)
  useEffect(() => {
    const ph = useLeft.getState().phase
    if (Object.values(ph).every((p) => p === 'idle')) void useLeft.getState().load()
    if (usePlan.getState().today === null) void usePlan.getState().refresh()
  }, [])

  const go = useCallback((section: string, view: string) => useShell.getState().go({ product: 'ww', section, view }), [])
  const actions: TodayActions = useMemo(() => ({
    startBlock: () => go('focus', 'start'),
    tapCount: (id, d) => void useLeft.getState().tapCount(id, d),
    lastCount,
    openPlan: () => setPlan(true),
    go,
  }), [go, lastCount])
  const ctx: TodayCtx = useMemo(() => ({ model, raw, actions }), [model, raw, actions])

  const onCapture = useCallback((p: Parsed) => {
    const toast = useStore.getState().toast
    if (p.grammar === 'ww' && p.verb === 'water') {
      const water = useLeft.getState().counters?.find((c) => c.id === 'water')
      if (water) {
        void useLeft.getState().tapCount('water', 1)
        return
      }
    }
    // honest: the line understood it, but Today has no store for this verb yet, so nothing was saved
    toast(`Understood "${p.verb}", but Today cannot save it yet. Nothing was stored.`, 'info')
  }, [])

  return (
    <TodayView ctx={ctx} onCapture={onCapture}
      left={<LeftRail omit={['now', 'counters']} go={go} />}
      right={<ProofStrip />}>
      <PlanDrawer open={plan} onClose={() => setPlan(false)} />
      <Suspense fallback={null}><Overlays /></Suspense>
    </TodayView>
  )
}
