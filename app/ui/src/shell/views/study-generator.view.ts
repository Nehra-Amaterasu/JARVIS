// Study, Practice (A.X03): the practice-paper maker (Blueprint, Slots, Print) replaces the set-up door into Drill under shell v2 only.
// Drill itself stays reachable at focus.drill, so no classic feature loses its home.
//
// The product test is written in place, as in study-papers.view.ts: Vite folds it only where it stands, so a JARVIS only build
// drops the dynamic import and holds no ww/ module through this file.
import type { ComponentType } from 'react'
import type { ViewRegistration } from './index'

const Absent: ComponentType = () => null

export const view: ViewRegistration = {
  id: 'study.practice',
  product: 'ww',
  load: () => (import.meta.env.VITE_PRODUCT !== 'jarvis' ? import('../../ww/study/generator/GeneratorView') : Promise.resolve({ default: Absent })),
}
