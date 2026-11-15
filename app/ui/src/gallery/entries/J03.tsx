// J03, 15 Nov 2026: the Senses section (Presence, Signal, Teach) on invented frames of an invented room, every reading
// SIMULATED. The states live in jarvis/senses/gallery.tsx and are loaded lazily, only where the build holds JARVIS (the same
// product gate as shell/views/core.view.ts, written in place so Vite folds it), so a Well Wisher only build carries none of it.
import { lazy, Suspense, type ComponentType } from 'react'
import type { GalleryEntryX } from '../types'

const merged = 'J03, 15 Nov 2026'

type StateId = 'presence' | 'presence-none' | 'presence-trusted' | 'presence-offline' | 'signal' | 'signal-none' | 'teach' | 'teach-unread'
const State: ComponentType<{ state: StateId }> | null = import.meta.env.VITE_PRODUCT !== 'ww'
  ? lazy(() => import('../../jarvis/senses/gallery').then((m) => ({ default: m.J03State })))
  : null

const node = (state: StateId) => (State
  ? <Suspense fallback={<p role="status">Loading the Senses state...</p>}><State state={state} /></Suspense>
  : <p>JARVIS is not in this build.</p>)

const entries: GalleryEntryX[] = [
  {
    id: 'J03',
    title: 'Senses',
    group: 'section',
    merged,
    also: ['PresenceView', 'SignalView', 'TeachView', 'SignalTerrain', 'LinkCube', 'ChannelMatrix', 'ProbabilityArc', 'MotionTape', 'FloorPlan', 'TeachRingForm'],
    note: 'Camera-free Wi-Fi sensing: it detects motion of anyone in range and identifies no one; one link, no pose. Presence holds the one canvas (the signal terrain, 51 subcarriers by 24 frames), the link row, the probability arc (a band and the word PREDICTING, no digit before the held-out day), the motion tape and the isometric floor plan; Signal is SVG only; Teach is four sigil rings and the desk. Fixture frames, stamped SIMULATED; with no frames every form is hollow.',
    states: [
      { label: 'presence, simulated frames', node: node('presence') },
      { label: 'presence, no frames (hollow)', node: node('presence-none') },
      { label: 'presence, held-out day passed', node: node('presence-trusted') },
      { label: 'presence, the server not answering', node: node('presence-offline') },
      { label: 'signal, simulated frames', node: node('signal') },
      { label: 'signal, no frames', node: node('signal-none') },
      { label: 'teach, steps half done', node: node('teach') },
      { label: 'teach, readiness not read', node: node('teach-unread') },
    ],
  },
]

export default entries
