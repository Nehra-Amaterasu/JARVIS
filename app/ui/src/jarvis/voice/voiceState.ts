// The voice state machine (spec 9.6): one pure function, table-tested. Precedence from the top; the first rule that
// matches wins. The result says what to draw (solid only with a fresh frame), which lamp to show, and what to say.
import { FIRST_AUDIO_MS, STALE_MS } from './constants'
import type { Channel } from './bands'
import type { LampReading } from '../../shared/lamp'
import type { ChannelView } from './signal'

export const VOICE_STATES = ['error', 'muted', 'no-signal', 'between', 'speaking', 'hearing', 'thinking', 'listening', 'idle'] as const
export type VoiceStateKey = (typeof VOICE_STATES)[number]

/** What the core says. `state` is the core's own word; unknown words behave as idle. */
export interface CoreView {
  /** The voice process is running. False shows "JARVIS IS OFF". */
  running: boolean
  state: 'idle' | 'listening' | 'followup' | 'thinking' | 'speaking' | (string & {})
  /** Epoch ms of the last change of `state`; null when unknown. */
  stateSince: number | null
  /** The core's `last_error`, a failed stream, or a dead voice process. */
  lastError: string | null
  /** Text-only mode (`--text`) or an explicit mute. The mute switch is PLANNED until the core reports it. */
  muted: boolean
}

export interface SignalViews {
  input: ChannelView
  output: ChannelView
}

/** Tier 0 has only the legacy scalar and no output level at all (9.9). */
export type Tier = 0 | 1

export const PLACEHOLDER_LEGEND = 'NO SIGNAL: shape is a placeholder, not a reading'
export const T0_NO_OUTPUT_LEGEND = 'NO SIGNAL: no output level yet, shape is a placeholder'

export interface VoiceStateResult {
  state: VoiceStateKey
  /** Sub-case words: "no-output-level", "first-audio", "between-sentences", "level-above-threshold", "off". */
  detail: string
  lamp: LampReading
  /** The word on the strip: "MIC, LISTENING", "SPEAKER", "NO SIGNAL". */
  label: string
  /** The always-visible source tag, or null when nothing is being read. */
  source: 'MIC' | 'SPEAKER, pre-volume' | 'MIC OFF' | null
  /** Which channel the picture shows when `measured`. */
  channel: Channel | null
  /** Solid points and a number are allowed only here, and only because a frame younger than 400 ms exists. */
  measured: boolean
  /** The legend that stands in for the live line when nothing is measured; null when measured (the caller prints the live line). */
  legend: string | null
  /** One short phrase for the polite live region, said once per change of this value. */
  announce: string
}

const lamp = (state: LampReading['state'], reason: string, since: number | null): LampReading => ({ state, since, reason })

/** The tier-0 legend of a live reading, and the full legend of a tier-1 one (9.4, 9.9). */
export function liveLegend(channel: Channel, tier: Tier, rmsDb: number | null, rateHz: number | null, shiftDb = 0): string {
  const src = channel === 'out' ? 'SPEAKER' : 'MIC'
  const rate = rateHz ? `, ${rateHz} Hz` : ''
  if (tier === 0 || rmsDb === null) return `${src} relative level, uncalibrated${rate}, LIVE. Level over the last 2.4 s, no spectrum`
  const shift = shiftDb ? `, display +${shiftDb} dB` : ''
  const tail = channel === 'out' ? ' before the system volume' : ''
  return `${src} ${Math.round(rmsDb)} dB${rate}, LIVE${shift}${tail}. 24 bands, low at centre, mirrored`
}

/** Elapsed thinking time as the strip prints it: "3.2 s". */
export const thinkingText = (sinceMs: number | null, now: number): string => (sinceMs === null ? 'THINKING' : `THINKING ${(Math.max(0, now - sinceMs) / 1000).toFixed(1)} s`)

export function voiceState(core: CoreView, sig: SignalViews, now: number, tier: Tier = 1): VoiceStateResult {
  const since = core.stateSince
  const sinceEntered = since === null ? Infinity : now - since
  const placeholder = (state: VoiceStateKey, detail: string, l: LampReading, label: string, legend: string, announce: string, source: VoiceStateResult['source'] = null): VoiceStateResult => ({
    state, detail, lamp: l, label, source, channel: null, measured: false, legend, announce,
  })
  const live = (state: VoiceStateKey, channel: Channel, label: string, announce: string, detail = ''): VoiceStateResult => ({
    state, detail, lamp: lamp('live', label, since), label, source: channel === 'out' ? 'SPEAKER, pre-volume' : 'MIC', channel, measured: true, legend: null, announce,
  })

  // 1 error
  if (core.lastError) {
    const why = core.lastError.trim() || 'voice engine failed'
    return placeholder('error', 'error', lamp('fault', why, since), 'ERROR', why, `Error: ${why}`)
  }
  // 2 muted
  if (core.muted) return placeholder('muted', 'muted', lamp('waiting', 'MIC OFF', since), 'MIC OFF', 'mic off', 'Microphone off', 'MIC OFF')

  const listening = core.state === 'listening' || core.state === 'followup'
  const speaking = core.state === 'speaking'

  // 3 no signal
  if (listening && !sig.input.fresh)
    return placeholder('no-signal', 'no-input', lamp('waiting', PLACEHOLDER_LEGEND, since), 'NO SIGNAL', PLACEHOLDER_LEGEND, 'No signal from the microphone')
  if (speaking) {
    if (tier === 0) return placeholder('no-signal', 'no-output-level', lamp('waiting', T0_NO_OUTPUT_LEGEND, since), 'NO SIGNAL', T0_NO_OUTPUT_LEGEND, 'Speaking, no output level yet')
    if (!sig.output.fresh) {
      // A stream of this sentence that ended (`final`), or audio that has not started yet, is not a lost signal.
      const sinceEntry = sig.output.lastArrival !== null && (since === null || sig.output.lastArrival >= since)
      if (sig.output.final && sinceEntry)
        return placeholder('between', 'between-sentences', lamp('waiting', 'between sentences', since), 'BETWEEN SENTENCES', 'between sentences', 'Between sentences')
      if (!sinceEntry && sinceEntered < FIRST_AUDIO_MS)
        return placeholder('between', 'first-audio', lamp('waiting', 'waiting for the first audio', since), 'STARTING TO SPEAK', 'waiting for the first audio', 'Speaking')
      return placeholder('no-signal', 'no-output', lamp('waiting', PLACEHOLDER_LEGEND, since), 'NO SIGNAL', PLACEHOLDER_LEGEND, 'No signal from the speaker')
    }
    // 5 speaking wins over a fresh microphone (barge-in: the output wins and the tag says SPEAKER).
    return live('speaking', 'out', 'SPEAKER', 'Speaking')
  }
  // 4 hearing speech
  if (listening && sig.input.fresh) {
    if (sig.input.speech === true) return live('hearing', 'in', 'MIC, HEARING SPEECH', 'Heard you')
    if (sig.input.speech === null && sig.input.aboveThreshold) return live('hearing', 'in', 'MIC, LEVEL ABOVE THRESHOLD', 'Level above threshold', 'level-above-threshold')
  }
  // 6 thinking
  if (core.state === 'thinking')
    return placeholder('thinking', 'thinking', lamp('waiting', thinkingText(since, now), since), thinkingText(since, now), 'thinking, no level', 'Thinking')
  // 7 listening
  if (listening) return live('listening', 'in', 'MIC, LISTENING', 'Listening')
  // 8 idle
  if (!core.running) return placeholder('idle', 'off', lamp('waiting', 'JARVIS IS OFF', since), 'JARVIS IS OFF', 'JARVIS is off', 'JARVIS is off')
  return placeholder('idle', 'idle', lamp('waiting', 'IDLE', since), 'IDLE', 'idle', 'Idle')
}

/**
 * The next epoch ms at which the state can change by the passage of time alone (a frame going stale, the first-audio
 * window ending), or null. The component arms one timeout for it, so a quiet picture needs no polling loop.
 */
export function nextChangeAt(core: CoreView, sig: SignalViews, now: number, tier: Tier = 1): number | null {
  if (core.lastError || core.muted) return null
  const listening = core.state === 'listening' || core.state === 'followup'
  if (listening && sig.input.fresh && sig.input.lastArrival !== null) return sig.input.lastArrival + STALE_MS + 1
  if (core.state === 'speaking' && tier === 1) {
    if (sig.output.fresh && sig.output.lastArrival !== null) return sig.output.lastArrival + STALE_MS + 1
    if (!sig.output.hasFrame || (sig.output.lastArrival !== null && core.stateSince !== null && sig.output.lastArrival < core.stateSince)) {
      if (core.stateSince !== null && now - core.stateSince < FIRST_AUDIO_MS) return core.stateSince + FIRST_AUDIO_MS
    }
  }
  return null
}

