// Console, Events (A.J05): the rebuilt view replaces the legacy host under shell v2 only. With the app.shell flag off the
// classic frame renders its own page exactly as before; this file is never read there. The product test is written in
// place on purpose (as core.view.ts explains): Vite folds `import.meta.env.X !== 'ww'` only where it is written here,
// so a Well Wisher only build (VITE_PRODUCT=ww) holds no jarvis/ module through this registration.
import type { ComponentType } from 'react'
import type { ViewRegistration } from './index'

const Absent: ComponentType = () => null

export const view: ViewRegistration = {
  id: 'console.events',
  product: 'jarvis',
  load: () => (import.meta.env.VITE_PRODUCT !== 'ww' ? import('../../jarvis/console/Events') : Promise.resolve({ default: Absent })),
}
