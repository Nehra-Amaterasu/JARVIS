/** Connect and System's helpers (lib/settings.ts): the voice test takes JARVIS's own
 * voice when he listens and the window's otherwise; uploads stream the file with the
 * token; export lines never claim memory; the hearing line says plainly when nobody
 * is listening for "Hey Jarvis". */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ago, costLine, exportState, fmtBytes, fmtS, groupOf, hearingLine, pronunciationProblem, readLine, testVoice,
  timeLeft, uploadExport, voiceLabel, voicesIn, type ExportSource, type Voice, type VoiceView,
} from '../lib/settings'

afterEach(() => vi.unstubAllGlobals())

const voice = (id: string, extra: Partial<Voice> = {}): Voice => ({
  id, engine: id.startsWith('kokoro') ? 'kokoro' : 'edge', name: id.split(/[:-]/).slice(-1)[0], accent: 'British',
  gender: 'Male', online: !id.startsWith('kokoro'), ...extra,
})
const VIEW: VoiceView = {
  chosen: 'edge:en-GB-RyanNeural', speed: 1, speed_range: [0.7, 1.4], default: 'edge:en-GB-RyanNeural',
  edge: [voice('edge:en-GB-RyanNeural', { name: 'Ryan' }), voice('edge:en-US-GuyNeural', { name: 'Guy', accent: 'American' })],
  edge_source: 'live', kokoro: [voice('kokoro:bm_lewis', { name: 'Lewis' })], kokoro_missing: null,
}

describe('voices', () => {
  it('groups by accent, with Kokoro as Offline', () => {
    expect(groupOf(VIEW.kokoro[0])).toBe('Offline')
    expect(voicesIn(VIEW, 'American').map((v) => v.name)).toEqual(['Guy'])
    expect(voicesIn(VIEW, 'Offline').map((v) => v.name)).toEqual(['Lewis'])
    expect(voicesIn(null, 'British')).toEqual([])
  })
  it('labels the chosen voice, or its raw name when the list is not loaded', () => {
    expect(voiceLabel(VIEW, 'kokoro:bm_lewis')).toBe('Lewis · British · offline')
    expect(voiceLabel(null, 'edge:en-GB-SoniaNeural')).toBe('en-GB-SoniaNeural')
  })
})

describe('test voice', () => {
  it('lets JARVIS say it when he is listening, and plays nothing here', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ via: 'jarvis', text: 'hi' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const play = vi.fn(async () => {})
    expect(await testVoice('hi', play)).toBe('jarvis')
    expect(play).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('plays the server-made audio here when he is not', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      return url.includes('/preview')
        ? new Response(new Blob(['ID3']), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } })
        : new Response(JSON.stringify({ via: 'window', text: 'Aankhen is awake' }), { status: 200 })
    }))
    const play = vi.fn(async () => {})
    expect(await testVoice(undefined, play)).toBe('window')
    expect(calls[1]).toBe('/api/settings/voice/preview?text=Aankhen%20is%20awake')
    expect(play).toHaveBeenCalledOnce()
  })
  it('says why when no voice can speak', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/preview')
      ? new Response(JSON.stringify({ detail: 'the offline voice is not installed' }), { status: 503 })
      : new Response(JSON.stringify({ via: 'window', text: 'x' }), { status: 200 })))
    await expect(testVoice('x', async () => {})).rejects.toThrow('the offline voice is not installed')
  })
})

describe('pronunciation form', () => {
  it('keeps the same limits as the server', () => {
    expect(pronunciationProblem('Aankhen', 'Aan-khen')).toBeNull()
    expect(pronunciationProblem('Aankhen', ' ')).toMatch(/Both/)
    expect(pronunciationProblem('[us]', 'x')).toMatch(/brackets/)
    expect(pronunciationProblem('x'.repeat(41), 'y')).toMatch(/short/)
  })
})

describe('modules', () => {
  it('counts down and stops at zero', () => {
    expect(timeLeft(1000 + 30, 1000)).toBe('30 s left')
    expect(timeLeft(1000 + 14 * 60 + 1, 1000)).toBe('15 min left')
    expect(timeLeft(1000 + 2 * 3600, 1000)).toBe('2 h 0 min left')
    expect(timeLeft(999, 1000)).toBeNull()
    expect(timeLeft(null, 1000)).toBeNull()
  })
  it('says the cost in VRAM and RAM', () => {
    expect(costLine({ vram_gb: 0, ram_gb: 0.3, note: '' })).toBe('no VRAM · 0.3 GB RAM')
    expect(costLine({ vram_gb: 5.7, ram_gb: null, note: '' })).toBe('5.7 GB VRAM')
  })
})

describe('System', () => {
  it('says plainly when nothing is listening for the wake word', () => {
    expect(hearingLine(null).tone).toBe('fault')
    expect(hearingLine({ running: true, mode: 'text', state: 'idle', brain: null, chosen_brain: '', last_error: null }).text)
      .toMatch(/cannot hear you/)
    expect(hearingLine({ running: true, mode: 'voice', state: 'sleeping', brain: null, chosen_brain: '', last_error: null }))
      .toEqual({ text: 'Listening for “Hey Jarvis”.', tone: 'live' })
  })
  it('formats seconds with a dash for nothing', () => {
    expect(fmtS(4.123)).toBe('4.1 s')
    expect(fmtS(null)).toBe('—')
    expect(fmtS(Number.NaN)).toBe('—')
  })
})

describe('data exports', () => {
  const src = (extra: Partial<ExportSource> = {}): ExportSource => ({
    id: 'chatgpt', name: 'ChatGPT', url: '', ask: '', wait: '', memory: '', files: [], downloads: [], job: null,
    state: 'not_requested', ...extra,
  })
  it('streams the file with the token and its name', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ name: 'a.zip', size: 3 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const blob = new Blob(['PK!'])
    expect(await uploadExport('chatgpt', blob, 'my export.zip')).toEqual({ name: 'a.zip', size: 3 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/imports/chatgpt/upload?name=my%20export.zip')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(blob)
    expect((init?.headers as Record<string, string>)['X-Jarvis-Token']).toBeDefined()
  })
  it('turns a refusal into its reason', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'This is a Spotify export' }), { status: 400 })))
    await expect(uploadExport('chatgpt', new Blob(['x']), 'x.zip')).rejects.toThrow('This is a Spotify export')
  })
  it('says what was read, never that it is in memory', () => {
    expect(readLine('chatgpt', { ok: true, items: 3104, conversations: 412, first: '2023-02-01', last: '2026-10-01' }))
      .toBe('3,104 of your messages in 412 conversations, 2023-02 → 2026-10')
    expect(readLine('spotify', { ok: true, items: 12, hours: 0.7, top_artists: [{ artist: 'A', plays: 9 }, { artist: 'B', plays: 3 }] }))
      .toBe('12 plays · 0.7 h · most: A, B')
    expect(readLine('instagram', { ok: true, threads: 88 })).toBe('88 message threads')
    expect(readLine('ytmusic', { ok: false, error: 'not JSON' })).toBe('Could not read it: not JSON')
    expect(readLine('chatgpt', null)).toBe('Reading it…')
    for (const s of ['chatgpt', 'spotify', 'instagram', 'ytmusic'] as const) {
      expect(readLine(s, { ok: true, items: 1, threads: 1 })).not.toMatch(/memory|remember/i)
    }
  })
  it('names each state', () => {
    expect(exportState(src())).toEqual({ label: 'not requested', tone: 'planned' })
    expect(exportState(src({ state: 'arrived' })).label).toBe('in Downloads')
    expect(exportState(src({ state: 'imported' })).tone).toBe('live')
    expect(exportState(src({ job: { state: 'failed', file: 'x' } })).tone).toBe('fault')
  })
  it('formats sizes and ages', () => {
    expect(fmtBytes(1_613_481_893)).toBe('1.6 GB')
    expect(fmtBytes(2_400_000)).toBe('2.4 MB')
    expect(fmtBytes(10)).toBe('1 kB')
    expect(ago(null, 1000)).toBe('never')
    expect(ago(1000 - 43 * 86400, 1000)).toBe('43 days ago')
  })
})
