/**
 * The media player, the UI's side of app/jarvis_app/media.py.
 *
 *   pure helpers     what the Media card says and in which colour (unit-tested,
 *                    src/__tests__/media.test.ts)
 *   startMediaHost   the window's own <audio>, started once by App: songs from his music
 *                    folder play HERE, and the window answers the server whether play()
 *                    really started. That answer is what lets JARVIS say "Now playing".
 *
 *   JARVIS ──POST /api/media/play──▶ server ──bus "media/local_play"──▶ host: fetch, play()
 *     ▲                                                                   │
 *     └──── "Now playing …" or "the window blocked autoplay" ◀── POST /api/media/ack
 */
import { post, TOKEN, type BusEvent } from './api'
import { useStore } from './store'

export type Source = 'auto' | 'local' | 'youtube' | 'ytmusic' | 'spotify'

export const SOURCES: { id: Source; label: string; hint: string }[] = [
  { id: 'auto', label: 'Auto', hint: 'Your music folder first, then YouTube’s top result' },
  { id: 'local', label: 'Folder', hint: 'Only your music folder, played in this window' },
  { id: 'youtube', label: 'YouTube', hint: 'YouTube’s top result, in your browser; starts on its own' },
  { id: 'ytmusic', label: 'YT Music', hint: 'A YouTube Music search in your browser: one click to start' },
  { id: 'spotify', label: 'Spotify', hint: 'A Spotify search: one click on the top result to start' },
]

export interface Track { id: string; title: string; artist: string; album: string; ext: string }

export interface MediaReceipt {
  ok: boolean
  say: string
  confirmed: boolean
  action: string
  source?: string | null
  needs_click?: boolean
  query?: string | null
  at: number
}

export interface NowPlaying { app: string; kind: string; title: string; artist: string; album: string; status: string }

export interface MediaState {
  now: NowPlaying | null
  say: string
  readable: boolean
  sessions: NowPlaying[]
  local: { state: string; track: Track | null; at: number | null }
  last: Pick<MediaReceipt, 'ok' | 'say' | 'source' | 'confirmed' | 'query' | 'at'> | null
  settings: { default_source: Source }
  library: { folder: string | null; tracks: number; scanning: boolean; scanned_at: number | null; truncated: boolean }
  sources: Source[]
}

export type Tone = 'live' | 'sim' | 'fault' | 'info'

/** Provenance, as everywhere (styles/tokens.css): cyan = confirmed by the window or by
 *  Windows, amber = done but not confirmed (a search opened, a key pressed), red = failed. */
export function receiptTone(r: Pick<MediaReceipt, 'ok' | 'confirmed'> | null | undefined): Tone {
  if (!r) return 'info'
  if (!r.ok) return 'fault'
  return r.confirmed ? 'live' : 'sim'
}

/** The card's top lines: the title, then who plays it and how. */
export function nowLines(st: MediaState | null): { title: string; sub: string; status: string; tone: Tone } {
  if (!st) return { title: 'Media', sub: 'loading…', status: '', tone: 'info' }
  const n = st.now
  if (n) {
    const playing = n.status === 'Playing'
    return {
      title: n.title || 'Untitled',
      sub: [n.artist, n.app].filter(Boolean).join(' · '),
      status: playing ? 'playing' : n.status.toLowerCase(),
      tone: playing ? 'live' : 'info',
    }
  }
  if (!st.readable) return { title: 'Nothing I can see', sub: 'Windows’ media sessions are not readable', status: 'unknown', tone: 'info' }
  return { title: 'Nothing playing', sub: 'Say “play” and a song, or type one below', status: 'idle', tone: 'info' }
}

/** Jobs for the window's player on the bus, newest last, not yet seen, not stale. */
export interface Job { id: string; kind: 'local_play' | 'local_control'; track?: Track; action?: string }

export function windowJobs(events: BusEvent[], seen: Set<string>, since: number): Job[] {
  const out: Job[] = []
  for (const ev of events) {
    if (ev.source !== 'media' || (ev.kind !== 'local_play' && ev.kind !== 'local_control') || ev.ts < since) continue
    const id = String(ev.request_id ?? '')
    if (!id || seen.has(id)) continue
    out.push({ id, kind: ev.kind, track: ev.track as Track | undefined, action: ev.action as string | undefined })
  }
  return out
}

/** The id of the newest media event (a change means: read the state again). */
export const lastMediaEvent = (events: BusEvent[]) =>
  events.reduce((m, e) => (e.source === 'media' && e.id > m ? e.id : m), 0)

/** "NotAllowedError: play() failed because the user didn't interact…" -> the part a
 *  person reads; the server keys on the name (NotAllowed = autoplay blocked). */
export function playError(e: unknown): string {
  const err = e as { name?: string; message?: string }
  return `${err?.name ?? 'Error'}: ${String(err?.message ?? e).slice(0, 140)}`
}

/* ------------------------------------------------------------------ the window's player */
let started = false
let audio: HTMLAudioElement | null = null
let current: Track | null = null
let blobUrl: string | null = null

async function load(track: Track): Promise<void> {
  const res = await fetch(`/api/media/file/${encodeURIComponent(track.id)}`, { headers: { 'X-Jarvis-Token': TOKEN } })
  if (!res.ok) throw new Error(`the server would not give the file (${res.status})`)
  // A blob, not a URL with the token in it: <audio> cannot send the token header, and the
  // token must never sit in a URL. A song is a few MB, read from this laptop's disk.
  const url = URL.createObjectURL(await res.blob())
  if (blobUrl) URL.revokeObjectURL(blobUrl)
  blobUrl = url
  audio!.src = url
  current = track
}

async function run(job: Job): Promise<{ ok: boolean; error?: string }> {
  try {
    if (job.kind === 'local_play' && job.track) {
      await load(job.track)
      await audio!.play()
    } else if (job.action === 'pause') {
      audio!.pause()
    } else if (job.action === 'play') {
      if (!current) throw new Error('nothing is loaded in the window')
      await audio!.play()
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: playError(e) }
  }
}

/** Start the window's player once; it lives as long as the window, whatever tab is open. */
export function startMediaHost(): () => void {
  if (started || typeof Audio === 'undefined') return () => {}
  started = true
  audio = new Audio()
  audio.preload = 'auto'
  const report = (state: string) =>
    void post('/api/media/local', { state, track_id: current?.id ?? null }).catch(() => {})
  audio.addEventListener('playing', () => report('playing'))
  audio.addEventListener('pause', () => { if (!audio!.ended) report('paused') })
  audio.addEventListener('ended', () => {
    // The next song of the folder (album order), from the server, so it is a receipt too.
    report('paused')
    void post('/api/media/control', { action: 'next', target: 'local' }).catch(() => {})
  })
  audio.addEventListener('error', () => report('error'))

  const seen = new Set<string>()
  const since = Date.now() / 1000 - 5
  const unsub = useStore.subscribe((s, prev) => {
    if (s.events === prev.events) return
    for (const job of windowJobs(s.events, seen, since)) {
      seen.add(job.id)
      void run(job).then((r) => post('/api/media/ack', { id: job.id, ...r }).catch(() => {}))
    }
  })
  return () => {
    unsub()
    audio?.pause()
    started = false
  }
}
