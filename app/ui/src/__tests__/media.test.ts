import { describe, expect, it } from 'vitest'
import type { BusEvent } from '../lib/api'
import { lastMediaEvent, nowLines, playError, receiptTone, SOURCES, windowJobs, type MediaState } from '../lib/media'

const NOW = 1_760_000_000

const state = (over: Partial<MediaState> = {}): MediaState => ({
  now: null, say: 'Nothing is playing.', readable: true, sessions: [],
  local: { state: 'idle', track: null, at: null }, last: null,
  settings: { default_source: 'auto' },
  library: { folder: null, tracks: 0, scanning: false, scanned_at: null, truncated: false },
  sources: ['auto', 'local', 'youtube', 'ytmusic', 'spotify'], ...over,
})

const ev = (id: number, kind: string, extra: Record<string, unknown> = {}): BusEvent =>
  ({ id, ts: NOW, source: 'media', kind, text: `event ${id}`, ...extra })

describe('the colour of a receipt is its provenance', () => {
  it('confirmed is cyan, opened-but-unconfirmed amber, failed red', () => {
    expect(receiptTone({ ok: true, confirmed: true })).toBe('live')
    expect(receiptTone({ ok: true, confirmed: false })).toBe('sim')          // "Spotify needs one click"
    expect(receiptTone({ ok: false, confirmed: false })).toBe('fault')
    expect(receiptTone(null)).toBe('info')
  })
})

describe('the card says only what the state says', () => {
  it('playing', () => {
    const l = nowLines(state({ now: { app: 'Spotify', kind: 'spotify', title: 'SICKO MODE', artist: 'Travis Scott', album: '', status: 'Playing' } }))
    expect(l).toEqual({ title: 'SICKO MODE', sub: 'Travis Scott · Spotify', status: 'playing', tone: 'live' })
  })
  it('paused is not playing', () => {
    const l = nowLines(state({ now: { app: 'Brave', kind: 'browser', title: 'Lofi Radio', artist: '', album: '', status: 'Paused' } }))
    expect(l.status).toBe('paused')
    expect(l.tone).toBe('info')
    expect(l.sub).toBe('Brave')
  })
  it('nothing, and unknown when Windows cannot be read', () => {
    expect(nowLines(state()).title).toBe('Nothing playing')
    expect(nowLines(state({ readable: false })).status).toBe('unknown')
    expect(nowLines(null).sub).toBe('loading…')
  })
})

describe('jobs for the window’s own player', () => {
  it('takes each new play or control once, ignores stale ones and other sources', () => {
    const seen = new Set<string>()
    const events = [
      ev(1, 'local_play', { request_id: 'a', track: { id: 't1', title: 'Kesariya', artist: 'Arijit Singh', album: '', ext: '.mp3' } }),
      ev(2, 'play', { ok: true }),                                           // a receipt, not a job
      ev(3, 'local_control', { request_id: 'b', action: 'pause' }),
      { ...ev(4, 'local_play', { request_id: 'old' }), ts: NOW - 60 },        // from before the window started
      { ...ev(5, 'local_play', { request_id: 'c' }), source: 'game' },
    ]
    const jobs = windowJobs(events, seen, NOW - 5)
    expect(jobs.map((j) => j.id)).toEqual(['a', 'b'])
    expect(jobs[0].track?.title).toBe('Kesariya')
    expect(jobs[1].action).toBe('pause')
    jobs.forEach((j) => seen.add(j.id))
    expect(windowJobs(events, seen, NOW - 5)).toEqual([])
  })
  it('the newest media event triggers a refresh', () => {
    expect(lastMediaEvent([ev(3, 'play'), { ...ev(9, 'x'), source: 'core' }, ev(7, 'scan')])).toBe(7)
  })
  it('an autoplay refusal keeps its name, which the server reads', () => {
    const e = Object.assign(new Error("play() failed because the user didn't interact with the document first."), { name: 'NotAllowedError' })
    expect(playError(e).startsWith('NotAllowedError: play() failed')).toBe(true)
  })
})

describe('sources', () => {
  it('every source the server takes has a chip, Spotify and YT Music say they need a click', () => {
    expect(SOURCES.map((s) => s.id)).toEqual(['auto', 'local', 'youtube', 'ytmusic', 'spotify'])
    expect(SOURCES.find((s) => s.id === 'spotify')?.hint).toMatch(/one click/)
    expect(SOURCES.find((s) => s.id === 'ytmusic')?.hint).toMatch(/one click/)
  })
})
