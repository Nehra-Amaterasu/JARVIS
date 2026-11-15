// Focus / Start (A.Y02): the Start form replaces the classic frame under shell v2 only. The page behind `load` is a lazy chunk.
//
// The product test is written in place, as in day-today.view.ts: Vite folds `import.meta.env.X !== 'jarvis'` only where it
// stands, so a JARVIS only build drops the dynamic import and holds no ww/ module through this file.
import type { ComponentType } from 'react'
import type { ViewRegistration } from './index'

const Absent: ComponentType = () => null

export const view: ViewRegistration = {
  id: 'focus.start',
  product: 'ww',
  load: () => (import.meta.env.VITE_PRODUCT !== 'jarvis' ? import('../../ww/focus/views/StartView') : Promise.resolve({ default: Absent })),
}
