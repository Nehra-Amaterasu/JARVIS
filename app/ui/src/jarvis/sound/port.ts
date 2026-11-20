// The routes Sound talks to, as one port, so the view is driven by props and a fixture can stand in for the server
// (the gallery, the jury page and the tests). LIVE_SOUND is the app's own routes with the classic cards' request bodies,
// unchanged (components/MediaCard.tsx, LibraryPanel.tsx, ConnectControls.tsx PronunciationCard):
//   /api/media/state, /control, /play, /settings        media
//   /api/library, /ingest, /ask, /doc/{id}              the study library
//   /api/settings/pronunciations, /voice/test           the spoken-words table and its Hear key
import { api, post } from '../../lib/api'
import type { LibraryAnswer, LibraryView } from '../../lib/library'
import type { MediaReceipt, MediaState, Source } from '../../lib/media'
import { loadPronunciations, removePronunciation, setPronunciation, testVoice } from '../../lib/settings'

export type WordTable = { table: Record<string, string> }

export interface SoundPort {
  media(): Promise<MediaState>
  control(action: string, value?: string): Promise<MediaReceipt>
  play(query: string, source: Source): Promise<MediaReceipt>
  setSource(source: Source): Promise<void>
  setFolder(path: string): Promise<void>
  library(): Promise<LibraryView>
  ingest(path: string): Promise<void>
  ask(question: string): Promise<LibraryAnswer>
  forget(docId: string): Promise<void>
  words(): Promise<WordTable>
  setWord(word: string, say: string): Promise<WordTable>
  removeWord(word: string): Promise<WordTable>
  hear(text: string): Promise<'jarvis' | 'window'>
}

export const LIVE_SOUND: SoundPort = {
  media: () => api<MediaState>('/api/media/state'),
  control: (action, value) => post<MediaReceipt>('/api/media/control', value === undefined ? { action } : { action, value }),
  play: (query, source) => post<MediaReceipt>('/api/media/play', { query, source }),
  setSource: async (source) => { await api('/api/media/settings', { method: 'PUT', body: { default_source: source } }) },
  setFolder: async (path) => { await api('/api/media/settings', { method: 'PUT', body: { folder: path } }) },
  library: () => api<LibraryView>('/api/library'),
  ingest: async (path) => { await post('/api/library/ingest', { path }) },
  ask: (question) => post<LibraryAnswer>('/api/library/ask', { question }),
  forget: async (docId) => { await api(`/api/library/doc/${docId}`, { method: 'DELETE' }) },
  words: loadPronunciations,
  setWord: setPronunciation,
  removeWord: removePronunciation,
  hear: (text) => testVoice(text),
}
