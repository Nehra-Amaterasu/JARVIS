// The Career workspace (plan chunk 11, 3.3 C4, 4.7): five views behind one switch, opening on Pipeline.
// One canvas per view, no page scroll: what does not fit pages (Paged.tsx), sits behind a drawer, or is another view.
import { useEffect, useState } from 'react'
import { usePlan } from '../../germoney/game/plan'
import { Button, Segmented } from '../kit'
import { openOverlay } from '../frame/overlayRegistry'
import { useFrame } from '../frame/frameStore'
import { AbroadView } from './AbroadView'
import { CertsView } from './CertsView'
import { MoneyView } from './MoneyView'
import { PipelineView } from './PipelineView'
import { PlanView } from './PlanView'
import { CAREER_VIEWS, isCareerView, type CareerView } from './model'
import { useDueNow } from './useDeadlines'
import './career.css'

export function CareerPage() {
  const loadRoad = usePlan((s) => s.loadRoad)
  const loadApplications = usePlan((s) => s.loadApplications)
  // Opening Career always starts on Pipeline (4.7). Only a view the frame names (a deep link such as
  // switchWorkspace('career', 'abroad')) overrides that; the old page's remembered tab is not read.
  const framed = useFrame((s) => s.view)
  const [view, setView] = useState<CareerView>(() => (isCareerView(useFrame.getState().view) ? (useFrame.getState().view as CareerView) : 'pipeline'))
  useEffect(() => {
    if (isCareerView(framed)) setView(framed)
  }, [framed])
  // the views read what they need from these two loads, so switching views never refetches
  useEffect(() => {
    void loadRoad()
    void loadApplications()
  }, [loadRoad, loadApplications])
  const dueNow = useDueNow()
  return (
    <div className="ww-career" data-ws-page="career" data-view={view}>
      <div className="cr-bar">
        <Segmented<CareerView> label="Career view" value={view} onChange={setView} options={CAREER_VIEWS.map((v) => ({ id: v.id, label: v.label }))} />
        <span className="cr-bar-note" data-due-now={dueNow}>
          {dueNow === 0 ? 'nothing due in 14 days' : `${dueNow} due in 14 days`}
        </span>
        <Button size="sm" onClick={() => openOverlay('record')}>
          Record
        </Button>
      </div>
      <div className="cr-body" role="region" aria-label={CAREER_VIEWS.find((v) => v.id === view)!.label}>
        {view === 'pipeline' && <PipelineView />}
        {view === 'certs' && <CertsView />}
        {view === 'abroad' && <AbroadView />}
        {view === 'money' && <MoneyView />}
        {view === 'plan' && <PlanView />}
      </div>
    </div>
  )
}
