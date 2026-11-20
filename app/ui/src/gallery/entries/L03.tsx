// L03, 19 Nov 2026: Day / Week, Body (with the Ledger drawer) and Close on invented rows. The states live in ww/day/week/gallery.tsx and are
// loaded lazily, only where the build holds Well Wisher (the same product gate as gallery/entries/L01.tsx), so a JARVIS only build carries none
// of it. The desk box is the real canvas under the shell's view row (1302 x 664), drawn at 0.72 to fit the pane; the phone states draw 390 px.
import { lazy, Suspense, type ComponentType } from 'react'
import type { GalleryEntryX } from '../types'

const merged = 'L03, 19 Nov 2026'

type StateId = 'week' | 'week-move' | 'week-waiting' | 'week-stale' | 'body' | 'body-waiting' | 'ledger' | 'close' | 'close-return' | 'close-plan' | 'week-phone' | 'body-phone' | 'close-phone'
const State: ComponentType<{ state: StateId }> | null = import.meta.env.VITE_PRODUCT !== 'jarvis'
  ? lazy(() => import('../../ww/day/week/gallery').then((m) => ({ default: m.L03State })))
  : null

const node = (state: StateId) => (State
  ? <Suspense fallback={<p role="status">Loading the Well Wisher state…</p>}><State state={state} /></Suspense>
  : <p>Well Wisher is not in this build.</p>)

const entries: GalleryEntryX[] = [
  {
    id: 'L03',
    title: 'Day: week, body, ledger and close',
    group: 'section',
    merged,
    also: ['Week', 'Rack', 'Margins', 'WaterGauge', 'HabitRibbon', 'LedgerDrawer', 'ClosePage'],
    note: 'Day / Week: seven day columns of blocks (a planned one hollow, a done one solid; m then arrows then Enter moves a planned block), the timetable rack with free-slot plates, and the attendance margin ledger (a 20-dot meter, the line the student set, the formula of the focused row). Day / Body: the gym session log and its seven-day strip, Water (a gauge and eight drops), Reminders you set, and Class reminders. The Ledger drawer holds the spending log, the habit counters with the ribbon, a small swap and the Help list. Day / Close: today in one look, tomorrow, Plan tomorrow, an opt-in capture line, and "Pick up here." on a return. No streak, no reset, no run of days anywhere. Every row is invented and stamped SIMULATED; the fixture clock is Wednesday 18 November 2026.',
    states: [
      { label: 'Week, simulated rows', node: node('week') },
      { label: 'Week, a planned block being moved (m)', node: node('week-move') },
      { label: 'Week, nothing read yet (waiting)', node: node('week-waiting') },
      { label: 'Week, attendance last entered 9 days ago', node: node('week-stale') },
      { label: 'Body, simulated rows', node: node('body') },
      { label: 'Body, nothing connected (waiting)', node: node('body-waiting') },
      { label: 'Body, the Ledger drawer open', node: node('ledger') },
      { label: 'Close, simulated rows', node: node('close') },
      { label: 'Close, back after some days (Pick up here.)', node: node('close-return') },
      { label: 'Close, Plan tomorrow open', node: node('close-plan') },
      { label: 'Week, phone 390 px', node: node('week-phone') },
      { label: 'Body, phone 390 px', node: node('body-phone') },
      { label: 'Close, phone 390 px', node: node('close-phone') },
    ],
  },
]

export default entries
