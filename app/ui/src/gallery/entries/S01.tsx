// S01, 20 Nov 2026: Core, Sound under shell v2 (the Now plate with its sigil ring and the one warm play key, the library plate,
// the spoken words plate, the PLANNED Spotify plate, and the drawer that holds the library, the words and the music folder),
// on invented fixtures stamped SIMULATED. The states live in jarvis/sound/gallery.tsx and are loaded lazily, only where the
// build holds JARVIS (the same product test as shell/views/core.view.ts), so a Well Wisher only build carries none of it.
import { lazy, Suspense, type ComponentType } from 'react'
import type { GalleryEntryX } from '../types'

const merged = 'S01, 20 Nov 2026'

type StateId = 'playing' | 'paused' | 'rest' | 'opened' | 'failed' | 'waiting' | 'unreadable' | 'library' | 'words' | 'folder' | 'answer' | 'job' | 'phone'
const State: ComponentType<{ state: StateId }> | null = import.meta.env.VITE_PRODUCT !== 'ww'
  ? lazy(() => import('../../jarvis/sound/gallery').then((m) => ({ default: m.S01State })))
  : null

const node = (state: StateId) => (State
  ? <Suspense fallback={<p role="status">Loading the JARVIS state…</p>}><State state={state} /></Suspense>
  : <p>JARVIS is not in this build.</p>)

const entries: GalleryEntryX[] = [
  {
    id: 'S01',
    title: 'Core: Sound',
    group: 'section',
    merged,
    also: ['SoundView', 'NowPlate', 'Ring', 'LibraryCard', 'WordsCard', 'SoundDrawer'],
    note: 'The Now plate shows what Windows or the window reported, the server\'s receipt word for word with its provenance, and a sigil ring that draws the state only (the app reports no level and no position, so no meter is drawn). Space on the plate plays or pauses. The library and the spoken words sit behind one key each; Spotify play by name stays a PLANNED plate. A route that does not answer is WAITING with its reason. Fixture rows, stamped SIMULATED.',
    states: [
      { label: 'Playing', node: node('playing') },
      { label: 'Paused', node: node('paused') },
      { label: 'Nothing playing (designed rest)', node: node('rest') },
      { label: 'Opened, not confirmed (Spotify search)', node: node('opened') },
      { label: 'Failed receipt', node: node('failed') },
      { label: 'Windows sessions not readable', node: node('unreadable') },
      { label: 'No route answered', node: node('waiting') },
      { label: 'Library running a job', node: node('job') },
      { label: 'Library drawer', node: node('library') },
      { label: 'Library answer with a passage', node: node('answer') },
      { label: 'Pronunciation drawer', node: node('words') },
      { label: 'Music folder drawer', node: node('folder') },
      { label: 'Phone, one column', node: node('phone') },
    ],
  },
]

export default entries
