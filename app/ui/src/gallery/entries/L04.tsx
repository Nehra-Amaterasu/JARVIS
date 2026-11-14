// L04, 14 Nov 2026: Today (the Day Arc, its callouts, the Capture Line and both rails) and the Proof relief, on invented
// rows. The states live in ww/day/today/gallery.tsx and are loaded lazily, only where the build holds Well Wisher (the same
// product gate as shell/views/core.view.ts), so a JARVIS only build carries none of it. The box is the real canvas under
// the shell's view row (1302 x 664), drawn at 0.72 to fit the pane.
import { lazy, Suspense, type ComponentType } from 'react'
import type { GalleryEntryX } from '../types'

const merged = 'L04, 14 Nov 2026'

type StateId = 'day' | 'first' | 'waiting' | 'rails' | 'relief'
const State: ComponentType<{ state: StateId }> | null = import.meta.env.VITE_PRODUCT !== 'jarvis'
  ? lazy(() => import('../../ww/day/today/gallery').then((m) => ({ default: m.L04State })))
  : null

const node = (state: StateId) => (State
  ? <Suspense fallback={<p role="status">Loading the Well Wisher state…</p>}><State state={state} /></Suspense>
  : <p>Well Wisher is not in this build.</p>)

const entries: GalleryEntryX[] = [
  {
    id: 'L04',
    title: 'Today and Proof',
    group: 'section',
    merged,
    also: ['Today', 'DayArc', 'ProofRelief'],
    note: 'The Well Wisher home under shell v2: the Day Arc (06:00 to 24:00, classes solid, planned hollow, done filled, the notch at now steps once a minute) with the minutes Odometer, the 7-day Trace against his own median, four callouts on leaders (Now holds the one accent key, n starts a block), the Capture Line and the Plan key. Both rails are one clay instrument each: the left a recessed channel of forms (a numeral, a notch scale of sittings, raised class keys), the right the Proof relief in miniature. Fixture rows, stamped SIMULATED.',
    states: [
      { label: 'a full day', node: node('day') },
      { label: 'first run', node: node('first') },
      { label: 'nothing read yet', node: node('waiting') },
      { label: 'both rails, every part', node: node('rails') },
      { label: 'proof relief, drill-down', node: node('relief') },
    ],
  },
]

export default entries
