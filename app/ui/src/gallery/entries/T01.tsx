// T01, 20 Nov 2026: the Tree under the new shell (the Grove, one tree, the node drawer, the six node states) on invented rows. The states
// live in ww/tree/gallery.tsx and are loaded lazily, only where the build holds Well Wisher (the same product gate as
// gallery/entries/L01.tsx), so a JARVIS only build carries none of it. The box is the real canvas under the shell's view row
// (1302 x 664), drawn at 0.72 to fit the pane; the phone states draw 358 px.
import { lazy, Suspense, type ComponentType } from 'react'
import type { GalleryEntryX } from '../types'

const merged = 'T01, 20 Nov 2026'

type StateId = 'grove' | 'waiting' | 'tree' | 'drawer' | 'claimed' | 'stale' | 'nodes' | 'phone' | 'sheet'
const State: ComponentType<{ state: StateId }> | null = import.meta.env.VITE_PRODUCT !== 'jarvis'
  ? lazy(() => import('../../ww/tree/gallery').then((m) => ({ default: m.T01State })))
  : null

const node = (state: StateId) => (State
  ? <Suspense fallback={<p role="status">Loading the Well Wisher state…</p>}><State state={state} /></Suspense>
  : <p>Well Wisher is not in this build.</p>)

const entries: GalleryEntryX[] = [
  {
    id: 'T01',
    title: 'Tree: Grove, one tree, node drawer',
    group: 'section',
    merged,
    also: ['GroveRing', 'SkillNode', 'TraceEdge', 'BranchSpine', 'EvidenceLedger', 'NodeDrawer', 'TreeStage'],
    note: 'Tree / Tree under shell v2. Scale 1, the Grove: ten seeds in a ring round one readout, dashed until evidence is counted, with the Next up plate and the last three records. Scale 2, one tree: branches as rows on circuit traces, level of detail by zoom, one tab stop with arrow-key roving, a growth spine that fills per node and falls when a record is deleted. Scale 3, the drawer: Evidence, Needs, Do next, Used by. Six node states told apart by shape and glyph; a self-mark draws CLAIMED, never EVIDENCED. The null adapter shows every node OPEN or LOCKED and the ledger WAITING with its reason. Every row is invented and stamped SIMULATED; the fixture clock is Wednesday 18 November 2026.',
    states: [
      { label: 'the Grove, simulated rows', node: node('grove') },
      { label: 'the Grove, no evidence store (waiting)', node: node('waiting') },
      { label: 'one tree', node: node('tree') },
      { label: 'a node open in the drawer (evidenced)', node: node('drawer') },
      { label: 'a self-mark (claimed)', node: node('claimed') },
      { label: 'a refresher due (stale)', node: node('stale') },
      { label: 'the six states on the three tiers', node: node('nodes') },
      { label: 'phone, 390 px', node: node('phone') },
      { label: 'phone, the node sheet', node: node('sheet') },
    ],
  },
]

export default entries
