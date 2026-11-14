// The Core section's pure model (spec 20.9.1, A.J01). Every function here is a plain function of its inputs and the
// clock it is handed, so the rules the jury and the honesty tests care about are unit-tested in one place:
//   - a number is shown only for LIVE or SIMULATED (shared/lamp showsNumber); everything else is hollow and says why;
//   - no ribbon node is solid without a fresh report, and with the core off every node is hollow and says OFF;
//   - a ribbon segment fills only as elapsed over a real median; with no median the segment is dashed, never guessed;
//   - every transcript row carries a tag ([YOU] or [JRV]) and a lamp.
import type { CoreInfo, Turn, Vitals } from '../../lib/api'
import { WAITING_DEFAULT, showsNumber, type LampReading, type LampState } from '../../shared/lamp'
import { fnv1a32 } from '../../shared/grammar'
import { N_BANDS, RING_BARS, RING_CX, RING_CY, F_HI, F_LO } from '../voice/constants'
import { bandEdges } from '../voice/bands'
import type { CoreView } from '../voice/voiceState'

// ------------------------------------------------------------------------------------------------ constants
/** Pipeline stages in the order a spoken turn runs through them (20.9.1 PipelineRibbon). */
export const STAGES = ['hear', 'write', 'think', 'say'] as const
export type StageId = (typeof STAGES)[number]
export const STAGE_WORD: Record<StageId, string> = { hear: 'HEAR', write: 'WRITE', think: 'THINK', say: 'SAY' }
/** What each stage measures, in words (the node's accessible name and the Anatomy table). */
export const STAGE_MEANS: Record<StageId, string> = {
  hear: 'silence waited before the recording closed',
  write: 'speech turned into text by Whisper',
  think: 'question to the first word of the reply',
  say: 'first word to his voice starting',
}

/** The core's own state words, mapped to the stage that is running while the core is in that state. */
const RUNNING_STAGE: Record<string, StageId> = {
  listening: 'hear', followup: 'hear', transcribing: 'write', thinking: 'think', replying: 'think', speaking: 'say',
}

/** A LIVE organ or stage reading older than this is no longer "fresh" and falls to WAITING "no fresh report".
 *  The app refreshes /api/system every 2 s (App.tsx), so 10 s is five missed reports. */
export const FRESH_MS = 10_000
/** The fitted transcript: four turns at 1366 x 768 (20.9.1), three when a flag bar is open, three on the phone. */
export const FIT_TURNS = 4
export const FIT_TURNS_PHONE = 3
/** The elapsed text of a running stage updates once a second, and only while a stage runs. */
export const TICK_MS = 1000
/** Medians come from the latency route's recent rows (at most 12 turns of the last 7 days). Fewer than this: no fill. */
export const MEDIAN_MIN_N = 3

// ------------------------------------------------------------------------------------------------ core view
/** The voice picture's CoreView from the app's CoreInfo. Text mode counts as muted (no microphone is open). */
export function coreViewOf(core: CoreInfo | null, stateSince: number | null): CoreView {
  if (!core) return { running: false, state: 'idle', stateSince: null, lastError: null, muted: false }
  return {
    running: !!core.running,
    state: core.running ? core.state : 'idle',
    stateSince,
    lastError: core.last_error ?? null,
    muted: core.running && core.mode === 'text',
  }
}

/** Remember when the core's state word last changed. A repeat of the same word keeps the first time. */
export function trackSince(prev: { state: string; since: number } | null, state: string, now: number): { state: string; since: number } {
  return prev && prev.state === state ? prev : { state, since: now }
}

export const runningStage = (core: CoreInfo | null): StageId | null => (core?.running ? RUNNING_STAGE[core.state] ?? null : null)

// ------------------------------------------------------------------------------------------------ stage seconds
export type StageSeconds = Record<StageId, number | null>

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)

/** One turn's per-stage seconds from the core's timing keys (core/jarvis.py: endpoint, stt, first_token, first_audio).
 *  SAY is the voice start after the first word, so it is first_audio minus first_token when both exist. */
export function stageSeconds(t: Record<string, unknown> | null | undefined): StageSeconds {
  const e = num(t?.endpoint)
  const s = num(t?.stt)
  const ft = num(t?.first_token)
  const fa = num(t?.first_audio)
  return { hear: e, write: s, think: ft, say: fa !== null && ft !== null ? Math.max(0, fa - ft) : null }
}

export const median = (xs: readonly number[]): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface StageMedian { value: number | null; n: number }

/** Per-stage medians over the latency route's recent rows. A stage with fewer than MEDIAN_MIN_N values has none. */
export function stageMedians(rows: readonly Record<string, unknown>[] | null | undefined): Record<StageId, StageMedian> {
  const per: Record<StageId, number[]> = { hear: [], write: [], think: [], say: [] }
  for (const r of rows ?? []) {
    const s = stageSeconds(r)
    for (const k of STAGES) if (s[k] !== null) per[k].push(s[k]!)
  }
  const out = {} as Record<StageId, StageMedian>
  for (const k of STAGES) out[k] = { value: per[k].length >= MEDIAN_MIN_N ? median(per[k]) : null, n: per[k].length }
  return out
}

// ------------------------------------------------------------------------------------------------ ribbon
export interface RibbonStage {
  id: StageId
  state: LampState
  /** Seconds to print: the running stage's elapsed time, or the last measured value. Drawn only for LIVE or SIMULATED. */
  sec?: number
  /** The stage's median, when one exists: the only thing that lets its segment fill. */
  median?: number
  /** True while this stage is the one running now. */
  running?: boolean
  /** Why it is hollow, or what the number is. */
  reason?: string
}

/** The segment into a node: a fill fraction only when the stage runs AND a median exists; otherwise null (dashed). */
export function ribbonFill(s: Pick<RibbonStage, 'state' | 'sec' | 'median' | 'running'>): number | null {
  if (!s.running || !showsNumber(s.state) || s.sec === undefined || !s.median || s.median <= 0) return null
  return Math.max(0, Math.min(1, s.sec / s.median))
}

/** "THINK 3.2 s" or "THINK" with a dash: the text a node prints. */
export function nodeText(s: RibbonStage): { word: string; value: string } {
  const has = showsNumber(s.state) && typeof s.sec === 'number'
  return { word: STAGE_WORD[s.id], value: has ? `${s.sec!.toFixed(1)} s` : s.state === 'waiting' && s.reason === 'core off' ? 'OFF' : '—' }
}

/** The four ribbon stages from what the app knows now. `last` holds the last measured seconds of this run of the core;
 *  with the core off every node is WAITING "core off" (hollow, the strip says OFF). */
export function ribbonStages(input: {
  core: CoreInfo | null
  stateSince: number | null
  now: number
  last: StageSeconds
  medians: Record<StageId, StageMedian>
}): RibbonStage[] {
  const { core, stateSince, now, last, medians } = input
  const run = runningStage(core)
  return STAGES.map((id) => {
    const med = medians[id]?.value ?? undefined
    if (!core?.running) return { id, state: 'waiting', reason: 'core off', median: med }
    if (core.last_error && run === id) return { id, state: 'fault', reason: core.last_error, median: med }
    if (run === id && stateSince !== null) {
      const sec = Math.max(0, (now - stateSince) / 1000)
      return { id, state: 'live', sec: Math.round(sec * 10) / 10, median: med, running: true, reason: 'running now' }
    }
    const v = last[id]
    if (v !== null) return { id, state: 'live', sec: Math.round(v * 10) / 10, median: med, reason: 'last turn' }
    return { id, state: 'waiting', median: med, reason: 'not measured yet' }
  })
}

// ------------------------------------------------------------------------------------------------ organs
export const ORGANS = ['brain', 'voice', 'room', 'sense', 'mem'] as const
export type OrganId = (typeof ORGANS)[number]
export const ORGAN_NAME: Record<OrganId, string> = { brain: 'BRAIN', voice: 'VOICE', room: 'ROOM', sense: 'SENSE', mem: 'MEM' }
/** The store's capability ids (shared/lamp Annunciators) for the organs that have one. */
const CAPABILITY: Partial<Record<OrganId, string>> = { voice: 'voice', room: 'room', sense: 'senses', mem: 'memory', brain: 'brain' }
/** The one word a chip prints (20.9.1): LIVE "ok", WAITING "not tested", FAULT "down". */
export const ORGAN_WORD: Record<LampState, string> = { live: 'ok', waiting: 'not tested', fault: 'down', simulated: 'simulated', planned: 'planned' }

export interface Organ { id: OrganId; name: string; reading: LampReading; source: string }

const fresh = (r: LampReading, now: number): LampReading =>
  r.state === 'live' && r.since !== null && now - r.since > FRESH_MS ? { state: 'waiting', since: r.since, reason: 'no fresh report' } : r

/**
 * The five organ lamps. A reading the store holds for the capability wins (a source reported it); otherwise the
 * lamp is derived only from what /api/system reported, dated by that report, and never LIVE from a stale one.
 */
export function organReadings(input: {
  core: CoreInfo | null
  vitals: Pick<Vitals, 't' | 'ollama' | 'aankhen'> | null
  readings: Record<string, LampReading>
  now: number
}): Organ[] {
  const { core, vitals, readings, now } = input
  const at = vitals ? vitals.t * 1000 : null
  const reported = at !== null && now - at <= FRESH_MS
  const derive = (id: OrganId): { reading: LampReading; source: string } => {
    const off: LampReading = { state: 'waiting', since: null, reason: 'core off' }
    switch (id) {
      case 'voice':
        if (!core) return { reading: WAITING_DEFAULT, source: 'core' }
        if (core.last_error) return { reading: { state: 'fault', since: at, reason: core.last_error }, source: 'core' }
        if (!core.running) return { reading: off, source: 'core' }
        if (core.mode === 'text') return { reading: { state: 'waiting', since: at, reason: 'text only: no microphone' }, source: 'core' }
        return { reading: { state: 'live', since: at ?? now, reason: 'voice process running' }, source: 'core' }
      case 'brain': {
        if (!core?.running) return { reading: off, source: 'ollama' }
        if (!reported) return { reading: { state: 'waiting', since: at, reason: 'no fresh report' }, source: 'ollama' }
        const m = vitals?.ollama?.find((x) => x.name.startsWith('qwen3'))
        if (m) return { reading: { state: 'live', since: at, reason: 'model loaded' }, source: 'ollama' }
        return { reading: { state: 'waiting', since: at, reason: vitals?.ollama ? 'loads on the first question' : 'brain not reachable' }, source: 'ollama' }
      }
      case 'room':
        if (core?.mqtt === true) return { reading: { state: 'live', since: at ?? now, reason: 'board link up' }, source: 'board' }
        if (core?.mqtt === false) return { reading: { state: 'fault', since: at, reason: 'board link down' }, source: 'board' }
        return { reading: { state: 'waiting', since: null, reason: 'not tested' }, source: 'board' }
      case 'sense': {
        const a = vitals?.aankhen
        if (a?.error) return { reading: { state: 'fault', since: at, reason: a.error }, source: 'aankhen' }
        if (a?.running && reported) return { reading: { state: 'live', since: at, reason: 'sensing process running' }, source: 'aankhen' }
        return { reading: { state: 'waiting', since: null, reason: 'not tested' }, source: 'aankhen' }
      }
      case 'mem':
        return { reading: { state: 'waiting', since: null, reason: 'not tested' }, source: 'memory' }
    }
  }
  return ORGANS.map((id) => {
    const cap = CAPABILITY[id]
    const own = cap ? readings[cap] : undefined
    const d = derive(id)
    const reading = fresh(own ?? d.reading, now)
    return { id, name: ORGAN_NAME[id], reading, source: own ? 'reported' : d.source }
  })
}

// ------------------------------------------------------------------------------------------------ transcript
export type TurnTag = 'YOU' | 'JRV'
export const tagOf = (t: Pick<Turn, 'role'>): TurnTag => (t.role === 'you' ? 'YOU' : 'JRV')

/** A finished turn was recorded by the core (LIVE); a turn still streaming is WAITING "still writing". */
export function turnLamp(t: Pick<Turn, 'done' | 't'>): LampReading {
  return t.done ? { state: 'live', since: Number.isFinite(t.t) ? t.t * 1000 : null, reason: 'recorded' } : { state: 'waiting', since: null, reason: 'still writing' }
}

/** The fitted turns (the newest `n`, oldest first) and the earlier ones (newest first) for the Earlier drawer. */
export function fitTurns<T>(turns: readonly T[], n: number): { shown: T[]; earlier: T[] } {
  const k = Math.max(0, Math.floor(n))
  const cut = Math.max(0, turns.length - k)
  return { shown: turns.slice(cut), earlier: turns.slice(0, cut).reverse() }
}

/** Accent tags ([us]…[/us], [hi]…[/hi]) steer the voice and are never shown (the rule of pages/Core.tsx). */
const VOICE_TAG = /\[\/?(uk|british|gb|us|american|usa|hi|hindi|in|indian)\]/gi
export const cleanText = (t: string): string => (t || '').replace(VOICE_TAG, '').replace(/[ \t]{2,}/g, ' ').trim()

/** The intent class of a turn, for its 12 px margin glyph only. A guess from the words, so it is never printed as a fact. */
export type Intent = 'ask' | 'command' | 'memory' | 'talk'
export const INTENT_WORD: Record<Intent, string> = { ask: 'question', command: 'command', memory: 'memory', talk: 'small talk' }
export function intentOf(text: string): Intent {
  const t = cleanText(text).toLowerCase()
  if (/\b(remember|remind|recall|forget|note that|save that)\b/.test(t)) return 'memory'
  if (/^(please\s+)?(turn|switch|set|play|open|start|stop|pause|dim|lights?|fan|mute|wake|sleep)\b/.test(t)) return 'command'
  if (/\?\s*$/.test(t) || /^(what|why|how|when|where|who|which|is|are|can|could|do|does|should|will|would|kya|kaise|kab|kahan|kaun)\b/.test(t)) return 'ask'
  return 'talk'
}

/** Clock text for a turn's epoch-seconds time, HH:MM:SS in the local zone. */
export const turnTime = (t: number): string => {
  if (!Number.isFinite(t)) return '--:--:--'
  const d = new Date(t * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** A turn that wrote into Well Wisher carries `handoff` (20.9.7). The core does not send one yet; this reads it if present. */
export interface Handoff { product: 'ww'; target: string; label: string }
export function handoffOf(t: unknown): Handoff | null {
  const h = (t as { handoff?: unknown } | null)?.handoff as Partial<Handoff> | undefined
  if (!h || h.product !== 'ww' || typeof h.target !== 'string' || typeof h.label !== 'string') return null
  if (!/^ww\/[a-z]+\.[a-z]+$/.test(h.target)) return null
  return { product: 'ww', target: h.target, label: h.label.slice(0, 48) }
}

// ------------------------------------------------------------------------------------------------ sigil ring
/** Ring geometry on the stage's own 720 x 360 grid (jarvis/voice constants: centre 360,176; bezel 120; bars from 128). */
export const SIGIL = {
  TICKS: RING_BARS,
  /** The 96-tick glyph band, radius 123 to 131 (20.9.1). */
  R_IN: 123,
  R_OUT: 131,
  /** The traced C02-07 bezel: segmented hairline arcs and a minor scale outside the bars (bars end at 128 + 36). */
  R_BEZEL: 168,
  R_SCALE_IN: 171,
  R_SCALE_OUT: 175,
  /** The overlay is a square of this half-size centred on the ring; it never reaches past the 360 px stage. */
  HALF: 176,
  CX: RING_CX,
  CY: RING_CY,
  /** A tick is lit when its band is at or above this share of full scale (0..255). */
  LIT_MIN: 0.3,
  GLYPHS: 12,
} as const

/** Which of the 96 ticks are lit. The mapping is the ring bars' own (mirrored, k = 0 at the top), so the lit ticks are
 *  the ring's live bars in a second projection. Hollow states light nothing, whatever the bands say. */
export function sigilTicks(bands: readonly number[] | null, state: LampState): boolean[] {
  const out = new Array<boolean>(SIGIL.TICKS).fill(false)
  if (!bands || !bands.length || !showsNumber(state)) return out
  const n = bands.length
  for (let k = 0; k < SIGIL.TICKS; k++) {
    const m = Math.min(k, SIGIL.TICKS - k)
    const p = (m / (SIGIL.TICKS / 2)) * (n - 1)
    const i = Math.floor(p)
    const f = p - i
    const v = (bands[i] ?? 0) * (1 - f) + (bands[Math.min(n - 1, i + 1)] ?? 0) * f
    out[k] = v / 255 >= SIGIL.LIT_MIN
  }
  return out
}

/** The glyph of tick k: deterministic from the glyph set's seed, so the band is a sigil, not decoration that drifts. */
export const glyphIndex = (glyphSet: string, k: number): number => fnv1a32(`${glyphSet}:${k}`) % SIGIL.GLYPHS

/** The tick under an angle (degrees clockwise from twelve o'clock) and the band and frequency it shows. */
export function bandAtAngle(deg: number): { tick: number; band: number; hz: number } {
  const a = ((deg % 360) + 360) % 360
  const tick = Math.round(a / (360 / SIGIL.TICKS)) % SIGIL.TICKS
  const m = Math.min(tick, SIGIL.TICKS - tick)
  const band = Math.min(N_BANDS - 1, Math.round((m / (SIGIL.TICKS / 2)) * (N_BANDS - 1)))
  const e = bandEdges(N_BANDS, F_LO, F_HI)
  return { tick, band, hz: Math.sqrt(e[band] * e[band + 1]) }
}

export const hzText = (hz: number): string => (hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`)

// ------------------------------------------------------------------------------------------------ anatomy
/** Spoke length for the Anatomy ring: the last measured latency over its own median (1.0 = typical). null = no spoke. */
export function spokeRatio(last: number | null, med: number | null): number | null {
  if (last === null || med === null || med <= 0) return null
  return Math.round((last / med) * 100) / 100
}
