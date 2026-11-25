// The orb of Core Talk under the v3 look (owner, 25 Nov: "the jarvis circle in the middle, the conversation just under it",
// wave lines through the circle). Pure functions only, so the honesty rules are unit-tested in one place:
//   - the orb's mode is read from the core's OWN state word, never guessed from sound;
//   - a wave whose height follows a level is drawn only from a real frame (voiceState says `measured`); with no frame the
//     waves run the calm loop of that mode at a FIXED height, which shows the mode is alive and never moves like a meter;
//   - the words under the orb are the engine's own sentence when the engine gave one (last_error, status_line).
import type { CoreInfo } from '../../lib/api'
import { voiceState, type CoreView, type VoiceSignal } from '../voice'

export type OrbMode = 'asleep' | 'waking' | 'ready' | 'listening' | 'writing' | 'thinking' | 'speaking' | 'fault'

/** The one word under the orb, in the reading face. */
export const ORB_WORD: Record<OrbMode, string> = {
  asleep: 'Asleep', waking: 'Waking', ready: 'Ready', listening: 'Listening', writing: 'Writing', thinking: 'Thinking', speaking: 'Speaking', fault: 'Stopped',
}

/** The core's state words (core/jarvis.py appio.emit("state", ...) and app/jarvis_app/core.py "booting"). */
const STATE_MODE: Record<string, OrbMode> = {
  booting: 'waking', listening: 'listening', followup: 'listening', transcribing: 'writing', thinking: 'thinking', replying: 'thinking', speaking: 'speaking',
}

/** The orb's mode from what the core reported. A core that stopped with an error is `fault`; an unknown awake word is `ready`. */
export function orbModeOf(core: CoreInfo | null): OrbMode {
  if (!core) return 'asleep'
  if (!core.running) return core.last_error ? 'fault' : 'asleep'
  return STATE_MODE[core.state] ?? 'ready'
}

/** The plain line under the word. The engine's own sentence wins over ours (the jury of 25 Nov: "it does not work" was a
 *  screen that hid the reason the core gave); `actionError` is what the last Wake or Sleep press got back. */
export function orbLine(mode: OrbMode, core: CoreInfo | null, actionError: string | null = null): { text: string; fault: boolean } {
  if (actionError) return { text: actionError, fault: true }
  const status = core?.status_line?.trim() ?? ''
  switch (mode) {
    case 'fault': return { text: core?.last_error?.trim() || status || 'The voice process stopped.', fault: true }
    case 'asleep': return { text: status && status !== 'Offline' ? status : 'Wake JARVIS to talk or type', fault: false }
    case 'waking': return { text: core?.boot_step ? `Starting: ${core.boot_step}` : 'Starting the voice process', fault: false }
    case 'listening': return { text: core?.mode === 'text' ? 'Text only: type below' : 'Say "Hey Jarvis", or type below', fault: false }
    case 'writing': return { text: 'Turning what you said into text', fault: false }
    case 'thinking': return { text: 'Working on the reply', fault: false }
    case 'speaking': return { text: 'Speaking the reply', fault: false }
    case 'ready': return { text: status || (core?.mode === 'text' ? 'Text only: type below' : 'Say "Hey Jarvis", or type below'), fault: false }
  }
}

/* ------------------------------------------------------------------ the level */
export interface OrbLevel {
  /** True only while a frame younger than the stale limit exists for the channel the mode reads (voiceState `measured`). */
  measured: boolean
  channel: 'in' | 'out' | null
  /** 0..1, a display transform of the real frame; 0 when not measured. */
  value: number
  /** The frame's own dB, when the source sent one. */
  db: number | null
  /** The short machine text beside the word: "MIC -21 dB", "no level". */
  text: string
}

/** dB to 0..1 over the meter's -60..0 range (the voice strip's own scale, jarvis/voice METER_MIN_DB). */
const dbUnit = (db: number): number => Math.max(0, Math.min(1, (db + 60) / 60))

/**
 * What the waves may show now. Bands (24 smoothed values, 0..255) give the liveliest real value: their mean over 160, the
 * level a normal voice reaches in the fixture and in the recordings of 12 Nov (mean band 120 to 170 while speaking). A scalar
 * frame (Tier 0, `level` RMS about 0 to 0.25) is scaled by 4 for the same reach; a dB frame maps -60..0 dB.
 */
export function orbLevel(signal: VoiceSignal, core: CoreView, now: number, mode: OrbMode): OrbLevel {
  const vs = voiceState(core, { input: signal.view('in', now), output: signal.view('out', now) }, now, 1)
  const reads = mode === 'listening' || mode === 'speaking'
  if (!reads || !vs.measured || !vs.channel) {
    return { measured: false, channel: null, value: 0, db: null, text: noLevelText(mode, core, vs.label) }
  }
  const ch = vs.channel
  const f = signal.latest(ch)
  const bands = signal.sampleBands(ch, now) ?? f?.smooth ?? null
  let value = 0
  if (bands && bands.length) {
    let s = 0
    for (let i = 0; i < bands.length; i++) s += bands[i]
    value = Math.min(1, s / bands.length / 160)
  } else if (f?.rmsDb != null) value = dbUnit(f.rmsDb)
  else if (f?.level != null) value = Math.min(1, f.level * 4)
  const db = f?.rmsDb ?? null
  const src = ch === 'out' ? 'SPEAKER' : 'MIC'
  return { measured: true, channel: ch, value, db, text: db !== null ? `${src} ${Math.round(db)} dB` : `${src} level` }
}

function noLevelText(mode: OrbMode, core: CoreView, label: string): string {
  if (core.muted && (mode === 'listening' || mode === 'ready')) return 'MIC OFF'
  switch (mode) {
    case 'listening': return 'MIC no level yet'
    case 'speaking': return label === 'BETWEEN SENTENCES' ? 'between sentences' : 'SPEAKER no level'
    case 'writing':
    case 'thinking': return 'no level while thinking'
    default: return ''
  }
}

/* ------------------------------------------------------------------ the waves */
/** The wave field's own grid. The stage stretches it to its box (preserveAspectRatio none), so these are shape units. */
export const WAVE_W = 1000
export const WAVE_H = 240
export const WAVE_POINTS = 56
/** Four lines, as in the owner's sketch (yellow, orange, red, violet): cycles across the field, speed (rad/s), weight. */
export const WAVES = [
  { cycles: 2.6, speed: 1.15, weight: 1, phase: 0 },
  { cycles: 3.7, speed: 1.6, weight: 0.72, phase: 1.9 },
  { cycles: 2.1, speed: 0.85, weight: 0.86, phase: 3.4 },
  { cycles: 4.6, speed: 2.05, weight: 0.5, phase: 5.1 },
] as const

/**
 * Per mode: the height of the decorative loop (shape units, half the field is 120), the speed factor, where the envelope
 * peaks (0.5 = the orb's centre; listening leans left so the lines read as entering the orb), and for the two modes that may
 * read a level, the height a real level adds at full scale.
 */
export const WAVE_MODE: Record<OrbMode, { amp: number; speed: number; centre: number; live: number }> = {
  asleep: { amp: 0, speed: 0, centre: 0.5, live: 0 },
  fault: { amp: 0, speed: 0, centre: 0.5, live: 0 },
  waking: { amp: 9, speed: 0.6, centre: 0.5, live: 0 },
  ready: { amp: 7, speed: 0.45, centre: 0.5, live: 0 },
  listening: { amp: 11, speed: 0.9, centre: 0.4, live: 72 },
  writing: { amp: 3, speed: 0.32, centre: 0.5, live: 0 },
  thinking: { amp: 3, speed: 0.32, centre: 0.5, live: 0 },
  speaking: { amp: 24, speed: 1.35, centre: 0.5, live: 84 },
}

/** The height the waves aim for now: the fixed loop height, plus the real level only when it is measured. */
export function waveTarget(mode: OrbMode, level: Pick<OrbLevel, 'measured' | 'value'>): number {
  const m = WAVE_MODE[mode]
  return level.measured ? Math.max(6, m.amp * 0.5) + m.live * level.value : m.amp
}

/** The envelope across the field: biggest through the orb, a quarter at the edges, so the lines pass through the circle. */
export const envelope = (u: number, centre: number): number => 0.22 + 0.78 * Math.exp(-(((u - centre) / 0.24) ** 2))

/** One wave line as an SVG path at time `t` (seconds). Travels left to right (sin(kx - wt)). Rounded to 0.1 for a short `d`. */
export function wavePath(i: number, t: number, amp: number, centre: number, speedFactor: number): string {
  const w = WAVES[i]
  const k = (w.cycles * 2 * Math.PI) / WAVE_W
  const cy = WAVE_H / 2
  let d = ''
  for (let p = 0; p <= WAVE_POINTS; p++) {
    const x = (WAVE_W * p) / WAVE_POINTS
    const y = cy + amp * w.weight * envelope(x / WAVE_W, centre) * Math.sin(k * x - w.speed * speedFactor * t + w.phase)
    d += `${p ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
  }
  return d
}

/** The still pose of each mode (reduced motion, calm, Pause, a gallery): fixed heights that still tell the modes apart. */
export const STILL_AMP: Record<OrbMode, number> = { asleep: 0, fault: 0, waking: 8, ready: 6, listening: 12, writing: 2, thinking: 2, speaking: 22 }

/** Does the mode run the frame loop? Asleep and stopped breathe by CSS alone: no frame callback while he is off. */
export const loops = (mode: OrbMode): boolean => mode !== 'asleep' && mode !== 'fault'

/* ------------------------------------------------------------------ the four lamps under the orb */
export const PATH_STEPS = ['hear', 'write', 'think', 'say'] as const
export const PATH_WORD: Record<(typeof PATH_STEPS)[number], string> = { hear: 'Hear', write: 'Write', think: 'Think', say: 'Say' }
