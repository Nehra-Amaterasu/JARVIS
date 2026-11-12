// The PLANNED homes of the two views direction v2 adds (wave 5): N02 registers the view ids day.month and focus.drill,
// and until L01 (the month calendar) and Y02 (Drill in Focus) build them, each view has one honest plate here. This
// is also the first file the `*.planned.ts` glob in registry.ts collects. Types only: see the note in registry.ts.
import type { PlannedEntry } from './types'

const SINCE = '2026-11-13'
const REVIEW_BY = '2027-02-11' // since + 90 days, the review window of spec 12.3

export const planned: readonly PlannedEntry[] = [
  {
    id: 'ww.day-month', product: 'ww', home: 'day.month', label: 'Month calendar', pattern: 'coming', blocker: 'build',
    line: 'The month calendar with a mark for each logged day is not built. The day and week views work now.',
    works_today: 'The day view lists what you logged today.',
    needs: 'The month calendar view of the Life section.', since: SINCE, reviewBy: REVIEW_BY, owner: 'ui-chat',
  },
  {
    id: 'ww.focus-drill', product: 'ww', home: 'focus.drill', label: 'Drill in Focus', pattern: 'coming', blocker: 'build',
    line: 'A timed question drill inside a focus block is not built. A plain focus block works now.',
    works_today: 'Start a focus block from the Focus section.',
    needs: 'The drill view and a question bank to draw from.', since: SINCE, reviewBy: REVIEW_BY, owner: 'ui-chat',
  },
]
