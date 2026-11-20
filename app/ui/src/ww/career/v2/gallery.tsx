// The gallery states of T02 (Career, five views): invented rows only, drawn with `simulated` so every LIVE lamp and cell says SIMULATED.
// Loaded lazily by gallery/entries/T02.tsx, only where the build holds Well Wisher. The desk box is the real 1302 x 664 canvas under
// the shell's view row, drawn at 0.72 to fit the pane; the phone states draw 358 px.
import { useMemo, type ReactNode } from 'react'
import { AbroadView } from './Abroad'
import { CertificatesView } from './Certificates'
import { LadderView } from './Ladder'
import { MoneyView } from './Money'
import { RunwayView, type RunwayActions } from './Runway'
import {
  FIXTURE_APPS, FIXTURE_CELLS, FIXTURE_CERTS, FIXTURE_COST_CELLS, FIXTURE_COST_ITEMS, FIXTURE_EVIDENCED, FIXTURE_FUNDING, FIXTURE_GOALS, FIXTURE_LADDER,
  FIXTURE_NODES, FIXTURE_ROLES, FIXTURE_TAGNODE, FIXTURE_TODAY, FIXTURE_UNIS,
} from './fixtures'
import { buildDeadlines } from '../model'
import { rateRead } from './model'

export type T02StateId =
  | 'runway' | 'runway-row' | 'runway-empty' | 'runway-phone'
  | 'ladder' | 'path' | 'path-waiting' | 'path-import'
  | 'abroad' | 'abroad-compare' | 'abroad-cell' | 'abroad-phone'
  | 'certs' | 'certs-detail' | 'certs-waiting'
  | 'money' | 'money-unknown' | 'money-phone'

const noop = () => undefined
const actions: RunwayActions = { setStatus: noop, confirm: noop, unconfirm: noop, add: noop, next: noop, nextFor: noop, confirmDue: noop }
const note = <p className="t2-quiet">A campaign pulls its skill-tree nodes to the front until it ships. (invented rows)</p>

const phone = (s: T02StateId) => s.endsWith('-phone')
const W = (s: T02StateId) => (phone(s) ? 358 : 1302)

function Page({ state }: { state: T02StateId }): ReactNode {
  const width = W(state)
  const due = useMemo(() => buildDeadlines({ applications: FIXTURE_APPS, pipeline: {}, due_soon: [], tasks: [], goals: [] }, [], FIXTURE_TODAY), [])
  const common = { today: FIXTURE_TODAY, width, simulated: true }
  switch (state) {
    case 'runway': case 'runway-row': case 'runway-phone':
      return <RunwayView {...{ width, simulated: true }} data={{ apps: FIXTURE_APPS, due, today: FIXTURE_TODAY, cells: FIXTURE_CELLS }} actions={actions} campaigns={note} initialDrawer={state === 'runway-row' ? 'northgate-intern' : null} />
    case 'runway-empty':
      return <RunwayView {...{ width, simulated: true }} data={{ apps: [], due: [], today: FIXTURE_TODAY, cells: {} }} actions={actions} campaigns={note} />
    case 'ladder': case 'path': case 'path-waiting': case 'path-import': {
      const waiting = state === 'path-waiting'
      return (
        <LadderView
          {...{ width, simulated: true }} ladder={FIXTURE_LADDER} goals={FIXTURE_GOALS} roles={state === 'path-import' ? [] : FIXTURE_ROLES} tagNode={FIXTURE_TAGNODE}
          evidenced={waiting ? null : FIXTURE_EVIDENCED} nodes={FIXTURE_NODES} parking={note} rewards={null} review={note} reviewDue
          onAddRole={noop} onRemoveRole={noop} onOpenGap={noop} onGoals={noop}
          initialFace={state === 'ladder' ? 'ladder' : 'path'} initialPick={state === 'path' ? 'embedded' : null} initialDrawer={state === 'path-import' ? 'import' : null}
        />
      )
    }
    case 'abroad': case 'abroad-compare': case 'abroad-cell': case 'abroad-phone':
      return (
        <AbroadView
          {...common} unis={FIXTURE_UNIS} cells={FIXTURE_CELLS} shortlist={FIXTURE_UNIS.map((u) => u.key)} pinned={FIXTURE_UNIS[0].key} done={{ [`${FIXTURE_UNIS[0].key}:language`]: '2026-11-12', [`${FIXTURE_UNIS[0].key}:transcript`]: '2026-11-14' }}
          trialState={{}} onShortlist={noop} onPin={noop} onConfirm={noop} onClear={noop} onRack={noop} onOpenPage={noop} onStage={noop} onTrialDate={noop}
          initialCompare={state === 'abroad-compare'} initialDrawer={state === 'abroad-cell' ? `cell:${FIXTURE_UNIS[1].key}:tuition` : null}
        />
      )
    case 'certs': case 'certs-detail': case 'certs-waiting':
      return (
        <CertificatesView
          {...common} certs={state === 'certs-waiting' ? null : FIXTURE_CERTS} cells={{}} local={{}} onConfirm={noop} onClear={noop} onEarn={noop} onLocal={noop}
          initialOpen={state === 'certs-detail' ? 'c2' : null}
        />
      )
    default: {
      const unknown = state === 'money-unknown'
      return (
        <MoneyView
          {...common} items={FIXTURE_COST_ITEMS} cells={unknown ? {} : FIXTURE_COST_CELLS} rate={{ ...rateRead(unknown ? 0 : 100, unknown ? null : '2026-11-17'), source: unknown ? '' : 'the bank page I read' }}
          saved={unknown ? { inr: 0, on: null } : { inr: 150000, on: '2026-11-15' }} custom={[]} funding={unknown ? [] : FIXTURE_FUNDING}
          onConfirmCost={noop} onClearCost={noop} onRate={noop} onLog={noop} onAddCost={noop} onRemoveCost={noop} onAddFunding={noop} onRemoveFunding={noop}
        />
      )
    }
  }
}

export function T02State({ state }: { state: T02StateId }) {
  return (
    <div className="t2-gallery-box" data-form={phone(state) ? 'phone' : 'desk'} data-state={state}>
      <Page state={state} />
    </div>
  )
}
