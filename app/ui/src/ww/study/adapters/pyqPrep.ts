// Preparing his question store (routes R-64 to R-74 of docs/design/well-wisher-engine-plan.md, section 9.0, the lines of 28 Nov: wave
// EW11 and "wave EW11 refined"; board requests 21 and 23), and the role of a paper through R-04. They are not members of the frozen
// Study port, so the Prepare face reaches them through `PrepClient`, built on the same rules as the tonight client (pyqTonight.ts):
//   - the engine's state and its sentence are passed through; none is invented. An answer with no valid state is a FAULT.
//   - gate off or no token: nothing is called, the answer is WAITING "the paper engine is not connected yet".
//   - a 400 is the engine's own sentence as a FAULT; a 409 ("A preparation run is going; wait for it or stop it.") is WAITING with it.
//   - nothing writes except his press. Every bulk step takes `apply`, sent only as he chose it; the client has no timer: the face polls
//     R-73 itself, and only while a run is going.
//   - counts are the engine's. A count the engine did not send stays null (drawn "not reported"), never 0.
// It is its own file so pyq.ts (the port) does not grow.
import { isLampState, type LampState } from '../../../shared/lamp'
import { api, TOKEN } from '../../../lib/api'
import { classify, faultReason, getJson, sendJson } from './http'
import { BASE } from './pyqIngest'
import type { ClientReply } from './types'

export const NOT_CONNECTED = 'the paper engine is not connected yet'
const ABSENT = 'engine routes not found'
const enc = encodeURIComponent
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const str = (x: unknown): string => (typeof x === 'string' ? x : '')
type R = Record<string, unknown>
const obj = (x: unknown): R | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as R) : null)
const arr = (x: unknown): R[] => (Array.isArray(x) ? (x.filter((r) => r && typeof r === 'object') as R[]) : [])
const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [])

// ------------------------------------------------------------------------------------------------ what the face reads
export type Provider = 'local' | 'claude' | 'off'
export type ClaudeModel = 'haiku' | 'sonnet' | 'opus'
export const PROVIDERS: readonly Provider[] = ['off', 'local', 'claude']
export const CLAUDE_MODELS: readonly ClaudeModel[] = ['haiku', 'sonnet', 'opus']
/** R-64: which model may be asked, whether it is on this PC (a version call, never a prompt), and whether his text leaves the PC. */
export interface ModelInfo { provider: Provider; claudeModel: ClaudeModel | null; name: string; available: { local: boolean | null; claude: boolean | null }; sendsOut: boolean | null }

/** R-65, one subject's row. Every count is the engine's; null when it sent none. */
export interface SubjectCounts { subject: string; name: string; papers: number | null; questions: number | null; pending: number | null; accepted: number | null; withMarks: number | null; tagged: number | null; sheetReadyTopics: number | null }
export interface PrepCounts {
  papers: number | null; withoutSubject: number | null; questions: number | null; pending: number | null; accepted: number | null; withMarks: number | null; tagged: number | null
  /** The sum of the subjects' sheet-ready topics (R-65 counts them per subject only); null when no subject row carries one. */
  sheetReadyTopics: number | null
  questionBanks: number | null; notQuestions: number | null; marksNotPrinted: number | null; acceptedUnmarked: number | null
  solutions: { papers: number | null; items: number | null; paired: number | null } | null
  courses: { mapped: number | null; unmapped: number | null; state: LampState | null; reason: string } | null
  bySubject: SubjectCounts[]
}

/** R-66, one paper without a subject: the subject proposed, the rule that spoke, what was written, and the engine's sentence. */
export interface SubjectProposal { paper: string; title: string; subject: string; rule: string; written: string; reason: string }
export interface SubjectsAnswer { items: SubjectProposal[]; counts: Record<string, number>; model: string; asked: number | null; roles: { paper: string; title: string; role: string; written: boolean }[]; pairs: number }
/** R-67, one paper read again. A count is null when the paper was not read (stopped, or the desk began reading). */
export interface RereadRow { paper: string; title: string; questionsBefore: number | null; questionsAfter: number | null; marksBefore: number | null; marksAfter: number | null; changed: boolean; failed: boolean; reason: string }
export interface RereadAnswer { items: RereadRow[]; changed: number | null }
/** R-68 for one subject: what the rule and the model tagged (or would tag), and what is left. */
export interface TagsAnswer { subject: string; rule: number | null; model: number | null; none: number | null; left: number | null; notQuestion: number | null; unitFromTitle: number | null; failedBatches: number | null; modelName: string; asked: number | null }
export interface PolicyInfo { autoAccept: boolean }
export interface AcceptAnswer { accepted: number | null; returned: number | null; unmarked: number | null; held: Record<string, number>; counts: PrepCounts | null; before: PrepCounts | null }

export type RunStatus = 'running' | 'done' | 'stopped' | 'failed'
export type Step = 'subjects' | 'reread' | 'tags' | 'accept'
/** The four steps in the one order the engine runs them (ww_pyq/prep.py STEPS). */
export const STEPS: readonly Step[] = ['subjects', 'reread', 'tags', 'accept']
/** R-73: the job record. `notes` are the engine's own lines (a failed batch, acceptance off); `failures` their count. */
export interface RunInfo {
  id: string; status: RunStatus; steps: Step[]; step: string; unit: string; done: number | null; total: number | null
  countsBefore: PrepCounts | null; countsNow: PrepCounts | null; seconds: number | null; failures: number | null; notes: string[]
  started: string; finished: string; subjects: string[]; model: string; error: string
}
export interface RoleAnswer { id: string; role: string; roleSource: string }

export interface PrepClient {
  model(signal?: AbortSignal): Promise<ClientReply<ModelInfo>>
  setModel(provider: Provider, claudeModel?: ClaudeModel): Promise<ClientReply<ModelInfo>>
  counts(signal?: AbortSignal): Promise<ClientReply<PrepCounts>>
  /** R-66. `limit` caps how many papers the model is asked about in this call. */
  subjects(req: { apply: boolean; useModel: boolean; limit?: number }): Promise<ClientReply<SubjectsAnswer>>
  reread(req: { apply: boolean; papers?: string[] }): Promise<ClientReply<RereadAnswer>>
  tags(req: { subject: string; apply: boolean; useModel: boolean; limit?: number }): Promise<ClientReply<TagsAnswer>>
  policy(signal?: AbortSignal): Promise<ClientReply<PolicyInfo>>
  setPolicy(autoAccept: boolean): Promise<ClientReply<PolicyInfo>>
  accept(subject: string): Promise<ClientReply<AcceptAnswer>>
  unaccept(subject: string): Promise<ClientReply<AcceptAnswer>>
  runStart(req: { steps: Step[]; subjects?: string[]; useModel: boolean }): Promise<ClientReply<RunInfo | null>>
  runStatus(signal?: AbortSignal): Promise<ClientReply<RunInfo | null>>
  runStop(): Promise<ClientReply<RunInfo | null>>
  /** R-04: his own choice of a paper's role; the engine writes role_source "hand". */
  setRole(paperId: string, role: string): Promise<ClientReply<RoleAnswer>>
  abortAll(): void
}

// ------------------------------------------------------------------------------------------------ mappers (pure; each has a test)
interface Env { state?: unknown; reason?: unknown; [k: string]: unknown }

export function modelInfo(e: Env): ModelInfo | null {
  const p = str(e.provider)
  if (!(PROVIDERS as readonly string[]).includes(p)) return null
  const cm = str(e.claude_model)
  const av = obj(e.available)
  const b = (x: unknown) => (typeof x === 'boolean' ? x : null)
  return {
    provider: p as Provider, claudeModel: (CLAUDE_MODELS as readonly string[]).includes(cm) ? (cm as ClaudeModel) : null, name: str(e.name),
    available: { local: b(av?.local), claude: b(av?.claude) }, sendsOut: b(e.sends_out),
  }
}

export function subjectCounts(r: R): SubjectCounts | null {
  const id = str(r.subject)
  if (!id) return null
  return {
    subject: id, name: str(r.name) || id, papers: num(r.papers), questions: num(r.questions), pending: num(r.pending), accepted: num(r.accepted),
    withMarks: num(r.with_marks), tagged: num(r.tagged), sheetReadyTopics: num(r.sheet_ready_topics),
  }
}

export function prepCounts(x: unknown): PrepCounts | null {
  const c = obj(x)
  if (!c) return null
  const bySubject = arr(c.by_subject).map(subjectCounts).filter((s): s is SubjectCounts => s !== null)
  const ready = bySubject.map((s) => s.sheetReadyTopics).filter((n): n is number => n !== null)
  const sol = obj(c.solutions)
  const crs = obj(c.courses)
  return {
    papers: num(c.papers), withoutSubject: num(c.without_subject), questions: num(c.questions), pending: num(c.pending), accepted: num(c.accepted),
    withMarks: num(c.with_marks), tagged: num(c.tagged), sheetReadyTopics: ready.length ? ready.reduce((a, b) => a + b, 0) : null,
    questionBanks: num(c.question_banks), notQuestions: num(c.not_questions), marksNotPrinted: num(c.marks_not_printed), acceptedUnmarked: num(c.accepted_unmarked),
    solutions: sol ? { papers: num(sol.papers), items: num(sol.items), paired: num(sol.paired) } : null,
    courses: crs ? { mapped: num(crs.mapped), unmapped: num(crs.unmapped), state: isLampState(crs.state) ? crs.state : null, reason: str(crs.reason) } : null,
    bySubject,
  }
}

export function subjectsAnswer(e: Env): SubjectsAnswer {
  const k = obj(e.counts) ?? {}
  const counts: Record<string, number> = {}
  for (const [key, v] of Object.entries(k)) if (num(v) !== null) counts[key] = v as number
  return {
    items: arr(e.items).filter((r) => str(r.paper)).map((r) => ({ paper: str(r.paper), title: str(r.title), subject: str(r.subject), rule: str(r.rule), written: str(r.written), reason: str(r.reason) })),
    counts, model: str(e.model), asked: num(e.asked),
    roles: arr(e.roles).filter((r) => str(r.paper)).map((r) => ({ paper: str(r.paper), title: str(r.title), role: str(r.role), written: r.written === true })),
    pairs: arr(e.pairs).length,
  }
}

export function rereadRow(r: R): RereadRow | null {
  if (!str(r.paper)) return null
  return {
    paper: str(r.paper), title: str(r.title), questionsBefore: num(r.questions_before), questionsAfter: num(r.questions_after), marksBefore: num(r.marks_before),
    marksAfter: num(r.marks_after), changed: r.changed === true, failed: r.failed === true, reason: str(r.reason),
  }
}

export function tagsAnswer(e: Env): TagsAnswer {
  return {
    subject: str(e.subject), rule: num(e.rule), model: num(e.model), none: num(e.none), left: num(e.left), notQuestion: num(e.not_question),
    unitFromTitle: num(e.unit_from_title), failedBatches: num(e.failed_batches), modelName: str(e.model_name), asked: num(e.asked),
  }
}

export function acceptAnswer(e: Env): AcceptAnswer {
  const held: Record<string, number> = {}
  for (const [k, v] of Object.entries(obj(e.held) ?? {})) if (num(v) !== null) held[k] = v as number
  return { accepted: num(e.accepted), returned: num(e.returned), unmarked: num(e.unmarked), held, counts: prepCounts(e.counts), before: prepCounts(e.before) }
}

const RUN_STATUS: readonly string[] = ['running', 'done', 'stopped', 'failed']
/** R-73: the whole record in `run`; null when there is none ("No preparation run yet."). */
export function runInfo(e: Env): RunInfo | null {
  const j = obj(e.run)
  if (!j || !RUN_STATUS.includes(str(j.status))) return null
  return {
    id: str(j.id), status: str(j.status) as RunStatus, steps: strs(j.steps).filter((s): s is Step => (STEPS as readonly string[]).includes(s)),
    step: str(j.step), unit: str(j.unit), done: num(j.done), total: num(j.total), countsBefore: prepCounts(j.counts_before), countsNow: prepCounts(j.counts_now),
    seconds: num(j.seconds), failures: num(j.failures), notes: strs(j.notes), started: str(j.started), finished: str(j.finished ?? ''),
    subjects: strs(j.subjects), model: str(j.model), error: str(j.error ?? ''),
  }
}

// ------------------------------------------------------------------------------------------------ the client
export interface PrepClientDeps { gate: () => boolean; token: () => string; now?: () => number }

export function createPrepClient(deps: PrepClientDeps): PrepClient {
  const now = deps.now ?? Date.now
  let ctl = new AbortController()
  let absentSince: number | null = null
  const bare = <T>(state: LampState, reason: string): ClientReply<T> => ({ state, reason, since: now(), data: null })

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

  /** `always`: the data travels in every state (R-65 "No paper on file yet." is WAITING with its counts; a stopping run is WAITING with its record). */
  const envelope = <T>(e: Env, build: () => T, always = false): ClientReply<T> => {
    if (!e || !isLampState(e.state)) return bare('fault', 'The engine answered without a state, so nothing is shown.')
    const state: LampState = e.state
    const reason = str(e.reason) || (state === 'fault' ? 'no reason given' : '')
    return { state, reason, since: now(), data: always || state === 'live' || state === 'simulated' ? build() : null }
  }

  const P = `${BASE}/prep`
  const run = (e: Env) => envelope(e, () => runInfo(e), true)
  return {
    model: (signal) => call(async (s) => { const e = await getJson<Env>(`${BASE}/model`, s); return envelope(e, () => modelInfo(e) as ModelInfo, true) }, signal),
    setModel: (provider, claudeModel) => call(async (s) => {
      const e = await sendJson<Env>(`${BASE}/model`, 'PUT', { provider, ...(claudeModel ? { claude_model: claudeModel } : {}) }, s)
      return envelope(e, () => modelInfo(e) as ModelInfo, true)
    }),
    counts: (signal) => call(async (s) => { const e = await getJson<Env>(P, s); return envelope(e, () => prepCounts(e.counts) as PrepCounts, true) }, signal),
    subjects: (req) => call(async (s) => {
      const body: Record<string, unknown> = { apply: req.apply, use_model: req.useModel }
      if (req.limit !== undefined) body.limit = req.limit
      const e = await sendJson<Env>(`${P}/subjects`, 'POST', body, s)
      return envelope(e, () => subjectsAnswer(e))
    }),
    reread: (req) => call(async (s) => {
      const e = await sendJson<Env>(`${P}/reread`, 'POST', { apply: req.apply, ...(req.papers?.length ? { papers: req.papers } : {}) }, s)
      return envelope(e, () => ({ items: arr(e.items).map(rereadRow).filter((x): x is RereadRow => x !== null), changed: num(e.changed) }))
    }),
    tags: (req) => call(async (s) => {
      const body: Record<string, unknown> = { subject: req.subject, apply: req.apply, use_model: req.useModel }
      if (req.limit !== undefined) body.limit = req.limit
      const e = await sendJson<Env>(`${P}/tags`, 'POST', body, s)
      return envelope(e, () => tagsAnswer(e), true)
    }),
    policy: (signal) => call(async (s) => {
      const e = await getJson<Env>(`${P}/policy`, s)
      const p = obj(e.policy)
      return envelope(e, () => ({ autoAccept: p?.auto_accept === true }), true)
    }, signal),
    setPolicy: (autoAccept) => call(async (s) => {
      const e = await sendJson<Env>(`${P}/policy`, 'PUT', { auto_accept: autoAccept }, s)
      const p = obj(e.policy)
      // a policy answer without the policy is not shown as switched
      if (!p || typeof p.auto_accept !== 'boolean') return bare('fault', 'The engine answered without the policy, so nothing is shown.')
      return envelope(e, () => ({ autoAccept: p.auto_accept === true }), true)
    }),
    // planned ("Acceptance by rule is off; only you can turn it on.") still carries the counts after, drawn beside its word
    accept: (subject) => call(async (s) => { const e = await sendJson<Env>(`${P}/accept`, 'POST', { subject }, s); return envelope(e, () => acceptAnswer(e), true) }),
    unaccept: (subject) => call(async (s) => { const e = await sendJson<Env>(`${P}/unaccept`, 'POST', { subject }, s); return envelope(e, () => acceptAnswer(e), true) }),
    runStart: (req) => call(async (s) => {
      const body: Record<string, unknown> = { steps: STEPS.filter((x) => req.steps.includes(x)), use_model: req.useModel }
      if (req.subjects?.length) body.subjects = req.subjects
      return run(await sendJson<Env>(`${P}/run`, 'POST', body, s))
    }),
    runStatus: (signal) => call(async (s) => run(await getJson<Env>(`${P}/run`, s)), signal),
    // http.ts has no DELETE helper; the same authenticated api() carries it, so the token header is still read in one place
    runStop: () => call(async (s) => run(await api<Env>(`${P}/run`, { method: 'DELETE', signal: s }))),
    setRole: (paperId, role) => call(async (s) => {
      const e = await sendJson<Env>(`${BASE}/papers/${enc(paperId)}`, 'PATCH', { role }, s)
      const p = obj(e.paper)
      if ((e.state === 'live' || e.state === 'simulated') && (!p || str(p.role) !== role)) return bare('fault', 'The engine answered without the paper, so the change is not shown.')
      return envelope(e, () => ({ id: str(p?.id) || paperId, role: str(p?.role), roleSource: str(p?.role_source) }))
    }),
    abortAll() { ctl.abort(); ctl = new AbortController() },
  }
}

/** The one client the screens use; they take another as a prop in their tests. */
export const prepClient: PrepClient = createPrepClient({ gate: () => import.meta.env.VITE_PRODUCT !== 'jarvis', token: () => TOKEN })
