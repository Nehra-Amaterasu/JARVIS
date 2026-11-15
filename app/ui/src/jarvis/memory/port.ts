// The Memory section's ports (rule 2 of the wave bulletin): every call the four views make goes through one of these small
// interfaces, so a view is drawn from fixtures in the gallery and the tests, and from the real routes in the app. The LIVE
// objects below are the moved calls of pages/Yaadash.tsx, components/LearnedReviewCard.tsx, components/RemindersCard.tsx and
// components/ConnectControls.tsx (same routes, same bodies); nothing was rewritten.
//
// What the store cannot do yet is `null` here and drawn PLANNED by the view, never faked: there is no route that deletes one
// stored item (`remove` is null), none that snapshots the store, none that deletes the raw signal, and none that returns an
// id for a stored line. A Fix is written the one way that exists, as a correction (POST /api/memory/teach).
import { api, post } from '../../lib/api'
import { ago, exportState, fmtBytes, importPath, loadExports, openImports, readLine, requestExport, uploadExport, type ExportSource } from '../../lib/settings'
import type { LearnedQueue, Verdict as LearnedVerdict } from '../../lib/learned'
import type { RemindersView } from '../../lib/reminders'
import type { Belief, GalaxyPayload, NodeDetail, Person, SearchRes, Stats, TasteView } from './types'

/** The most nodes asked of the layout route. The payload counts are the whole store whatever this is. */
export const GALAXY_MAX = 600

export interface RecallPort {
  /** A fixture: every state it draws is stamped SIMULATED. */
  simulated: boolean
  stats(): Promise<Stats>
  galaxy(): Promise<GalaxyPayload>
  detail(id: string): Promise<NodeDetail>
  search(q: string): Promise<SearchRes>
  /** `remember> ...`: one fact written. `added` is false when the same text is already stored. */
  capture(text: string): Promise<{ added: boolean }>
  /** A fix, written as a correction: `before` is the wording it replaces. */
  fix(before: string, after: string): Promise<{ added: boolean }>
  taste(): Promise<TasteView>
  /** Null: the store has no route that deletes one item, so the Delete key is drawn PLANNED and sends nothing. */
  remove: null | ((ids: string[]) => Promise<void>)
}

export const LIVE_RECALL: RecallPort = {
  simulated: false,
  stats: () => api<Stats>('/api/memory/stats'),
  galaxy: () => api<GalaxyPayload>(`/api/galaxy?max_nodes=${GALAXY_MAX}`),
  detail: (id) => api<NodeDetail>(`/api/galaxy/node?id=${encodeURIComponent(id)}`),
  search: (q) => api<SearchRes>(`/api/memory/search?q=${encodeURIComponent(q)}`),
  capture: (text) => post<{ ok: boolean; added: boolean }>('/api/memory/teach', { answer: text, question: '' }).then((r) => ({ added: r.added })),
  fix: (before, after) => post<{ ok: boolean; added: boolean }>('/api/memory/teach', { answer: after, question: before }).then((r) => ({ added: r.added })),
  taste: () => api<TasteView>('/api/memory/taste'),
  remove: null,
}

export type BeliefVerdict = 'confirmed' | 'outdated' | 'rejected'
export interface BeliefPort {
  simulated: boolean
  questions(n: number): Promise<Belief[]>
  /** What JARVIS already states as fact: the beliefs you confirmed. */
  confirmed(limit: number): Promise<Belief[]>
  answer(id: string, verdict: BeliefVerdict, correction?: string): Promise<void>
  learned(n: number): Promise<LearnedQueue>
  review(id: string, verdict: LearnedVerdict): Promise<void>
}
export const LIVE_BELIEFS: BeliefPort = {
  simulated: false,
  questions: (n) => api<Belief[]>(`/api/memory/questions?n=${n}`),
  confirmed: (limit) => api<Belief[]>(`/api/memory/beliefs?status=confirmed&limit=${limit}`),
  answer: async (id, verdict, correction) => { await post(`/api/memory/beliefs/${id}`, { verdict, correction: correction ?? null }) },
  learned: (n) => api<LearnedQueue>(`/api/memory/learned?n=${n}`),
  review: async (id, verdict) => { await post(`/api/memory/learned/${encodeURIComponent(id)}`, { verdict }) },
}

export interface PeoplePort {
  simulated: boolean
  people(limit: number): Promise<Person[]>
}
export const LIVE_PEOPLE: PeoplePort = { simulated: false, people: (limit) => api<Person[]>(`/api/memory/people?limit=${limit}`) }

export interface RemindersPort {
  simulated: boolean
  view(): Promise<RemindersView>
  add(phrase: string): Promise<{ say: string }>
  cancel(id: string): Promise<void>
}
export const LIVE_REMINDERS: RemindersPort = {
  simulated: false,
  view: () => api<RemindersView>('/api/reminders'),
  add: (phrase) => post<{ say: string }>('/api/reminders', { phrase, origin: 'app' }),
  cancel: async (id) => { await api(`/api/reminders/${id}`, { method: 'DELETE' }) },
}

export interface SourcesPort {
  simulated: boolean
  list(): Promise<ExportSource[]>
  request(id: ExportSource['id']): Promise<void>
  importPath(id: ExportSource['id'], path: string): Promise<void>
  upload(id: ExportSource['id'], file: File): Promise<void>
  open(id: ExportSource['id']): Promise<void>
}
export const LIVE_SOURCES: SourcesPort = {
  simulated: false,
  list: loadExports,
  request: async (id) => { await requestExport(id) },
  importPath: async (id, path) => { await importPath(id, path) },
  upload: async (id, file) => { await uploadExport(id, file, file.name) },
  open: async (id) => { await openImports(id) },
}

export { ago, exportState, fmtBytes, readLine }
export type { ExportSource }
