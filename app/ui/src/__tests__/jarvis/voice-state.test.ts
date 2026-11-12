// The state machine (spec 9.6, V-02, V-08, V-15): a table, every precedence tie, and the "solid implies fresh" property.
import { describe, expect, it } from 'vitest'
import { VoiceSignal } from '../../jarvis/voice/signal'
import { FIRST_AUDIO_MS, STALE_MS } from '../../jarvis/voice/constants'
import { PLACEHOLDER_LEGEND, T0_NO_OUTPUT_LEGEND, VOICE_STATES, liveLegend, nextChangeAt, voiceState, type CoreView, type VoiceStateKey } from '../../jarvis/voice/voiceState'
import { LAMP_SPECS } from '../../shared/lamp'
import { planScene } from '../../jarvis/voice/scene'
import { flat, frame } from './voice-helpers'

const NOW = 100_000
const core = (o: Partial<CoreView> = {}): CoreView => ({ running: true, state: 'idle', stateSince: NOW - 5000, lastError: null, muted: false, ...o })
const sigWith = (setup: (s: VoiceSignal) => void) => {
  const s = new VoiceSignal()
  setup(s)
  return s
}
const run = (c: CoreView, s: VoiceSignal, now = NOW, tier: 0 | 1 = 1) => voiceState(c, { input: s.view('in', now), output: s.view('out', now) }, now, tier)
const mic = (s: VoiceSignal, at = NOW - 20, extra = {}) => s.ingest(frame('in', at, flat(30), { rmsDb: -40, thrDb: -50, ...extra }))
const spk = (s: VoiceSignal, at = NOW - 20, extra = {}) => s.ingest(frame('out', at, flat(80), extra))
const none = () => new VoiceSignal()

describe('V-02: the precedence table', () => {
  const cases: [string, CoreView, VoiceSignal, VoiceStateKey, string?][] = [
    ['error beats everything', core({ lastError: 'output device failed', muted: true, state: 'speaking' }), sigWith((s) => { mic(s); spk(s) }), 'error'],
    ['empty error string still counts as no error', core({ lastError: '' }), none(), 'idle'],
    ['muted beats no signal', core({ muted: true, state: 'listening' }), none(), 'muted'],
    ['muted beats a live mic', core({ muted: true, state: 'listening' }), sigWith((s) => mic(s)), 'muted'],
    ['listening, no frames: no signal', core({ state: 'listening' }), none(), 'no-signal', 'no-input'],
    ['followup, stale frame: no signal', core({ state: 'followup' }), sigWith((s) => mic(s, NOW - 500)), 'no-signal'],
    ['listening, fresh, VAD speech: hearing', core({ state: 'listening' }), sigWith((s) => mic(s, NOW - 20, { speaking: true })), 'hearing'],
    ['listening, speech_prob over the threshold: hearing', core({ state: 'listening' }), sigWith((s) => mic(s, NOW - 20, { speechProb: 0.9, vadThreshold: 0.5 })), 'hearing'],
    ['listening, speech_prob under the threshold: listening', core({ state: 'listening' }), sigWith((s) => mic(s, NOW - 20, { speechProb: 0.1, vadThreshold: 0.5 })), 'listening'],
    ['listening, no VAD, two frames over the threshold: hearing, worded as a level', core({ state: 'listening' }), sigWith((s) => { mic(s, NOW - 70, { rmsDb: -30 }); mic(s, NOW - 20, { rmsDb: -30 }) }), 'hearing', 'level-above-threshold'],
    ['listening, no VAD, one frame over the threshold: still listening', core({ state: 'listening' }), sigWith((s) => mic(s, NOW - 20, { rmsDb: -30 })), 'listening'],
    ['listening, fresh, quiet: listening (a flat line is LIVE)', core({ state: 'listening' }), sigWith((s) => mic(s)), 'listening'],
    ['speaking, fresh output: speaking', core({ state: 'speaking' }), sigWith((s) => spk(s)), 'speaking'],
    ['barge-in: output and mic fresh, the output wins', core({ state: 'speaking' }), sigWith((s) => { mic(s, NOW - 20, { speaking: true }); spk(s) }), 'speaking'],
    ['speaking, first audio pending under 1 s', core({ state: 'speaking', stateSince: NOW - 600 }), none(), 'between', 'first-audio'],
    ['speaking, nothing after 1 s: no signal', core({ state: 'speaking', stateSince: NOW - 1200 }), none(), 'no-signal', 'no-output'],
    ['speaking, output went stale mid-stream: no signal', core({ state: 'speaking', stateSince: NOW - 3000 }), sigWith((s) => spk(s, NOW - 900)), 'no-signal'],
    ['speaking, pipe closed with final: between sentences', core({ state: 'speaking', stateSince: NOW - 3000 }), sigWith((s) => { spk(s, NOW - 900); s.ingest(frame('out', NOW - 800, flat(0), { final: true })) }), 'between', 'between-sentences'],
    ['thinking', core({ state: 'thinking' }), sigWith((s) => mic(s)), 'thinking'],
    ['idle, running', core({ state: 'idle' }), none(), 'idle', 'idle'],
    ['idle, core off', core({ running: false, state: 'idle' }), none(), 'idle', 'off'],
    ['an unknown core word is idle', core({ state: 'wandering' }), none(), 'idle'],
  ]
  it.each(cases)('%s', (_name, c, s, state, detail) => {
    const r = run(c, s)
    expect(r.state).toBe(state)
    if (detail) expect(r.detail).toBe(detail)
    expect(LAMP_SPECS[r.lamp.state]).toBeTruthy() // every state has a lamp
  })

  it('covers all nine states', () => {
    for (const st of VOICE_STATES) expect(cases.some((c) => c[3] === st)).toBe(true)
  })

  it('tier 0 speaking is NO SIGNAL with the legend "no output level yet", even if frames somehow arrive', () => {
    const r = run(core({ state: 'speaking' }), sigWith((s) => spk(s)), NOW, 0)
    expect(r.state).toBe('no-signal')
    expect(r.legend).toBe(T0_NO_OUTPUT_LEGEND)
    expect(r.legend).toMatch(/no output level yet/)
  })

  it('maps lamps: live states LIVE, error FAULT with its reason, muted and idle WAITING', () => {
    expect(run(core({ state: 'listening' }), sigWith((s) => mic(s))).lamp.state).toBe('live')
    const e = run(core({ lastError: 'output device failed' }), none())
    expect(e.lamp.state).toBe('fault')
    expect(e.lamp.reason).toBe('output device failed')
    expect(run(core({ muted: true }), none()).lamp.state).toBe('waiting')
    expect(run(core(), none()).lamp.state).toBe('waiting')
    expect(run(core({ state: 'listening' }), none()).legend).toBe(PLACEHOLDER_LEGEND)
  })

  it('only a measured state carries a measured source tag; the placeholder says it is not a reading', () => {
    const r = run(core({ state: 'speaking' }), sigWith((s) => spk(s)))
    expect(r.source).toBe('SPEAKER, pre-volume')
    expect(run(core({ state: 'listening' }), none()).measured).toBe(false)
    expect(run(core({ state: 'listening' }), none()).legend).toMatch(/not a reading/)
  })
})

describe('V-08: the 400 ms edge in the state', () => {
  it('listening is live at 399 ms and NO SIGNAL at 401 ms', () => {
    const s = sigWith((x) => x.ingest(frame('in', NOW, flat(30))))
    const c = core({ state: 'listening' })
    expect(run(c, s, NOW + 399).state).toBe('listening')
    expect(run(c, s, NOW + STALE_MS).state).toBe('listening')
    expect(run(c, s, NOW + 401).state).toBe('no-signal')
  })
  it('nextChangeAt names the moment time alone changes the state, and is null when nothing is pending', () => {
    const s = sigWith((x) => x.ingest(frame('in', NOW, flat(30))))
    const sv = (now: number) => ({ input: s.view('in', now), output: s.view('out', now) })
    expect(nextChangeAt(core({ state: 'listening' }), sv(NOW + 10), NOW + 10)).toBe(NOW + STALE_MS + 1)
    expect(nextChangeAt(core({ state: 'idle' }), sv(NOW), NOW)).toBeNull()
    expect(nextChangeAt(core({ state: 'speaking', stateSince: NOW }), sv(NOW + 100), NOW + 100)).toBe(NOW + FIRST_AUDIO_MS)
    expect(nextChangeAt(core({ lastError: 'x', state: 'listening' }), sv(NOW), NOW)).toBeNull()
  })
})

describe('legends', () => {
  it('prints the measured line with the source, the dB, the rate and LIVE', () => {
    expect(liveLegend('in', 1, -23, 20)).toBe('MIC -23 dB, 20 Hz, LIVE. 24 bands, low at centre, mirrored')
    expect(liveLegend('out', 1, -20.4, 20, 12)).toMatch(/SPEAKER -20 dB, 20 Hz, LIVE, display \+12 dB before the system volume/)
  })
  it('V-09: a tier-0 legend is relative, says no spectrum, and has no dB anywhere', () => {
    const t = liveLegend('in', 0, null, 12)
    expect(t).toMatch(/relative level, uncalibrated/)
    expect(t).toMatch(/no spectrum/)
    expect(t).not.toMatch(/dB/)
  })
})

describe('V-15: solid points only with a frame younger than 400 ms, in every state, over 1,000 random sequences', () => {
  // a small deterministic generator, so the property test is reproducible
  let seed = 12345
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296
  it('plans hollow with measured false whenever no fresh frame exists, and solid only when one does', () => {
    const words = ['idle', 'listening', 'followup', 'thinking', 'speaking']
    let solid = 0
    for (let n = 0; n < 1000; n++) {
      const s = new VoiceSignal()
      const now = 50_000 + Math.floor(rnd() * 100)
      const frames = Math.floor(rnd() * 6)
      for (let k = 0; k < frames; k++) {
        const ch = rnd() < 0.5 ? 'in' : 'out'
        const at = now - Math.floor(rnd() * 1500)
        s.ingest(frame(ch, at, flat(Math.floor(rnd() * 255)), { final: rnd() < 0.15, speaking: rnd() < 0.3 ? true : null }))
      }
      const c = core({ state: words[Math.floor(rnd() * words.length)], stateSince: now - Math.floor(rnd() * 4000), muted: rnd() < 0.1, lastError: rnd() < 0.1 ? 'boom' : null, running: rnd() < 0.9 })
      const scene = planScene({ core: c, signal: s, now, tier: 1, quality: 'high', breath: rnd() < 0.5, sensitivityDb: 0, testPatternSince: null })
      if (scene.style === 'solid') {
        solid++
        expect(scene.vs.measured).toBe(true)
        expect(s.view(scene.vs.channel!, now).fresh).toBe(true)
        expect(['hearing', 'speaking', 'listening']).toContain(scene.vs.state)
      } else {
        expect(scene.vs.measured).toBe(false)
        expect(scene.style).toBe('hollow')
        expect(scene.fill).toBeNull()
        expect(scene.levelDb).toBeNull()
      }
    }
    expect(solid).toBeGreaterThan(20) // the property is not vacuous
  })
})
