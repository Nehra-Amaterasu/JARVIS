// The exam adapter of the Study port (package AD08): the ten members the exam slice serves (papers, questions, ingest, decide,
// crop, blueprints, generate, patterns, practiseNext, check) over routes R-01 to R-27 under /api/mission/pyq.
//
// What it promises, and where each promise is kept:
//   - the engine's state is passed through. A route that answers WAITING stays WAITING with its own reason (`reply`, pyqMap.ts).
//   - a failure is named. A refused call, a busy job, a server error or no answer is FAULT with the status and a plain sentence;
//     a 404 on the whole prefix means the engine is not there, which is WAITING "engine routes not found" (`guarded`).
//   - nothing is called when it must not be: with the product gate off, or no token in the window, a member answers exactly what
//     the null adapter answers, and no request is made.
//   - nothing enters the bank unreviewed. Only `decide({kind: 'accept'})` writes status `accepted`; ingest, crop and every read
//     leave questions `pending` (the tests count the PATCH calls).
//   - a view that closes stops the work: `abortAll()` cancels every request and poll in flight.
import { nullStudyPort } from './null.register'
import { waiting } from './types'
import type {
  CheckInput, CropRequest, Decision, GenerateRequest, IngestInput, PortReply, QuestionFilter, StudyMember, StudyPort,
} from '../ports'
import { classify, faultReason, getImage, getJson, sendJson } from './http'
import { BASE, ingestInput, type IngestCtx } from './pyqIngest'
import {
  blueprint as mapBlueprint, boxIn, checkResult, cropInfo, gainItems, generatedPaper, paperRow, patternSet, questionRow, reply,
  type EBlueprint, type ECheck, type EGain, type EGenerated, type EPaper, type EPatterns, type EQuestion, type EnvelopeIn,
} from './pyqMap'

export const ABSENT_REASON = 'engine routes not found'
/** After the prefix answered "not found" the adapter does not ask again for this long (ms). */
const ABSENT_MS = 15_000
const IMAGE_CACHE = 300
const IMAGE_WORKERS = 4
const QUESTION_PAGE = 500
const MAX_EXAMS = 24

export interface PyqDeps {
  /** The product test, written in place by the caller (`import.meta.env.VITE_PRODUCT !== 'jarvis'`) so a JARVIS-only build folds it. */
  gate: () => boolean
  /** The window's token; empty when there is none, and then no request is made. */
  token: () => string
  now?: () => number
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

export interface PyqAdapter {
  port: Partial<StudyPort>
  /** Cancel every request and poll in flight (a view calls this when it unmounts). Later calls start fresh. */
  abortAll(): void
  /** The subject the pattern, practise-next and ingest members work on. Unset: the papers' own subject, else the plan's only one. */
  setSubject(subject: string | null): void
}

const abortError = () => Object.assign(new Error('stopped'), { name: 'AbortError' })
const defaultSleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(abortError()); return }
  const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
  const onAbort = () => { clearTimeout(t); reject(abortError()) }
  signal.addEventListener('abort', onAbort, { once: true })
})

interface ListEnv<T> extends EnvelopeIn { items?: T[]; count?: number; total?: number }
interface AcademicsEnv { subjects?: { id?: string }[] }
interface ExamsEnv { papers?: { id?: string; subject?: string; title?: string }[] }

const enc = encodeURIComponent
const bare = (state: 'waiting' | 'fault', reason: string, now: number): PortReply<never> => ({ state, reason, since: now, data: null })

export function createPyqPort(deps: PyqDeps): PyqAdapter {
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? defaultSleep
  let ctl = new AbortController()
  let absentSince: number | null = null
  let subjectOverride: string | null = null
  const inflight = new Map<string, Promise<unknown>>()
  const images = new Map<string, string>()

  /** One request for several callers at once (the desk asks papers, questions and patterns together). */
  const shared = <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const hit = inflight.get(key) as Promise<T> | undefined
    if (hit) return hit
    const p = run().finally(() => inflight.delete(key))
    inflight.set(key, p)
    return p
  }

  async function guarded<T>(member: StudyMember, run: (signal: AbortSignal) => Promise<PortReply<T>>): Promise<PortReply<T>> {
    // gate off or no token: the null adapter's own answer, and no call
    if (!deps.gate() || !deps.token()) return (nullStudyPort[member] as unknown as () => Promise<PortReply<T>>)()
    if (absentSince !== null && now() - absentSince < ABSENT_MS) return waiting(ABSENT_REASON)
    const signal = ctl.signal
    try {
      const r = await run(signal)
      absentSince = null
      return r
    } catch (e) {
      const f = classify(e)
      if (f.cls === 'absent') { absentSince = now(); return waiting(ABSENT_REASON) }
      if (f.cls === 'aborted') return bare('waiting', 'Stopped: the view was closed.', now())
      return bare('fault', faultReason(f), now())
    }
  }

  const readPapers = (signal: AbortSignal) => shared('papers', () => getJson<ListEnv<EPaper>>(`${BASE}/papers`, signal))

  /** The subject of the desk: the one set by hand, else the subject most papers carry, else the plan's only subject. */
  async function subjectOf(signal: AbortSignal): Promise<string | null> {
    if (subjectOverride) return subjectOverride
    const seen = new Map<string, number>()
    for (const p of (await readPapers(signal)).items ?? []) if (p.subject) seen.set(p.subject, (seen.get(p.subject) ?? 0) + 1)
    const best = [...seen.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
    if (best) return best[0]
    try {
      const ids = ((await shared('academics', () => getJson<AcademicsEnv>('/api/mission/academics', signal))).subjects ?? []).map((s) => s.id).filter((x): x is string => !!x)
      return ids.length === 1 ? ids[0] : null
    } catch (e) {
      if (classify(e).cls === 'aborted') throw e
      return null
    }
  }

  const NO_SUBJECT = 'Say which subject the papers are for first.'

  /** Page crops as data URIs: the image needs the token header, so an <img src> could not load them by address. */
  async function cropImages(rows: EQuestion[], signal: AbortSignal): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    const todo = rows.filter((q) => q.has_crop)
    let next = 0
    const worker = async () => {
      while (next < todo.length) {
        const q = todo[next++]
        const key = `${q.id}|${q.updated ?? ''}`
        let uri = images.get(key)
        if (!uri) {
          try { uri = await getImage(`${BASE}/crops/${enc(q.id)}`, signal) } catch (e) {
            if (classify(e).cls === 'aborted') throw e
            continue // a crop that cannot be read leaves the card saying "crop not rendered"
          }
          images.set(key, uri)
          if (images.size > IMAGE_CACHE) images.delete(images.keys().next().value as string)
        }
        out.set(q.id, uri)
      }
    }
    await Promise.all(Array.from({ length: Math.min(IMAGE_WORKERS, todo.length) }, worker))
    return out
  }

  const port: Partial<StudyPort> = {
    papers: () => guarded('papers', async (signal) => {
      const env = await readPapers(signal)
      return reply(env, now(), (e) => ((e as ListEnv<EPaper>).items ?? []).map(paperRow))
    }),

    questions: (filter?: QuestionFilter) => guarded('questions', async (signal) => {
      const q = new URLSearchParams({ limit: String(QUESTION_PAGE) })
      if (filter?.paperId) q.set('paper', filter.paperId)
      if (filter?.status) q.set('status', filter.status)
      const [papers, first] = await Promise.all([readPapers(signal), getJson<ListEnv<EQuestion>>(`${BASE}/questions?${q}`, signal)])
      const rows: EQuestion[] = [...(first.items ?? [])]
      // R-06 clamps the page to 500; the rest is asked for by offset, to at most six pages
      for (let page = 1; page < 6 && typeof first.total === 'number' && rows.length < first.total; page++) {
        const more = await getJson<ListEnv<EQuestion>>(`${BASE}/questions?${q}&offset=${rows.length}`, signal)
        if (!(more.items ?? []).length) break
        rows.push(...(more.items ?? []))
      }
      const byPaper = new Map((papers.items ?? []).map((p) => [p.id, p]))
      const pics = (first.state === 'live' || first.state === 'simulated') ? await cropImages(rows, signal) : new Map<string, string>()
      return reply(first, now(), () => rows.map((r) => questionRow(r, byPaper.get(r.paper_id), pics.get(r.id))))
    }),

    ingest: (input: IngestInput & { signal?: AbortSignal }) => guarded('ingest', async (signal) => {
      // the caller's own signal (a view's unmount) joins the adapter's; either one stops the poll
      const both = new AbortController()
      const stop = () => both.abort()
      for (const s of [signal, input.signal]) { if (s?.aborted) stop(); else s?.addEventListener('abort', stop, { once: true }) }
      const ctx: IngestCtx = { signal: both.signal, now, sleep, subject: await subjectOf(both.signal) }
      const out = await ingestInput(input, ctx)
      return { state: out.state, reason: out.reason, since: now(), data: out.job }
    }),

    decide: (d: Decision) => guarded('decide', async (signal) => {
      if (d.kind === 'merge' || d.kind === 'split') return { state: 'planned', reason: `The engine has no route to ${d.kind} questions yet.`, since: null, data: null }
      const set: Record<string, unknown> = {}
      if (d.kind === 'accept') set.status = 'accepted'
      else if (d.kind === 'reject') set.status = 'rejected'
      else if (d.kind === 'undo') set.status = 'pending'
      else {
        const p = d.patch
        if (p.stem !== undefined) set.text = p.stem
        if (p.marks !== undefined && p.marks !== null) set.marks = p.marks
        if (p.type !== undefined) set.type = p.type
        if (p.topicId) {
          const cut = p.topicId.indexOf('|')
          const unit = cut > 0 ? Number(p.topicId.slice(0, cut)) : NaN
          if (Number.isInteger(unit)) { set.unit = unit; set.topic = p.topicId.slice(cut + 1) }
        }
      }
      const env = await sendJson<ListEnv<EQuestion>>(`${BASE}/questions`, 'PATCH', { ids: [d.qid], set }, signal)
      return reply(env, now(), (e) => {
        const row = ((e as ListEnv<EQuestion>).items ?? [])[0]
        return { qid: d.qid, status: row?.status === 'accepted' || row?.status === 'rejected' ? row.status : 'pending' } as const
      })
    }),

    crop: (req: CropRequest) => guarded('crop', async (signal) => {
      const env = await sendJson<EnvelopeIn & { question?: EQuestion }>(`${BASE}/crops/${enc(req.qid)}`, 'PUT', { bbox: boxIn(req.bbox) }, signal)
      let img: string | undefined
      if (env.state === 'live' || env.state === 'simulated') {
        for (const k of [...images.keys()]) if (k.startsWith(`${req.qid}|`)) images.delete(k)
        try { img = await getImage(`${BASE}/crops/${enc(req.qid)}`, signal) } catch (e) { if (classify(e).cls === 'aborted') throw e }
      }
      return reply(env, now(), (e) => cropInfo((e as { question?: EQuestion }).question ?? { id: req.qid, paper_id: '' }, img))
    }),

    blueprints: () => guarded('blueprints', async (signal) => {
      const exams = ((await getJson<ExamsEnv>('/api/mission/exams', signal)).papers ?? []).filter((e) => e.id).slice(0, MAX_EXAMS)
      if (!exams.length) return bare('waiting', 'No exam is on the date sheet yet.', now())
      const found = await Promise.all(exams.map(async (ex) => {
        try { return { ex, env: await getJson<EnvelopeIn & { blueprint?: EBlueprint | null }>(`${BASE}/blueprints/${enc(ex.id as string)}`, signal) } } catch (e) {
          // an exam whose subject has no unit list is a 404 of its own; the other exams are still asked
          if (classify(e).cls === 'refused') return null
          throw e
        }
      }))
      const rows = found.filter((x): x is NonNullable<typeof x> => !!x)
      const live = rows.filter((r) => r.env.state === 'live' && r.env.blueprint)
      const sick = rows.find((r) => r.env.state === 'fault')
      if (live.length) {
        const bad = rows.filter((r) => r.env.state === 'fault').length
        const tail = bad && sick ? ` ${bad} more ${bad === 1 ? 'does' : 'do'} not balance: ${String(sick.env.reason ?? '')}` : ''
        return { state: 'live', reason: `${live.length} ${live.length === 1 ? 'blueprint' : 'blueprints'} on file.${tail}`, since: now(), data: live.map((r) => mapBlueprint(r.env.blueprint as EBlueprint, r.ex.id as string, r.ex.title ?? (r.ex.id as string))) }
      }
      const first = sick ?? rows[0]
      if (!first) return bare('waiting', 'No exam on the date sheet has a unit list yet.', now())
      return reply(first.env, now(), () => [])
    }),

    generate: (req: GenerateRequest) => guarded('generate', async (signal) => {
      const env = await sendJson<EnvelopeIn & { paper?: EGenerated }>(`${BASE}/papers/generate`, 'POST', { exam: req.blueprintId, seed: req.seed }, signal)
      return reply(env, now(), (e) => generatedPaper((e as { paper?: EGenerated }).paper ?? {}, req.blueprintId, req.seed))
    }),

    patterns: () => guarded('patterns', async (signal) => {
      const subject = await subjectOf(signal)
      if (!subject) return bare('waiting', NO_SUBJECT, now())
      const env = await getJson<EnvelopeIn & { patterns?: EPatterns }>(`${BASE}/patterns?subject=${enc(subject)}`, signal)
      return reply(env, now(), (e) => patternSet((e as { patterns?: EPatterns }).patterns))
    }),

    practiseNext: () => guarded('practiseNext', async (signal) => {
      const subject = await subjectOf(signal)
      if (!subject) return bare('waiting', NO_SUBJECT, now())
      const env = await getJson<ListEnv<EGain>>(`${BASE}/practise-next?subject=${enc(subject)}`, signal)
      return reply(env, now(), (e) => gainItems((e as ListEnv<EGain>).items))
    }),

    check: (input: CheckInput) => guarded('check', async (signal) => {
      const env = await sendJson<EnvelopeIn & { check?: ECheck }>(`${BASE}/check`, 'POST', { question_id: input.qid, answer: input.answer }, signal)
      return reply(env, now(), (e) => checkResult((e as { check?: ECheck }).check))
    }),
  }

  return {
    port,
    abortAll() { ctl.abort(); ctl = new AbortController(); inflight.clear() },
    setSubject(subject) { subjectOverride = subject },
  }
}

