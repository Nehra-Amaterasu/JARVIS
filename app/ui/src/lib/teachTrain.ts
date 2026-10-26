/**
 * Teach, train and correct Aankhen from the app (routes_aankhen_train.py): the route
 * shapes, the API calls, and the pure wording rules the panel and the prediction bar
 * share (unit-tested in src/__tests__/teachTrain.test.ts).
 *
 * WORDING. The model's output is "Predicting: <place>" until the backend's status word
 * is "answering" (4-5 days of drills and a passed held-out day). Before that the page
 * never says "answering", "is at" or "you're at": a guess is shown as a guess.
 */
import { api, post } from './api'

export type StatusWord = 'predicting' | 'answering'
export interface JobView { name: string; state: 'idle' | 'running' | 'done' | 'error'; stage: string; fraction: number; error: string | null; started: number | null; finished: number | null }
export interface PlainReport {
  status: StatusWord
  model: string | null
  balanced: number | null
  baseline: number | null
  interval: [number, number] | null
  clears_baseline: boolean | null
  recall: { place: string; name: string; recall: number | null }[]
  seconds: { place: string; name: string; have: number; need: number; missing: number }[]
  per_place_s: number
  days: number | null
  sessions: number | null
  last_trained: number | string | null
  error: string | null
  lines: string[]
}
export interface TrainView {
  status: StatusWord
  model: { status: StatusWord; unavailable?: string; days?: number; sessions?: number; last_trained?: number | string | null }
  job: JobView
  report: PlainReport | null
  available: Record<string, boolean | string[]> & { missing: string[] }
}
export interface MiniSpan { zone: string; t0: number; t1: number }
export interface MiniView {
  recording: string | null; started: number | null; fan: boolean | null
  open: { zone: string; name: string; t0: number; seconds: number } | null
  spans: MiniSpan[]; dropped: (MiniSpan & { why: string })[]
  seconds: Record<string, number>
}
export interface NarrateSession { day: string; session: string; folder: string; labelled: boolean; has_raw: boolean }
export interface AudioFile { path: string; name: string; mb: number; modified: number }
export interface NarrateSummary {
  folder: string; audio: string; words: number; clock: string | null; stretches: number
  minutes: Record<string, number>; has_empty: boolean
  labels: { zone: string; seconds: number; activity?: string }[]
}
export interface ZoneLite { id: string; name: string; dwell_s?: number; in_room?: boolean }

export const getTrain = () => api<TrainView>('/api/aankhen/train2')
export const startTrain = (per_place_s = 30, adabn = false) => post<TrainView>('/api/aankhen/train2', { per_place_s, adabn })
export const getMini = () => api<MiniView>('/api/aankhen/minidrill')
export const startMini = (fan: boolean | null) => post<MiniView>('/api/aankhen/minidrill/start', { fan })
export const tapMini = (zone: string | null) => post<MiniView & { closed: MiniSpan | null }>('/api/aankhen/minidrill/tap', { zone })
export const stopMini = () => post<MiniView>('/api/aankhen/minidrill/stop')
export const correct = (zone: string, confirmed: boolean, seconds = CORRECT_SECONDS) =>
  post<{ ok: boolean; name: string; seconds: number; source: string }>('/api/aankhen/correct', { zone, confirmed, seconds })
export const getNarrate = () => api<{ sessions: NarrateSession[]; audio: AudioFile[]; job: JobView }>('/api/aankhen/narrate/sessions')
export const getNarrateJob = () => api<{ job: JobView; summary: NarrateSummary | null }>('/api/aankhen/narrate/label')
export const startNarrate = (audio: string, session = 'latest') =>
  post<{ job: JobView; summary: NarrateSummary | null }>('/api/aankhen/narrate/label', { audio, session })
export const setFan = (on: boolean) => post<{ ok: boolean; error?: string }>('/api/aankhen/drill/fan', { on })

/** How many seconds a ✓ or a correction labels: the last 10 s (the owner's default). */
export const CORRECT_SECONDS = 10
/** A zone he usually stays in for this long or less is a place he walks THROUGH
 *  (zones.py: transit dwell 3-4 s, places 15 s and up): it gets a smaller "on the way" button. */
export const TRANSIT_DWELL_S = 5

/** "Predicting: Sitting at the desk" until the backend says answering. */
export function predictionWording(status: StatusWord | null | undefined, place: string | null | undefined): string {
  const p = place && place.trim() ? place : '—'
  return status === 'answering' ? `You're at: ${p}` : `Predicting: ${p}`
}

/** Big place buttons and smaller transit ones, in the zone file's order. */
export function placeButtons(zones: ZoneLite[]): { places: ZoneLite[]; transit: ZoneLite[] } {
  const places: ZoneLite[] = [], transit: ZoneLite[] = []
  for (const z of zones) {
    if (typeof z.dwell_s === 'number' && z.dwell_s <= TRANSIT_DWELL_S) transit.push(z)
    else places.push(z)
  }
  return { places, transit }
}

/** "desk 12 s of 30 s" */
export const secondsOf = (name: string, have: number, need: number) => `${name} ${Math.round(have)} s of ${Math.round(need)} s`

export const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${Math.round(v * 100)} %`)

/**
 * What the page says about the fan. The engine's frame carries motion_detail.fan:
 * {relay, board, on, locked, f0_hz, ...}; an automatic detector (another agent's work)
 * may add `detected` (bool) with `confidence`, or `auto: {on, confidence}`. Whatever the
 * engine reports is shown, and where it came from: detected beats the relay's word.
 */
export function fanView(fan: unknown): { on: boolean | null; source: 'detected' | 'relay' | 'board' | 'unknown'; text: string } {
  const f = (fan && typeof fan === 'object' ? fan : {}) as Record<string, unknown>
  const conf = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? ` · ${Math.round(Math.max(0, Math.min(1, v)) * 100)} %` : '')
  const auto = f.auto && typeof f.auto === 'object' ? (f.auto as Record<string, unknown>) : null
  if (typeof f.detected === 'boolean') return { on: f.detected, source: 'detected', text: `Fan ${f.detected ? 'on' : 'off'} (detected${conf(f.confidence)})` }
  if (auto && typeof auto.on === 'boolean') return { on: auto.on, source: 'detected', text: `Fan ${auto.on ? 'on' : 'off'} (detected${conf(auto.confidence)})` }
  if (typeof f.board === 'boolean') return { on: f.board, source: 'board', text: `Fan ${f.board ? 'on' : 'off'} (switch board)` }
  if (typeof f.relay === 'boolean') return { on: f.relay, source: 'relay', text: `Fan ${f.relay ? 'on' : 'off'} (relay)` }
  if (typeof f.on === 'boolean') return { on: f.on, source: 'relay', text: `Fan ${f.on ? 'on' : 'off'}` }
  return { on: null, source: 'unknown', text: 'Fan: not known' }
}
