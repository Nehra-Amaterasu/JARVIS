// The intake store's adapter (package I, rows R24 and R25): the intake desk's port over R-36 to R-42 (routes_ww_intake.py) and the
// Classroom export door R-46 and R-47 (routes_ww_pyq_takeout.py), as built on main 7e7e3c1.
//
// What it promises, and where each promise is kept:
//   - the engine's state and sentence are passed through (`env`). A 400, 404, 409 or 503 keeps the engine's own sentence as the reason.
//   - nothing is called when it must not be: with the product gate off or no token in the window every member answers what the
//     null desk answers (WAITING with its reason) and no request is made.
//   - the browser never parses a date: a paste is sent as text and the engine's rows come back (C01 reads them).
//   - nothing is taken into his plan here: accepting only changes the row (R-39), and R-42 is not read by this desk.
//   - a fault with `problems` (the rows file was set aside) is kept for the screen, which prints the lines.
//   - the engine being absent (404 "Not Found" on the prefix) is WAITING "engine routes not found", as in the other adapters.
import { isLampState, type LampState } from '../../../../shared/lamp'
import type { PortReply } from '../../ports'
import { api } from '../../../../lib/api'
import { classify, faultReason, getJson, sendJson, upload } from '../../adapters/http'
import { nullIntakeDesk, type IntakeDeskPort } from '../port'
import type { ArchiveEntry, ArchiveListing, CourseRow, DecidePatch, IcsResult, IntakeKind, IntakeRow, IntakeSource, IntakeState, PasteResult, SubjectOption } from '../types'

export const BASE = '/api/mission/intake'
export const TAKEOUT = '/api/mission/pyq/takeout'
export const ABSENT_REASON = 'engine routes not found'
/** R-39 takes accepted or declined; there is no route that sets a row back to new. */
export const NO_UNDO = 'The store keeps a decision: a row is accepted or declined, and either can be changed to the other.'

export interface IntakeStoreDeps {
  /** The product test, written in place by the caller so a JARVIS-only build folds it. */
  gate: () => boolean
  /** The window's token; empty when there is none, and then no request is made. */
  token: () => string
  now?: () => number
}

export interface IntakeStoreAdapter {
  port: IntakeDeskPort
  abortAll(): void
}

type Env = { state?: unknown; reason?: unknown; source?: unknown } & Record<string, unknown>

interface ERow {
  id?: unknown; source?: unknown; kind?: unknown; state?: unknown; title?: unknown; date?: unknown; time?: unknown
  readings?: unknown; ambiguous?: unknown; subject?: unknown; subject_suggestion?: unknown; repeats?: unknown; file?: unknown; added?: unknown
}

const SOURCES: readonly IntakeSource[] = ['paste', 'ics', 'folder']
const KINDS: readonly IntakeKind[] = ['deadline', 'event', 'file']
const STATES: readonly IntakeState[] = ['new', 'accepted', 'declined', 'taken']
const str = (x: unknown): string => (typeof x === 'string' ? x : '')
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const enc = encodeURIComponent

/** One engine row as the desk's row; null when it is not a row this desk can draw (no id, or a word it does not know). */
export function toRow(e: ERow): IntakeRow | null {
  const source = SOURCES.find((s) => s === e.source)
  const kind = KINDS.find((k) => k === e.kind)
  const state = STATES.find((s) => s === e.state)
  if (typeof e.id !== 'string' || !source || !kind || !state) return null
  const readings = Array.isArray(e.readings) ? (e.readings as { date?: unknown; order?: unknown }[]).filter((r) => r && typeof r.date === 'string') : []
  const sug = e.subject_suggestion && typeof e.subject_suggestion === 'object' ? (e.subject_suggestion as { subject?: unknown; score?: unknown }) : null
  const f = e.file && typeof e.file === 'object' ? (e.file as { name?: unknown; size?: unknown; owned?: unknown }) : null
  const repeats = str(e.repeats)
  const added = typeof e.added === 'string' ? Date.parse(e.added) : NaN
  return {
    id: e.id, source, kind, state, title: str(e.title),
    date: str(e.date) || null, time: str(e.time) || null,
    readings: readings.map((r) => r.date as string), readingOrders: readings.map((r) => str(r.order)),
    ambiguous: e.ambiguous === true,
    subject: str(e.subject),
    suggestion: sug && typeof sug.subject === 'string' && num(sug.score) !== null ? { subject: sug.subject, score: sug.score as number } : null,
    repeats: repeats !== '' && repeats !== 'none', repeatsWord: repeats !== '' && repeats !== 'none' ? repeats : undefined,
    file: f && typeof f.name === 'string' ? { name: f.name, size: num(f.size) ?? 0, owned: f.owned === true } : null,
    added: Number.isFinite(added) ? added : 0,
  }
}

const rowsOf = (items: unknown): IntakeRow[] => (Array.isArray(items) ? (items as ERow[]).map(toRow).filter((r): r is IntakeRow => r !== null) : [])

export function toListing(l: Record<string, unknown>): ArchiveListing | null {
  if (typeof l.id !== 'string' || !Array.isArray(l.entries)) return null
  const entries: ArchiveEntry[] = (l.entries as Record<string, unknown>[]).filter((e) => e && typeof e.name === 'string').map((e) => ({
    id: e.name as string, name: e.name as string, size: num(e.size) ?? 0,
    kind: e.kind === 'pdf' || e.kind === 'pptx' || e.kind === 'other' ? e.kind : undefined,
    refused: typeof e.refused === 'string' && e.refused ? e.refused : undefined,
  }))
  return { id: l.id, name: str(l.name), entries, totalSize: num(l.total_size) ?? undefined, note: str(l.note) || undefined }
}

export function createIntakeStore(deps: IntakeStoreDeps): IntakeStoreAdapter {
  const now = deps.now ?? Date.now
  let ctl = new AbortController()
  let lastProblems: string[] = []
  const silent = () => !deps.gate() || !deps.token()

  const bare = <T,>(state: LampState, reason: string): PortReply<T> => ({ state, reason, since: now(), data: null })

  /** The engine's envelope as a reply: its state and sentence are kept; a body with no valid state is a FAULT. */
  function reply<T>(env: Env, data: (e: Env) => T | null): PortReply<T> {
    if (!isLampState(env.state)) return bare<T>('fault', 'The engine answered without a state.')
    return { state: env.state, reason: str(env.reason), since: now(), data: data(env) }
  }

  function failure<T>(e: unknown): PortReply<T> {
    const f = classify(e)
    if (f.cls === 'absent') return bare<T>('waiting', ABSENT_REASON)
    if (f.cls === 'aborted') return bare<T>('waiting', 'Stopped: the view was closed.')
    // a refusal, a busy job or a desk not mounted (503 "The paper desk is not up yet.") says its own sentence and is not a fault
    if (f.cls === 'refused' || f.cls === 'busy' || f.status === 503) return bare<T>('waiting', f.detail)
    return bare<T>('fault', faultReason(f))
  }

  /** The one wrapper of every call: silent without a gate or token (the null desk's own sentence), a thrown failure becomes a reply. */
  async function call<T>(member: keyof IntakeDeskPort, args: unknown[], run: (s: AbortSignal) => Promise<PortReply<T>>): Promise<PortReply<T>> {
    if (silent()) return (nullIntakeDesk[member] as (...a: unknown[]) => Promise<PortReply<T>>)(...args)
    try { return await run(ctl.signal) } catch (e) { return failure<T>(e) }
  }

  const port: IntakeDeskPort = {
    noUndo: NO_UNDO,
    problems: () => lastProblems,

    list: () => call('list', [], async (s) => {
      const env = await getJson<Env>(BASE, s)
      lastProblems = Array.isArray(env.problems) ? (env.problems as unknown[]).filter((p): p is string => typeof p === 'string') : []
      return reply<IntakeRow[]>(env, (e) => (e.state === 'fault' ? null : rowsOf(e.items)))
    }),

    // the plan's subjects are the ones a suggestion points at (the engine's `subject` is the plan's id)
    subjects: () => call('subjects', [], async (s) => {
      const env = await getJson<{ subjects?: { id?: unknown; name?: unknown }[] }>('/api/mission/academics', s)
      const subs: SubjectOption[] = (env.subjects ?? []).filter((x) => typeof x.id === 'string').map((x) => ({ id: x.id as string, label: str(x.name) || (x.id as string) }))
      if (subs.length === 0) return bare<SubjectOption[]>('waiting', 'No subjects in your plan yet.')
      return { state: 'live', reason: `${subs.length} subjects in your plan.`, since: now(), data: subs }
    }),

    paste: (text) => call('paste', [text], async (s) => {
      const env = await sendJson<Env>(`${BASE}/paste`, 'POST', { text }, s)
      return reply<PasteResult>(env, (e) => ({
        items: rowsOf(e.items),
        unread: (Array.isArray(e.unread) ? (e.unread as { line?: unknown; text?: unknown; reason?: unknown }[]) : []).map((u) => ({ line: num(u.line) ?? 0, text: str(u.text), reason: str(u.reason) })),
      }))
    }),

    // R-38 reads the raw calendar body; the shared helper sends it as bytes with the token (the route does not look at the content type)
    ics: (text) => call('ics', [text], async () => {
      const env = await upload<Env>(`${BASE}/ics`, new Blob([text], { type: 'text/calendar' }), ctl.signal)
      return reply<IcsResult>(env, (e) => ({ items: rowsOf(e.items), skipped: num(e.skipped) ?? 0, past: num(e.past) ?? undefined }))
    }),

    decide: (id, patch: DecidePatch) => {
      if (patch.state === 'new') return Promise.resolve(bare<IntakeRow>('waiting', NO_UNDO))
      return call('decide', [id, patch], async (s) => {
        const body: Record<string, unknown> = { state: patch.state }
        if (patch.title !== undefined) body.title = patch.title
        if (patch.date) body.date = patch.date
        if (patch.time !== undefined) body.time = patch.time
        if (patch.subject !== undefined) body.subject = patch.subject
        const env = await sendJson<Env>(`${BASE}/${enc(id)}`, 'PATCH', body, s)
        return reply<IntakeRow>(env, (e) => toRow((e.row ?? {}) as ERow))
      })
    },

    take: (id, to) => call('take', [id, to], async (s) => {
      const env = await sendJson<Env>(`${BASE}/${enc(id)}/take`, 'POST', { to }, s)
      return reply<IntakeRow>(env, (e) => toRow((e.row ?? {}) as ERow))
    }),

    remove: (id) => call('remove', [id], async (s) => {
      // sendJson has no DELETE, so the app's own helper is called with the method
      const env = await api<Env>(`${BASE}/${enc(id)}`, { method: 'DELETE', signal: s })
      return reply<{ row: boolean; file: boolean }>(env, (e) => {
        const r = (e.removed ?? {}) as { row?: unknown; file?: unknown }
        return { row: r.row === true, file: r.file === true }
      })
    }),

    // no route reads class names or maps them (the plan has none yet): the null desk's WAITING stays for these two
    courses: () => nullIntakeDesk.courses() as Promise<PortReply<CourseRow[]>>,
    mapCourse: (id, subject) => nullIntakeDesk.mapCourse(id, subject),

    archive: (file) => call('archive', [file], async (s) => {
      const env = await upload<Env>(`${TAKEOUT}?name=${enc(file.name)}`, file, s)
      return reply<ArchiveListing>(env, (e) => toListing((e.listing ?? {}) as Record<string, unknown>))
    }),

    archivePath: (path) => call('archive', [path], async (s) => {
      const env = await sendJson<Env>(TAKEOUT, 'POST', { path }, s)
      return reply<ArchiveListing>(env, (e) => toListing((e.listing ?? {}) as Record<string, unknown>))
    }),

    queueArchive: (listingId, entryIds) => call('queueArchive', [listingId, entryIds], async (s) => {
      const env = await sendJson<Env>(`${TAKEOUT}/${enc(listingId)}/accept`, 'POST', { entries: entryIds }, s)
      return reply<{ queued: number }>(env, () => ({ queued: entryIds.length }))
    }),
  }

  return { port, abortAll() { ctl.abort(); ctl = new AbortController() } }
}
