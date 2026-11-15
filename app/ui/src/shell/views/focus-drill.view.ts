// Focus / Drill (A.Y02): the new Drill. The legacy id `drill` resolves here through ALIASES (shell/ids.ts). Shell v2 only (see focus-start.view.ts).
import type { ComponentType } from 'react'
import type { ViewRegistration } from './index'

const Absent: ComponentType = () => null

export const view: ViewRegistration = {
  id: 'focus.drill',
  product: 'ww',
  load: () => (import.meta.env.VITE_PRODUCT !== 'jarvis' ? import('../../ww/focus/views/DrillView') : Promise.resolve({ default: Absent })),
}
