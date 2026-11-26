// ReviewDesk (package Y01, spec 20.7.2 and 21.3.2 S2): turn a paper into reviewed questions without anything entering the bank
// unseen. Left, the page with the reader's boxes (the selected box has four 44 px corner handles; Shift+arrow moves an edge
// 4 px). Right, the run's real trace, the crop with its text layer, the fields each with its RULE, MODEL or HAND chip, and the
// actions: Accept (Enter), Edit (E) and Reject (Backspace, undo for 10 s) stand on the row; Merge with previous (M), Split (S),
// Next uncertain (N) and the two view switches (T, R) are behind one "More" key (the keys themselves work either way, 14 Nov jury).
// The run's trace is one line that opens (it was a 130 px terminal and the loudest thing on the desk).
// The one warm fill is "Accept all certain and review the rest": it takes only a RULE tag at margin 0.5 or more with its marks
// found. J and K step, T puts the text beside the crop, R opens the rubric strip, Esc closes. The state is a pure reducer
// (reviewModel.ts); the desk is optimistic (it answers at once) and tells the port after.
import { useEffect, useId, useMemo, useReducer, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button, PrimaryButton, Switch } from '../../../shared/kit'
import { Lamp, readingOf, type LampState } from '../../../shared/lamp'
import { ExtractionTrace, eventClock } from '../papers/ExtractionTrace'
import { LampWord } from '../../left/LampWord'
import { COPY, FOOTER } from '../papers/copy'
import { countText } from '../papers/stats'
import type { Decision, QuestionRow, TagSource, Topic, TraceEvent, QType } from '../ports'
import { CropCard } from './CropCard'
import { RubricChips } from './RubricChips'
import { TagChip } from './TagChip'
import { dragCorner, moveEdge, EDGE_STEP_PX, type ArrowKey, type Box, type Corner } from './cropModel'
import { certain, initialReview, pending, reduceReview, rubricSum, UNDO_MS, type ReviewAction, type ReviewItem } from './reviewModel'

export interface ReviewDeskProps {
  questions: readonly QuestionRow[]
  topics: readonly Topic[]
  /** The run's events, exactly as they happened. */
  events: readonly TraceEvent[]
  /** The state of the source of the questions. A fixture is SIMULATED and is stamped so. */
  state?: LampState
  reason?: string
  paperLabel?: string
  /** The rendered page image. Absent and not SIMULATED: the page is drawn hollow ("page image not rendered"). */
  pageImg?: string
  /** The reader could not read photos (the OCR tool is not installed): a FAULT line with what to do. */
  ocrMissing?: boolean
  /** The local model is busy: tags come from rules only (WAITING). */
  modelBusy?: boolean
  /** Told of every decision after the desk has applied it. */
  onDecide?: (d: Decision) => void
  /** Told when a crop box was released after a move. */
  onCrop?: (qid: string, bbox: Box) => void
  onDraftPoints?: (qid: string) => void
  onClose?: () => void
  /** A dialog over the desk (focus is trapped, Esc closes) or an embedded panel (the gallery). */
  modal?: boolean
  undoMs?: number
  now?: () => number
  /** Draw the text beside the crop and the rubric strip from the start (the gallery shows both). */
  defaultSideBySide?: boolean
  defaultRubric?: boolean
  defaultEditing?: boolean
  /** Open at this question (a Strata cell opens its question here). */
  startId?: string
}

/** The page in page units. Boxes are kept in these and drawn in percent, so the page can be any width (460 px at full size). */
export const PAGE = { w: 500, h: 480 } as const
const FALLBACK_SCALE = 0.92
const FIELD_WORD: Record<string, string> = { marks: 'Marks', topic: 'Topic', type: 'Type', unit: 'Unit' }
const TYPES: { id: QType; label: string }[] = [
  { id: 'numerical', label: 'numerical' }, { id: 'derivation', label: 'derivation' }, { id: 'short', label: 'short answer' }, { id: 'mcq', label: 'multiple choice' },
]
const isEntry = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable="true"]')
const isButton = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('button, a, [role="switch"]')

/** The run's trace as ONE line: the newest event with its lamp and word, how many there are, and a key that opens the whole log. Real
 *  events only (nothing is invented to fill the line); with none it says there is no run. */
function TraceLine({ events }: { events: readonly TraceEvent[] }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const last = events[events.length - 1]
  const Chev = open ? ChevronDown : ChevronRight
  return (
    <div className="rv-trace" data-open={open ? 'true' : undefined}>
      <button type="button" className="rv-trace-line" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        {last ? (
          <>
            <LampWord state={last.state} />
            <span className="rv-trace-clock">{eventClock(last.at)}</span>
            <span className="rv-trace-text">{last.text}</span>
          </>
        ) : <span className="rv-trace-text">No run yet: the trace lists what the reader did, and nothing else</span>}
        <span className="rv-trace-n">{events.length} {events.length === 1 ? 'event' : 'events'}</span>
        <Chev size={16} aria-hidden="true" />
      </button>
      <div id={id} hidden={!open}>{open && <ExtractionTrace events={events} max={6} />}</div>
    </div>
  )
}

function Field({ name, chip, children }: { name: string; chip: TagSource; children: ReactNode }) {
  return (
    <div className="rv-field" data-field={name}>
      <span className="rv-field-name">{FIELD_WORD[name] ?? name}</span>
      <span className="rv-field-val">{children}</span>
      <TagChip source={chip} />
    </div>
  )
}

export function ReviewDesk({
  questions, topics, events, state = 'live', reason, paperLabel, pageImg, ocrMissing, modelBusy, onDecide, onCrop, onDraftPoints, onClose,
  modal, undoMs = UNDO_MS, now = Date.now, defaultSideBySide, defaultRubric, defaultEditing, startId,
}: ReviewDeskProps) {
  const [rs, dispatch] = useReducer(reduceReview, null, () => {
    const s0 = initialReview(questions)
    return startId && s0.items.some((i) => i.id === startId) ? { ...s0, cursorId: startId } : s0
  })
  const [side, setSide] = useState(!!defaultSideBySide)
  const [rubric, setRubric] = useState(!!defaultRubric)
  const [editing, setEditing] = useState(!!defaultEditing)
  const [draft, setDraft] = useState<{ stem: string; marks: string; topicId: string; type: QType } | null>(null)
  const [boxes, setBoxes] = useState<Record<string, Box>>({})
  const [say, setSay] = useState('')
  const [more, setMore] = useState(false)
  const moreId = useId()
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: string; corner: Corner; x: number; y: number; box: Box; scale: { x: number; y: number } } | null>(null)
  const sheet = useRef<HTMLDivElement>(null)
  // screen px per page unit on each axis, read when a move starts: the page is as wide as its column lets it be, and on a phone it is taller than 500 by 480
  const scaleOf = () => ({ x: (sheet.current?.clientWidth || PAGE.w * FALLBACK_SCALE) / PAGE.w, y: (sheet.current?.clientHeight || PAGE.h * FALLBACK_SCALE) / PAGE.h })

  const cur = rs.items.find((i) => i.id === rs.cursorId) ?? null
  const waiting = pending(rs)
  const sure = certain(rs)
  const done = rs.items.length - waiting.length
  const topic = (id: string) => topics.find((t) => t.id === id)
  const sameFile = useMemo(() => rs.items.filter((i) => i.paperId === (cur?.paperId ?? rs.items[0]?.paperId)), [rs.items, cur?.paperId])
  const boxOf = (i: ReviewItem): Box => boxes[i.id] ?? i.crop.bbox ?? [20, 12 + sameFile.indexOf(i) * 66, 460, 56]

  // an open edit follows the question under the cursor
  useEffect(() => {
    if (editing && cur) setDraft({ stem: cur.stem, marks: cur.marks === null ? '' : String(cur.marks), topicId: cur.topicId, type: cur.type })
    else setDraft(null)
  }, [editing, cur?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // the undo window is one timer that exists only while a reject can still be taken back
  useEffect(() => {
    if (!rs.undo) return
    const t = setTimeout(() => dispatch({ type: 'expire', now: now() + undoMs + 1 }), Math.max(0, rs.undo.until - now()))
    return () => clearTimeout(t)
  }, [rs.undo, now, undoMs])

  useEffect(() => { if (modal) root.current?.focus() }, [modal])

  const act = (a: ReviewAction, d?: Decision, spoken?: string) => {
    dispatch(a)
    if (d) onDecide?.(d)
    if (spoken) setSay(spoken)
  }
  const accept = () => { if (cur && cur.status !== 'accepted') act({ type: 'accept' }, { kind: 'accept', qid: cur.id }, `Accepted ${cur.number}. ${Math.max(0, waiting.length - 1)} waiting.`) }
  const reject = () => { if (cur && cur.status !== 'rejected') act({ type: 'reject', now: now() }, { kind: 'reject', qid: cur.id }, `Rejected ${cur.number}. Undo within 10 seconds.`) }
  const undo = () => { if (rs.undo) act({ type: 'undo', now: now() }, { kind: 'undo', qid: rs.undo.id }, 'Rejection undone.') }
  const merge = () => { if (cur) act({ type: 'merge' }, { kind: 'merge', qid: cur.id }, `Merged ${cur.number} with the question before it.`) }
  const split = () => { if (cur) act({ type: 'split' }, { kind: 'split', qid: cur.id, at: Math.floor(cur.stem.length / 2) }, `Split ${cur.number} in two. Set the marks of each part.`) }
  const next = () => dispatch({ type: 'nextUncertain' })
  const acceptCertain = () => { if (sure.length) { sure.forEach((i) => onDecide?.({ kind: 'accept', qid: i.id })); setSay(`Accepted ${sure.length} certain. ${waiting.length - sure.length} left to review.`); dispatch({ type: 'acceptCertain' }) } }
  const save = () => {
    if (!cur || !draft) return
    const marks = draft.marks.trim() === '' ? null : Number(draft.marks)
    const patch = { stem: draft.stem, marks: Number.isFinite(marks as number) ? marks : null, topicId: draft.topicId, type: draft.type }
    act({ type: 'edit', patch }, { kind: 'edit', qid: cur.id, patch }, `Saved ${cur.number}. It is still waiting for Accept.`)
    setEditing(false)
  }

  // ------------------------------------------------------------------ keys
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Tab' && modal && root.current) {
      const f = [...root.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select, textarea, [tabindex="0"]')].filter((x) => x.offsetParent !== null)
      if (f.length) {
        const first = f[0], last = f[f.length - 1]
        if (e.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
      return
    }
    if (e.key === 'Escape') {
      if (more) { e.stopPropagation(); setMore(false); return }
      if (editing) { e.stopPropagation(); setEditing(false); return }
      if (modal) { e.stopPropagation(); onClose?.() }
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey || isEntry(e.target)) {
      if (e.key === 'Enter' && e.ctrlKey && editing) { e.preventDefault(); save() }
      return
    }
    // a handle takes Shift+arrows itself
    if ((e.target as HTMLElement).dataset?.handle) return
    const k = e.key
    if (e.shiftKey && k === 'A') { e.preventDefault(); acceptCertain(); return }
    if (e.shiftKey) return
    if (k === 'Enter' && !isButton(e.target)) { e.preventDefault(); accept() }
    else if (k === 'Backspace') { e.preventDefault(); reject() }
    else if (k === 'e' || k === 'E') { e.preventDefault(); setEditing((v) => !v) }
    else if (k === 'm' || k === 'M') { e.preventDefault(); merge() }
    else if (k === 's' || k === 'S') { e.preventDefault(); split() }
    else if (k === 'n' || k === 'N') { e.preventDefault(); next() }
    else if (k === 'u' || k === 'U') { e.preventDefault(); undo() }
    else if (k === 'j' || k === 'ArrowDown') { e.preventDefault(); dispatch({ type: 'step', by: 1 }) }
    else if (k === 'k' || k === 'ArrowUp') { e.preventDefault(); dispatch({ type: 'step', by: -1 }) }
    else if (k === 't' || k === 'T') { e.preventDefault(); setSide((v) => !v) }
    else if (k === 'r' || k === 'R') { e.preventDefault(); setRubric((v) => !v) }
  }

  // ------------------------------------------------------------------ crop handles
  const commit = (i: ReviewItem, b: Box) => onCrop?.(i.id, b)
  const onHandleKey = (e: KeyboardEvent, i: ReviewItem, corner: Corner) => {
    if (!e.shiftKey || !e.key.startsWith('Arrow')) return
    e.preventDefault()
    e.stopPropagation()
    setBoxes((b) => ({ ...b, [i.id]: moveEdge(boxes[i.id] ?? boxOf(i), corner, e.key as ArrowKey, EDGE_STEP_PX / (e.key === 'ArrowLeft' || e.key === 'ArrowRight' ? scaleOf().x : scaleOf().y), PAGE) }))
  }
  const onHandleUp = (e: KeyboardEvent, i: ReviewItem) => { if (e.shiftKey || e.key === 'Shift' || e.key.startsWith('Arrow')) commit(i, boxes[i.id] ?? boxOf(i)) }
  const down = (e: RPointerEvent, i: ReviewItem, corner: Corner) => {
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    drag.current = { id: i.id, corner, x: e.clientX, y: e.clientY, box: boxOf(i), scale: scaleOf() }
  }
  const moveDrag = (e: RPointerEvent) => {
    const d = drag.current
    if (!d) return
    setBoxes((b) => ({ ...b, [d.id]: dragCorner(d.box, d.corner, (e.clientX - d.x) / d.scale.x, (e.clientY - d.y) / d.scale.y, PAGE) }))
  }
  const upDrag = () => {
    const d = drag.current
    drag.current = null
    if (d) onCrop?.(d.id, boxes[d.id] ?? d.box)
  }

  const fixtureOnly = state === 'simulated' && !pageImg
  const sum = cur ? rubricSum(cur) : null
  const pend = waiting.length

  return (
    <div
      ref={root}
      className="rv-desk"
      data-component="review-desk"
      data-state={state}
      role={modal ? 'dialog' : 'region'}
      aria-modal={modal ? true : undefined}
      aria-label={`Review desk${paperLabel ? `: ${paperLabel}` : ''}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <header className="rv-head">
        <div className="rv-title">
          <h2>Review desk</h2>
          <span className="rv-sub">{paperLabel ?? 'No paper chosen'}</span>
        </div>
        <span className="rv-count" aria-label={`${done} of ${rs.items.length} reviewed`}>
          <b>{countText(done, rs.items.length)}</b> reviewed
        </span>
        <span className="rv-lamp">
          <Lamp reading={readingOf({ state, reason })} />
        </span>
        <PrimaryButton
          claimId="review-accept-certain"
          rank="overlay"
          when={sure.length > 0}
          className="rv-primary"
          onClick={acceptCertain}
          disabledReason={sure.length === 0 ? (pend === 0 ? COPY.nothingToReview : 'No question is certain yet') : undefined}
          title={COPY.acceptCertainHint}
          aria-keyshortcuts="Shift+A"
        >
          {COPY.acceptCertain}{sure.length ? ` (${sure.length})` : ''}
        </PrimaryButton>
        {modal && <button type="button" className="rv-close" aria-label="Close the review desk" onClick={onClose}>×</button>}
      </header>

      {(ocrMissing || modelBusy || rs.undo) && (
        <div className="rv-strip" role="status">
          {ocrMissing && <span className="rv-note" data-state="fault"><Lamp reading={readingOf({ state: 'fault', reason: COPY.ocrMissing })} /><span>{COPY.ocrMissing}</span></span>}
          {modelBusy && <span className="rv-note" data-state="waiting"><Lamp reading={readingOf({ state: 'waiting', reason: COPY.rulesOnly })} /><span>{COPY.rulesOnly}</span></span>}
          {rs.undo && <span className="rv-note rv-undo"><span>{COPY.rejected}</span><Button size="sm" onClick={undo} aria-keyshortcuts="U">{COPY.undo}</Button></span>}
        </div>
      )}

      <div className="rv-body">
        <section className="rv-page" aria-label="The page and the boxes the reader found">
          <div ref={sheet} className="rv-sheet" data-fixture={fixtureOnly ? 'true' : undefined}>
            {pageImg ? <img src={pageImg} alt="The page as printed" draggable={false} /> : fixtureOnly ? (
              <svg className="rv-fake" viewBox={`0 0 ${PAGE.w} ${PAGE.h}`} aria-hidden="true">
                {Array.from({ length: 30 }, (_, i) => <rect key={i} x="30" y={28 + i * 18} width={140 + ((i * 53) % 280)} height="6" rx="3" />)}
              </svg>
            ) : <div className="rv-hollow">page image not rendered</div>}
            {fixtureOnly && <span className="pp-stamp rv-page-stamp">SIMULATED</span>}
            {sameFile.map((i) => {
              const [x, y, w, h] = boxOf(i)
              const sel = i.id === rs.cursorId
              return (
                <div key={i.id} className="rv-boxwrap" style={{ left: `${(x / PAGE.w) * 100}%`, top: `${(y / PAGE.h) * 100}%`, width: `${(w / PAGE.w) * 100}%`, height: `${(h / PAGE.h) * 100}%` }}>
                  <button type="button" className="rv-box" data-sel={sel ? 'true' : undefined} data-status={i.status} onClick={() => dispatch({ type: 'go', id: i.id })} aria-label={`${i.number}, ${i.status}${sel ? ', current' : ''}`} aria-current={sel ? 'true' : undefined}>
                    <span className="rv-box-no">{i.status === 'accepted' ? '✓ ' : i.status === 'rejected' ? '× ' : ''}{i.number}</span>
                  </button>
                  {sel && (['tl', 'tr', 'bl', 'br'] as Corner[]).map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="rv-handle"
                      data-handle={c}
                      aria-label={`Crop handle, ${{ tl: 'top left', tr: 'top right', bl: 'bottom left', br: 'bottom right' }[c]}. Shift and arrows move an edge 4 pixels.`}
                      onKeyDown={(e) => onHandleKey(e, i, c)}
                      onKeyUp={(e) => onHandleUp(e, i)}
                      onPointerDown={(e) => down(e, i, c)}
                      onPointerMove={moveDrag}
                      onPointerUp={upDrag}
                    />
                  ))}
                </div>
              )
            })}
          </div>
        </section>

        <section className="rv-work" aria-label="The question under review">
          <TraceLine events={events} />
          {cur ? (
            <>
              <CropCard
                img={cur.crop.img}
                bbox={boxOf(cur)}
                text={editing && draft ? draft.stem : cur.crop.text}
                textStatus={cur.crop.textStatus}
                editing={editing}
                onText={(v) => setDraft((d) => (d ? { ...d, stem: v } : d))}
                onVerify={(v) => dispatch({ type: 'verify', verified: v })}
                sideBySide={side}
                compact={rubric}
                simulated={state === 'simulated'}
                ocr={cur.ocrConfidence != null || cur.wholePage ? { confidence: cur.ocrConfidence ?? null, wholePage: cur.wholePage } : undefined}
                label={`${cur.number} of ${topic(cur.topicId)?.label ?? 'topic'}`}
                chips={<><TagChip source={cur.tag} label={`margin ${cur.margin.toFixed(2)}`} />{cur.hand?.includes('stem') && <TagChip source="HAND" label="text" />}</>}
              />
              {rubric ? (
                <div className="rv-rubric-strip">
                  <RubricChips points={cur.rubric} awarded={[]} onToggle={() => undefined} label={`Rubric points of ${cur.number}`} />
                  <RubricAdd onAdd={(text, marks) => dispatch({ type: 'addPoint', text, marks })} />
                  <div className="rv-sumrow">
                    <p className="rv-sum" data-ok={sum?.ok ? 'true' : undefined}>
                      {sum && sum.total !== null ? COPY.rubricSum(sum.sum, sum.total) : 'Set the marks first: points must sum to them'}
                    </p>
                    <Button size="sm" onClick={() => cur && onDraftPoints?.(cur.id)} disabledReason={onDraftPoints ? undefined : COPY.draftWaiting}>{COPY.draftPoints}</Button>
                  </div>
                </div>
              ) : (
                <div className="rv-fields">
                  <Field name="marks" chip={cur.hand?.includes('marks') ? 'HAND' : 'RULE'}>
                    {editing && draft ? <input className="rv-input" inputMode="numeric" aria-label="Marks" value={draft.marks} onChange={(e) => setDraft({ ...draft, marks: e.target.value })} /> : cur.marks === null ? <em className="rv-miss">not found</em> : cur.marks}
                  </Field>
                  <Field name="topic" chip={cur.tag}>
                    {editing && draft ? (
                      <select className="rv-input" aria-label="Topic" value={draft.topicId} onChange={(e) => setDraft({ ...draft, topicId: e.target.value })}>
                        {topics.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                    ) : topic(cur.topicId)?.label}
                  </Field>
                  <Field name="unit" chip="RULE">{topic(cur.topicId)?.unit}</Field>
                  <Field name="type" chip={cur.hand?.includes('type') ? 'HAND' : 'RULE'}>
                    {editing && draft ? (
                      <select className="rv-input" aria-label="Question type" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as QType })}>
                        {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                    ) : TYPES.find((t) => t.id === cur.type)?.label}
                  </Field>
                </div>
              )}
            </>
          ) : (
            <div className="rv-none"><p>{COPY.nothingToReview}</p></div>
          )}

          <div className="rv-actionbar">
            <div className="rv-actions" role="group" aria-label="Decide on this question">
              {editing ? (
                <>
                  <Button size="sm" tone="quiet" onClick={save} aria-keyshortcuts="Control+Enter">Save</Button>
                  <Button size="sm" onClick={() => setEditing(false)} aria-keyshortcuts="Escape">Cancel</Button>
                </>
              ) : (
                <>
                  <Button size="sm" onClick={accept} disabled={!cur || cur.status === 'accepted'} aria-keyshortcuts="Enter">Accept</Button>
                  <Button size="sm" onClick={() => setEditing(true)} disabled={!cur} aria-keyshortcuts="E">Edit</Button>
                  <Button size="sm" onClick={reject} disabled={!cur || cur.status === 'rejected'} aria-keyshortcuts="Backspace">Reject</Button>
                  <Button size="sm" tone="quiet" aria-expanded={more} aria-controls={moreId} onClick={() => setMore((v) => !v)}>More</Button>
                  <span className="rv-step" role="group" aria-label="Step between questions">
                    <button type="button" className="pp-pg" aria-label="Previous question" aria-keyshortcuts="K" onClick={() => dispatch({ type: 'step', by: -1 })}>‹</button>
                    <button type="button" className="pp-pg" aria-label="Next question" aria-keyshortcuts="J" onClick={() => dispatch({ type: 'step', by: 1 })}>›</button>
                  </span>
                </>
              )}
            </div>
            <div id={moreId} className="rv-more" role="group" aria-label="More on this question" hidden={!more || editing}>
              <Button size="sm" onClick={merge} disabled={!cur} aria-keyshortcuts="M">Merge with previous</Button>
              <Button size="sm" onClick={split} disabled={!cur} aria-keyshortcuts="S">Split</Button>
              <Button size="sm" onClick={next} disabled={pend < 2} aria-keyshortcuts="N">Next uncertain</Button>
              <Switch checked={side} onChange={setSide} label="Text beside crop (T)" />
              <Switch checked={rubric} onChange={setRubric} label="Rubric strip (R)" />
            </div>
          </div>
          <p className="rv-keys" aria-hidden="true">Enter accept · E edit · M merge · S split · Backspace reject · N next uncertain · U undo · J K step · T text · R rubric</p>
        </section>
      </div>

      <footer className="rv-foot">
        <span>{FOOTER}</span>
        <span className="ww-sr-only" role="status" aria-live="polite">{say}</span>
      </footer>
    </div>
  )
}

function RubricAdd({ onAdd }: { onAdd: (text: string, marks: number) => void }) {
  const [text, setText] = useState('')
  const [marks, setMarks] = useState('1')
  const go = () => { const m = Number(marks); if (text.trim() && m > 0) { onAdd(text, m); setText('') } }
  return (
    <form className="rv-add" onSubmit={(e) => { e.preventDefault(); go() }}>
      <input className="rv-input" aria-label="Point text" placeholder="A point the answer must make" value={text} onChange={(e) => setText(e.target.value)} />
      <input className="rv-input rv-input-n" aria-label="Marks for the point" inputMode="numeric" value={marks} onChange={(e) => setMarks(e.target.value)} />
      <Button size="sm" type="submit">Add point</Button>
    </form>
  )
}
