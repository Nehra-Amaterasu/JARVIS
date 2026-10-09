/**
 * The React-Native seams of Mission Germoney, re-implemented for JARVIS.
 *
 * Germoney's stores and engine were written against three platform APIs. Instead
 * of rewriting the game logic (and risking a subtly different XP rule), the same
 * modules run here unchanged except for their imports, which point at:
 *
 *   AsyncStorage  -> the JARVIS server's key-value store (app/data/germoney/,
 *                    atomic writes, daily backups). Same keys as the phone app
 *                    ("@silicon_player_v2", …), so a phone export can be imported.
 *   Alert         -> a JARVIS toast, or a dialog when it asks a question.
 *   GithubConfig  -> the GitHub username saved in Mission → Proof.
 */
import { api } from '../lib/api'
import { useStore } from '../lib/store'
import { create } from 'zustand'

/* ------------------------------------------------------------------ AsyncStorage */
const cache = new Map<string, string | null>()
const chains = new Map<string, Promise<unknown>>()

/** Writes to one key run strictly in order: two quick toggles can never arrive at
 *  the server out of order and leave the OLDER state saved. */
function queue<T>(key: string, job: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(job)
  chains.set(key, next)
  return next
}

const kvPath = (key: string) => `/api/kv/${encodeURIComponent(key)}`

export const AsyncStorage = {
  async getItem(key: string): Promise<string | null> {
    if (cache.has(key)) return cache.get(key) ?? null
    await chains.get(key)
    const r = await api<{ value: string | null }>(kvPath(key))
    cache.set(key, r.value)
    return r.value
  },
  async setItem(key: string, value: string): Promise<void> {
    cache.set(key, value)
    await queue(key, () => api(kvPath(key), { method: 'PUT', body: { value } }))
  },
  async removeItem(key: string): Promise<void> {
    cache.set(key, null)
    await queue(key, () => api(kvPath(key), { method: 'DELETE' }))
  },
  async getAllKeys(): Promise<string[]> {
    const r = await api<{ keys: string[] }>('/api/kv')
    return r.keys
  },
  async multiRemove(keys: string[]): Promise<void> {
    await Promise.all(keys.map((k) => AsyncStorage.removeItem(k)))
  },
}
export default AsyncStorage

/* ------------------------------------------------------------------ Alert */
export interface AlertButton { text: string; style?: 'cancel' | 'destructive' | 'default'; onPress?: () => void }
interface DialogState { open: { title: string; message?: string; buttons: AlertButton[] } | null; close: () => void }
export const useDialog = create<DialogState>((set) => ({ open: null, close: () => set({ open: null }) }))

const FAULT = /FAIL|CRASH|CRITICAL|INSUFFICIENT|LOCK|PURGATORY(?! CLEARED)/i
export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[]) {
    if (buttons && buttons.length > 1) {
      useDialog.setState({ open: { title, message, buttons } })
      return
    }
    const tone = FAULT.test(title) ? 'fault' : /CLEARED|LOGGED|DEFEATED|CONQUERED|FORGED/i.test(title) ? 'live' : 'info'
    useStore.getState().toast(message ? `${title} — ${message}` : title, tone)
  },
}

/* ------------------------------------------------------------------ GithubConfig */
export const GITHUB_USER_KEY = '@silicon_github_user'
export const GithubConfig = {
  async getUser(): Promise<string | null> {
    const v = await AsyncStorage.getItem(GITHUB_USER_KEY)
    return v && v.trim() ? v.trim() : null
  },
  async setUser(user: string): Promise<void> {
    await AsyncStorage.setItem(GITHUB_USER_KEY, user.trim())
  },
}

/* ------------------------------------------------------------------ palette */
// Germoney's branch accents are CATEGORIES, not states. JARVIS keeps cyan / amber /
// red for meaning (measured / inferred / fault), so categories get quiet tints that
// can't be mistaken for any of those.
export const Palette = {
  accentPrimary: '#e8edf3',
  accentInfo: '#a9bfff',
  accentWarning: '#e3c9a2',
  accentPurple: '#c8b6ff',
  accentDanger: '#ff453a',
  textSecondary: 'rgba(245,246,248,0.42)',
}

/* ------------------------------------------------------------------ AI types */
export type FailureCategoryAI = 'energy' | 'planning' | 'distraction' | 'overreach' | 'external' | 'avoidance'
export interface FailureAnalysis {
  rootCause: string
  category: FailureCategoryAI
  intervention: string
  verdict: string
  /** JARVIS addition: where the verdict came from — local model or rule fallback. */
  source?: 'local-ai' | 'rules'
}
