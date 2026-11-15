// The registered face of `study.library` under shell v2 (package C03): the Manual Intake desk, with the classic Library one press
// away as the second face, so the concept of the day, the study node and the findings keep their home. With the shell flag
// off the classic frame renders ww/study/Library.tsx exactly as before; this file is never read there.
import { lazy, Suspense, useState } from 'react'
import { Segmented } from '../../../shared/kit'
import { IntakeDesk } from './IntakeDesk'

const Classic = lazy(() => import('../Library').then((m) => ({ default: m.Library })))

type Face = 'intake' | 'library'
const FACES = [{ id: 'intake' as const, label: 'Intake' }, { id: 'library' as const, label: 'Library' }]

export default function IntakeDeskView() {
  const [face, setFace] = useState<Face>('intake')
  const switcher = <Segmented<Face> variant="choice" label="Library face" value={face} onChange={setFace} options={FACES} />
  if (face === 'library') {
    return (
      <div className="ik-classic" data-face="library">
        <div className="ik-classic-bar">{switcher}</div>
        <Suspense fallback={<p className="ik-sheet-note">Opening the library</p>}><Classic /></Suspense>
      </div>
    )
  }
  return <IntakeDesk extra={switcher} />
}
