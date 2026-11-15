// Memory, recall (A.J04): the rebuilt view replaces the hosted classic page under shell v2 only. With the app.shell flag off the
// classic frame renders pages/Yaadash.tsx and pages/Connect.tsx exactly as before; this file is never read there.
//
// The product test is written in place on purpose (as core.view.ts explains): Vite folds `import.meta.env.X !== 'ww'` to a constant
// only when it is written here, and Rollup then drops the dynamic import, so a Well Wisher only build (VITE_PRODUCT=ww) holds
// no jarvis/ module through this registration.
import type { ComponentType } from 'react'
import type { ViewRegistration } from './index'

const Absent: ComponentType = () => null

export const view: ViewRegistration = {
  id: 'memory.recall',
  product: 'jarvis',
  load: () => (import.meta.env.VITE_PRODUCT !== 'ww' ? import('../../jarvis/memory/MemoryRecall') : Promise.resolve({ default: Absent })),
}
