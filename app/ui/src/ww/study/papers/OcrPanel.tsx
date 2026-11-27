// OcrPanel (rows R10 and R12, package O): what the paper desk shows about reading a paper with OCR. Routes R-28, R-48, R-49.
//
// OCR never starts by itself (the engine measured about 14 s a page on the CPU and 3,374 scan pages are on file), so a paper whose fault lines say
// "no text layer; run OCR on this paper" gets one key, "Read with OCR". While the job runs the panel says which page, how many were
// read, how many fell under the gate, and the seconds per page as the engine measured them, and it polls R-28 only then. When the job
// ends it says Done, Failed or Stopped with the counts and asks the desk to read the paper's questions again.
//
// Nothing OCR returns is shown as verified: the questions arrive pending with their text unverified (the Review Desk says so). Every
// number here is the engine's, drawn beside the engine's own sentence and its lamp.
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../../shared/kit'
import { Lamp, readingOf } from '../../../shared/lamp'
import type { ClientReply, OcrJob, OcrStatus, PyqClient } from '../adapters/types'
import type { PaperRow } from '../ports'

/** The fault line the engine writes for a page it could not read yet (engine plan, 25 Nov, "OCR on demand"). */
const NO_TEXT = /^p\.\s*(\d+):\s*no text layer; run OCR on this paper/

/** The pages of a paper still waiting for OCR, from its fault lines. */
export const waitingPages = (faults: readonly string[] | undefined): number[] =>
  [...new Set((faults ?? []).map((f) => NO_TEXT.exec(f)).filter((m): m is RegExpExecArray => !!m).map((m) => Number(m[1])))].sort((a, b) => a - b)

export const POLL_MS = 2500
const END_WORD: Record<Exclude<OcrJob['status'], 'running'>, string> = { done: 'Done', failed: 'Failed', stopped: 'Stopped' }
const MAX_LINES = 6

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export interface OcrPanelProps {
  client: PyqClient
  paper: PaperRow
  /** The job ended (done, failed or stopped) after this panel saw it running: read the paper's questions again. */
  onFinished?: () => void
  /** Poll gap while a job runs, ms. The engine plan asks for 2 to 3 s. */
  pollMs?: number
}

export function OcrPanel({ client, paper, onFinished, pollMs = POLL_MS }: OcrPanelProps) {
  const [reply, setReply] = useState<ClientReply<OcrStatus> | null>(null)
  // the answer to a press that gave no job: the engine's own sentence (a 409 says OCR or the paper desk is busy)
  const [said, setSaid] = useState<{ state: ClientReply<OcrStatus>['state']; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  // one tick per answer, so the next poll is armed by every answer, not by an answer that happens to be a new object
  const [tick, setTick] = useState(0)
  const seenRunning = useRef<string | null>(null)
  const finished = useRef(onFinished)
  finished.current = onFinished

  const job = reply?.data?.job ?? null
  const running = job?.status === 'running'
  const pages = waitingPages(paper.faults)

  // one read of R-28 when the paper changes: a job may already be running, started in an earlier visit
  useEffect(() => {
    let live = true
    setReply(null)
    setSaid(null)
    void client.ocrStatus().then((r) => { if (live) setReply(r) })
    return () => { live = false }
  }, [client, paper.id])

  // poll only while a job runs; every answer re-arms the next timer, and the cleanup is the stop (unmount, or a job that ended)
  useEffect(() => {
    if (!running) return
    let live = true
    const t = setTimeout(() => { void client.ocrStatus().then((r) => { if (live) { setReply(r); setTick((n) => n + 1) } }) }, pollMs)
    return () => { live = false; clearTimeout(t) }
  }, [client, running, tick, pollMs])

  // a job seen running and then not running ended while the desk looked: the paper has new questions and new fault lines
  useEffect(() => {
    if (!job) return
    if (job.status === 'running') { seenRunning.current = job.id; return }
    if (seenRunning.current === job.id) { seenRunning.current = null; finished.current?.() }
  }, [job])

  const start = async () => {
    setBusy(true)
    setSaid(null)
    const r = await client.ocrStart(paper.id)
    setBusy(false)
    if (r.data?.job) setReply(r)
    else setSaid({ state: r.state, text: r.reason })
  }
  const stop = async () => {
    setBusy(true)
    const r = await client.ocrStop()
    setBusy(false)
    if (r.data?.job) setReply(r)
    else setSaid({ state: r.state, text: r.reason })
  }

  const mine = !!job && job.paperId === paper.id
  const elsewhere = running && !mine
  const shown = job && (mine || elsewhere) ? job : null
  const gate = reply?.data?.gate ?? 0.85
  // a "no text layer" line is one more page waiting: its page number goes into the hint beside the key. Every other line (a page under
  // the gate with its confidence, a whole page to split, an unreadable page) is printed as the engine wrote it.
  const others = (paper.faults ?? []).filter((f) => !NO_TEXT.test(f))
  const lines = others.slice(0, MAX_LINES)
  const more = others.length - lines.length
  if (!pages.length && !shown && !(paper.faults ?? []).length && !said) return null

  return (
    <section className="pp-ocr" data-component="ocr-panel" data-job={shown?.status ?? 'none'} aria-label="Reading this paper with OCR">
      <div className="pp-ocr-act">
        {running && mine ? (
          <Button size="md" grouped onClick={() => void stop()} loading={busy} aria-label="Stop reading after this page">Stop</Button>
        ) : pages.length > 0 ? (
          <Button
            size="md"
            grouped
            onClick={() => void start()}
            loading={busy}
            disabledReason={elsewhere ? 'OCR is reading another paper.' : undefined}
            aria-label={`Read with OCR: ${plural(pages.length, 'page', 'pages')} have no text layer`}
          >
            Read with OCR
          </Button>
        ) : null}
        {pages.length > 0 && !running && <span className="pp-ocr-hint">{plural(pages.length, 'page has', 'pages have')} no text layer: {pages.length > 12 ? `${pages.slice(0, 12).join(', ')} and ${pages.length - 12} more` : pages.join(', ')}.</span>}
      </div>

      {lines.length > 0 && (
        <ul className="pp-faults" aria-label="Fault lines of this paper">
          {lines.map((f) => <li key={f}>{f}</li>)}
          {more > 0 && <li className="pp-faults-more">and {plural(more, 'more line', 'more lines')}</li>}
        </ul>
      )}

      {shown && (
        <div className="pp-ocr-job" role="group" aria-label="OCR reading">
          {running ? (
            <p className="pp-ocr-head" data-end="running">
              <strong>{elsewhere ? 'Another paper is being read' : `Reading page ${Math.min(shown.pagesDone + 1, Math.max(shown.pagesTotal, 1))} of ${shown.pagesTotal}`}</strong>
            </p>
          ) : (
            <p className="pp-ocr-head" data-end={shown.status}><strong>{END_WORD[shown.status as keyof typeof END_WORD]}</strong></p>
          )}
          <dl className="pp-ocr-facts">
            <div><dt>Pages read</dt><dd>{shown.pagesRead} of {shown.pagesTotal}</dd></div>
            <div><dt>Below the {gate.toFixed(2)} gate</dt><dd>{shown.pagesBelowGate}</dd></div>
            <div><dt>Time per page</dt><dd>{shown.secondsPerPage === null ? 'not measured yet' : `${shown.secondsPerPage.toFixed(1)} s`}</dd></div>
            {running && shown.pageNow !== null && <div><dt>Paper page</dt><dd>{shown.pageNow}</dd></div>}
            {!running && <div><dt>Drafts to review</dt><dd>{shown.questions}</dd></div>}
          </dl>
          {!running && shown.pagesBelowGate > 0 && (
            <p className="pp-ocr-note">{plural(shown.pagesBelowGate, 'page was', 'pages were')} below the gate and {shown.pagesBelowGate === 1 ? 'stays a picture' : 'stay pictures'}; its fault line says the confidence.</p>
          )}
          {!running && shown.questions > 0 && <p className="pp-ocr-note">Read by OCR, check it: each draft waits in review with its text unverified.</p>}
        </div>
      )}

      {reply && (
        <p className="pp-ocr-state" role="status" data-state={reply.state}>
          <Lamp reading={readingOf({ state: reply.state, reason: reply.reason, since: reply.since })} />
          <span>{reply.reason}</span>
        </p>
      )}
      {said && (
        <p className="pp-ocr-state" role="status" data-state={said.state} data-said="">
          <Lamp reading={readingOf({ state: said.state, reason: said.text })} />
          <span>{said.text}</span>
        </p>
      )}

    </section>
  )
}
