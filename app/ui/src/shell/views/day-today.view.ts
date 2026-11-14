// Day / Today (A.L04): the Well Wisher home rebuilt as the Day Arc with its callouts and both rails, under shell v2 only.
// With the app.shell flag off this file is never read and the classic frame shows the Life page exactly as before; the
// other Day views keep the frame host of hosts.ts. The page behind `load` is a lazy chunk.
import type { ViewRegistration } from './index'

export const view: ViewRegistration = {
  id: 'day.today',
  product: 'ww',
  load: () => import('../../ww/day/today/Today'),
}
