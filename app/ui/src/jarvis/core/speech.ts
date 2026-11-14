// The spoken side of Core Talk (parity ledger O4b and O4d): which voice JARVIS uses, how fast, and the table of words he
// is taught to say differently. The classic page keeps both in ConnectControls; the new Core reaches them through two
// Trims (SpeechTrims.tsx). No new route: every call is a helper lib/settings.ts already exports (loadVoice, chooseVoice,
// testVoice, loadPronunciations, setPronunciation, removePronunciation).
//
// Why a store and not component state: a Trim's setting is registered once (speech.settings.ts) and read by the palette
// index and by the Trim's own "Set to" line through a plain `read()`, so the value it reads has to live outside React.
// Why a port: the gallery and the jury page run on fixtures with no server, so the calls are handed in; the fixture port
// keeps its words in memory and says SIMULATED, it never reaches the network.
//
// Honesty: a value is shown as "set" only after the server's own answer came back. While a call is out the note says
// WAITING; a failed call keeps the old value and says FAULT with the server's own words. Nothing is saved on a guess.
import { useSyncExternalStore } from 'react'
import {
  chooseVoice, loadPronunciations, loadVoice, pronunciationProblem, removePronunciation, setPronunciation, testVoice, voiceLabel,
  type VoiceView,
} from '../../lib/settings'
import type { LampState } from '../../shared/lamp'

export interface SpeechPort {
  loadVoice(): Promise<VoiceView>
  chooseVoice(body: { id?: string; speed?: number }): Promise<VoiceView>
  testVoice(text?: string): Promise<'jarvis' | 'window'>
  loadPronunciations(): Promise<{ table: Record<string, string> }>
  setPronunciation(word: string, say: string): Promise<{ table: Record<string, string> }>
  removePronunciation(word: string): Promise<{ table: Record<string, string> }>
}

/** The real routes, through the helpers the classic page uses. */
export const LIVE_SPEECH: SpeechPort = { loadVoice, chooseVoice, testVoice, loadPronunciations, setPronunciation, removePronunciation }

/** What a control says about its last call. `idle` prints nothing. */
export interface Note {
  state: LampState | 'idle'
  text: string
}
const IDLE: Note = { state: 'idle', text: '' }

export interface SpeechState {
  voice: VoiceView | null
  words: Record<string, string> | null
  voiceNote: Note
  wordsNote: Note
  /** The voice and the words are a fixture: every note is SIMULATED, nothing is sent. */
  simulated: boolean
}

/** The slowest and fastest speech the server accepts, with the classic page's own fallback when the voice list has not loaded. */
export const SPEED_FALLBACK: [number, number] = [0.7, 1.4]
export const SPEED_DEFAULT = 1

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export interface SpeechStore {
  get(): SpeechState
  subscribe(fn: () => void): () => void
  /** Hand in the port; reloads when the port or the fixture flag changed. */
  bind(port: SpeechPort, simulated: boolean): void
  loadVoice(): Promise<void>
  loadWords(): Promise<void>
  pick(id: string): Promise<void>
  speed(v: number): Promise<void>
  resetVoice(): Promise<void>
  test(text?: string, subject?: string): Promise<void>
  add(word: string, say: string): Promise<boolean>
  drop(word: string): Promise<void>
}

export function createSpeechStore(): SpeechStore {
  let port: SpeechPort | null = null
  let state: SpeechState = { voice: null, words: null, voiceNote: IDLE, wordsNote: IDLE, simulated: false }
  const subs = new Set<() => void>()
  const set = (p: Partial<SpeechState>) => {
    state = { ...state, ...p }
    subs.forEach((f) => f())
  }
  // a call's lamp: SIMULATED for a fixture (never LIVE), LIVE only for a real answer
  const done = (text: string): Note => ({ state: state.simulated ? 'simulated' : 'live', text })
  const wait = (text: string): Note => ({ state: 'waiting', text })
  const fault = (e: unknown): Note => ({ state: 'fault', text: errText(e) })

  const needPort = () => {
    if (!port) throw new Error('not connected to JARVIS yet')
    return port
  }
  const voiceCall = async (waiting: string, ok: (v: VoiceView) => string, call: (p: SpeechPort) => Promise<VoiceView>) => {
    set({ voiceNote: wait(waiting) })
    try {
      const v = await call(needPort())
      set({ voice: v, voiceNote: done(ok(v)) })
    } catch (e) {
      set({ voiceNote: fault(e) })
    }
  }
  const self: SpeechStore = {
    get: () => state,
    subscribe: (fn) => {
      subs.add(fn)
      return () => void subs.delete(fn)
    },
    bind(p, simulated) {
      if (port === p && state.simulated === simulated) return
      port = p
      state = { voice: null, words: null, voiceNote: IDLE, wordsNote: IDLE, simulated }
      subs.forEach((f) => f())
    },
    async loadVoice() {
      try {
        set({ voice: await needPort().loadVoice() })
      } catch (e) {
        set({ voiceNote: fault(e) })
      }
    },
    async loadWords() {
      try {
        set({ words: (await needPort().loadPronunciations()).table })
      } catch (e) {
        set({ wordsNote: fault(e) })
      }
    },
    pick: (id) => voiceCall('saving the voice', (v) => `voice saved: ${voiceLabel(v, v.chosen)}. He uses it from his next sentence.`, (p) => p.chooseVoice({ id })),
    speed: (n) => voiceCall('saving the speed', (v) => `speed saved: ${v.speed.toFixed(2)}×`, (p) => p.chooseVoice({ speed: n })),
    resetVoice: async () => {
      const v = state.voice
      if (!v) return
      await voiceCall('putting the voice back', (x) => `back to the default: ${voiceLabel(x, x.chosen)}, ${x.speed.toFixed(2)}×`, (p) => p.chooseVoice({ id: v.default, speed: SPEED_DEFAULT }))
    },
    async test(text, subject = 'the voice') {
      set({ voiceNote: wait(`asking JARVIS to say ${subject}`) })
      try {
        const via = await needPort().testVoice(text)
        set({ voiceNote: done(via === 'jarvis' ? 'JARVIS is saying it now.' : 'played here: JARVIS is not listening, so this window made the sound.') })
      } catch (e) {
        set({ voiceNote: fault(e) })
      }
    },
    async add(word, say) {
      const problem = pronunciationProblem(word, say)
      if (problem) {
        set({ wordsNote: { state: 'fault', text: problem } })
        return false
      }
      set({ wordsNote: wait(`saving ${word.trim()}`) })
      try {
        const r = await needPort().setPronunciation(word.trim(), say.trim())
        set({ words: r.table, wordsNote: done(`saved: he now says "${word.trim()}" as "${say.trim()}".`) })
        return true
      } catch (e) {
        set({ wordsNote: fault(e) })
        return false
      }
    },
    async drop(word) {
      set({ wordsNote: wait(`removing ${word}`) })
      try {
        const r = await needPort().removePronunciation(word)
        set({ words: r.table, wordsNote: done(`removed ${word}.`) })
      } catch (e) {
        set({ wordsNote: fault(e) })
      }
    },
  }
  return self
}

/** The one store the registered settings read (speech.settings.ts) and the Trims write. */
export const speechStore: SpeechStore = createSpeechStore()

export function useSpeech(store: SpeechStore = speechStore): SpeechState {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

/** The words a setting's "Set to" line prints. Empty until the server has answered: never a guessed value. */
export function voiceValueText(s: SpeechState): string {
  if (!s.voice) return 'not loaded yet'
  return `${voiceLabel(s.voice, s.voice.chosen)}, ${s.voice.speed.toFixed(2)}×${s.simulated ? ' (fixture)' : ''}`
}
export function wordsValueText(s: SpeechState): string {
  if (!s.words) return 'not loaded yet'
  const n = Object.keys(s.words).length
  return `${n} word${n === 1 ? '' : 's'} taught${s.simulated ? ' (fixture)' : ''}`
}
