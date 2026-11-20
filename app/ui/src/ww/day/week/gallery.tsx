// The gallery states of L03 (package L03): Day / Week, Body and Close on invented rows, stamped SIMULATED by each page's own lamp. Loaded
// lazily by gallery/entries/L03.tsx, only where the build holds Well Wisher. The desk box is the real 1302 x 664 canvas the shell leaves at
// 1366 x 768, drawn at 0.72 so it fits the gallery pane; the phone boxes are 390 wide.
import { useMemo } from 'react'
import { DAY_PORT } from '../ports'
import { BodyPage, type BodyPageProps } from '../body/Body'
import { ClosePage, type ClosePageProps } from '../close/Close'
import type { PlanStore } from '../close/plan'
import { createFixtureStores } from '../ledger/fixtures'
import { NULL_STORES } from '../ledger/stores'
import { WeekPage, type WeekPageProps } from './Week'
import { FIXTURE_ATTENDANCE, FIXTURE_MINUTES, FIXTURE_NOW, FIXTURE_SESSIONS, FIXTURE_STALE, FIXTURE_TODAY, createWeekPort } from './fixtures'
import './base.css'

export const L03_STATES = [
  'week', 'week-move', 'week-waiting', 'week-stale', 'body', 'body-waiting', 'ledger', 'close', 'close-return', 'close-plan', 'week-phone', 'body-phone', 'close-phone',
] as const
export type L03StateId = (typeof L03_STATES)[number]

const planStore: PlanStore = {
  save: async (_d, rows) => ({ state: 'simulated', reason: 'invented rows, not your records', since: null, data: { applied: true, message: `Saved ${rows.length} line${rows.length === 1 ? '' : 's'} in the fixture only.` } }),
}

const CLOSE_BASE: ClosePageProps = {
  today: FIXTURE_TODAY, simulated: true, minutes: FIXTURE_MINUTES, classes: FIXTURE_ATTENDANCE.today.map((c) => ({ id: c.id, start: c.start, end: c.end, name: c.name, room: c.room, status: c.status })),
  tomorrowFirst: 'Fixture topic 4: fixture subject A', lastSeen: FIXTURE_TODAY, plan: planStore,
}

export function L03State({ state }: { state: L03StateId }) {
  const phone = state.endsWith('-phone')
  const form = phone ? 'phone' : 'desk'
  const week = useMemo<WeekPageProps>(() => {
    const base: WeekPageProps = { today: FIXTURE_TODAY, form, port: createWeekPort(), minutes: FIXTURE_MINUTES, attendance: FIXTURE_ATTENDANCE, simulated: true }
    if (state === 'week-move') return { ...base, initialMove: { id: '2026-11-19-ps0', date: '2026-11-19' } }
    if (state === 'week-waiting') return { today: FIXTURE_TODAY, form, port: DAY_PORT, attendance: null }
    if (state === 'week-stale') return { ...base, attendance: FIXTURE_STALE }
    return base
  }, [state, form])
  const body = useMemo<BodyPageProps>(() => {
    const base: BodyPageProps = {
      today: FIXTURE_TODAY, now: FIXTURE_NOW, form, port: createWeekPort(), stores: createFixtureStores(FIXTURE_TODAY), sessions: FIXTURE_SESSIONS, simulated: true,
      classes: FIXTURE_ATTENDANCE.today.map((c) => ({ id: c.id, start: c.start, end: c.end, name: c.name, room: c.room, status: c.status })),
    }
    if (state === 'body-waiting') return { today: FIXTURE_TODAY, now: FIXTURE_NOW, form, port: DAY_PORT, stores: NULL_STORES, sessions: [] }
    if (state === 'ledger') return { ...base, initialLedger: true }
    return base
  }, [state, form])
  const close = useMemo<ClosePageProps>(() => {
    const base: ClosePageProps = { ...CLOSE_BASE, form, port: createWeekPort() }
    if (state === 'close-return') return { ...base, lastSeen: '2026-11-12' }
    if (state === 'close-plan') return { ...base, initialPlan: true }
    return base
  }, [state, form])
  const view = state.startsWith('week') ? <WeekPage {...week} /> : state.startsWith('body') || state === 'ledger' ? <BodyPage {...body} /> : <ClosePage {...close} />
  return <div className="dy-gallery-box" data-form={form} data-state={state}>{view}</div>
}
