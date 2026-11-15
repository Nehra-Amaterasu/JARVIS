// J04, 15 Nov 2026: the Memory section of shell v2 (Recall, Beliefs, People, Keep) on invented rows, stamped SIMULATED. The
// states live in jarvis/memory/gallery.tsx and are loaded lazily, only where the build holds JARVIS (the same product gate
// as shell/views/core.view.ts, reversed), so a Well Wisher only build carries none of it.
import { lazy, Suspense, type ComponentType } from 'react'
import type { GalleryEntryX } from '../types'

type StateId = 'recall' | 'recall-lit' | 'recall-many' | 'recall-empty' | 'strata' | 'trail' | 'results' | 'beliefs' | 'people' | 'keep'
const State: ComponentType<{ state: StateId }> | null = import.meta.env.VITE_PRODUCT !== 'ww'
  ? lazy(() => import('../../jarvis/memory/gallery').then((m) => ({ default: m.J04State })))
  : null

const node = (state: StateId) => (State
  ? <Suspense fallback={<p role="status">Loading the Memory state…</p>}><State state={state} /></Suspense>
  : <p>JARVIS is not in this build.</p>)

const entries: GalleryEntryX[] = [
  {
    id: 'J04',
    title: 'Memory (shell v2)',
    group: 'section',
    merged: 'J04, 15 Nov 2026',
    also: ['MemoryConstellation', 'StrataBands', 'Trail', 'Detail', 'RecallView', 'BeliefsView', 'PeopleView', 'KeepView'],
    note: 'What JARVIS holds, recalled, fixed and deleted. The constellation is a map of the store, not a reward: golden-angle wedges by source, radius by age with the newest in the middle, at most 120 nodes then clusters with counts, a ring and a letter on each node and never stored text. A recall draws one 240 ms dotted path through the nodes it returned, numbered in rank order. Fix shows a two-line diff with a seven-day undo; Delete names the count (drawn PLANNED while the store has no route); the remember line is the shared capture line. Beliefs, People and Keep follow spec 20.16.3. Every state is a fixture and says SIMULATED.',
    states: [
      { label: 'Recall: the constellation (55 items)', node: node('recall') },
      { label: 'Recall: a search lights nodes and draws the numbered path', node: node('recall-lit') },
      { label: 'Recall: above 120 items, clusters with counts', node: node('recall-many') },
      { label: 'Recall: an empty store, hollow with the reason', node: node('recall-empty') },
      { label: 'Recall: strata, months as dithered bands', node: node('strata') },
      { label: 'Recall: the trail of this session\'s recalls', node: node('trail') },
      { label: 'Recall: results with the matched words marked', node: node('results') },
      { label: 'Beliefs: the board, three sockets, Learned lately', node: node('beliefs') },
      { label: 'People: the alphabetical ring', node: node('people') },
      { label: 'Keep: four plates, Holdings and the sources', node: node('keep') },
    ],
  },
]

export default entries
