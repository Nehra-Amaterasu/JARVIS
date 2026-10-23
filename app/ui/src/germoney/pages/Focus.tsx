/**
 * Mission → Focus: deep work and recall in one place. The Crucible (a timed
 * session with the distraction guard) and Drill (spaced repetition). Absorbs the
 * Crucible and Drill tabs; both pages run unchanged inside it.
 */
import { useStore } from '../../lib/store'
import { MissionHeader } from '../ui'
import { CruciblePage } from './Crucible'
import { DrillPage } from './Drill'

export function FocusPage() {
  const tab = useStore((s) => s.tab)
  const setTab = useStore((s) => s.setTab)
  const drill = tab === 'drill'
  return (
    <div className="mission-page focus">
      <MissionHeader n="M3" title="Focus" sub={drill ? 'Drill: answer in your head, reveal, grade yourself honestly.' : 'Crucible: pick a length and a track. No distractions in front.'}
        right={<div className="seg" role="tablist" aria-label="Focus mode">
          <button role="tab" aria-selected={!drill} className={`chip ${!drill ? 'on' : ''}`} onClick={() => setTab('crucible')}>Crucible</button>
          <button role="tab" aria-selected={drill} className={`chip ${drill ? 'on' : ''}`} onClick={() => setTab('drill')}>Drill</button>
        </div>} />
      <div className="embedded">{drill ? <DrillPage /> : <CruciblePage />}</div>
    </div>
  )
}
