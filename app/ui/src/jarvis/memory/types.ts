// The wire shapes of the Memory section (A.J04), copied from what pages/Yaadash.tsx read from app/jarvis_app/server.py
// (/api/memory/*) and routes_galaxy.py (/api/galaxy). The graph payload and its node detail are lib/galaxy.ts's own
// types: the 3D scene is retired, the data route stays and is read here as data.
export type { GalaxyNode, GalaxyPayload, NodeDetail, NodeKind } from '../../lib/galaxy'

export interface Stats {
  archive_messages: number | null
  threads: number | null
  people: number | null
  people_scored: number | null
  memories: number | null
  memory_sources: Record<string, number> | null
  beliefs: Record<string, number> | null
  taste_topics: number | null
  taste_captions: number | null
}

export interface Excerpt { date: string | null; who: string | null; messages: { speaker: string; text: string; me: boolean }[] }
export interface Fact { text: string; source: string; distance: number | null }
export interface SearchRes { query: string; excerpts: Excerpt[]; facts: Fact[]; took_ms: number; excerpts_error?: string }

export interface Belief { id: string; claim: string; category: string; era: string; confidence: number; support: number; source: string }
export interface Person {
  name: string; closeness: number; rank: number; span_days: number; n_msgs: number; reciprocity: number; calls: number
  share_ratio: number; why: string; last_iso?: string | null; first_iso?: string | null; recency_days?: number | null
}
export interface Topic { label: string; words: string[]; share: number; trend: string; by_year: Record<string, number> }
export interface TasteView { topics: Topic[]; n_captions?: number | null; recent_from?: number }

/** Where one row came from, in the three chips of spec 20.16.3: a rule, the local model, or the owner's own hand. */
export type Origin = 'RULE' | 'MODEL' | 'HAND'

/** A loadable thing: never a number without a state. */
export type Loadable<T> =
  | { state: 'loading'; data: null; error: null }
  | { state: 'ready'; data: T; error: null }
  | { state: 'fault'; data: null; error: string }
