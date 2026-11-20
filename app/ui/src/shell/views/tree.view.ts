// Tree / Tree (A.T01): the Grove, one tree and the node drawer under shell v2 only. With the app.shell flag off this file is never read
// and the classic frame shows the Tree page exactly as before. The page behind `load` is a lazy chunk.
//
// The product test is written in place, as in day-month.view.ts: Vite folds `import.meta.env.X !== 'jarvis'` only where it stands,
// so a JARVIS only build (VITE_PRODUCT=jarvis) drops the dynamic import and holds no ww/ module through this file.
import type { ComponentType } from 'react'
import type { ViewRegistration } from './index'

const Absent: ComponentType = () => null

export const view: ViewRegistration = {
  id: 'tree.tree',
  product: 'ww',
  load: () => (import.meta.env.VITE_PRODUCT !== 'jarvis' ? import('../../ww/tree/TreeView') : Promise.resolve({ default: Absent })),
}
