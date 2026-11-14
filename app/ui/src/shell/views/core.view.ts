// Core, Talk (A.J01): the rebuilt Core view replaces the legacy page under shell v2 only. With the app.shell flag off
// the classic frame renders pages/Core.tsx exactly as before; this file is never read there. `core.sound` keeps its
// legacy host (hosts.ts) until its own package lands.
//
// The product test is written in place on purpose (as art/index.ts explains): Vite folds `import.meta.env.X !== 'lit'`
// to a constant only when it is written here, and Rollup then drops the dynamic import, so a Well Wisher only build
// (VITE_PRODUCT=ww) holds no jarvis/ module through this registration (scripts/bundle-budget.mjs checks it).
import type { ComponentType } from 'react'
import type { ViewRegistration } from './index'

const Absent: ComponentType = () => null

export const view: ViewRegistration = {
  id: 'core.talk',
  product: 'jarvis',
  load: () => (import.meta.env.VITE_PRODUCT !== 'ww' ? import('../../jarvis/core/CoreTalk') : Promise.resolve({ default: Absent })),
}
