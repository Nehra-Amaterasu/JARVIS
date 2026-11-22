// The registered face of `study.library` under shell v2 (package C03): the Manual Intake desk, with the classic Library one press
// away as the second face, so the concept of the day, the study node and the findings keep their home. With the shell flag
// off the classic frame renders ww/study/Library.tsx exactly as before; this file is never read there.
import { lazy, Suspense, useState } from 'react'
import { Segmented } from '../../../shared/kit'
import { lookV3Enabled } from '../../../shell/v3'
import { ClassroomShelf } from '../classroom/ClassroomShelf'
import { IntakeDesk } from './IntakeDesk'

const Classic = lazy(() => import('../Library').then((m) => ({ default: m.Library })))
const CLASSIC_FALLBACK = <p className="ik-sheet-note">Opening the library</p>

// the third face is the Classroom shelf: the courses and files the Classroom link read, and a reader for them
type Face = 'intake' | 'library' | 'classroom'
const FACES = [{ id: 'intake' as const, label: 'Intake' }, { id: 'library' as const, label: 'Library' }, { id: 'classroom' as const, label: 'Classroom' }]

export default function IntakeDeskView() {
  const [face, setFace] = useState<Face>('intake')
  const switcher = <Segmented<Face> variant="choice" label="Library face" value={face} onChange={setFace} options={FACES} />
  if (face === 'classroom') return <ClassroomShelf extra={switcher} />
  if (face === 'library' && lookV3Enabled()) {
    // under the v3 look the classic Library draws its own three trays; the face switch rides at the head of the first one
    return <Suspense fallback={CLASSIC_FALLBACK}><Classic lead={switcher} /></Suspense>
  }
  if (face === 'library') {
    return (
      <div className="ik-classic" data-face="library">
        <div className="ik-classic-bar">{switcher}</div>
        <Suspense fallback={<p className="ik-sheet-note">Opening the library</p>}><Classic /></Suspense>
      </div>
    )
  }
  return <IntakeDesk extra={switcher} onShelf={() => setFace('classroom')} />
}
