// Y03 on the gallery: the Study plan board and the dMAT board with their drawings, every state on INVENTED data. The states live in
// ww/study/plan/gallery.tsx and are loaded lazily, only where the build holds Well Wisher (the same product gate as Y01), so a
// JARVIS only build carries none of it. Every reading drawn from a fixture is stamped SIMULATED; states with no engine say WAITING.
import { lazy, Suspense, type ComponentType } from 'react'
import type { GalleryEntryX } from '../types'

const LABELS = [
  'Plan board, invented data (SIMULATED)',
  'Plan board, no engine and no papers (WAITING)',
  'Plan board, the Why sheet open',
  'Plan board, the Swap sheet open',
  'Sigil gauges: measured, selected and too few answers',
  'Syllabus landscape: measured and not measured',
  'Syllabus landscape: no units (empty slab)',
  'Exam wheel, four papers, one tentative date',
  'Retention orbit: no cards (WAITING)',
  'Retention orbit: four bands, DEFAULT chip (SIMULATED)',
  'dMAT setup with a last set',
  'dMAT, a set running',
  'dMAT, a scored set',
  'Plan board, papers on file but no marks yet (units not measured)',
]

const State: ComponentType<{ index: number }> | null = import.meta.env.VITE_PRODUCT !== 'jarvis'
  ? lazy(() => import('../../ww/study/plan/gallery').then((m) => ({ default: m.Y03State })))
  : null

const node = (index: number) => (State
  ? <Suspense fallback={<p role="status">Loading the Well Wisher state…</p>}><State index={index} /></Suspense>
  : <p>Well Wisher is not in this build.</p>)

const list: GalleryEntryX[] = [{
  id: 'Y03',
  title: 'Study plan board and dMAT board',
  group: 'data',
  states: LABELS.map((label, i) => ({ label, node: node(i) })),
  note: 'The plan on one canvas (today, landscape, sigil gauges, exam wheel, review orbit) and the dMAT board, on invented data. Nothing here is read from a file: every reading is SIMULATED, and the states with no engine say WAITING with the reason.',
  also: ['SyllabusLandscape', 'SigilGauge', 'ExamWheel', 'RetentionOrbit', 'PlanBoard', 'DmatBoard'],
  merged: 'Y03, 20 Nov 2026',
}]

export default list
