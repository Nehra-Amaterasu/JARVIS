// The OCR and draft calls of the paper desk (routes R-28, R-48, R-49 and R-50 to R-52 of docs/design/well-wisher-engine-plan.md,
// section 9.0, the 25 Nov lines). They are not members of the frozen sixteen-member Study port, so the desk reaches them through
// `PyqClient`, built here with the same rules as the exam adapter (pyq.ts):
//   - the engine's state and sentence are passed through; none is invented. An answer with no valid state is a FAULT.
//   - gate off or no token: nothing is called, the answer is WAITING "the paper engine is not connected yet".
//   - a 400 or a 409 is the engine's own sentence, not wrapped ("OCR is already reading a paper; wait for it or stop it.").
//   - nothing is accepted for him: a draft becomes a question only through `draftsDecide({status: 'accepted'})`, his own press.
//   - a view that closes stops the work: `abortAll()` cancels every request in flight.
import { isLampState, type LampState } from '../../../shared/lamp'
import { api } from '../../../lib/api'
import { classify, faultReason, getJson, sendJson } from './http'
import { BASE } from './pyqIngest'
import type { EnvelopeIn } from './pyqMap'
import type { ClientReply, DraftPatch, DraftRequest, DraftRow, DraftStatus, OcrJob, OcrJobStatus, OcrStatus, PyqClient } from './types'

export const NOT_CONNECTED = 'the paper engine is not connected yet'
const ABSENT = 'engine routes not found'

export interface PyqClientDeps {
  gate: () => boolean
  token: () => string
  now?: () => number
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const str = (x: unknown): string => (typeof x === 'string' ? x : '')
const enc = encodeURIComponent
const JOB_STATUS: readonly OcrJobStatus[] = ['running', 'done', 'failed', 'stopped']
const DRAFT_STATUS: readonly DraftStatus[] = ['pending', 'accepted', 'rejected']

interface EJob { id?: unknown; status?: unknown; paper_id?: unknown; pages_total?: unknown; pages_done?: unknown; page_now?: unknown; pages_read?: unknown; pages_below_gate?: unknown; questions?: unknown; started?: unknown; finished?: unknown; seconds_per_page?: unknown }
interface EOcr extends EnvelopeIn { engine?: { name?: unknown; version?: unknown; device?: unknown; installed?: unknown } | null; gate?: unknown; job?: EJob | null; waiting?: { papers?: unknown; pages?: unknown } | null }
interface EDraft {
  id?: unknown; subject?: unknown; unit?: unknown; topic?: unknown; text?: unknown; marks?: unknown; status?: unknown; origin?: unknown
  sources?: { file_id?: unknown; title?: unknown }[]; checks?: { copied?: unknown; similarity?: unknown } | null; made?: unknown; reason?: unknown
  question_id?: unknown; edited?: unknown
}

export function ocrJob(j: EJob | null | undefined): OcrJob | null {
  if (!j || typeof j.id !== 'string') return null
  const status = JOB_STATUS.find((s) => s === j.status)
  if (!status) return null
  return {
    id: j.id, status, paperId: str(j.paper_id), pagesTotal: num(j.pages_total) ?? 0, pagesDone: num(j.pages_done) ?? 0, pageNow: num(j.page_now),
    pagesRead: num(j.pages_read) ?? 0, pagesBelowGate: num(j.pages_below_gate) ?? 0, questions: num(j.questions) ?? 0,
    started: str(j.started) || null, finished: str(j.finished) || null, secondsPerPage: num(j.seconds_per_page),
  }
}

export function ocrStatus(e: EOcr): OcrStatus {
  const g = num(e.gate)
  const eng = e.engine
  return {
    engine: eng && typeof eng === 'object' ? { name: str(eng.name), version: str(eng.version), device: str(eng.device), installed: eng.installed === true } : null,
    // the gate is the engine's number; 0.85 is only the plan's value of 25 Nov, used when an older answer carries none
    gate: g ?? 0.85,
    job: ocrJob(e.job),
    waiting: { papers: num(e.waiting?.papers) ?? 0, pages: num(e.waiting?.pages) ?? 0 },
  }
}

export function draftRow(d: EDraft): DraftRow | null {
  const status = DRAFT_STATUS.find((s) => s === d.status)
  if (typeof d.id !== 'string' || !status) return null
  const checks = d.checks && typeof d.checks === 'object' ? d.checks : null
  return {
    id: d.id, subject: str(d.subject), unit: num(d.unit), topic: str(d.topic), text: str(d.text), marks: num(d.marks), status, origin: str(d.origin),
    sources: (d.sources ?? []).filter((s) => s && typeof s.file_id === 'string').map((s) => ({ fileId: s.file_id as string, title: str(s.title) })),
    copied: typeof checks?.copied === 'boolean' ? checks.copied : null,
    similarity: num(checks?.similarity),
    made: str(d.made), reason: str(d.reason), questionId: str(d.question_id) || null, edited: d.edited === true,
  }
}

const draftRows = (items: unknown): DraftRow[] => (Array.isArray(items) ? (items as EDraft[]).map(draftRow).filter((r): r is DraftRow => r !== null) : [])

export function createPyqClient(deps: PyqClientDeps): PyqClient {
  const now = deps.now ?? Date.now
  let ctl = new AbortController()
  let absentSince: number | null = null

  const bare = <T>(state: LampState, reason: string): ClientReply<T> => ({ state, reason, since: now(), data: null })

  /** One call: the gate and the token first, then the engine's answer as a reply, and a failure as a named reply. */
  async function call<T>(run: (signal: AbortSignal) => Promise<ClientReply<T>>, outer?: AbortSignal): Promise<ClientReply<T>> {
    if (!deps.gate() || !deps.token()) return { state: 'waiting', reason: NOT_CONNECTED, since: null, data: null }
    if (absentSince !== null && now() - absentSince < 15_000) return { state: 'waiting', reason: ABSENT, since: null, data: null }
    const both = new AbortController()
    const stop = () => both.abort()
    for (const s of [ctl.signal, outer]) { if (s?.aborted) stop(); else s?.addEventListener('abort', stop, { once: true }) }
    try {
      const r = await run(both.signal)
      absentSince = null
      return r
    } catch (e) {
      const f = classify(e)
      if (f.cls === 'absent') { absentSince = now(); return { state: 'waiting', reason: ABSENT, since: null, data: null } }
      if (f.cls === 'aborted') return bare('waiting', 'Stopped: the view was closed.')
      // a 409 and a 400 are the engine's own sentence about what to do; only a server or network failure is worded here
      if (f.cls === 'busy') return bare('waiting', f.detail)
      if (f.cls === 'refused') return bare('fault', f.detail)
      return bare('fault', faultReason(f))
    }
  }

  const envelope = <T>(env: EnvelopeIn, build: () => T, withData = false): ClientReply<T> => {
    if (!env || !isLampState(env.state)) return bare('fault', 'The engine answered without a state, so nothing is shown.')
    const state: LampState = env.state
    const reason = str(env.reason) || (state === 'fault' ? 'no reason given' : '')
    const live = state === 'live' || state === 'simulated'
    return { state, reason, since: now(), data: live || withData ? build() : null }
  }

  // OCR answers carry the job and the counts in every state (a job that is stopping is WAITING and still has a page number), and each is
  // drawn beside the engine's state word and sentence, so a number is never shown without the state it came with.
  const ocr = (env: EOcr) => envelope(env, () => ocrStatus(env), true)

  return {
    ocrStatus: (signal) => call(async (s) => ocr(await getJson<EOcr>(`${BASE}/ocr`, s)), signal),
    ocrStart: (paperId, pages) => call(async (s) => ocr(await sendJson<EOcr>(`${BASE}/papers/${enc(paperId)}/ocr`, 'POST', pages?.length ? { pages } : {}, s))),
    // http.ts has no DELETE helper; the same authenticated api() carries it, so the token header is still read in one place
    ocrStop: () => call(async (s) => ocr(await api<EOcr>(`${BASE}/ocr`, { method: 'DELETE', signal: s }))),

    draftsMake: (req: DraftRequest) => call(async (s) => {
      const body: Record<string, unknown> = { subject: req.subject, topic: req.topic }
      if (req.unit !== undefined) body.unit = req.unit
      if (req.count !== undefined) body.count = req.count
      if (req.marks !== undefined) body.marks = req.marks
      const env = await sendJson<EnvelopeIn & { items?: unknown }>(`${BASE}/drafts/from-notes`, 'POST', body, s)
      return envelope(env, () => draftRows(env.items))
    }),
    draftsList: (filter, signal) => call(async (s) => {
      const q = new URLSearchParams()
      if (filter?.subject) q.set('subject', filter.subject)
      if (filter?.status) q.set('status', filter.status)
      const env = await getJson<EnvelopeIn & { items?: unknown }>(`${BASE}/drafts${q.size ? `?${q}` : ''}`, s)
      return envelope(env, () => draftRows(env.items))
    }, signal),
    draftsDecide: (id: string, patch: DraftPatch) => call(async (s) => {
      const env = await sendJson<EnvelopeIn & { draft?: EDraft }>(`${BASE}/drafts/${enc(id)}`, 'PATCH', patch, s)
      const row = env.draft ? draftRow(env.draft) : null
      // a decided draft with no record back is not shown as decided
      if ((env.state === 'live' || env.state === 'simulated') && !row) return bare('fault', 'The engine answered without the draft, so nothing is shown.')
      return envelope(env, () => row as DraftRow)
    }),

    abortAll() { ctl.abort(); ctl = new AbortController() },
  }
}
