// PaperDesk (package Y01, spec 20.7.1): the Study home of papers. A Coverage Ledger along the top, then three columns: the Paper
// Strata, the paper list over the Drop Slot (the Import Tray), and the detail of the chosen paper with the one warm button, "Review
// k waiting", which opens the Review Desk over the desk. It reads through the Study port only. With the null adapter every member
// answers WAITING with a reason, so a fresh install draws an honest empty desk: hollow ledger, an empty grid, "Drop the first paper
// here". A gallery or a test hands it `data` (invented papers, SIMULATED) instead of a port.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Chip, Button, PrimaryButton, Segmented } from '../../../shared/kit'
import { Lamp, readingOf, showsNumber, type LampState } from '../../../shared/lamp'
import { STUDY_PORT, type IngestRoute, type PaperRow, type QueuedFile, type QuestionRow, type RouteId, type StudyPort, type Topic, type TraceEvent } from '../ports'
import { ReviewDesk } from '../review/ReviewDesk'
import { COPY, FOOTER } from './copy'
import { CoverageLedger, EMPTY_COVERAGE } from './CoverageLedger'
import { ExtractionTrace } from './ExtractionTrace'
import { ImportTray } from './ImportTray'
import { PAPER_ACCEPT } from './PaperDrop'
import { PaperStrata } from './PaperStrata'
import { cellsOf, coverageOf } from './strataModel'
import './papers.css'
import '../review/review.css'

// the classic exam-date page is a face of this desk, loaded only when asked for (it moves, it is not rewritten)
const Classic = lazy(() => import('../Papers').then((m) => ({ default: m.Papers })))

/** Everything the desk draws, with the lamp state of where it came from. */
export interface DeskData {
  state: LampState
  reason: string
  papers: PaperRow[]
  questions: QuestionRow[]
  topics: Topic[]
  events: TraceEvent[]
  queued: QueuedFile[]
  routes: IngestRoute[]
  lastRun: number | null
}

export const WAITING_ROUTES: IngestRoute[] = [
  { id: 'drop', label: 'Drop', state: 'waiting', reason: 'reading needs the paper engine' },
  { id: 'paste', label: 'Paste text', state: 'waiting', reason: 'reading needs the paper engine' },
  { id: 'folder', label: 'Watch a folder', state: 'waiting', reason: 'choose a folder to watch' },
  { id: 'classroom', label: 'Connect through Classroom', state: 'planned', reason: 'not built' },
]

export const EMPTY_DATA: DeskData = { state: 'waiting', reason: 'the paper engine is not connected yet', papers: [], questions: [], topics: [], events: [], queued: [], routes: WAITING_ROUTES, lastRun: null }

/** Read the desk's data through the port. A WAITING answer keeps its reason; nothing is invented to fill the gap. */
export async function loadDesk(port: StudyPort): Promise<DeskData> {
  const [p, q, pat] = await Promise.all([port.papers(), port.questions(), port.patterns()])
  const ok = (s: LampState) => showsNumber(s)
  const first = [p, q, pat].find((r) => !ok(r.state)) ?? p
  if (!ok(p.state) || !p.data) return { ...EMPTY_DATA, state: p.state, reason: p.reason }
  return {
    ...EMPTY_DATA,
    state: first === p ? p.state : first.state,
    reason: first === p ? p.reason : first.reason,
    papers: p.data,
    questions: ok(q.state) && q.data ? q.data : [],
    topics: ok(pat.state) && pat.data ? pat.data.topics : [],
  }
}

export interface PaperDeskProps {
  port?: StudyPort
  /** Hand the desk its data instead of reading the port (the gallery and the tests). */
  data?: DeskData
  /** Fixed clock for age texts. */
  now?: number
  /** Show the classic exam-date face beside the desk (shell view: yes; gallery: no). */
  classic?: boolean
  /** The tray starts open (the gallery shows it). */
  trayOpen?: boolean
  /** The Review Desk starts open on this paper. */
  reviewOpen?: boolean
  /** Told when files are chosen and the port has answered. */
  onIngested?: (state: LampState, reason: string) => void
}

type Face = 'desk' | 'classic'

export function PaperDesk({ port = STUDY_PORT, data, now, classic = true, trayOpen, reviewOpen, onIngested }: PaperDeskProps) {
  const [loaded, setLoaded] = useState<DeskData | null>(data ?? null)
  const [face, setFace] = useState<Face>('desk')
  const [sel, setSel] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState<{ startId?: string } | null>(reviewOpen ? {} : null)
  const [pasting, setPasting] = useState(false)
  const [notice, setNotice] = useState<{ state: LampState; text: string } | null>(null)
  const [page, setPage] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const lastFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (data) { setLoaded(data); return }
    let live = true
    loadDesk(port).then((d) => { if (live) setLoaded(d) })
    return () => { live = false }
  }, [port, data])

  const d = loaded ?? EMPTY_DATA
  const sorted = useMemo(() => [...d.papers].sort((a, b) => b.year - a.year), [d.papers])
  const years = useMemo(() => d.papers.map((p) => p.year), [d.papers])
  const cells = useMemo(() => cellsOf(d.questions), [d.questions])
  const coverage = useMemo(() => (d.papers.length || d.questions.length ? coverageOf(d.papers, d.questions, d.lastRun) : EMPTY_COVERAGE), [d.papers, d.questions, d.lastRun])
  const chosen = sorted.find((p) => p.id === sel) ?? null
  const live = showsNumber(d.state)
  const waitingOf = (p: PaperRow) => d.questions.filter((q) => q.paperId === p.id && q.status === 'pending').length
  const PER = 7
  const pages = Math.max(1, Math.ceil(sorted.length / PER))
  const shown = sorted.slice(page * PER, page * PER + PER)

  const say = useCallback((state: LampState, text: string) => setNotice({ state, text }), [])

  const onFiles = async (files: File[]) => {
    const r = await port.ingest({ route: 'drop', files })
    say(r.state, r.state === 'live' || r.state === 'simulated' ? `${files.length} file${files.length === 1 ? '' : 's'} queued` : `Not read: ${r.reason}`)
    onIngested?.(r.state, r.reason)
  }
  const onRoute = async (id: RouteId) => {
    if (id === 'paste') { setPasting(true); return }
    if (id === 'folder') { const r = await port.intake(); say(r.state, r.state === 'waiting' ? `Folder: ${r.reason}` : 'Folder chosen'); return }
    const r = await port.classroom()
    say(r.state, `Connect through Classroom: ${r.reason}. It would pull course files you can already open, and the app never stores your password.`)
  }
  const onPaste = async (text: string) => {
    setPasting(false)
    const r = await port.ingest({ route: 'paste', text })
    say(r.state, r.state === 'live' || r.state === 'simulated' ? 'Pasted text queued' : `Not read: ${r.reason}`)
  }

  const onKey = (e: KeyboardEvent) => {
    if (reviewing || pasting || e.ctrlKey || e.metaKey || e.altKey) return
    if ((e.target as HTMLElement).closest('input, textarea, select')) return
    const k = e.key.toLowerCase()
    if (k === 'a') { e.preventDefault(); input.current?.click() }
    else if (k === 'v') { /* the strata's own V toggles its table; the desk takes V only outside it */ if (!(e.target as HTMLElement).closest('.pp-strata')) { e.preventDefault(); setPasting(true) } }
    else if (k === 'w') { e.preventDefault(); void onRoute('folder') }
  }

  const openReview = (startId?: string) => { lastFocus.current = document.activeElement as HTMLElement | null; setReviewing({ startId }) }
  const closeReview = () => { setReviewing(null); requestAnimationFrame(() => lastFocus.current?.focus?.()) }

  const reviewPaper = chosen ?? sorted.find((p) => waitingOf(p) > 0) ?? null
  const reviewQs = reviewPaper ? d.questions.filter((q) => q.paperId === reviewPaper.id) : []
  const waitingTotal = d.questions.filter((q) => q.status === 'pending').length

  return (
    <div className="pp-desk" data-component="paper-desk" data-state={d.state} data-face={face} onKeyDown={onKey}>
      <div className="pp-desk-in">
      <header className="pp-top">
        <CoverageLedger coverage={coverage} state={d.state} reason={d.reason} now={now} />
      </header>

      {face === 'classic' ? (
        <div className="pp-classic">
          <Suspense fallback={<p className="pp-notice">Opening the exam dates</p>}><Classic /></Suspense>
        </div>
      ) : (
        <div className="pp-main">
          <div className="pp-col pp-col-strata">
            <PaperStrata
              cells={cells}
              years={years}
              topics={d.topics}
              coverage={coverage}
              state={d.state}
              reason={d.reason}
              selectedYear={chosen?.year ?? null}
              onOpen={(qid) => { const q = d.questions.find((x) => x.id === qid); if (q) { setSel(q.paperId); openReview(qid) } }}
            />
          </div>

          <div className="pp-col pp-col-list">
            <nav className="pp-list" aria-label="Papers on file">
              {sorted.length === 0 ? (
                <p className="pp-list-empty">{live ? 'No papers on file.' : `Waiting: ${d.reason}`}</p>
              ) : (
                <ul>
                  {shown.map((p) => {
                    const w = waitingOf(p)
                    return (
                      <li key={p.id}>
                        <button type="button" className="pp-paper" aria-current={sel === p.id ? 'true' : undefined} onClick={() => setSel(sel === p.id ? null : p.id)}>
                          <span className="pp-paper-name">{p.label}</span>
                          <span className="pp-paper-meta">{live ? `${p.questions} questions, ${w ? `${w} waiting` : 'reviewed'}` : 'not reported'}</span>
                          {live && <Chip tone={w ? 'sim' : 'neutral'}>{w ? 'to review' : 'reviewed'}</Chip>}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
              {pages > 1 && (
                <div className="pp-listpager" role="group" aria-label={`Papers, page ${page + 1} of ${pages}`}>
                  <button type="button" className="pp-pg" aria-label="Earlier page" disabled={page === 0} onClick={() => setPage(page - 1)}>‹</button>
                  <span>{page + 1} of {pages}</span>
                  <button type="button" className="pp-pg" aria-label="Later page" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>›</button>
                </div>
              )}
            </nav>
            <ImportTray
              routes={d.routes}
              queued={d.queued}
              onFiles={(f) => void onFiles(f)}
              accept={PAPER_ACCEPT}
              onRoute={(id) => void onRoute(id)}
              onOpenTrace={() => undefined}
              inputRef={input}
              defaultOpen={trayOpen}
            />
          </div>

          <aside className="pp-col pp-col-detail" aria-label="The chosen paper">
            {classic && (
              <Segmented<Face>
                variant="compact"
                label="Desk face"
                value={face}
                onChange={setFace}
                options={[{ id: 'desk', label: 'Papers on file' }, { id: 'classic', label: 'Exam dates' }]}
              />
            )}
            {chosen ? (
              <div className="pp-detail">
                <h2>{chosen.label}</h2>
                <dl className="pp-facts">
                  <div><dt>Questions read</dt><dd>{live ? chosen.questions : '--'}</dd></div>
                  <div><dt>Reviewed</dt><dd>{live ? `${chosen.questions - waitingOf(chosen)} of ${chosen.questions}` : '--'}</dd></div>
                  <div><dt>Pages</dt><dd>{live ? chosen.pages : '--'}</dd></div>
                </dl>
                <Lamp reading={readingOf({ state: d.state, reason: d.reason })} />
              </div>
            ) : (
              <div className="pp-detail pp-detail-none"><p>{sorted.length ? COPY.noPaper : 'Nothing on file yet.'}</p></div>
            )}
            <div className="pp-detail-act">
              <PrimaryButton
                claimId="paper-desk-review"
                rank="workspace"
                when={waitingTotal > 0}
                size="lg"
                onClick={() => openReview()}
                disabledReason={waitingTotal === 0 ? COPY.nothingToReview : undefined}
              >
                {waitingTotal > 0 ? COPY.reviewCta(reviewPaper ? waitingOf(reviewPaper) || waitingTotal : waitingTotal) : 'Review desk'}
              </PrimaryButton>
            </div>
            {notice && (
              <p className="pp-notice" role="status" data-state={notice.state}>
                <Lamp reading={readingOf({ state: notice.state, reason: notice.text })} />
                <span>{notice.text}</span>
              </p>
            )}
            {d.events.length > 0 && <ExtractionTrace events={d.events} max={3} />}
          </aside>
        </div>
      )}

      <footer className="pp-foot"><span>{FOOTER}</span></footer>
      </div>

      {pasting && <PasteSheet onClose={() => setPasting(false)} onRead={(t) => void onPaste(t)} />}
      {reviewing && (
        <div className="pp-scrim">
          <ReviewDesk
            modal
            questions={reviewQs.length ? reviewQs : d.questions}
            topics={d.topics}
            events={d.events}
            state={d.state}
            reason={d.reason}
            paperLabel={reviewPaper?.label}
            startId={reviewing.startId}
            onDecide={(dec) => void port.decide(dec)}
            onClose={closeReview}
          />
        </div>
      )}
    </div>
  )
}

function PasteSheet({ onClose, onRead }: { onClose: () => void; onRead: (text: string) => void }) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <div className="pp-scrim" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
      <div className="pp-sheet" role="dialog" aria-modal="true" aria-label="Paste the text of a paper">
        <h2>Paste text</h2>
        <p>Paste the text of a paper or a set of slides. It is read like a file, and nothing enters the bank until you accept it.</p>
        <textarea ref={ref} className="pp-paste" value={text} onChange={(e) => setText(e.target.value)} aria-label="Pasted text" rows={9} />
        <div className="pp-sheet-act">
          <Button onClick={onClose}>Cancel</Button>
          <PrimaryButton claimId="paper-paste-read" rank="overlay" disabled={!text.trim()} onClick={() => onRead(text)}>Read this text</PrimaryButton>
        </div>
      </div>
    </div>
  )
}
