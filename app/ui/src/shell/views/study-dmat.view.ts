// Study, dMAT (A.Y03): the dMAT practice board replaces the classic Dmat page under shell v2 only. With the flag off the classic frame renders
// ww/study/Dmat.tsx as before. The product test is written in place, as in study-papers.view.ts, so a JARVIS only build holds no ww/ module here.
import type { ComponentType } from 'react'
import type { ViewRegistration } from './index'

const Absent: ComponentType = () => null

export const view: ViewRegistration = {
  id: 'study.dmat',
  product: 'ww',
  load: () => (import.meta.env.VITE_PRODUCT !== 'jarvis' ? import('../../ww/study/dmat/DmatView') : Promise.resolve({ default: Absent })),
}
