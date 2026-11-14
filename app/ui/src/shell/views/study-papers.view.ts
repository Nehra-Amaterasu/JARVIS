// Study, Papers (A.Y01): the Paper Desk replaces the classic Papers page under shell v2 only. The classic exam-date page is kept as
// the desk's second face ("Exam dates"), so no feature of the old page loses its home.
import type { ViewRegistration } from './index'

export const view: ViewRegistration = {
  id: 'study.papers',
  product: 'ww',
  load: () => import('../../ww/study/papers/PaperDeskView'),
}
