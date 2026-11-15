// L01, 15 Nov 2026: the Life month calendar (the Almanac, DayCell, DayMark, StippleStrip and the day drawer) on invented rows. The
// states live in ww/day/month/gallery.tsx and are loaded lazily, only where the build holds Well Wisher (the same product gate as
// gallery/entries/L04.tsx), so a JARVIS only build carries none of it. The box is the real canvas under the shell's view row
// (1302 x 664), drawn at 0.72 to fit the pane; the phone states draw 390 px.
import { lazy, Suspense, type ComponentType } from 'react'
import type { GalleryEntryX } from '../types'

const merged = 'L01, 15 Nov 2026'

type StateId = 'month' | 'drawer' | 'marks' | 'year' | 'waiting' | 'empty' | 'phone' | 'sheet'
const State: ComponentType<{ state: StateId }> | null = import.meta.env.VITE_PRODUCT !== 'jarvis'
  ? lazy(() => import('../../ww/day/month/gallery').then((m) => ({ default: m.L01State })))
  : null

const node = (state: StateId) => (State
  ? <Suspense fallback={<p role="status">Loading the Well Wisher state…</p>}><State state={state} /></Suspense>
  : <p>Well Wisher is not in this build.</p>)

const entries: GalleryEntryX[] = [
  {
    id: 'L01',
    title: 'Life month calendar',
    group: 'section',
    merged,
    also: ['Almanac', 'DayCell', 'DayMark', 'StippleStrip', 'DayDrawer'],
    note: 'Day / Month under shell v2: the head (month, previous and next, Week Month Year, Today, the Google lamp, Marks), a grid of raised clay cells (a pressed tile outside the month and on a rest day) with up to four kind marks and a stipple strip of minutes, a side panel that reads the month, and the 12 px weekday strip. One tab stop with arrow-key roving. A cell shows a count only when its source lamp is LIVE or SIMULATED. The day drawer has Happened, Planned and Intents folds; "Not now" makes a carried outline. Every row is invented and stamped SIMULATED; the fixture clock is Wednesday 18 November 2026.',
    states: [
      { label: 'the month, simulated rows', node: node('month') },
      { label: 'a day open in the drawer', node: node('drawer') },
      { label: 'the Marks legend', node: node('marks') },
      { label: 'the year form', node: node('year') },
      { label: 'nothing read yet (waiting)', node: node('waiting') },
      { label: 'a month with nothing logged', node: node('empty') },
      { label: 'phone, 390 px', node: node('phone') },
      { label: 'phone, a day in the bottom sheet', node: node('sheet') },
    ],
  },
]

export default entries
