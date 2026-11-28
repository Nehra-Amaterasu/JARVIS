// The tonight sheet and the counted ledger (routes R-55 to R-59 and R-60 to R-62 of docs/design/well-wisher-engine-plan.md, section 9.0,
// the lines of 27 Nov; board requests 12 and 13). They are not members of the frozen Study port, so the two screens reach them through
// `TonightClient`, built with the same rules as the paper desk's client (pyqExtras.ts):
//   - the engine's state and its sentence are passed through; none is invented. An answer with no valid state is a FAULT.
//   - gate off or no token: nothing is called, the answer is WAITING "the paper engine is not connected yet".
//   - a 400 is the engine's own sentence (FAULT, e.g. "Marks for a 5-mark question are from 0 to 5."), a 409 likewise (WAITING).
//   - nothing is built, saved or scheduled except by his press: the client has no timer and no poll.
//   - a mark is only what he typed; the client never computes a grade, a total of its own or a forecast: totals are the engine's.
// This is its own file because the paper desk's adapter files change on another branch.
import { isLampState, type LampState } from '../../../shared/lamp'
import { TOKEN } from '../../../lib/api'
import { classify, faultReason, getJson, sendJson } from './http'
import { BASE } from './pyqIngest'
import type { ClientReply } from './types'

export const NOT_CONNECTED = 'the paper engine is not connected yet'
const ABSENT = 'engine routes not found'
const enc = encodeURIComponent
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const str = (x: unknown): string => (typeof x === 'string' ? x : '')

// ------------------------------------------------------------------------------------------------ what the screens read
/** The printed terms that put a question on the sheet: R-17's own numbers, none of them mine. */
export interface Why { daysLeft: number | null; marksWeight: number | null; share: number | null; proficiency: number | null; syllabusWeight: number | null }
/** A mark he typed (R-58): his, with the maximum the engine holds for the question. */
export interface SheetMark { got: number; max: number; minutes: number | null; at: string }
export interface SheetItem {
  /** null only when the question's marks are not printed (a question bank, wave EW11): then marksNotPrinted is true and R-58 needs his out_of. */
  n: number; questionId: string; marks: number | null; unit: number | null; topic: string; topicKey: string
  marksNotPrinted?: boolean
  text: string
  /** The path of the page crop when the question is a picture (read with the token, never an <img src>). */
  crop: string | null
  why: Why | null
  mark: SheetMark | null
}
export interface Sheet { id: string; date: string; subject: string; builtAt: string; items: SheetItem[]; unmarked: number }
export interface TonightSettings { on: boolean; hour: string; count: number; horizonDays: number }
export interface AwaitingRow { id: string; date: string; subject: string; unmarked: number }
export interface NextPaper { subject: string; title: string; date: string; daysLeft: number }
export interface TonightView { sheet: Sheet | null; awaiting: AwaitingRow[]; settings: TonightSettings | null; nextPapers: NextPaper[] }
export interface MarksSaved { sheet: Sheet | null; saved: number; total: { got: number; max: number } | null; markedBy: string; keptMarks?: string[] }
/** outOf and keep only for a question whose marks are not printed: outOf his own number (1 to 100), keep to remember it as the question's marks. */
export interface MarkInput { questionId: string; got: number; minutes?: number; outOf?: number; keep?: boolean }
export interface SettingsPatch { on?: boolean; hour?: string; count?: number; horizonDays?: number }

export interface LedgerRow {
  key: string; unit: number | null; topic: string
  /** 3 high, 2 middle, 1 low: the engine's number. */
  syllabusWeight: number | null
  notes: number; pastQuestions: number; pastMarks: number; papersSeen: number; families: number
  attempts: number; got: number; max: number; minutes: number | null; lastPractised: string | null
  questionIds: string[]; noteFiles: string[]
}
export interface Hole { key: string; kind: string; sentence: string }
export interface LedgerTotals { topics: number; withNotes: number; withPastQuestion: number; practised: number; attempts: number; got: number; max: number }
export interface Skipped { file: string; reason: string }
export interface Ledger { items: LedgerRow[]; holes: Hole[]; totals: LedgerTotals | null; skipped: Skipped[] }
export interface AttemptRow { at: string; source: 'sheet' | 'paper' | string; sourceId: string; questionId: string; topicKey: string; got: number; max: number; minutes: number | null }
export interface Pace {
  paperDate: string | null; daysLeft: number | null; topics: number; practised: number; left: number
  daysCounted: number; practisedInDays: number | null; perDay: number | null; daysNeeded: number | null; from: string | null; to: string | null; sentence: string
}

export interface TonightClient {
  /** R-55: today's sheet (or none), the sheets waiting for marks, the settings, the papers ahead. Every state carries them. */
  tonight(signal?: AbortSignal): Promise<ClientReply<TonightView>>
  /** R-56: only the fields in the patch are sent. */
  saveSettings(patch: SettingsPatch): Promise<ClientReply<TonightSettings>>
  /** R-57: his press. With no date and no subject the engine picks the paper nearest in date. */
  build(req?: { date?: string; subject?: string }): Promise<ClientReply<Sheet | null>>
  /** R-58: marks he typed; a second post for a question replaces the first. */
  saveMarks(sheetId: string, items: MarkInput[]): Promise<ClientReply<MarksSaved>>
  /** R-59: the sheet as A4 HTML, fetched with the token (an <iframe src> cannot send it). */
  printHtml(sheetId: string): Promise<ClientReply<string>>
  ledger(subject: string, signal?: AbortSignal): Promise<ClientReply<Ledger>>
  attempts(subject: string, topic: string, signal?: AbortSignal): Promise<ClientReply<AttemptRow[]>>
  pace(subject: string, signal?: AbortSignal): Promise<ClientReply<Pace>>
  abortAll(): void
}

// ------------------------------------------------------------------------------------------------ mappers (pure; each has a test)
interface Env { state?: unknown; reason?: unknown; [k: string]: unknown }
type R = Record<string, unknown>
const arr = (x: unknown): R[] => (Array.isArray(x) ? (x.filter((r) => r && typeof r === 'object') as R[]) : [])
const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [])

export function whyOf(w: unknown): Why | null {
  if (!w || typeof w !== 'object') return null
  const r = w as R
  return { daysLeft: num(r.days_left), marksWeight: num(r.marks_weight), share: num(r.share), proficiency: num(r.proficiency), syllabusWeight: num(r.syllabus_weight) }
}

export function sheetMark(m: unknown): SheetMark | null {
  if (!m || typeof m !== 'object') return null
  const r = m as R
  const got = num(r.got)
  const max = num(r.max)
  if (got === null || max === null) return null
  return { got, max, minutes: num(r.minutes), at: str(r.at) }
}

export function sheetItem(i: R): SheetItem | null {
  const q = str(i.question_id)
  const marks = num(i.marks)
  // marks null is kept only when the engine says why (marks_note "marks not printed", R-57 since wave EW11); any other gap is dropped
  const notPrinted = marks === null && str(i.marks_note) === 'marks not printed'
  if (!q || (marks === null && !notPrinted)) return null
  return {
    n: num(i.n) ?? 0, questionId: q, marks, marksNotPrinted: notPrinted, unit: num(i.unit), topic: str(i.topic), topicKey: str(i.topic_key),
    text: str(i.text), crop: str(i.crop) || null, why: whyOf(i.why), mark: sheetMark(i.mark),
  }
}

export function sheetOf(s: unknown): Sheet | null {
  if (!s || typeof s !== 'object') return null
  const r = s as R
  const id = str(r.id)
  if (!id) return null
  const items = arr(r.items).map(sheetItem).filter((x): x is SheetItem => x !== null)
  // the engine counts the unmarked itself; when an older answer carries no count it is the items with no mark of his
  return { id, date: str(r.date), subject: str(r.subject), builtAt: str(r.built_at), items, unmarked: num(r.unmarked) ?? items.filter((x) => !x.mark).length }
}

export function settingsOf(s: unknown): TonightSettings | null {
  if (!s || typeof s !== 'object') return null
  const r = s as R
  const count = num(r.count)
  const horizon = num(r.horizon_days)
  if (typeof r.on !== 'boolean' || !str(r.hour) || count === null || horizon === null) return null
  return { on: r.on, hour: str(r.hour), count, horizonDays: horizon }
}

export function tonightView(e: Env): TonightView {
  return {
    sheet: sheetOf(e.sheet),
    awaiting: arr(e.awaiting_marks).filter((r) => str(r.id)).map((r) => ({ id: str(r.id), date: str(r.date), subject: str(r.subject), unmarked: num(r.unmarked) ?? 0 })),
    settings: settingsOf(e.settings),
    nextPapers: arr(e.next_papers).map((r) => ({ subject: str(r.subject), title: str(r.title), date: str(r.date), daysLeft: num(r.days_left) ?? 0 })),
  }
}

export function ledgerRow(r: R): LedgerRow | null {
  const key = str(r.key)
  if (!key) return null
  return {
    key, unit: num(r.unit), topic: str(r.topic), syllabusWeight: num(r.syllabus_weight), notes: num(r.notes) ?? 0, pastQuestions: num(r.past_questions) ?? 0,
    pastMarks: num(r.past_marks) ?? 0, papersSeen: num(r.papers_seen) ?? 0, families: num(r.families) ?? 0, attempts: num(r.attempts) ?? 0,
    got: num(r.got) ?? 0, max: num(r.max) ?? 0, minutes: num(r.minutes), lastPractised: str(r.last_practised) || null,
    questionIds: strs(r.question_ids), noteFiles: strs(r.note_files),
  }
}

export function ledgerOf(e: Env): Ledger {
  const t = e.totals && typeof e.totals === 'object' ? (e.totals as R) : null
  return {
    items: arr(e.items).map(ledgerRow).filter((x): x is LedgerRow => x !== null),
    holes: arr(e.holes).filter((h) => str(h.key) && str(h.kind)).map((h) => ({ key: str(h.key), kind: str(h.kind), sentence: str(h.sentence) })),
    totals: t ? {
      topics: num(t.topics) ?? 0, withNotes: num(t.with_notes) ?? 0, withPastQuestion: num(t.with_past_question) ?? 0, practised: num(t.practised) ?? 0,
      attempts: num(t.attempts) ?? 0, got: num(t.got) ?? 0, max: num(t.max) ?? 0,
    } : null,
    skipped: arr(e.skipped).map((s) => ({ file: str(s.file), reason: str(s.reason) })),
  }
}

export function attemptRow(r: R): AttemptRow | null {
  const got = num(r.got)
  const max = num(r.max)
  if (!str(r.at) || got === null || max === null) return null
  return { at: str(r.at), source: str(r.source), sourceId: str(r.source_id), questionId: str(r.question_id), topicKey: str(r.topic_key), got, max, minutes: num(r.minutes) }
}

export function paceOf(e: Env): Pace {
  return {
    paperDate: str(e.paper_date) || null, daysLeft: num(e.days_left), topics: num(e.topics) ?? 0, practised: num(e.practised) ?? 0, left: num(e.left) ?? 0,
    daysCounted: num(e.days_counted) ?? 0, practisedInDays: num(e.practised_in_days), perDay: num(e.per_day), daysNeeded: num(e.days_needed),
    from: str(e.from) || null, to: str(e.to) || null, sentence: str(e.sentence),
  }
}

// ------------------------------------------------------------------------------------------------ the client
export interface TonightClientDeps { gate: () => boolean; token: () => string; now?: () => number }

export function createTonightClient(deps: TonightClientDeps): TonightClient {
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

  /** `always`: the data travels in every state (R-55 and R-62 carry numbers with WAITING and PLANNED, drawn beside the state word). */
  const envelope = <T>(env: Env, build: () => T, always = false): ClientReply<T> => {
    if (!env || !isLampState(env.state)) return bare('fault', 'The engine answered without a state, so nothing is shown.')
    const state: LampState = env.state
    const reason = str(env.reason) || (state === 'fault' ? 'no reason given' : '')
    return { state, reason, since: now(), data: always || state === 'live' || state === 'simulated' ? build() : null }
  }

  const BASE_T = `${BASE}/tonight`
  const BASE_L = `${BASE}/ledger`
  return {
    tonight: (signal) => call(async (s) => { const e = await getJson<Env>(BASE_T, s); return envelope(e, () => tonightView(e), true) }, signal),
    saveSettings: (patch) => call(async (s) => {
      const body: Record<string, unknown> = {}
      if (patch.on !== undefined) body.on = patch.on
      if (patch.hour !== undefined) body.hour = patch.hour
      if (patch.count !== undefined) body.count = patch.count
      if (patch.horizonDays !== undefined) body.horizon_days = patch.horizonDays
      const e = await sendJson<Env>(`${BASE_T}/settings`, 'PUT', body, s)
      // planned (switched off) still carries the settings: the key he pressed shows what is now on file
      return envelope(e, () => settingsOf(e.settings) as TonightSettings, true)
    }),
    build: (req = {}) => call(async (s) => {
      const body: Record<string, unknown> = {}
      if (req.date) body.date = req.date
      if (req.subject) body.subject = req.subject
      const e = await sendJson<Env>(`${BASE_T}/build`, 'POST', body, s)
      const sheet = sheetOf(e.sheet)
      // a sheet that did not come back is not shown as built, whatever the state word says
      if (e.state === 'live' && !sheet) return bare('fault', 'The engine answered without the sheet, so nothing is shown.')
      return envelope(e, () => sheet, true)
    }),
    saveMarks: (sheetId, items) => call(async (s) => {
      const body = { items: items.map((m) => ({
        question_id: m.questionId, got: m.got, ...(m.minutes !== undefined ? { minutes: m.minutes } : {}),
        ...(m.outOf !== undefined ? { out_of: m.outOf } : {}), ...(m.outOf !== undefined && m.keep !== undefined ? { keep: m.keep } : {}),
      })) }
      const e = await sendJson<Env>(`${BASE_T}/${enc(sheetId)}/marks`, 'POST', body, s)
      const t = e.total && typeof e.total === 'object' ? (e.total as R) : null
      return envelope(e, () => ({
        sheet: sheetOf(e.sheet), saved: num(e.saved) ?? 0, markedBy: str(e.marked_by), keptMarks: Array.isArray(e.kept_marks) ? e.kept_marks.filter((x): x is string => typeof x === 'string') : [],
        total: t && num(t.got) !== null && num(t.max) !== null ? { got: num(t.got) as number, max: num(t.max) as number } : null,
      }))
    }),
    printHtml: (sheetId) => call(async (s) => {
      // not api(): the answer is HTML, not JSON
      const res = await fetch(`${BASE_T}/${enc(sheetId)}/print`, { headers: { 'X-Jarvis-Token': TOKEN }, signal: s })
      if (!res.ok) {
        let msg = res.statusText
        try { msg = (await res.json()).detail ?? msg } catch { /* not JSON */ }
        return bare<string>('fault', msg)
      }
      return { state: 'live' as LampState, reason: 'The sheet as the engine prints it.', since: now(), data: await res.text() }
    }),
    ledger: (subject, signal) => call(async (s) => { const e = await getJson<Env>(`${BASE_L}?subject=${enc(subject)}`, s); return envelope(e, () => ledgerOf(e), true) }, signal),
    attempts: (subject, topic, signal) => call(async (s) => {
      const e = await getJson<Env>(`${BASE_L}/attempts?subject=${enc(subject)}&topic=${enc(topic)}`, s)
      return envelope(e, () => arr(e.items).map(attemptRow).filter((x): x is AttemptRow => x !== null), true)
    }, signal),
    pace: (subject, signal) => call(async (s) => { const e = await getJson<Env>(`${BASE_L}/pace?subject=${enc(subject)}`, s); return envelope(e, () => paceOf(e), true) }, signal),
    abortAll() { ctl.abort(); ctl = new AbortController() },
  }
}

/** The one client the screens use; they take another as a prop in their tests. */
export const tonightClient: TonightClient = createTonightClient({ gate: () => import.meta.env.VITE_PRODUCT !== 'jarvis', token: () => TOKEN })
