// Focus / Rest (A.Y02): where a block ends, with the dots that were filled. Shell v2 only (see focus-start.view.ts).
import type { ComponentType } from 'react'
import type { ViewRegistration } from './index'

const Absent: ComponentType = () => null

export const view: ViewRegistration = {
  id: 'focus.rest',
  product: 'ww',
  load: () => (import.meta.env.VITE_PRODUCT !== 'jarvis' ? import('../../ww/focus/views/RestView') : Promise.resolve({ default: Absent })),
}
