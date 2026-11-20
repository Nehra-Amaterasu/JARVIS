// Invented rows for Sound (the gallery, the jury page and the specs): every title, folder and word below is made up, and a
// fixture is always drawn SIMULATED (SoundView `simulated`). Nothing here is read from the machine it runs on.
import type { LibraryAnswer, LibraryView } from '../../lib/library'
import type { MediaReceipt, MediaState } from '../../lib/media'
import type { SoundPort } from './port'

export type SoundKind = 'playing' | 'paused' | 'rest' | 'unreadable' | 'folder'

const NOW_S = 1_700_000_000

const base = (): MediaState => ({
  now: null,
  say: '',
  readable: true,
  sessions: [],
  local: { state: 'idle', track: null, at: null },
  last: null,
  settings: { default_source: 'auto' },
  library: { folder: null, tracks: 0, scanning: false, scanned_at: null, truncated: false },
  sources: ['auto', 'local', 'youtube', 'ytmusic', 'spotify'],
})

export function fixtureMedia(kind: SoundKind = 'rest'): MediaState {
  const m = base()
  if (kind === 'playing' || kind === 'paused') {
    m.now = { app: 'Fixture Player', kind: 'audio', title: 'Slow Lanterns', artist: 'Fixture Artist', album: 'Invented Album', status: kind === 'playing' ? 'Playing' : 'Paused' }
    m.last = { ok: true, say: 'Now playing Slow Lanterns by Fixture Artist.', source: 'local', confirmed: true, query: 'slow lanterns', at: NOW_S }
    m.library = { folder: 'C:\\Fixture\\Music', tracks: 42, scanning: false, scanned_at: NOW_S, truncated: false }
  } else if (kind === 'unreadable') {
    m.readable = false
  } else if (kind === 'folder') {
    m.library = { folder: 'C:\\Fixture\\Music', tracks: 42, scanning: false, scanned_at: NOW_S, truncated: false }
  }
  return m
}

export const fixtureReceipt = (kind: 'confirmed' | 'opened' | 'failed'): MediaReceipt =>
  kind === 'confirmed'
    ? { ok: true, say: 'Now playing Slow Lanterns by Fixture Artist.', confirmed: true, action: 'play', at: NOW_S }
    : kind === 'opened'
      ? { ok: true, say: 'Opened a Spotify search for "slow lanterns". It needs one click to start.', confirmed: false, action: 'play', source: 'spotify', at: NOW_S }
      : { ok: false, say: 'No song called "zzz" in your folder, and YouTube did not answer.', confirmed: false, action: 'play', at: NOW_S }

export function fixtureLibrary(kind: 'notes' | 'empty' | 'running' = 'notes'): LibraryView {
  const docs: LibraryView['docs'] = kind === 'empty' ? [] : [
    { doc_id: 'd1', file: 'fixture-sequential-logic.pdf', path: 'C:\\Fixture\\Notes\\fixture-sequential-logic.pdf', kind: 'pdf', title: 'Sequential logic', pages: 12, chunks: 31, words: 5200, scanned: [], blank: [], ocr: [], notes: [], embedder: 'fixture', added: '2026-11-01', updated: '2026-11-01' },
    { doc_id: 'd2', file: 'fixture-lecture-slides.pptx', path: 'C:\\Fixture\\Notes\\fixture-lecture-slides.pptx', kind: 'pptx', title: 'Lecture slides', pages: 24, chunks: 40, words: 3100, scanned: [3, 4], blank: [], ocr: [], notes: ['2 slides are images'], embedder: 'fixture', added: '2026-11-02', updated: '2026-11-02' },
  ]
  return {
    root: 'C:\\Fixture\\Library',
    documents: docs.length,
    chunks: docs.reduce((a, d) => a + d.chunks, 0),
    pages: docs.reduce((a, d) => a + d.pages, 0),
    scanned_pages: docs.reduce((a, d) => a + d.scanned.length, 0),
    embedder: { name: 'fixture', ready: true, error: null },
    mode: 'hybrid',
    ocr: false,
    docs,
    job: kind === 'running' ? { state: 'running', path: 'C:\\Fixture\\Notes', done: 3, total: 8, current: 'fixture-notes-3.pdf' } : { state: 'idle' },
  }
}

export const fixtureAnswer = (): LibraryAnswer => ({
  question: 'Explain setup and hold time',
  answer: 'Setup time is how long data must be steady before the clock edge [1]. Hold time is how long it must stay after it [1].',
  abstained: false,
  reason: '',
  used: [1],
  invalid: [],
  uncited: false,
  sources: [{ n: 1, id: 's1', doc_id: 'd1', file: 'fixture-sequential-logic.pdf', kind: 'pdf', page: 3, loc: 'p. 3', heading: 'Timing', text: 'Setup time is the interval before the active clock edge during which the data input must be stable. Hold time is the interval after it.', path: 'C:\\Fixture\\Notes\\fixture-sequential-logic.pdf', title: 'Sequential logic', distance: 0.2, bm25_rank: 1, vector_rank: 1 }],
  mode: 'hybrid',
  llm: 'fixture-model',
  took_ms: 900,
  retrieval_ms: 40,
  best_distance: 0.2,
  coverage: 0.9,
})

export const fixtureWords = (): Record<string, string> => ({ raga: 'rah-gah', tabla: 'tub-lah', sitar: 'sih-tar', GPU: 'jee pee you' })

/** A port whose routes answer from the fixtures (the gallery). Presses are accepted and change nothing. */
export function fixturePort(kind: SoundKind = 'rest'): SoundPort {
  const words = fixtureWords()
  return {
    media: async () => fixtureMedia(kind),
    control: async (action) => ({ ok: true, say: `${action} sent.`, confirmed: false, action, at: NOW_S }),
    play: async () => fixtureReceipt('confirmed'),
    setSource: async () => undefined,
    setFolder: async () => undefined,
    library: async () => fixtureLibrary('notes'),
    ingest: async () => undefined,
    ask: async () => fixtureAnswer(),
    forget: async () => undefined,
    words: async () => ({ table: words }),
    setWord: async () => ({ table: words }),
    removeWord: async () => ({ table: words }),
    hear: async () => 'window',
  }
}
