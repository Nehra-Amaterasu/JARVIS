// C03, 15 Nov 2026: the Manual Intake desk (the four doors, the ledger with provenance, Accept and Decline, the Course Mapper) on
// invented items. The states live in ww/study/intake/gallery.tsx and are loaded lazily, only where the build holds Well Wisher
// (the same product gate as gallery/entries/L04.tsx and Y01.tsx), so a JARVIS only build carries none of it. The box is the real
// canvas under the shell's view row (1230 x 664). Every item is invented and stamped SIMULATED.
import { lazy, Suspense, type ComponentType } from 'react'
import type { GalleryEntryX } from '../types'

const merged = 'C03, 15 Nov 2026'

const LABELS = [
  'Intake desk, twelve items (SIMULATED)',
  'Intake desk, nothing brought in (null adapters: WAITING)',
  'An item with an ambiguous date: Accept waits for the choice',
  'A folder file and its attachment ladder',
  'Accepted items (the Accepted filter)',
  'Forty new items: the first screen, grouped and paged',
  'Paste door: lines read, one not read',
  'Calendar-file door: events with their keep switches',
  'Archive door: listed before anything is queued',
  'Course Mapper: mapped, suggested, unmapped',
  'Folder door',
  'Parts: ProvenanceChip and AttachmentLadder',
  'Intake desk, live and empty: the tray picture moves (SIMULATED)',
]

const State: ComponentType<{ index: number }> | null = import.meta.env.VITE_PRODUCT !== 'jarvis'
  ? lazy(() => import('../../ww/study/intake/gallery').then((m) => ({ default: m.C03State })))
  : null

const node = (index: number) => (State
  ? <Suspense fallback={<p role="status">Loading the Well Wisher state…</p>}><State index={index} /></Suspense>
  : <p>Well Wisher is not in this build.</p>)

const entries: GalleryEntryX[] = [
  {
    id: 'C03',
    title: 'Manual Intake desk',
    group: 'section',
    merged,
    also: ['IntakeDesk', 'IntakeLedger', 'IntakeDetail', 'Doors', 'ProvenanceChip', 'AttachmentLadder', 'PasteParser', 'IcsPreview', 'ExportImportDrop', 'CourseMapper', 'CourseMapRow'],
    note: 'Study > Library under shell v2: bring deadlines and course files in with no account. Four doors (Folder, Paste, Calendar file, Archive) and a PLANNED Classroom plate; under them the ledger, grouped by when an item matters (This week, Later, No date), every row with the door it came through; on the right the chosen item with its provenance sentence and Accept or Decline. Nothing is accepted without his press and an accepted deadline never changes a count. An ambiguous date must be chosen first; a file is taken to Papers or Notes, never fetched. Invented items, stamped SIMULATED.',
    states: LABELS.map((label, i) => ({ label, node: node(i) })),
  },
]

export default entries
