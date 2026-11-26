// The Classroom adapter of the Study port (package GC-UI): `classroom()` of the port from G-01, and a small typed client
// (`GcrClient`) for the nineteen routes under /api/mission/gcr that the Classroom screens use (and DELETE /api/reminders/{id}, which removes the reminder G-17 made).
//
// What it promises, and where each promise is kept:
//   - the engine's state and sentence are passed through (`answer`). A refusal (400 not connected, 409 busy) keeps the engine's own
//     sentence as the reason, so a screen can print it as it is.
//   - the engine being absent is named: a 404 "Not Found" on the prefix is WAITING "engine routes not found", from 'app', so no
//     Connect key is drawn for a link nobody can answer.
//   - nothing is called when it must not be: with the product gate off or no token in the window the client answers PLANNED (status)
//     or WAITING (the rest) and makes no request, the way the null adapter does.
//   - a view that closes stops the work: every call takes the caller's AbortSignal, and `abortAll()` cancels all of them.
//   - the original file is fetched WITH the token header and handed over as a blob URL, because an <iframe src> or <img src> cannot
//     send a header; whoever shows it revokes the URL (`revokeOriginal`).
import { isLampState } from '../../../shared/lamp'
import { api } from '../../../lib/api'
import type { ClassroomStatus, PortReply, StudyPort } from '../ports'
import { classify, faultReason, getJson, sendJson, type Fail } from './http'
import type {
  GcrAnnouncement, GcrAnswer, GcrAssignmentQuery, GcrAssignmentsBody, GcrCourse, GcrEvent, GcrFile, GcrFileQuery, GcrJob, GcrKind, GcrNoteBody,
  GcrOriginal, GcrReminder, GcrStatusBody,
} from './gcrTypes'
import { planned } from './types'

export const BASE = '/api/mission/gcr'
export const ABSENT_REASON = 'engine routes not found'
export const NO_TOKEN_REASON = 'Classroom needs the app window it was opened in; this window has no sign-in for the app.'
/** The sentence of the null adapter, kept for a window that cannot ask the engine. */
export const NOT_BUILT_REASON = 'Classroom is not built; it would pull course files you can already open'
/** How often the screens ask again while a sign-in or a sync is running (the route contract says 2 s). */
export const POLL_MS = 2000

export interface GcrDeps {
  /** The product test, written in place by the caller (`import.meta.env.VITE_PRODUCT !== 'jarvis'`) so a JARVIS-only build folds it. */
  gate: () => boolean
  /** The window's token; empty when there is none, and then no request is made. */
  token: () => string
  now?: () => number
}

type Env = { state?: unknown; reason?: unknown; source?: unknown } & Record<string, unknown>

export interface GcrClient {
  status(signal?: AbortSignal): Promise<GcrAnswer<GcrStatusBody>>
  /** G-02: `account` is a short lower-case name; absent means the main account. */
  connect(account?: string, signal?: AbortSignal): Promise<GcrAnswer<GcrStatusBody>>
  /** G-03: the same optional name. */
  disconnect(account?: string, signal?: AbortSignal): Promise<GcrAnswer<GcrStatusBody>>
  /** G-04: start a sync of all courses, or of the ones named. */
  sync(courses?: string[], signal?: AbortSignal): Promise<GcrAnswer<{ job: GcrJob }>>
  /** G-05 */
  job(signal?: AbortSignal): Promise<GcrAnswer<{ job: GcrJob }>>
  courses(signal?: AbortSignal): Promise<GcrAnswer<{ items: GcrCourse[] }>>
  patchCourse(id: string, patch: { subject?: string; include?: boolean }, signal?: AbortSignal): Promise<GcrAnswer<{ course: GcrCourse }>>
  files(query?: GcrFileQuery, signal?: AbortSignal): Promise<GcrAnswer<{ items: GcrFile[] }>>
  setKind(id: string, kind: GcrKind, signal?: AbortSignal): Promise<GcrAnswer<{ file: GcrFile }>>
  note(id: string, signal?: AbortSignal): Promise<GcrAnswer<GcrNoteBody>>
  /** G-11: the bytes as a blob URL. The caller owns the URL and calls `revokeOriginal` when it closes the view. */
  original(id: string, signal?: AbortSignal): Promise<GcrAnswer<GcrOriginal>>
  revokeOriginal(url: string): void
  /** G-12: open the original in the PC's own program for its type. */
  openInProgram(id: string, signal?: AbortSignal): Promise<GcrAnswer<Record<string, unknown>>>
  /** G-13: send a PDF or a Word file to the paper desk. */
  toPapers(id: string, signal?: AbortSignal): Promise<GcrAnswer<{ paper_id: string | null }>>
  /** G-14: stop the running sync after the file being fetched. A 400 (none runs) keeps the engine's sentence and has no data. */
  stopSync(signal?: AbortSignal): Promise<GcrAnswer<{ job: GcrJob }>>
  /** G-15: the coursework; `show` is "open" (the engine's default) or "all". */
  assignments(query?: GcrAssignmentQuery, signal?: AbortSignal): Promise<GcrAnswer<GcrAssignmentsBody>>
  /** G-16: open the assignment's Classroom page in the browser. Turning in happens there: there is no call for it, Google forbids it. */
  openAssignment(id: string, signal?: AbortSignal): Promise<GcrAnswer<Record<string, unknown>>>
  /** G-17: one reminder, by default 18:00 the day before; `at` is local "YYYY-MM-DDTHH:MM". A second press answers the one already made. */
  remind(id: string, at?: string, signal?: AbortSignal): Promise<GcrAnswer<{ reminder: GcrReminder }>>
  /** DELETE /api/reminders/{id}: the reminder made by `remind`. Not under the gcr prefix; the answer is made LIVE from its `ok`. */
  removeReminder(reminderId: string, signal?: AbortSignal): Promise<GcrAnswer<Record<string, unknown>>>
  /** G-18 */
  announcements(course?: string, limit?: number, signal?: AbortSignal): Promise<GcrAnswer<{ items: GcrAnnouncement[] }>>
  /** G-19: `from` and `to` are "YYYY-MM-DD"; the engine's default is today and 30 days. */
  calendar(range?: { from?: string; to?: string }, signal?: AbortSignal): Promise<GcrAnswer<{ items: GcrEvent[] }>>
}

export interface GcrAdapter {
  port: Partial<StudyPort>
  client: GcrClient
  /** Cancel every request in flight (a view calls this when it unmounts). Later calls start fresh. */
  abortAll(): void
}

const enc = encodeURIComponent

/** One signal that fires when either does; a missing one is ignored. */
function joined(a: AbortSignal, b?: AbortSignal): AbortSignal {
  if (!b) return a
  const both = new AbortController()
  const stop = () => both.abort()
  for (const s of [a, b]) { if (s.aborted) stop(); else s.addEventListener('abort', stop, { once: true }) }
  return both.signal
}

export function createGcr(deps: GcrDeps): GcrAdapter {
  const now = deps.now ?? Date.now
  let ctl = new AbortController()
  const silent = () => !deps.gate() || !deps.token()

  const bare = <T,>(state: GcrAnswer<T>['state'], reason: string, from: 'engine' | 'app' = 'app', status = 0): GcrAnswer<T> =>
    ({ state, reason, source: 'this window', from, status, since: now(), data: null })

  /** The engine's envelope as an answer: the state is kept, the fields ride along as data. A body with no valid state is a FAULT. */
  function answer<T>(env: Env, status: number): GcrAnswer<T> {
    if (!isLampState(env.state)) return { ...bare<T>('fault', 'The engine answered without a state.', 'engine', status) }
    return {
      state: env.state,
      reason: typeof env.reason === 'string' ? env.reason : '',
      source: typeof env.source === 'string' ? env.source : '',
      from: 'engine',
      status,
      since: now(),
      data: env as unknown as T,
    }
  }

  function failure<T>(f: Fail): GcrAnswer<T> {
    if (f.cls === 'absent') return bare<T>('waiting', ABSENT_REASON)
    if (f.cls === 'aborted') return bare<T>('waiting', 'Stopped: the view was closed.')
    // a refusal or a busy engine says its own sentence ("Not connected yet.", "A sync is already running."); the screen prints it as it is
    if (f.cls === 'refused' || f.cls === 'busy') return bare<T>('waiting', f.detail, 'engine', f.status)
    return bare<T>('fault', faultReason(f), f.cls === 'network' ? 'app' : 'engine', f.status)
  }

  /** The one wrapper of every call: silent without a gate or token, and a thrown failure becomes an answer. */
  async function call<T>(quiet: GcrAnswer<T>, signal: AbortSignal | undefined, run: (s: AbortSignal) => Promise<GcrAnswer<T>>): Promise<GcrAnswer<T>> {
    if (silent()) return quiet
    try { return await run(joined(ctl.signal, signal)) } catch (e) { return failure<T>(classify(e)) }
  }

  const noToken = <T,>() => bare<T>('waiting', NO_TOKEN_REASON)
  const get = <T,>(path: string, quiet: GcrAnswer<T>, signal?: AbortSignal) =>
    call<T>(quiet, signal, async (s) => answer<T>(await getJson<Env>(`${BASE}${path}`, s), 200))
  const send = <T,>(method: 'POST' | 'PATCH', path: string, body: unknown, signal?: AbortSignal) =>
    call<T>(noToken<T>(), signal, async (s) => answer<T>(await sendJson<Env>(`${BASE}${path}`, method, body, s), 200))

  const client: GcrClient = {
    status: (signal) => get<GcrStatusBody>('/status', { ...planned<never>(NOT_BUILT_REASON), source: 'this window', from: 'app', status: 0, data: null }, signal),
    connect: (account, signal) => send<GcrStatusBody>('POST', '/connect', account ? { account } : {}, signal),
    disconnect: (account, signal) => send<GcrStatusBody>('POST', '/disconnect', account ? { account } : {}, signal),
    sync: (courses, signal) => send<{ job: GcrJob }>('POST', '/sync', courses ? { courses } : {}, signal),
    job: (signal) => get<{ job: GcrJob }>('/sync', noToken(), signal),
    courses: (signal) => get<{ items: GcrCourse[] }>('/courses', noToken(), signal),
    patchCourse: (id, patch, signal) => send<{ course: GcrCourse }>('PATCH', `/courses/${enc(id)}`, patch, signal),
    files: (q = {}, signal) => {
      const p = new URLSearchParams()
      if (q.course) p.set('course', q.course)
      if (q.kind) p.set('kind', q.kind)
      if (q.q?.trim()) p.set('q', q.q.trim())
      const s = p.toString()
      return get<{ items: GcrFile[] }>(`/files${s ? `?${s}` : ''}`, noToken(), signal)
    },
    setKind: (id, kind, signal) => send<{ file: GcrFile }>('PATCH', `/files/${enc(id)}`, { kind }, signal),
    note: (id, signal) => get<GcrNoteBody>(`/files/${enc(id)}/note`, noToken(), signal),
    original: (id, signal) => call<GcrOriginal>(noToken(), signal, async (s) => {
      const res = await fetch(`${BASE}/files/${enc(id)}/original`, { headers: { 'X-Jarvis-Token': deps.token() }, signal: s })
      if (!res.ok) {
        let msg = res.statusText
        try { const j = await res.json(); msg = j.detail ?? j.error ?? msg } catch { /* not JSON */ }
        return fromStatus<GcrOriginal>(res.status, msg)
      }
      const blob = await res.blob()
      return { state: 'live', reason: '', source: 'the Classroom copy on this PC', from: 'engine', status: 200, since: now(), data: { url: URL.createObjectURL(blob), mime: res.headers.get('content-type') ?? blob.type, bytes: blob.size } }
    }),
    revokeOriginal: (url) => { try { URL.revokeObjectURL(url) } catch { /* a URL already gone */ } },
    openInProgram: (id, signal) => send<Record<string, unknown>>('POST', `/files/${enc(id)}/open`, {}, signal),
    toPapers: (id, signal) => send<{ paper_id: string | null }>('POST', `/files/${enc(id)}/to-papers`, {}, signal),
    stopSync: (signal) => call<{ job: GcrJob }>(noToken(), signal, async (s) => answer<{ job: GcrJob }>(await api<Env>(`${BASE}/sync`, { method: 'DELETE', signal: s }), 200)),
    assignments: (q = {}, signal) => {
      const p = new URLSearchParams()
      if (q.course) p.set('course', q.course)
      if (q.show) p.set('show', q.show)
      const s = p.toString()
      return get<GcrAssignmentsBody>(`/assignments${s ? `?${s}` : ''}`, noToken(), signal)
    },
    openAssignment: (id, signal) => send<Record<string, unknown>>('POST', `/assignments/${enc(id)}/open`, {}, signal),
    remind: (id, at, signal) => send<{ reminder: GcrReminder }>('POST', `/assignments/${enc(id)}/remind`, at ? { at } : {}, signal),
    removeReminder: (reminderId, signal) => call<Record<string, unknown>>(noToken(), signal, async (s) => {
      // the reminder list answers {ok, reminder} with no state word: a removal that came back ok is LIVE, and the sentence is ours
      const r = await api<Record<string, unknown>>(`/api/reminders/${enc(reminderId)}`, { method: 'DELETE', signal: s })
      return { state: 'live', reason: 'Reminder removed.', source: 'your reminders', from: 'engine', status: 200, since: now(), data: r }
    }),
    announcements: (course, limit, signal) => {
      const p = new URLSearchParams()
      if (course) p.set('course', course)
      if (limit) p.set('limit', String(limit))
      const s = p.toString()
      return get<{ items: GcrAnnouncement[] }>(`/announcements${s ? `?${s}` : ''}`, noToken(), signal)
    },
    calendar: (range = {}, signal) => {
      const p = new URLSearchParams()
      if (range.from) p.set('from', range.from)
      if (range.to) p.set('to', range.to)
      const s = p.toString()
      return get<{ items: GcrEvent[] }>(`/calendar${s ? `?${s}` : ''}`, noToken(), signal)
    },
  }

  /** The status a refused byte fetch maps to: the same classes as every JSON call (404 "Not Found" is the engine being absent). */
  function fromStatus<T>(status: number, msg: string): GcrAnswer<T> {
    if ((status === 404 && msg === 'Not Found') || (status === 405 && msg === 'Method Not Allowed')) return bare<T>('waiting', ABSENT_REASON)
    if (status >= 500) return bare<T>('fault', faultReason({ cls: 'server', status, detail: msg }), 'engine', status)
    return bare<T>('waiting', msg, 'engine', status)
  }

  /** G-01 mapped onto the frozen ClassroomStatus: data only for LIVE, the engine's reason for every state. */
  const classroom = async (): Promise<PortReply<ClassroomStatus>> => {
    const r = await client.status()
    if (r.state === 'live' && r.data) {
      const d = r.data
      return {
        state: 'live', reason: r.reason, since: r.since,
        data: { connected: true, courses: d.counts?.courses ?? 0, connecting: d.connecting, syncedAt: d.synced_at, scopes: d.scopes, counts: d.counts, job: d.job },
      }
    }
    // PLANNED, WAITING and FAULT carry no data (a number is never drawn for them); the engine's reason says which and why
    return { state: r.state, reason: r.reason, since: r.since, data: null }
  }

  return {
    port: { classroom },
    client,
    abortAll() { ctl.abort(); ctl = new AbortController() },
  }
}
