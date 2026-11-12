// The voice visualiser as a standalone module (spec 9, B07 UI half). Not mounted anywhere here: B06 mounts VoiceHill on Core
// and wires `attachVoiceFeed(voiceSignal, subscribe)` to the bus event stream (ephemeral core/level and core/out_level).
import { VoiceSignal } from './signal'

export { VoiceHill, type VoiceHillProps } from './VoiceHill'
export { VoiceSignal, attachVoiceFeed, parseFrame, type ChannelView, type StoredFrame, type VoiceFrame } from './signal'
export { voiceState, nextChangeAt, liveLegend, thinkingText, VOICE_STATES, PLACEHOLDER_LEGEND, T0_NO_OUTPUT_LEGEND, type CoreView, type SignalViews, type Tier, type VoiceStateKey, type VoiceStateResult } from './voiceState'
export { planScene, drawScene, levelReading, testPatternView, FALLBACK_PALETTE, type Ctx2D, type Palette, type Scene, type SceneInputs } from './scene'
export * from './geometry'
export * from './bands'
export * from './constants'
export { VoiceLoop, browserLoopDeps, type LoopDeps } from './loop'

/** The one shared signal the shell and Core use; a test makes its own with `new VoiceSignal()`. */
export const voiceSignal = new VoiceSignal()
