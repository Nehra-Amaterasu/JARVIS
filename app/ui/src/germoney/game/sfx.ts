/**
 * Game sounds, synthesised with WebAudio — no asset files, nothing to download.
 * Every sound marks a real event (a rep ticked, the floor secured, a level, a boss
 * down). Off with one switch in the Armory's settings.
 */
let ctx: AudioContext | null = null
let enabled = true

export function setSound(on: boolean) {
  enabled = on
}

function audio(): AudioContext | null {
  if (!enabled) return null
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = ctx ?? new AC()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; at?: number; slide?: number } = {}) {
  const a = audio()
  if (!a) return
  const t0 = a.currentTime + (opts.at ?? 0)
  const osc = a.createOscillator()
  const g = a.createGain()
  osc.type = opts.type ?? 'triangle'
  osc.frequency.setValueAtTime(freq, t0)
  if (opts.slide) osc.frequency.exponentialRampToValueAtTime(opts.slide, t0 + dur)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.05, t0 + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g).connect(a.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

const arp = (notes: number[], step: number, dur: number, gain = 0.045) =>
  notes.forEach((f, i) => tone(f, dur, { at: i * step, gain }))

export const sfx = {
  tick: () => tone(1320, 0.05, { gain: 0.03 }),
  rep: () => { tone(660, 0.09); tone(990, 0.12, { at: 0.07 }) },
  secure: () => arp([523, 659, 784, 1047], 0.08, 0.28),
  contract: () => { tone(740, 0.08); tone(1110, 0.16, { at: 0.06 }) },
  crit: () => { arp([880, 1175, 1568, 2093], 0.05, 0.2, 0.05); tone(220, 0.35, { type: 'sawtooth', gain: 0.025 }) },
  level: () => arp([392, 494, 587, 784, 988, 1175], 0.07, 0.35, 0.05),
  boss: () => { tone(110, 0.6, { type: 'sawtooth', gain: 0.05, slide: 55 }); arp([330, 415, 494, 659], 0.12, 0.5, 0.04) },
  hit: () => tone(180, 0.12, { type: 'square', gain: 0.03, slide: 90 }),
  chest: () => arp([1047, 1319, 1568, 2093, 2637], 0.04, 0.18, 0.035),
  warn: () => { tone(220, 0.18, { type: 'square', gain: 0.03 }); tone(220, 0.18, { type: 'square', gain: 0.03, at: 0.26 }) },
  buy: () => { tone(1568, 0.06); tone(2093, 0.1, { at: 0.05 }) },
}
