// Y01 on the gallery: the Paper Desk, the Review Desk and their parts, every state on INVENTED papers. The fixtures are drawings and
// templates (ww/study/papers/fixtures.ts), never a real paper; every reading drawn from them is stamped SIMULATED, and the null
// adapter's own empty state (WAITING) is shown beside them. Nothing here reads a route.
import { useState, type ReactNode } from 'react'
import { PaperDesk, EMPTY_DATA, WAITING_ROUTES, type DeskData } from '../../ww/study/papers/PaperDesk'
import { PaperDrop, PAPER_ACCEPT } from '../../ww/study/papers/PaperDrop'
import { ImportTray } from '../../ww/study/papers/ImportTray'
import { ExtractionTrace } from '../../ww/study/papers/ExtractionTrace'
import { CoverageLedger } from '../../ww/study/papers/CoverageLedger'
import { PaperStrata } from '../../ww/study/papers/PaperStrata'
import { CropCard } from '../../ww/study/review/CropCard'
import { RubricChips } from '../../ww/study/review/RubricChips'
import { ReviewDesk } from '../../ww/study/review/ReviewDesk'
import { TagChip } from '../../ww/study/review/TagChip'
import { NOW, PAPERS, QUESTIONS, TOPICS, TRACE, YEARS, cellsFor, fixtureCrop } from '../../ww/study/papers/fixtures'
import { cellsOf, coverageOf } from '../../ww/study/papers/strataModel'
import type { IngestRoute, QueuedFile, RubricPoint } from '../../ww/study/ports'
import type { GalleryEntryX } from '../types'
import '../../ww/study/papers/papers.css'
import '../../ww/study/review/review.css'

const ROUTES: IngestRoute[] = [
  { id: 'drop', label: 'Drop', state: 'simulated', reason: 'fixture' },
  { id: 'paste', label: 'Paste text', state: 'simulated', reason: 'fixture' },
  { id: 'folder', label: 'Watch a folder', state: 'waiting', reason: 'choose a folder to watch' },
  { id: 'classroom', label: 'Connect through Classroom', state: 'planned', reason: 'not built' },
]
const QUEUED: QueuedFile[] = [
  { id: 'f1', name: 'paper-2024.pdf', method: 'text-layer', wordsPerPage: [412, 388, 0, 361], reading: false },
  { id: 'f2', name: 'scan-2018.pdf', method: 'ocr', wordsPerPage: [], reading: true },
  { id: 'f3', name: 'slides-unit4.pdf', method: 'slides', wordsPerPage: [120, 98], reading: false },
]

const FIX: DeskData = {
  state: 'simulated', reason: 'invented papers for the gallery', papers: PAPERS, questions: QUESTIONS, topics: TOPICS, events: TRACE,
  queued: QUEUED.slice(0, 1), routes: ROUTES, lastRun: NOW - 3 * 3_600_000,
}
const subset = (n: number): DeskData => {
  const ys = YEARS.slice(0, n)
  return { ...FIX, papers: PAPERS.filter((p) => ys.includes(p.year)), questions: QUESTIONS.filter((q) => ys.includes(q.year)), events: [], queued: [] }
}

/** The desk's own box: 1230 x 664 at desktop widths (the shell canvas), the full width and natural height on a phone. */
const Box = ({ children }: { children: ReactNode }) => <div className="y01-box">{children}</div>
const Fixed = ({ w, children }: { w: number; children: ReactNode }) => <div style={{ inlineSize: '100%', maxInlineSize: w }}>{children}</div>

const POINTS: RubricPoint[] = [
  { id: 'r1', text: 'States the definition', marks: 2, origin: 'HAND', accepted: true },
  { id: 'r2', text: 'Sets up the relation', marks: 2, origin: 'RULE', accepted: true },
  { id: 'r3', text: 'Draws the diagram', marks: 1, origin: 'MODEL', accepted: false },
]

function Interactive() {
  const [on, setOn] = useState<string[]>(['r1'])
  return <RubricChips points={POINTS} awarded={on} marked onToggle={(id) => setOn((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))} />
}
function ReviewBox({ children }: { children: ReactNode }) { return <div className="y01-review">{children}</div> }

const pending = QUESTIONS.filter((q) => q.status === 'pending')
const crop = (i: number) => ({ img: fixtureCrop(40 + i, 3 + (i % 3)), bbox: [20, 30, 460, 60] as const })
const states = [
  { label: 'Paper Desk, six papers (SIMULATED)', node: <Box><PaperDesk data={FIX} now={NOW} classic={false} /></Box> },
  { label: 'Paper Desk, nothing on file (null adapter: WAITING)', node: <Box><PaperDesk data={EMPTY_DATA} now={NOW} classic={false} /></Box> },
  { label: 'Paper Desk, one paper (counts only, no pattern)', node: <Box><PaperDesk data={subset(1)} now={NOW} classic={false} /></Box> },
  { label: 'Paper Desk, two papers (too few papers to show a pattern)', node: <Box><PaperDesk data={subset(2)} now={NOW} classic={false} /></Box> },
  { label: 'Paper Desk with the import tray open', node: <Box><PaperDesk data={FIX} now={NOW} classic={false} trayOpen /></Box> },
  { label: 'Review Desk over the desk (the modal form)', node: <Box><PaperDesk data={FIX} now={NOW} classic={false} reviewOpen /></Box> },
  { label: 'Review Desk, text beside the crop', node: <ReviewBox><ReviewDesk questions={pending} topics={TOPICS} events={TRACE} state="simulated" reason="invented papers" paperLabel="Paper 2024" defaultSideBySide /></ReviewBox> },
  { label: 'Review Desk, editing a question', node: <ReviewBox><ReviewDesk questions={pending} topics={TOPICS} events={TRACE} state="simulated" reason="invented papers" paperLabel="Paper 2024" defaultEditing startId="q2024-3" /></ReviewBox> },
  { label: 'Review Desk, rubric strip', node: <ReviewBox><ReviewDesk questions={pending} topics={TOPICS} events={TRACE} state="simulated" reason="invented papers" paperLabel="Paper 2024" defaultRubric /></ReviewBox> },
  { label: 'Review Desk, OCR missing (FAULT) and the model busy (WAITING)', node: <ReviewBox><ReviewDesk questions={pending} topics={TOPICS} events={TRACE.slice(0, 3)} state="simulated" reason="invented papers" paperLabel="Paper 2024" ocrMissing modelBusy startId="q2024-5" /></ReviewBox> },
  { label: 'Paper Strata, nine papers on three pages of years', node: (
    <Fixed w={600}>
      <PaperStrata
        cells={cellsFor(YEARS)}
        years={[...YEARS, 2016, 2017, 2018].sort()}
        topics={TOPICS}
        coverage={coverageOf(PAPERS, QUESTIONS, NOW)}
        onOpen={() => undefined}
        state="simulated"
        reason="invented papers"
        selectedYear={2022}
      />
    </Fixed>
  ) },
  { label: 'Coverage Ledger: SIMULATED and WAITING', node: (
    <Fixed w={1230}>
      <div style={{ display: 'grid', gap: 12 }}>
        <CoverageLedger coverage={coverageOf(PAPERS, QUESTIONS, NOW - 3 * 3_600_000)} state="simulated" reason="invented papers" now={NOW} />
        <CoverageLedger coverage={coverageOf([], [], null)} state="waiting" reason="the paper engine is not connected yet" now={NOW} />
      </div>
    </Fixed>
  ) },
  { label: 'Import Tray: open, with a file being read', node: <Fixed w={300}><div style={{ blockSize: 270, display: 'grid', alignContent: 'end' }}><ImportTray defaultOpen routes={ROUTES} queued={QUEUED} onFiles={() => undefined} accept={PAPER_ACCEPT} /></div></Fixed> },
  { label: 'Import Tray: closed (the 300 x 100 Drop Slot)', node: <Fixed w={300}><ImportTray routes={WAITING_ROUTES} queued={[]} onFiles={() => undefined} accept={PAPER_ACCEPT} /></Fixed> },
  { label: 'Paper Drop: idle, reading, refused type', node: (
    <Fixed w={300}>
      <div style={{ display: 'grid', gap: 12 }}>
        <PaperDrop onFiles={() => undefined} accept={PAPER_ACCEPT} />
        <PaperDrop onFiles={() => undefined} accept={PAPER_ACCEPT} reading />
        <PaperDrop onFiles={() => undefined} accept={PAPER_ACCEPT} variant="row" />
      </div>
    </Fixed>
  ) },
  { label: 'Extraction Trace: real events only', node: <Fixed w={620}><ExtractionTrace events={TRACE} /></Fixed> },
  { label: 'Extraction Trace: no run yet', node: <Fixed w={620}><ExtractionTrace events={[]} /></Fixed> },
  { label: 'Crop Card: verified, unverified, crop only, editing', node: (
    <div className="y01-cards">
      <CropCard {...crop(1)} text="Which statement about waves is correct?" textStatus="verified" simulated chips={<TagChip source="RULE" label="margin 0.72" />} />
      <CropCard {...crop(2)} text="Explain in three lines why optics matters." textStatus="unverified" simulated chips={<TagChip source="MODEL" label="margin 0.09" />} />
      <CropCard img={crop(3).img} textStatus="crop-only" simulated chips={<TagChip source="HAND" />} />
      <CropCard {...crop(4)} text="Find the quantity asked in part (a)." textStatus="unverified" editing simulated chips={<TagChip source="RULE" />} />
    </div>
  ) },
  { label: 'Rubric Chips: unmarked, partial, full, none', node: (
    <div className="y01-rubrics">
      <RubricChips points={POINTS} awarded={[]} onToggle={() => undefined} />
      <RubricChips points={POINTS} awarded={['r1']} onToggle={() => undefined} marked />
      <RubricChips points={POINTS} awarded={['r1', 'r2', 'r3']} onToggle={() => undefined} marked />
      <RubricChips points={POINTS} awarded={[]} onToggle={() => undefined} marked />
      <Interactive />
    </div>
  ) },
  { label: 'Tag chips: RULE, MODEL, HAND', node: <div style={{ display: 'flex', gap: 8 }}><TagChip source="RULE" /><TagChip source="MODEL" /><TagChip source="HAND" /></div> },
  { label: 'Strata cells of the fixture, as data', node: <pre style={{ font: '12px/1.4 var(--font-mono, monospace)', color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>{`${cellsOf(QUESTIONS).length} cells, ${YEARS.length} papers, ${TOPICS.length} topics; all invented, SIMULATED`}</pre> },
]

const list: GalleryEntryX[] = [{
  id: 'Y01',
  title: 'Paper Desk and Review Desk',
  group: 'data',
  states,
  note: 'The first screens of the exam generator on invented papers. Nothing here is read from a file: every reading is SIMULATED, and the null adapter answers WAITING with a reason.',
  also: ['PaperStrata', 'CoverageLedger', 'PaperDrop', 'ImportTray', 'ExtractionTrace', 'CropCard', 'RubricChips', 'ReviewDesk', 'PaperDesk', 'TagChip'],
  merged: 'Y01, 14 Nov 2026',
}]

export default list
