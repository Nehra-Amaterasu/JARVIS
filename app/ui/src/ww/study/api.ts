/**
 * Study's reads and writes (chunk 7). Every number on a Study screen comes from one of these routes, so
 * a route that answers nothing shows words ("not measured", "none yet"), never a made-up value.
 * The shapes are the server's (ww_exams.py, ww_generator.py, ww_harvest.py, ww_dmat.py); the exam and
 * paper types are borrowed from the old Exams card so there is one definition of them.
 */
import { api, post } from '../../lib/api'
import type { ExamPaper, ExamsAnswer, ExamTopic, GeneratedPaper, PaperQuestion } from '../../germoney/pages/Exams'

export type { ExamPaper, ExamsAnswer, ExamTopic }

export type Tier = 'exam' | 'gate'

/** A question as the paper prints it. `type: 'harvested'` marks a disk-bank item (ids h:<subject>:<hash>). */
export interface PQuestion extends PaperQuestion {
  type?: string
  bank_marks?: number
  latex?: boolean
}

export interface HarvestNote {
  enabled: boolean | null
  short: boolean
  queued: number
  note: string | null
}

export interface PracticePaper extends Omit<GeneratedPaper, 'sections'> {
  sections: { name: string; marks: number; attempt: number; set: number; questions: PQuestion[] }[]
  max?: number | null
  pattern_scaled?: boolean
  harvest?: HarvestNote
}

export interface BankListing {
  subject: string
  name: string | null
  units: { n: number; title: string | null; topics: string[] }[]
  sizes: { total: number; tiers: { exam: number; gate: number }; by_unit: Record<string, number>; by_section: Record<string, number>; typed: number }
}

export interface HarvestItem { id?: string; subject: string; topic: string; status: string; tier?: string }
export interface HarvestQueue {
  enabled: boolean
  paused: boolean
  state: string
  queued: number
  fetching: number
  refused: number
  on_disk: number
  last_request_at: string | number | null
  items: HarvestItem[]
}

export interface MarksResult {
  saved: number
  score: number
  max: number
  say: string
  proficiency: Record<string, number>
}

export const getExams = () => api<ExamsAnswer>('/api/mission/exams')
export const getPaper = (exam: string, seed: number, tier: Tier) =>
  api<PracticePaper>(`/api/mission/paper/${encodeURIComponent(exam)}?seed=${seed}&tier=${tier}`)
export const getBank = (subject: string) => api<BankListing>(`/api/mission/bank/${encodeURIComponent(subject)}`)
export const getHarvest = () => api<HarvestQueue>('/api/mission/harvest/queue')

/** The marks the paper showed go with the answer: a scaled CIE paper is scored out of its own total. */
export const postMarks = (exam: string, items: { id: string; got: number; max: number }[], seed: number) =>
  post<MarksResult>(`/api/mission/paper/${encodeURIComponent(exam)}/marks`, { items, seed })

export interface NewQuestion { unit: number; topic: string; question: string; marks: number; section?: string; tier: Tier; source?: string }
/** O8 posts here. The route is per subject (routes_mission.py bank_add); the brief's "bank/questions" is this one. */
export const postQuestion = (subject: string, q: NewQuestion) =>
  post<{ added: unknown; sizes: BankListing['sizes'] }>(`/api/mission/bank/${encodeURIComponent(subject)}`, q)

export const postTopic = (subject: string, key: string, state: 'none' | 'learned' | 'solid') =>
  post<ExamsAnswer>(`/api/mission/exams/${encodeURIComponent(subject)}/topic`, { key, state })
export const postMinutes = (subject: string, minutes: number) =>
  post<ExamsAnswer>(`/api/mission/exams/${encodeURIComponent(subject)}/minutes`, { minutes })

/** The section kind of the filter row: CIE, End (end-sem), Other (backlog and the rest). */
export type Kind = 'all' | 'cie' | 'end' | 'other'
export const kindOf = (p: ExamPaper): Exclude<Kind, 'all'> => (p.kind === 'cie' ? 'cie' : p.kind === 'end_sem' ? 'end' : 'other')

/** A harvester's last request counts as "fetching" for five minutes (plan 4.2, 8.1): never a promise. */
export const FETCH_WINDOW_MS = 5 * 60 * 1000
export function recentRequest(at: string | number | null | undefined, now = Date.now()): boolean {
  if (at == null || at === '') return false
  const t = typeof at === 'number' ? (at < 1e12 ? at * 1000 : at) : Date.parse(at)
  return Number.isFinite(t) && now - t >= 0 && now - t <= FETCH_WINDOW_MS
}

/** The queue line for one paper's subject, worded from the harvester's real state. null = say nothing. */
export function queueLine(q: HarvestQueue | null, subject: string, now = Date.now()): string | null {
  if (!q) return null
  const mine = (i: HarvestItem) => String(i.subject).toLowerCase() === subject.toLowerCase()
  const waiting = q.items.filter((i) => mine(i) && i.status === 'waiting').length
  const fetching = q.items.filter((i) => mine(i) && i.status === 'fetching').length
  const live = fetching > 0 || (waiting > 0 && q.enabled && !q.paused && recentRequest(q.last_request_at, now))
  if (live) return `Fetching: ${fetching || waiting} ${(fetching || waiting) === 1 ? 'topic' : 'topics'}`
  if (waiting === 0) return null
  const word = waiting === 1 ? 'topic' : 'topics'
  if (!q.enabled) return `Queued: ${waiting} ${word} (off)`
  if (q.paused) return `Queued: ${waiting} ${word} (paused)`
  return `Queued: ${waiting} ${word}`
}

export const dmatSet = (kind: string, seed: number, n: number, level: number) =>
  api<DmatSet>(`/api/mission/dmat/set?kind=${kind}&seed=${seed}&n=${n}&level=${level}`)
export const dmatScore = (set_id: string, answers: (number | null)[], seconds: number) =>
  post<DmatResult>('/api/mission/dmat/score', { set_id, answers, seconds })
export const dmatHistory = (kind?: string) => api<{ results: DmatRow[]; empty: boolean }>(`/api/mission/dmat/history${kind ? `?kind=${kind}` : ''}`)

export type DmatKind = 'figure' | 'equation' | 'latin'
export interface Fig { token: string; text: string; paths: string[]; viewbox: [number, number, number, number] }
export interface DmatItem {
  i: number
  kind: DmatKind
  prompt: string
  shown?: Fig[]
  options: (Fig | { text: string })[]
  unknowns?: string[]
  rule?: string
  equations?: string[]
  ask?: string | { row: number; col: number }
  n?: number
  symbols?: string[]
  grid?: (string | null)[][]
}
export interface DmatSet { set_id: string; kind: DmatKind; label: string; seed: number; level: number; n: number; seconds_per_item: number; time_limit_s: number; items: DmatItem[]; rules: string }
export interface DmatResult { set_id: string; kind: DmatKind; correct: number; of: number; unanswered: number; pct: number; seconds: number | null; time_limit_s: number; in_time: boolean | null }
export interface DmatRow { set_id: string; kind: DmatKind; level: number; n: number; correct: number; of: number; seconds: number | null; time_limit_s: number; in_time: boolean | null; date: string }
