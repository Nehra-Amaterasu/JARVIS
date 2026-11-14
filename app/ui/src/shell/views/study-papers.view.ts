// Study, Papers (A.Y01): the Paper Desk replaces the classic Papers page under shell v2 only. The classic exam-date page is kept as
// the desk's second face ("Exam dates"), so no feature of the old page loses its home.
//
// The product test is written in place, as in day-today.view.ts: Vite folds it only where it stands, so a JARVIS only build
// drops the dynamic import and holds no ww/ module through this file.
import type { ComponentType } from 'react'
import type { ViewRegistration } from './index'

const Absent: ComponentType = () => null

export const view: ViewRegistration = {
  id: 'study.papers',
  product: 'ww',
  load: () => (import.meta.env.VITE_PRODUCT !== 'jarvis' ? import('../../ww/study/papers/PaperDeskView') : Promise.resolve({ default: Absent })),
}
