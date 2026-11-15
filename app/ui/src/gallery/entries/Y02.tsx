// Y02 on the gallery: Focus, Start, the Crucible session, Rest and the Drill, every state on INVENTED rows (the states live in
// ww/focus/gallery.tsx). That file is loaded lazily, only where the build holds Well Wisher (the same product gate as
// shell/views/core.view.ts and gallery/entries/L04.tsx), so a JARVIS only build carries none of it. The questions are drawings,
// never a real paper; every reading drawn from them is SIMULATED, and the null port's own empty state (WAITING) is shown beside them.
// Nothing here reads a route.
import { lazy, Suspense, type ComponentType } from 'react'
import type { GalleryEntryX } from '../types'

const LABELS = [
  'Start: track, length, cue, switches and Pick for me (SIMULATED)',
  'Start: no rotation yet (WAITING)',
  'Start: a block is already running',
  'Session: 32 of 50 minutes, dots standing',
  'Session: held, with the Park field open',
  'Rest: a block ended early, the filled dots stay',
  'Rest: a block complete, one break offered',
  'Drill: a numeric question, the unit chip and the Check key',
  'Drill: two hints open (logged, nothing lowered)',
  'Drill: a miss, "Not yet. Worked answer below"',
  'Drill: a recall card, the key shown, marked by you',
  'Drill: a written answer, rubric points ticked by you',
  'Drill: the set end, counts only',
  'Drill: nothing queued (null port: WAITING)',
]

const State: ComponentType<{ index: number }> | null = import.meta.env.VITE_PRODUCT !== 'jarvis'
  ? lazy(() => import('../../ww/focus/gallery').then((m) => ({ default: m.Y02State })))
  : null

const node = (index: number) => (State
  ? <Suspense fallback={<p role="status">Loading the Well Wisher state…</p>}><State index={index} /></Suspense>
  : <p>Well Wisher is not in this build.</p>)

const list: GalleryEntryX[] = [{
  id: 'Y02',
  title: 'Focus: Start, Session, Rest and Drill',
  group: 'section',
  states: LABELS.map((label, i) => ({ label, node: node(i) })),
  note: 'The Focus section under shell v2 on invented questions. Start picks a track, a length and a cue, with the wager and the guards as kit switches (both off) and a Pick for me strip that prints its three terms. The session is the dot field, a mono readout and one terminal strip that changes only on a real event. Rest keeps the dots that were filled. The Drill asks one question at a time: a hint reveal is logged and lowers nothing, a miss says "Not yet. Worked answer below" in the same ink, and the set ends with counts only. Every reading is SIMULATED.',
  also: ['FocusStart', 'Crucible', 'FocusRest', 'Drill', 'ParkField', 'DrillDots'],
  merged: 'Y02, 15 Nov 2026',
}]

export default list
