/**
 * The Study workspace (plan 3.3 C1): four views behind one switch, Papers by default. The view is the
 * frame's (`useFrame.view`), so a legacy deep link ("schedule" opens Plan, "interrogation" opens Library) and the
 * Back chip keep working. Importing this file registers the Reader (O3) and Add questions (O8).
 */
import { Segmented } from '../kit'
import { useFrame } from '../frame/frameStore'
import { switchWorkspace } from '../frame/navigate'
import '../overlays/Reader'
import '../overlays/AddQuestions'
import { Dmat } from './Dmat'
import { Library } from './Library'
import { Papers } from './Papers'
import { Plan } from './Plan'
import './study.css'

export const STUDY_VIEWS = ['papers', 'plan', 'library', 'dmat'] as const
export type StudyView = (typeof STUDY_VIEWS)[number]
const LABEL: Record<StudyView, string> = { papers: 'Papers', plan: 'Plan', library: 'Library', dmat: 'dMAT' }

export const viewOf = (v: string | null | undefined): StudyView => ((STUDY_VIEWS as readonly string[]).includes(v ?? '') ? (v as StudyView) : 'papers')

export function StudyPage() {
  const raw = useFrame((s) => s.view)
  const view = viewOf(raw)
  return (
    <div className="ww-study" data-ws-page="study" data-study-view={view}>
      <Segmented<StudyView> label="Study views" value={view} onChange={(v) => void switchWorkspace('study', v)}
        options={STUDY_VIEWS.map((id) => ({ id, label: LABEL[id] }))} />
      {view === 'papers' && <Papers />}
      {view === 'plan' && <Plan />}
      {view === 'library' && <Library />}
      {view === 'dmat' && <Dmat />}
    </div>
  )
}
