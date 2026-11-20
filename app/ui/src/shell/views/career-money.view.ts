// Career / Money (A.T02): the new Money view under shell v2 only. With the app.shell flag off this file is never read and the classic
// frame shows the Career page exactly as before. The page behind `load` is a lazy chunk; the product test is written in place so a
// JARVIS only build (VITE_PRODUCT=jarvis) drops the dynamic import and holds no ww/ module through this file.
import type { ComponentType } from 'react'
import type { ViewRegistration } from './index'

const Absent: ComponentType = () => null

export const view: ViewRegistration = {
  id: 'career.money',
  product: 'ww',
  load: () => (import.meta.env.VITE_PRODUCT !== 'jarvis' ? import('../../ww/career/v2/Money') : Promise.resolve({ default: Absent })),
}
