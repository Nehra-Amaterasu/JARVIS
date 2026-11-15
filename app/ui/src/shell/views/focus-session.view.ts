// Focus / Session (A.Y02): the registered track of the running block (the Crucible is the first). Shell v2 only; the product test is
// written in place so a JARVIS only build drops the import (see focus-start.view.ts).
import type { ComponentType } from 'react'
import type { ViewRegistration } from './index'

const Absent: ComponentType = () => null

export const view: ViewRegistration = {
  id: 'focus.session',
  product: 'ww',
  load: () => (import.meta.env.VITE_PRODUCT !== 'jarvis' ? import('../../ww/focus/views/SessionView') : Promise.resolve({ default: Absent })),
}
