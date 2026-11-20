// Study, Plan (A.Y03): the plan board replaces the classic Plan page under shell v2 only. With the flag off the classic frame renders
// ww/study/Plan.tsx as before. The product test is written in place, as in study-papers.view.ts, so a JARVIS only build holds no ww/ module here.
import type { ComponentType } from 'react'
import type { ViewRegistration } from './index'

const Absent: ComponentType = () => null

export const view: ViewRegistration = {
  id: 'study.plan',
  product: 'ww',
  load: () => (import.meta.env.VITE_PRODUCT !== 'jarvis' ? import('../../ww/study/plan/PlanView') : Promise.resolve({ default: Absent })),
}
