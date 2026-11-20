// T02, 19 Nov 2026: Career under shell v2, five views on one runway (Runway, Ladder with Path, Abroad, Certificates, Money) on invented
// rows. The states live in ww/career/v2/gallery.tsx and are loaded lazily, only where the build holds Well Wisher (the same product gate
// as gallery/entries/L01.tsx), so a JARVIS only build carries none of it. The box is the real canvas under the shell's view row
// (1302 x 664), drawn at 0.72 to fit the pane; the phone state draws 358 px.
import { lazy, Suspense, type ComponentType } from 'react'
import type { GalleryEntryX } from '../types'

const merged = 'T02, 19 Nov 2026'

type StateId =
  | 'runway' | 'runway-row' | 'runway-empty' | 'runway-phone'
  | 'ladder' | 'path' | 'path-waiting' | 'path-import'
  | 'abroad' | 'abroad-compare' | 'abroad-cell' | 'abroad-phone'
  | 'certs' | 'certs-detail' | 'certs-waiting'
  | 'money' | 'money-unknown' | 'money-phone'
const State: ComponentType<{ state: StateId }> | null = import.meta.env.VITE_PRODUCT !== 'jarvis'
  ? lazy(() => import('../../ww/career/v2/gallery').then((m) => ({ default: m.T02State })))
  : null

const node = (state: StateId) => (State
  ? <Suspense fallback={<p role="status">Loading the Well Wisher state…</p>}><State state={state} /></Suspense>
  : <p>Well Wisher is not in this build.</p>)

const entries: GalleryEntryX[] = [
  {
    id: 'T02',
    title: 'Career: five views on one runway',
    group: 'section',
    merged,
    also: ['FlightBoard', 'SpecTable', 'RackChecklist', 'RoleConstellation', 'PlateShelf', 'FundingBridge'],
    note: 'Career under shell v2. Runway: a flight board of the next 120 days with a notch at each closing date (dashed until the date is confirmed), the five-stage table and Up next. Ladder, and Path as its second state: five rungs, a constellation of the roles you wrote or imported and a gap list ranked by roles unlocked. Abroad: spec sheets, a route diagram and the rack of requirements. Certificates: a shelf of plates, a hollow dashed plate for one not held. Money: a funding bridge, rupees and euros apart, a typed and dated rate. A date or fee cell is LIVE only with the value and the day it was checked; otherwise WAITING, unconfirmed. Every row here is invented and stamped SIMULATED; the fixture clock is Wednesday 18 November 2026.',
    states: [
      { label: 'Runway, simulated rows', node: node('runway') },
      { label: 'Runway, an application open', node: node('runway-row') },
      { label: 'Runway, nothing yet', node: node('runway-empty') },
      { label: 'Runway, phone 358 px', node: node('runway-phone') },
      { label: 'Ladder', node: node('ladder') },
      { label: 'Path, a role picked', node: node('path') },
      { label: 'Path, the plan has not answered (waiting)', node: node('path-waiting') },
      { label: 'Path, no role yet: add one', node: node('path-import') },
      { label: 'Abroad, four universities', node: node('abroad') },
      { label: 'Abroad, compare two', node: node('abroad-compare') },
      { label: 'Abroad, a cell open to confirm', node: node('abroad-cell') },
      { label: 'Abroad, phone 358 px', node: node('abroad-phone') },
      { label: 'Certificates, held and planned', node: node('certs') },
      { label: 'Certificates, one open', node: node('certs-detail') },
      { label: 'Certificates, the bank has not answered (waiting)', node: node('certs-waiting') },
      { label: 'Money, a bridge with a gap', node: node('money') },
      { label: 'Money, nothing confirmed (unknown)', node: node('money-unknown') },
      { label: 'Money, phone 358 px', node: node('money-phone') },
    ],
  },
]

export default entries
