/**
 * JARVIS's settings (Connect) and how fast he answers (System): the UI's side of
 * app/jarvis_app/routes_settings.py. Types, calls and pure helpers, unit-tested in
 * src/__tests__/settings.test.ts.
 */
import { api, post, TOKEN, ApiError } from './api'

/* ------------------------------------------------------------------ brain */
export interface BrainModel {
  name: string
  size: number
  gb: number
  params: string | null
  family: string | null
  quant: string | null
  capabilities: string[]
  why_not: string | null
  warn: string | null
  note: string | null
  chosen: boolean
  running: boolean
  loaded_gb: number | null
}
export interface BrainView {
  ollama: boolean
  models: BrainModel[]
  chosen: string
  running: string | null
  default: string
  pending_restart: boolean
  core_running: boolean
}
export const loadBrain = () => api<BrainView>('/api/settings/brain')
export const chooseBrain = (model: string) => post<BrainView>('/api/settings/brain', { model })
export const restartBrain = () => post<{ ok: boolean; brain: string }>('/api/settings/brain/restart')

/* ------------------------------------------------------------------ voice */
export interface Voice { id: string; engine: 'edge' | 'kokoro'; name: string; accent: string; gender: string; online: boolean }
export interface VoiceView {
  chosen: string
  speed: number
  speed_range: [number, number]
  edge: Voice[]
  edge_source: 'live' | 'built-in'
  kokoro: Voice[]
  kokoro_missing: string | null
  default: string
}
export const loadVoice = () => api<VoiceView>('/api/settings/voice')
export const chooseVoice = (body: { id?: string; speed?: number }) => post<VoiceView>('/api/settings/voice', body)

/** The groups the voice picker shows, in order: three accents online, then offline. */
export const VOICE_GROUPS = ['British', 'American', 'Indian English', 'Offline'] as const
export type VoiceGroup = typeof VOICE_GROUPS[number]

export function groupOf(v: Voice): VoiceGroup {
  return v.engine === 'kokoro' ? 'Offline' : (v.accent as VoiceGroup)
}

export function voicesIn(view: VoiceView | null, g: VoiceGroup): Voice[] {
  if (!view) return []
  return [...view.edge, ...view.kokoro].filter((v) => groupOf(v) === g)
}

export function voiceLabel(view: VoiceView | null, id: string | null | undefined): string {
  const v = view ? [...view.edge, ...view.kokoro].find((x) => x.id === id) : undefined
  if (v) return `${v.name} · ${v.accent}${v.engine === 'kokoro' ? ' · offline' : ''}`
  return id ? id.replace(/^(edge|kokoro):/, '') : '—'
}

/**
 * "Test voice": JARVIS says it himself when he is listening (his real voice path, the
 * truest test); otherwise the server makes the audio and this window plays it.
 */
export async function testVoice(text?: string, play: (blob: Blob) => Promise<void> = playBlob): Promise<'jarvis' | 'window'> {
  const r = await post<{ via: 'jarvis' | 'window'; text: string }>('/api/settings/voice/test', text ? { text } : {})
  if (r.via === 'jarvis') return 'jarvis'
  const res = await fetch(`/api/settings/voice/preview?text=${encodeURIComponent(r.text)}`, { headers: { 'X-Jarvis-Token': TOKEN } })
  if (!res.ok) {
    let msg = res.statusText
    try { msg = (await res.json()).detail ?? msg } catch { /* not JSON */ }
    throw new ApiError(res.status, msg)
  }
  await play(await res.blob())
  return 'window'
}

async function playBlob(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  audio.onended = () => URL.revokeObjectURL(url)
  await audio.play()
}

/* ------------------------------------------------------------------ pronunciation */
export const loadPronunciations = () => api<{ table: Record<string, string> }>('/api/settings/pronunciations')
export const setPronunciation = (word: string, say: string) => post<{ table: Record<string, string> }>('/api/settings/pronunciations', { word, say })
export const removePronunciation = (word: string) =>
  api<{ table: Record<string, string> }>(`/api/settings/pronunciations/${encodeURIComponent(word)}`, { method: 'DELETE' })

/** What the form may send: the same limits the server keeps (user_settings.py). */
export function pronunciationProblem(word: string, say: string): string | null {
  const w = word.trim(), s = say.trim()
  if (!w || !s) return 'Both the word and how to say it.'
  if (w.length > 40 || s.length > 80) return 'Keep it short: 40 and 80 characters.'
  if (/[[\]]/.test(w + s)) return 'No square brackets: those are accent tags.'
  return null
}

/* ------------------------------------------------------------------ modules */
export interface DeepCandidate { name: string; params: string | null; gb: number; vram_gb: number; thinking: boolean; warn: string | null; note: string | null }
export interface Download { name: string; gb: number; command: string | null; why: string }
export interface Module {
  id: 'deep_think' | 'offline_voice' | 'unload_all'
  name: string
  kind: 'timed' | 'action'
  what: string
  status: 'installed' | 'not_installed' | 'loaded' | 'unknown'
  detail: string
  cost: { vram_gb: number | null; ram_gb: number | null; note: string }
  until?: number | null
  candidates?: DeepCandidate[]
  model?: string | null
  always?: boolean
  download?: Download | null
  loaded?: { name: string; vram_gb: number }[]
}
export const loadModules = () => api<{ modules: Module[] }>('/api/settings/modules').then((r) => r.modules)
export const moduleOn = (id: string, minutes: number, model?: string) =>
  post<{ ok: boolean; until: number }>(`/api/settings/modules/${id}/on`, model ? { minutes, model } : { minutes })
export const moduleOff = (id: string) => post(`/api/settings/modules/${id}/off`)
export const freeGpu = () => post<{ unloaded: string[]; freed_gb: number }>('/api/settings/modules/unload_all/run')

/** "12 min left", "40 s left"; null when it is off or over. */
export function timeLeft(until: number | null | undefined, nowS: number): string | null {
  if (!until || until <= nowS) return null
  const s = until - nowS
  if (s < 60) return `${Math.ceil(s)} s left`
  if (s < 3600) return `${Math.ceil(s / 60)} min left`
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min left`
}

export const STATUS_TEXT: Record<Module['status'], { label: string; tone: '' | 'live' | 'planned' | 'fault' }> = {
  loaded: { label: 'loaded', tone: 'live' },
  installed: { label: 'installed', tone: '' },
  not_installed: { label: 'needs download', tone: 'planned' },
  unknown: { label: 'unknown', tone: 'fault' },
}

export function costLine(c: Module['cost']): string {
  const parts: string[] = []
  if (c.vram_gb != null) parts.push(c.vram_gb === 0 ? 'no VRAM' : `${c.vram_gb} GB VRAM`)
  if (c.ram_gb != null) parts.push(`${c.ram_gb} GB RAM`)
  return parts.join(' · ')
}

/* ------------------------------------------------------------------ latency */
export interface Stat { median: number; p90: number; n: number }
export interface Wake {
  t: number
  score: number | null
  outcome: 'listening' | 'thinking' | 'answered' | 'heard_nothing' | 'error'
  first_word: number | null
  full: number | null
  done_speaking: number | null
  marginal: boolean
  error?: string
}
export interface TurnTiming {
  ts: number
  spoken: boolean
  heard: number | null
  first_word: number | null
  full: number | null
  first_token: number | null
}
export interface LatencyView {
  live: { wakes: Wake[]; counts: Record<string, number>; threshold: number }
  summary: { turns: number; spoken: number; heard: Stat | null; first_word: Stat | null; full: Stat | null; typed_first_word: Stat | null }
  recent: TurnTiming[]
  core: { running: boolean; mode: 'voice' | 'text' | null; state: string; brain: string | null; chosen_brain: string; last_error: string | null }
}
export const loadLatency = () => api<LatencyView>('/api/settings/latency')

export const OUTCOME: Record<Wake['outcome'], { label: string; tone: '' | 'live' | 'sim' | 'fault' }> = {
  listening: { label: 'listening', tone: 'live' },
  thinking: { label: 'thinking', tone: 'live' },
  answered: { label: 'answered', tone: '' },
  heard_nothing: { label: 'heard nothing', tone: 'sim' },
  error: { label: 'error', tone: 'fault' },
}

export const fmtS = (s: number | null | undefined, d = 1) => (s == null || !Number.isFinite(s) ? '—' : `${s.toFixed(d)} s`)

/** The one line at the top of System: can he hear "Hey Jarvis" right now? */
export function hearingLine(core: LatencyView['core'] | null | undefined): { text: string; tone: 'live' | 'sim' | 'fault' } {
  if (!core || !core.running) return { text: 'JARVIS is off: nothing is listening for “Hey Jarvis”.', tone: 'fault' }
  if (core.mode === 'text') return { text: 'Text mode: he reads what you type and cannot hear you.', tone: 'sim' }
  if (core.state === 'booting') return { text: 'Booting: he cannot hear you yet.', tone: 'sim' }
  if (core.state === 'sleeping') return { text: 'Listening for “Hey Jarvis”.', tone: 'live' }
  return { text: `Awake: ${core.state}.`, tone: 'live' }
}

/* ------------------------------------------------------------------ data exports */
export interface ExportRead {
  ok: boolean
  error?: string
  warning?: string
  items?: number
  files?: number
  first?: string | null
  last?: string | null
  conversations?: number
  words?: number
  threads?: number
  hours?: number
  top_artists?: { artist: string; plays: number }[]
}
export interface ExportFile { name: string; size: number | null; mtime: number; folder: boolean; read: ExportRead | null }
export interface ExportSource {
  id: 'instagram' | 'chatgpt' | 'spotify' | 'ytmusic'
  name: string
  url: string
  ask: string
  wait: string
  memory: string
  files: ExportFile[]
  downloads: { path: string; name: string; size: number; mtime: number }[]
  job: { state: 'copying' | 'reading' | 'failed'; file: string; error?: string } | null
  state: 'not_requested' | 'arrived' | 'imported'
  archive_built?: number | null
  archive_stale?: boolean
}
export const loadExports = () => api<{ sources: ExportSource[] }>('/api/imports').then((r) => r.sources)
export const requestExport = (id: string) => post<{ url: string }>(`/api/imports/${id}/request`)
export const importPath = (id: string, path: string) => post<{ name: string; size: number }>(`/api/imports/${id}/path`, { path })
export const openImports = (id: string) => post(`/api/imports/${id}/open`)

/** Send a dropped file to the server as it is (streamed; an export can be gigabytes). */
export async function uploadExport(id: string, file: File | Blob, name: string): Promise<{ name: string; size: number }> {
  const res = await fetch(`/api/imports/${id}/upload?name=${encodeURIComponent(name)}`, {
    method: 'POST', headers: { 'X-Jarvis-Token': TOKEN, 'Content-Type': 'application/octet-stream' }, body: file,
  })
  if (!res.ok) {
    let msg = res.statusText
    try { msg = (await res.json()).detail ?? msg } catch { /* not JSON */ }
    throw new ApiError(res.status, msg)
  }
  return res.json()
}

export const fmtBytes = (n: number | null | undefined) =>
  n == null ? '—' : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`

/** What was read from an export, in one line; never says "in memory". */
export function readLine(source: ExportSource['id'], r: ExportRead | null): string {
  if (!r) return 'Reading it…'
  if (!r.ok) return `Could not read it: ${r.error ?? 'unknown error'}`
  const span = r.first && r.last ? `, ${r.first.slice(0, 7)} → ${r.last.slice(0, 7)}` : ''
  const n = (x: number | undefined) => (x ?? 0).toLocaleString('en-IN')
  if (source === 'instagram') return `${n(r.threads)} message threads`
  if (source === 'chatgpt') return `${n(r.items)} of your messages in ${n(r.conversations)} conversations${span}`
  const top = (r.top_artists ?? []).slice(0, 3).map((a) => a.artist).join(', ')
  const hours = r.hours != null ? ` · ${r.hours} h` : ''
  return `${n(r.items)} plays${hours}${span}${top ? ` · most: ${top}` : ''}`
}

export function exportState(s: ExportSource): { label: string; tone: '' | 'live' | 'sim' | 'planned' | 'fault' } {
  if (s.job?.state === 'failed') return { label: 'copy failed', tone: 'fault' }
  if (s.job) return { label: s.job.state, tone: 'sim' }
  if (s.state === 'imported') return { label: 'imported', tone: 'live' }
  if (s.state === 'arrived') return { label: 'in Downloads', tone: 'sim' }
  return { label: 'not requested', tone: 'planned' }
}

/** "built 43 days ago" from an epoch-seconds time. */
export function ago(ts: number | null | undefined, nowS: number): string {
  if (!ts) return 'never'
  const d = Math.max(0, nowS - ts)
  if (d < 90) return 'just now'
  if (d < 3600) return `${Math.round(d / 60)} min ago`
  if (d < 86400 * 2) return `${Math.round(d / 3600)} h ago`
  return `${Math.round(d / 86400)} days ago`
}
