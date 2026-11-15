// The ingest half of the exam adapter (package AD08): a dropped file, a folder or pasted text becomes papers on the engine side,
// and the long job (R-13) is polled with a bounded backoff until it is done, the deadline passes, or the view closes.
//
// Nothing here accepts a question. The engine adds every draft as `pending` whatever it carries (plan file 9.0, note 2), and a
// question joins the bank only through `decide({kind: 'accept'})`, which is the student's own press.
import type { LampState } from '../../../shared/lamp'
import type { IngestInput, IngestJob, QueuedFile } from '../ports'
import { classify, getJson, sendJson, upload } from './http'
import { METHOD, traceEvents, type EJob, type EJobFile, type EnvelopeIn } from './pyqMap'

export const BASE = '/api/mission/pyq'
/** First wait, growth and ceiling of the poll, in ms; and how long a job may run before the adapter stops asking (10 minutes). */
export const POLL = { first: 250, grow: 1.6, cap: 2000, deadline: 600_000 } as const

export interface IngestCtx {
  signal: AbortSignal
  now: () => number
  sleep: (ms: number, signal: AbortSignal) => Promise<void>
  subject: string | null
}

export interface IngestOutcome { state: LampState; reason: string; job: IngestJob | null }

interface JobEnvelope extends EnvelopeIn { job?: EJob | null }

/** Ask R-13 until the job leaves `running`. The wait grows from 250 ms to 2 s and the loop ends at the deadline or on abort. */
export async function pollJob(jobId: string, ctx: IngestCtx): Promise<JobEnvelope> {
  const stop = ctx.now() + POLL.deadline
  let wait: number = POLL.first
  for (;;) {
    const env = await getJson<JobEnvelope>(`${BASE}/ingest/${encodeURIComponent(jobId)}`, ctx.signal)
    if (env.job?.status !== 'running' || ctx.now() >= stop) return env
    await ctx.sleep(wait, ctx.signal)
    wait = Math.min(Math.round(wait * POLL.grow), POLL.cap)
  }
}

const kindOfName = (name: string): QueuedFile['method'] => (/\.pptx$/i.test(name) ? 'slides' : 'text-layer')

function queued(job: EJob): QueuedFile[] {
  return (job.files ?? []).map((f: EJobFile, i) => ({
    id: `${job.id}:${i}`,
    name: f.file ?? '',
    method: (f.method && METHOD[f.method]) || kindOfName(f.file ?? ''),
    // the engine reports pages, not words per page, so the list stays empty rather than inventing a count
    wordsPerPage: [],
    reading: false,
  }))
}

const RANK: Record<LampState, number> = { live: 0, simulated: 1, planned: 2, waiting: 3, fault: 4 }
const worse = (a: LampState, b: LampState) => (RANK[b] > RANK[a] ? b : a)

/** Several files, one after another: R-12 and R-15 answer 409 while a job runs, so the next file waits for the last. */
async function readOne(start: () => Promise<JobEnvelope>, ctx: IngestCtx): Promise<{ state: LampState; reason: string; job: EJob | null }> {
  const first = await start()
  if (!first.job) return { state: (first.state as LampState) ?? 'fault', reason: String(first.reason ?? ''), job: null }
  const done = await pollJob(first.job.id, ctx)
  const job = done.job ?? first.job
  const running = job.status === 'running'
  return {
    state: running ? 'waiting' : ((done.state as LampState) ?? 'fault'),
    reason: running ? 'Still reading; ask again in a minute.' : String(done.reason ?? ''),
    job,
  }
}

function assemble(results: { state: LampState; reason: string; job: EJob | null }[], failed: string[], ctx: IngestCtx): IngestOutcome {
  let state: LampState = 'live'
  let reason = ''
  const files: QueuedFile[] = []
  const events: IngestJob['events'] = []
  let id = ''
  for (const r of results) {
    state = worse(state, r.state)
    if (!reason && r.state !== 'live') reason = r.reason
    if (r.job) {
      id = r.job.id
      files.push(...queued(r.job))
      events.push(...traceEvents(r.job.trace, ctx.now() - (r.job.took_s ?? 0) * 1000, r.job.id))
    }
  }
  if (failed.length) { state = 'fault'; reason = failed[0] }
  if (!reason) reason = results.at(-1)?.reason ?? ''
  return { state, reason, job: state === 'live' || state === 'simulated' ? { id, queued: files, events } : null }
}

/** One engine refusal of one file (a wrong type, too large) is a line about that file; the other files are still read. */
async function guardFile<T>(name: string, run: () => Promise<T>, failed: string[]): Promise<T | null> {
  try { return await run() } catch (e) {
    const f = classify(e)
    if (f.cls === 'refused' || f.cls === 'busy') { failed.push(`${name}: ${f.detail}`); return null }
    throw e
  }
}

export async function ingestInput(input: IngestInput, ctx: IngestCtx): Promise<IngestOutcome> {
  const failed: string[] = []
  const results: { state: LampState; reason: string; job: EJob | null }[] = []
  if (input.route === 'drop') {
    const files = input.files ?? []
    if (!files.length) return { state: 'waiting', reason: 'No file was chosen.', job: null }
    for (const f of files) {
      const q = new URLSearchParams({ name: f.name })
      if (ctx.subject) q.set('subject', ctx.subject)
      const r = await guardFile(f.name, () => readOne(() => upload<JobEnvelope>(`${BASE}/upload?${q}`, f, ctx.signal), ctx), failed)
      if (r) results.push(r)
    }
    return assemble(results, failed, ctx)
  }
  if (input.route === 'folder') {
    const body: Record<string, unknown> = { folder: true }
    if (ctx.subject) body.subject = ctx.subject
    const r = await readOne(() => sendJson<JobEnvelope>(`${BASE}/ingest`, 'POST', body, ctx.signal), ctx)
    // R-12 answers "Nothing new in the folder." with no job: that is a LIVE answer with nothing queued
    return r.job ? assemble([r], [], ctx) : { state: r.state, reason: r.reason, job: r.state === 'live' ? { id: '', queued: [], events: [] } : null }
  }
  if (input.route === 'paste') return pasteInput(input.text ?? '', ctx)
  return { state: 'planned', reason: 'Classroom is not built; it would pull course files you can already open.', job: null }
}

const MAX_QUESTION = 2000
const MAX_PASTED = 200

/** Pasted text becomes one typed paper (R-02): one question per blank-line block, with no marks, so each one stays in review. */
async function pasteInput(text: string, ctx: IngestCtx): Promise<IngestOutcome> {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
  if (!blocks.length) return { state: 'waiting', reason: 'There is nothing to read in the pasted text.', job: null }
  const questions = blocks.slice(0, MAX_PASTED).map((b) => ({ text: b.slice(0, MAX_QUESTION) }))
  const body: Record<string, unknown> = { title: 'Pasted questions', questions }
  if (ctx.subject) body.subject = ctx.subject
  const env = await sendJson<EnvelopeIn & { paper?: { id?: string; title?: string } }>(`${BASE}/papers`, 'POST', body, ctx.signal)
  const state = (env.state as LampState) ?? 'fault'
  if (state !== 'live' && state !== 'simulated') return { state, reason: String(env.reason ?? ''), job: null }
  const words = text.split(/\s+/).filter(Boolean).length
  const reason = blocks.length > MAX_PASTED ? `Kept the first ${MAX_PASTED} of ${blocks.length} blocks; they wait for your review.` : String(env.reason ?? '') || `${questions.length} pasted question${questions.length === 1 ? '' : 's'} wait for your review.`
  return { state, reason, job: { id: env.paper?.id ?? '', queued: [{ id: env.paper?.id ?? '', name: env.paper?.title ?? 'Pasted questions', method: 'pasted', wordsPerPage: [words], reading: false }], events: [] } }
}
