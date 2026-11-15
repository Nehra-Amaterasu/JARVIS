// Study, Library (A.C03): the Manual Intake desk replaces the classic Library page under shell v2 only. The classic Library is kept
// as the desk's second face ("Library"), so no feature of the old page loses its home.
//
// The product test is written in place, as in study-papers.view.ts: Vite folds it only where it stands, so a JARVIS only build
// drops the dynamic import and holds no ww/ module through this file.
import type { ComponentType } from 'react'
import type { ViewRegistration } from './index'

const Absent: ComponentType = () => null

export const view: ViewRegistration = {
  id: 'study.library',
  product: 'ww',
  load: () => (import.meta.env.VITE_PRODUCT !== 'jarvis' ? import('../../ww/study/intake/IntakeDeskView') : Promise.resolve({ default: Absent })),
}
