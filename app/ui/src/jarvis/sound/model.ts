// Core, Sound (A.S01, spec 20.9.1 `core.sound`): the pure decisions of the view, so they are tested without rendering.
//
// What the view may say is fixed here, once:
//   - the lamp of the plate is the answer of the media route and of Windows, never the view's own opinion;
//   - "playing" is drawn only when Windows (or the window's own player) reported Playing; the receipt of the last action is
//     the server's own sentence, word for word, in its provenance (confirmed = LIVE, opened but not confirmed = WAITING,
//     failed = FAULT);
//   - no level and no progress exists on this view: the app reports neither for the media player (the output level port is
//     not built, S0 section 4), so the ring is a STATE ring (hollow, lit or dimmed), never a meter. Its inner arc is the volume
//     TRACK: drawn empty and dashed, with a WAITING lamp, until a volume read-back exists; the keys only send up and down.
import { nowLines, receiptTone, SOURCES, type MediaReceipt, type MediaState, type Source } from '../../lib/media'
import type { LampReading, LampState } from '../../shared/lamp'

export { SOURCES }
export type { MediaReceipt, MediaState, Source }

/** What a poll of one route last did: answered, or did not and why (the classic usePoll hides the failure). */
export interface RouteStatus {
  ok: boolean
  /** The words of the failure ("401", "Failed to fetch"), null while it answers or before the first answer. */
  reason: string | null
  /** Epoch ms of the last answer. */
  at: number | null
}

export const ROUTE_IDLE: RouteStatus = { ok: false, reason: null, at: null }

export type RingState = 'playing' | 'paused' | 'rest' | 'waiting'

export interface NowView {
  title: string
  sub: string
  /** The one-word status beside the title: PLAYING, PAUSED, IDLE, NO REPORT. */
  word: string
  ring: RingState
  playing: boolean
  reading: LampReading
}

/** LIVE becomes SIMULATED for a fixture; nothing else changes (the same rule as the Core view). */
export const simState = (s: LampState, sim: boolean): LampState => (sim && s === 'live' ? 'simulated' : s)

/** The plate's face from the media state and the route's own status. */
export function nowView(st: MediaState | null, route: RouteStatus, simulated = false, now = Date.now()): NowView {
  if (!st) {
    const reason = route.reason ? `the media route did not answer: ${route.reason}` : 'reading the media state'
    return {
      title: 'No report',
      sub: reason,
      word: 'NO REPORT',
      ring: 'waiting',
      playing: false,
      reading: { state: 'waiting', since: null, reason },
    }
  }
  const lines = nowLines(st)
  const since = route.at ?? now
  if (st.now) {
    const playing = st.now.status === 'Playing'
    return {
      title: lines.title,
      sub: lines.sub,
      word: playing ? 'PLAYING' : st.now.status.toUpperCase(),
      ring: playing ? 'playing' : 'paused',
      playing,
      reading: { state: simState('live', simulated), since, reason: playing ? 'Windows reports it playing' : `Windows reports it ${st.now.status.toLowerCase()}` },
    }
  }
  if (!st.readable) {
    return {
      title: lines.title,
      sub: lines.sub,
      word: 'NO REPORT',
      ring: 'waiting',
      playing: false,
      reading: { state: 'waiting', since: null, reason: 'Windows media sessions are not readable' },
    }
  }
  return {
    title: lines.title,
    sub: lines.sub,
    word: 'IDLE',
    ring: 'rest',
    playing: false,
    reading: { state: simState('live', simulated), since, reason: 'Windows reports no media session' },
  }
}

export interface ReceiptView {
  text: string
  state: LampState
  /** Why the lamp says what it says, in plain words (the lamp's own reason line). */
  why: string
}

/** The receipt of the last action: the server's sentence untouched, its provenance as a lamp. Null when there is none. */
export function receiptView(r: Pick<MediaReceipt, 'ok' | 'confirmed' | 'say'> | null | undefined, simulated = false): ReceiptView | null {
  if (!r) return null
  const tone = receiptTone(r)
  if (tone === 'fault') return { text: r.say, state: 'fault', why: 'the action failed' }
  if (tone === 'live') return { text: r.say, state: simState('live', simulated), why: 'Windows or this window confirmed it' }
  return { text: r.say, state: 'waiting', why: 'done, not confirmed' }
}

/** The line under an empty plate when there is no receipt yet: what the music folder holds, or what to say. */
export function restLine(st: MediaState | null): string {
  const lib = st?.library
  if (lib?.scanning) return 'Reading your music folder…'
  if (lib?.folder) return `${lib.tracks} song${lib.tracks === 1 ? '' : 's'} in your folder. Say “play” and a song, or type one.`
  return 'Say “play” and a song, or type one below.'
}

/** The sigil ring of the plate: the marks round it and how they are drawn. A state, never a measure. */
export const RING = { TICKS: 72, R_IN: 108, R_OUT: 120, R_BEZEL: 134, HALF: 140, R_GAUGE: 92 } as const

export function ringWord(r: RingState): string {
  if (r === 'playing') return 'PLAYING'
  if (r === 'paused') return 'PAUSED'
  if (r === 'rest') return 'NOTHING PLAYING'
  return 'NO REPORT'
}

/** How many marks of the ring are lit: all while playing, a quarter ring while paused, none at rest or while waiting. */
export function litMarks(r: RingState): number {
  if (r === 'playing') return RING.TICKS
  if (r === 'paused') return RING.TICKS / 4
  return 0
}

/** The words of the pronunciation table, in the order a person looks them up (case-blind, then as typed). */
export function wordRows(table: Record<string, string> | null | undefined): { word: string; say: string }[] {
  return Object.entries(table ?? {})
    .map(([word, say]) => ({ word, say }))
    .sort((a, b) => a.word.toLowerCase().localeCompare(b.word.toLowerCase()) || a.word.localeCompare(b.word))
}

/** Which source the Spotify caveat applies to. */
export const isSpotify = (s: Source) => s === 'spotify'
