// J02, 15 Nov 2026: Room under shell v2 (the wall box with its guard keys and three-phase lamps, the mode dial, the board plate,
// the 24 hour ring with a preview-only scrubber, the rules as logic gates, the modes, the relay pin map), on invented fixtures
// stamped SIMULATED. The states live in jarvis/room/gallery.tsx and are loaded lazily, only where the build holds JARVIS (the same
// product test as shell/views/core.view.ts), so a Well Wisher only build carries none of it. The box is the real canvas under
// the shell's view row, drawn at 0.66 to fit the pane.
import { lazy, Suspense, type ComponentType } from 'react'
import type { GalleryEntryX } from '../types'

const merged = 'J02, 15 Nov 2026'

type StateId = 'switches' | 'asked' | 'offline' | 'virtual' | 'rules' | 'rules-waiting' | 'keys' | 'ring' | 'phone'
const State: ComponentType<{ state: StateId }> | null = import.meta.env.VITE_PRODUCT !== 'ww'
  ? lazy(() => import('../../jarvis/room/gallery').then((m) => ({ default: m.J02State })))
  : null

const node = (state: StateId) => (State
  ? <Suspense fallback={<p role="status">Loading the JARVIS state…</p>}><State state={state} /></Suspense>
  : <p>JARVIS is not in this build.</p>)

const entries: GalleryEntryX[] = [
  {
    id: 'J02',
    title: 'Room: Switches and Rules',
    group: 'section',
    merged,
    also: ['GuardKey', 'DayRing24', 'Faceplate', 'BoardPlate', 'ModeDial', 'GateCard', 'RoomSwitchesView', 'RoomRulesView'],
    note: 'The wall box: eight keys whose lamps follow the board only (asked is WAITING with a 6 s sweep, confirmed is LIVE only after the board reported, no report after 6 s is FAULT, a free channel is dashed "unavailable"). A channel the owner flags as a heavy load needs its cover lifted first; OFF is always one press. The day ring previews with its scrubber and sends nothing. Rules are three logic gates with their last real firing; a route that did not answer draws hollow. Fixture rows, stamped SIMULATED.',
    states: [
      { label: 'Switches, live board', node: node('switches') },
      { label: 'Switches, two asks pending', node: node('asked') },
      { label: 'Switches, board offline', node: node('offline') },
      { label: 'Switches, virtual room', node: node('virtual') },
      { label: 'Rules', node: node('rules') },
      { label: 'Rules, nothing answered', node: node('rules-waiting') },
      { label: 'Every key state', node: node('keys') },
      { label: 'Day ring, with and without rules', node: node('ring') },
      { label: 'Phone, one column', node: node('phone') },
    ],
  },
]

export default entries
