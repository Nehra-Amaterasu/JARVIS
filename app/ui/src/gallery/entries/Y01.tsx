// Y01 on the gallery: the Paper Desk, the Review Desk and their parts, every state on INVENTED papers (the states live in
// ww/study/papers/gallery.tsx). That file is loaded lazily, only where the build holds Well Wisher (the same product gate as
// shell/views/core.view.ts and gallery/entries/L04.tsx), so a JARVIS only build carries none of it. The fixtures are drawings and
// templates, never a real paper; every reading drawn from them is stamped SIMULATED, and the null adapter's own empty state
// (WAITING) is shown beside them. Nothing here reads a route.
import { lazy, Suspense, type ComponentType } from 'react'
import type { GalleryEntryX } from '../types'

const LABELS = [
  'Paper Desk, six papers (SIMULATED)',
  'Paper Desk, nothing on file (null adapter: WAITING)',
  'Paper Desk, one paper (counts only, no pattern)',
  'Paper Desk, two papers (too few papers to show a pattern)',
  'Paper Desk with the import tray open',
  'Review Desk over the desk (the modal form)',
  'Review Desk, text beside the crop',
  'Review Desk, editing a question',
  'Review Desk, rubric strip',
  'Review Desk, OCR missing (FAULT) and the model busy (WAITING)',
  'Paper Strata, nine papers on three pages of years',
  'Coverage Ledger: SIMULATED and WAITING',
  'Import Tray: open, with a file being read',
  'Import Tray: closed (the 300 x 100 Drop Slot)',
  'Paper Drop: idle, reading, refused type',
  'Extraction Trace: real events only',
  'Extraction Trace: no run yet',
  'Crop Card: verified, unverified, crop only, editing',
  'Rubric Chips: unmarked, partial, full, none',
  'Tag chips: RULE, MODEL, HAND',
  'Strata cells of the fixture, as data',
]

const State: ComponentType<{ index: number }> | null = import.meta.env.VITE_PRODUCT !== 'jarvis'
  ? lazy(() => import('../../ww/study/papers/gallery').then((m) => ({ default: m.Y01State })))
  : null

const node = (index: number) => (State
  ? <Suspense fallback={<p role="status">Loading the Well Wisher state…</p>}><State index={index} /></Suspense>
  : <p>Well Wisher is not in this build.</p>)

const list: GalleryEntryX[] = [{
  id: 'Y01',
  title: 'Paper Desk and Review Desk',
  group: 'data',
  states: LABELS.map((label, i) => ({ label, node: node(i) })),
  note: 'The first screens of the exam generator on invented papers. Nothing here is read from a file: every reading is SIMULATED, and the null adapter answers WAITING with a reason.',
  also: ['PaperStrata', 'CoverageLedger', 'PaperDrop', 'ImportTray', 'ExtractionTrace', 'CropCard', 'RubricChips', 'ReviewDesk', 'PaperDesk', 'TagChip'],
  merged: 'Y01, 14 Nov 2026',
}]

export default list
