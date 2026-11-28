// PaperDesk (package Y01, spec 20.7.1): the Study home of papers. A Coverage Ledger along the top, then three columns: the Paper
// Strata, the paper list over the Drop Slot (the Import Tray), and the detail of the chosen paper with the one warm button, "Review
// k waiting", which opens the Review Desk over the desk. It reads through the Study port only. With the null adapter every member
// answers WAITING with a reason, so a fresh install draws an honest empty desk: hollow ledger, an empty grid, "Drop the first paper
// here". A gallery or a test hands it `data` (invented papers, SIMULATED) instead of a port.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Chip, Button, Field, PrimaryButton, Segmented } from '../../../shared/kit'
import { Lamp, readingOf, showsNumber, type LampState } from '../../../shared/lamp'
import { lookV3Enabled, Zones } from '../../../shell/v3'
import { pyqClient } from '../adapters/pyq.register'
import type { PyqClient } from '../adapters/types'
import { prepClient, type PrepClient } from '../adapters/pyqPrep'
import { STUDY_PORT, type GainItem, type IngestRoute, type PaperRole, type PaperRow, type QueuedFile, type QuestionRow, type RouteId, type StudyPort, type Topic, type TraceEvent } from '../ports'
import { PrepFace } from '../prep/PrepFace'
import { ReviewDesk } from '../review/ReviewDesk'
import { COPY, FOOTER } from './copy'
import { CoverageLedger, EMPTY_COVERAGE } from './CoverageLedger'
import { DraftsPanel } from './DraftsPanel'
import { ExtractionTrace } from './ExtractionTrace'
import { ImportTray } from './ImportTray'
import { OcrPanel } from './OcrPanel'
import { PractiseNext, ProvisionalNote, type ProvisionalCounts } from './PatternNotes'
import { PAPER_ACCEPT } from './PaperDrop'
import { PaperStrata } from './PaperStrata'
import { cellsOf, coverageOf } from './strataModel'
import './papers.css'
import './papers-v3.css'
import './ocr.css'
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
  /** R-17's picks with the engine's terms as words (LIVE only). Optional so a fixture need not carry them. */
  gains?: GainItem[]
  /** R-16 answered WAITING with the counts still present: a note under the grid, never a pattern. */
  provisional?: ProvisionalCounts | null
  /** The state of R-01 itself: the desk's own state is the first that is not LIVE (a waiting pattern), but the empty poses ask the papers. */
  papersState?: LampState
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
  const [p, q, pat, gain] = await Promise.all([port.papers(), port.questions(), port.patterns(), port.practiseNext?.() ?? Promise.resolve(null)])
  const ok = (s: LampState) => showsNumber(s)
  // fewer than 3 papers or 20 counted questions: the patterns answer WAITING with the counts still present. The desk keeps its own
  // state (the papers are on file and countable) and prints the counts as a note, so that answer does not hollow the whole desk.
  const prov = pat.data?.provisional && !ok(pat.state) ? { papers: pat.data.papers, questions: pat.data.questions ?? 0, reason: pat.reason } : null
  const first = [p, q, pat].find((r) => !ok(r.state) && !(r === pat && prov)) ?? p
  if (!ok(p.state) || !p.data) return { ...EMPTY_DATA, state: p.state, reason: p.reason }
  return {
    ...EMPTY_DATA,
    state: first === p ? p.state : first.state,
    reason: first === p ? p.reason : first.reason,
    papers: p.data,
    questions: ok(q.state) && q.data ? q.data : [],
    topics: ok(pat.state) && pat.data ? pat.data.topics : [],
    gains: gain && ok(gain.state) && gain.data ? gain.data : [],
    provisional: prov,
    papersState: p.state,
  }
}

export interface PaperDeskProps {
  port?: StudyPort
  /** The OCR and draft calls (not members of the Study port). Default: the engine's. A test hands in a fake. */
  client?: PyqClient
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
  /** The preparation routes (R-64 to R-74) and the role of a paper (R-04). Default: the engine's. A test hands in a fake. */
  prep?: PrepClient
  /** The face the desk opens on (the gallery and the tests). */
  startFace?: Face
}

type Face = 'desk' | 'prep' | 'classic'

/** A paper's role in words (wave EW11), and who set it. */
export const ROLE_WORD: Record<PaperRole, string> = { paper: 'paper', question_bank: 'question bank', solution: 'solution sheet', notes: 'notes' }
export const roleText = (p: PaperRow): string =>
  p.role ? `${ROLE_WORD[p.role]}, set by ${p.roleSource === 'hand' ? 'you' : p.roleSource === 'rule' ? 'the rule' : p.roleSource || 'nobody named'}` : ''
/** A solution sheet's items are never questions he was set, and notes are not a paper (prep.HELD_ROLES): neither is offered "to review". */
const held = (p: PaperRow) => p.role === 'solution' || p.role === 'notes'

/** The two plain poses of an empty desk (queue row V8): no paper at all, or papers with nothing accepted yet. */
export const EMPTY_NONE = 'No paper on file. Drop one here, or pull them from Classroom in Library.'
export const EMPTY_UNREADY = 'Nothing is ready for the study screens yet. Open Prepare.'

export function PaperDesk({ port = STUDY_PORT, client = pyqClient, data, now, classic = true, trayOpen, reviewOpen, onIngested, prep = prepClient, startFace = 'desk' }: PaperDeskProps) {
  const [loaded, setLoaded] = useState<DeskData | null>(data ?? null)
  const [face, setFace] = useState<Face>(startFace)
  const [sel, setSel] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState<{ startId?: string } | null>(reviewOpen ? {} : null)
  const [pasting, setPasting] = useState(false)
  const [notice, setNotice] = useState<{ state: LampState; text: string } | null>(null)
  const [page, setPage] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const lastFocus = useRef<HTMLElement | null>(null)
  // v3: the matrix gets as many topic rows as its tray can hold (44 px a row under about 205 px of chrome); 5 on the phone, where the tray grows
  const strataBox = useRef<HTMLDivElement>(null)
  const [strataRows, setStrataRows] = useState(4)
  useEffect(() => {
    const el = strataBox.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const fit = () => setStrataRows(window.innerWidth <= 700 ? 5 : Math.max(2, Math.min(9, Math.floor((el.clientHeight - 205) / 44))))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [face])

  useEffect(() => {
    if (data) { setLoaded(data); return }
    let live = true
    loadDesk(port).then((d) => { if (live) setLoaded(d) })
    return () => { live = false }
  }, [port, data])

  // OCR ended or a draft was accepted: the paper has new questions and new fault lines, so the desk reads the port again
  const reload = useCallback(() => { if (!data) void loadDesk(port).then(setLoaded) }, [port, data])

  const d = loaded ?? EMPTY_DATA
  const sorted = useMemo(() => [...d.papers].sort((a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity)), [d.papers])
  const years = useMemo(() => d.papers.flatMap((p) => (p.year === null ? [] : [p.year])), [d.papers])
  const cells = useMemo(() => cellsOf(d.questions), [d.questions])
  const coverage = useMemo(() => (d.papers.length || d.questions.length ? coverageOf(d.papers, d.questions, d.lastRun) : EMPTY_COVERAGE), [d.papers, d.questions, d.lastRun])
  const chosen = sorted.find((p) => p.id === sel) ?? null
  const live = showsNumber(d.state)
  const waitingOf = (p: PaperRow) => (held(p) ? 0 : d.questions.filter((q) => q.paperId === p.id && q.status === 'pending' && !q.notQuestion).length)
  const PER = 7
  const pages = Math.max(1, Math.ceil(sorted.length / PER))
  const shown = sorted.slice(page * PER, page * PER + PER)

  const say = useCallback((state: LampState, text: string) => setNotice({ state, text }), [])

  const onFiles = async (files: File[]) => {
    const r = await port.ingest({ route: 'drop', files })
    say(r.state, r.state === 'live' || r.state === 'simulated' ? `${files.length} file${files.length === 1 ? '' : 's'} queued` : `Not read: ${r.reason}`)
    // a paper that was just read is on file now, and a scan among them carries the fault line that offers OCR
    if (r.state === 'live' || r.state === 'simulated') reload()
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

  const reviewPaper = (chosen && !held(chosen) ? chosen : null) ?? sorted.find((p) => waitingOf(p) > 0) ?? null
  const reviewQs = reviewPaper ? d.questions.filter((q) => q.paperId === reviewPaper.id) : []
  const heldIds = new Set(d.papers.filter(held).map((p) => p.id))
  const waitingTotal = d.questions.filter((q) => q.status === 'pending' && !q.notQuestion && !heldIds.has(q.paperId)).length
  // the empty poses (V8): said only once the port answered LIVE, never over a desk still loading or an engine that is not there
  const emptyPose = loaded && face === 'desk' && (live || d.papersState === 'live') ? (d.papers.length === 0 ? 'none' : d.questions.some((q) => q.status === 'accepted') ? null : 'unready') : null

  const [roleSaid, setRoleSaid] = useState<{ state: LampState; text: string } | null>(null)
  const changeRole = async (paper: PaperRow, role: string) => {
    setRoleSaid(null)
    const r = await prep.setRole(paper.id, role)
    setRoleSaid({ state: r.state, text: r.state === 'live' ? `Role set to ${ROLE_WORD[role as PaperRole] ?? role} by you.` : r.reason })
    if (r.state === 'live') reload()
  }

  const overlays = (
    <>
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
    </>
  )

  if (lookV3Enabled()) {
    const faceSwitch = classic ? (
      <Segmented<Face>
        variant="choice"
        label="Desk face"
        value={face}
        onChange={setFace}
        options={[{ id: 'desk', label: 'Papers on file' }, { id: 'prep', label: 'Prepare' }, { id: 'classic', label: 'Exam dates' }]}
      />
    ) : null
    if (face === 'prep') {
      return (
        <div className="pp-desk pp-v3" data-component="paper-desk" data-state={d.state} data-face={face}>
          <PrepFace client={prep} faceSwitch={faceSwitch} papers={d.papers} onChanged={reload} />
          {overlays}
        </div>
      )
    }
    const pose = emptyPose && (
      <div className="pp3-pose" role="status" data-pose={emptyPose}>
        <p className="pp3-pose-line">{emptyPose === 'none' ? EMPTY_NONE : EMPTY_UNREADY}</p>
        {emptyPose === 'none'
          ? <Button size="lg" onClick={() => input.current?.click()} data-key="pose-drop">Choose a file</Button>
          : classic && <Button size="lg" onClick={() => setFace('prep')} data-key="pose-prepare">Open Prepare</Button>}
      </div>
    )
    return (
      <div className="pp-desk pp-v3" data-component="paper-desk" data-state={d.state} data-face={face} onKeyDown={onKey}>
        <Zones
          ratio="default"
          first={{
            job: 'COVERAGE',
            flare: waitingTotal > 0 ? 1 : 0,
            children: (
              <div className="pp3-col pp3-cover">
                {face === 'classic' ? (
                  <div className="pp-classic pp3-classic">
                    {faceSwitch}
                    <Suspense fallback={<p className="pp-notice">Opening the exam dates</p>}><Classic /></Suspense>
                  </div>
                ) : (
                  <>
                    {/* the face switch heads the first tray on every face (28 Nov: with Prepare it needs about 300 px, more than the third tray had) */}
                    {faceSwitch}
                    {pose}
                    <div className="pp3-strata" ref={strataBox}>
                      <PaperStrata
                        rowsPerPage={strataRows}
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
                    {d.provisional && <ProvisionalNote counts={d.provisional} />}
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
                    <CoverageLedger coverage={coverage} state={d.state} reason={d.reason} now={now} />
                    <PractiseNext items={d.gains ?? []} topics={d.topics} />
                    {d.events.length > 0 && <ExtractionTrace events={d.events} max={3} />}
                  </>
                )}
                <p className="pp-foot pp3-foot"><span>{FOOTER}</span></p>
              </div>
            ),
          }}
          second={{
            job: 'PAPERS',
            peek: { name: 'Papers', lamp: d.state, note: sorted.length ? `${sorted.length} on file` : 'nothing on file yet' },
            children: (
              <div className="pp3-col pp3-papers">
                {/* the paper he is acting on comes first, so the OCR key is on screen without scrolling; the list scrolls under it */}
                {chosen ? (
                  <div className="pp-detail pp3-chosen">
                    <h2>{chosen.label}</h2>
                    <dl className="pp-facts pp-facts-row">
                      <div><dt>Questions read</dt><dd>{live ? chosen.questions : '--'}</dd></div>
                      <div><dt>Reviewed</dt><dd>{live ? (held(chosen) ? 'not questions' : `${chosen.questions - waitingOf(chosen)} of ${chosen.questions}`) : '--'}</dd></div>
                      <div><dt>Pages</dt><dd>{live ? chosen.pages : '--'}</dd></div>
                      <div data-fact="role"><dt>Role</dt><dd>{chosen.role ? roleText(chosen) : 'not reported'}</dd></div>
                    </dl>
                    <Lamp reading={readingOf({ state: d.state, reason: d.reason })} />
                    {live && (
                      <Field kind="select" label="Change the role" value={chosen.role ?? ''} onChange={(e) => void changeRole(chosen, (e.target as unknown as HTMLSelectElement).value)} data-role-select="">
                        {!chosen.role && <option value="">not reported</option>}
                        {(Object.keys(ROLE_WORD) as PaperRole[]).map((r) => <option key={r} value={r}>{ROLE_WORD[r]}</option>)}
                      </Field>
                    )}
                    {roleSaid && (
                      <p className="pp-notice" role="status" data-state={roleSaid.state} data-role-said="">
                        <Lamp reading={readingOf({ state: roleSaid.state, reason: roleSaid.text })} />
                        <span>{roleSaid.text}</span>
                      </p>
                    )}
                    {chosen.role === 'solution'
                      ? <p className="pp-notice" data-solution="">A solution sheet: its items are never questions, so it is not read for questions or offered for review.</p>
                      : <OcrPanel client={client} paper={chosen} onFinished={reload} />}
                  </div>
                ) : (
                  <div className="pp-detail pp-detail-none pp3-chosen"><p>{sorted.length ? COPY.noPaper : EMPTY_NONE}</p></div>
                )}
                {notice && (
                  <p className="pp-notice" role="status" data-state={notice.state}>
                    <Lamp reading={readingOf({ state: notice.state, reason: notice.text })} />
                    <span>{notice.text}</span>
                  </p>
                )}
                <nav className="pp-list pp3-list" aria-label="Papers on file">
                  {sorted.length === 0 ? (
                    <p className="pp-list-empty">{live ? 'No papers on file.' : `Waiting: ${d.reason}`}</p>
                  ) : (
                    <ul>
                      {shown.map((p) => {
                        const w = waitingOf(p)
                        const hold = held(p)
                        return (
                          <li key={p.id}>
                            <button type="button" className="pp-paper" aria-current={sel === p.id ? 'true' : undefined} onClick={() => setSel(sel === p.id ? null : p.id)} data-role={p.role ?? ''}>
                              <span className="pp-paper-name">{p.label}{p.year === null && <span className="pp-paper-nd" title="No year on file, so this paper is not in the year columns"> n.d.</span>}</span>
                              <span className="pp-paper-meta">{live ? `${hold ? `${p.questions} items, not questions` : `${p.questions} questions, ${w ? `${w} waiting` : 'reviewed'}`}${p.role ? `; ${roleText(p)}` : ''}` : 'not reported'}</span>
                              {live && <Chip tone={w ? 'sim' : 'neutral'}>{hold ? ROLE_WORD[p.role as PaperRole] : w ? 'to review' : 'reviewed'}</Chip>}
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
            ),
          }}
          third={{
            job: 'DRAFTS',
            peek: { name: 'Drafts', lamp: d.state, note: 'written from your notes' },
            children: (
              <div className="pp3-col pp3-detail">
                <DraftsPanel client={client} subject={chosen?.subject} topics={d.topics} onAccepted={reload} defaultOpen />
              </div>
            ),
          }}
        />
        {overlays}
      </div>
    )
  }

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
            {d.provisional && <ProvisionalNote counts={d.provisional} />}
            <PractiseNext items={d.gains ?? []} topics={d.topics} />
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
                          <span className="pp-paper-name">{p.label}{p.year === null && <span className="pp-paper-nd" title="No year on file, so this paper is not in the year columns"> n.d.</span>}</span>
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
                variant="choice"
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
            {chosen && <OcrPanel client={client} paper={chosen} onFinished={reload} />}
            <DraftsPanel client={client} subject={chosen?.subject} topics={d.topics} onAccepted={reload} />
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

      {overlays}
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
