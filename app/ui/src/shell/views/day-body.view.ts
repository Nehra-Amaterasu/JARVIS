// Day / Body (A.L03): the Well Wisher body view rebuilt on the Today column's pattern, under shell v2 only. With the app.shell flag off this file
// is never read and the classic frame keeps its page; the other Day views keep the frame host of hosts.ts. The page that `load` fetches is a lazy chunk.
//
// The product test is written in place, as in day-month.view.ts: Vite folds `import.meta.env.X !== 'jarvis'` only where it stands,
// so a JARVIS only build (VITE_PRODUCT=jarvis) drops the dynamic import and holds no ww/ module through this file.
import type { ComponentType } from 'react'
import type { ViewRegistration } from './index'

const Absent: ComponentType = () => null

export const view: ViewRegistration = {
  id: 'day.body',
  product: 'ww',
  load: () => (import.meta.env.VITE_PRODUCT !== 'jarvis' ? import('../../ww/day/body/Body') : Promise.resolve({ default: Absent })),
}
