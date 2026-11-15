// The gallery states of L01 (package L01): the Life month on invented rows, stamped SIMULATED by the page's own lamp. Loaded lazily
// by gallery/entries/L01.tsx, only where the build holds Well Wisher. The desk box is the real 1302 x 664 canvas the shell leaves at
// 1366 x 768, drawn at 0.72 so it fits the gallery pane; every measure divides by that zoom.
import { useMemo } from 'react'
import { DAY_PORT } from '../ports'
import { FIXTURE_MONTH, FIXTURE_TODAY, createFixturePort } from './fixtures'
import { MonthPage, type MonthPageProps } from './Month'

export type L01StateId = 'month' | 'drawer' | 'marks' | 'year' | 'waiting' | 'empty' | 'phone' | 'sheet'

const props = (state: L01StateId): { box: 'desk' | 'phone'; page: MonthPageProps; empty: boolean } => {
  const base = { today: FIXTURE_TODAY, initialMonth: FIXTURE_MONTH }
  switch (state) {
    case 'drawer': return { box: 'desk', empty: false, page: { ...base, initialDrawer: FIXTURE_TODAY } }
    case 'marks': return { box: 'desk', empty: false, page: { ...base, initialMarks: true } }
    case 'year': return { box: 'desk', empty: false, page: { ...base, initialMode: 'year' } }
    case 'waiting': return { box: 'desk', empty: false, page: { ...base, port: DAY_PORT } }
    case 'empty': return { box: 'desk', empty: true, page: { ...base } }
    case 'phone': return { box: 'phone', empty: false, page: { ...base, form: 'phone' } }
    case 'sheet': return { box: 'phone', empty: false, page: { ...base, form: 'phone', initialDrawer: FIXTURE_TODAY } }
    default: return { box: 'desk', empty: false, page: { ...base } }
  }
}

export function L01State({ state }: { state: L01StateId }) {
  const p = useMemo(() => props(state), [state])
  const port = useMemo(() => (p.page.port ? p.page.port : createFixturePort(FIXTURE_TODAY, { empty: p.empty })), [p])
  return (
    <div className="mo-gallery-box" data-form={p.box} data-state={state}>
      <MonthPage {...p.page} port={port} live={false} />
    </div>
  )
}
