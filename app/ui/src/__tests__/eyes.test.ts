/** Aankhen's eyes, the pure half (lib/eyes.ts): colour that means provenance and
 * brightness that means distance from noise, the rhythm's log-frequency layout, the
 * scroll clock that never shows a column before it arrives, and the body glyph's
 * reading of the learned models — always as an estimate. */
import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_BANDS, CLIP_Z, KNEE, LAG, POSES, RAMPS, STRIP_TOP, SUBCARRIERS, Z_TOP, bandsAt, channelMHz, clockArrive, clockStep,
  fmtRhythm, freqToX, intensity, newClock, powerRange, provenanceOf, rampColor, rampTable, readBody, seeSentence,
  smoothPath, spectrumPoints, stripIntensity, xToFreq, type LearnedLike, type Pose,
} from '../lib/eyes'

const lum = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b

describe('the channel', () => {
  it('has the 51 LLTF subcarriers the columns carry, without DC and +1', () => {
    expect(SUBCARRIERS).toHaveLength(51)
    expect(SUBCARRIERS[0]).toBe(-26)
    expect(SUBCARRIERS[50]).toBe(26)
    expect(SUBCARRIERS).not.toContain(0)
    expect(SUBCARRIERS).not.toContain(1)
    expect(SUBCARRIERS.indexOf(2)).toBe(26)            // the DC gap sits after 26 rows
  })
  it('knows where 2.4 GHz channels are', () => {
    expect(channelMHz(1)).toBe(2412)
    expect(channelMHz(11)).toBe(2462)
    expect(channelMHz(14)).toBe(2484)
    expect(channelMHz(0)).toBeNull()
    expect(channelMHz(null)).toBeNull()
  })
})

describe('colour', () => {
  it('is provenance: ice only for hardware, amber for everything else', () => {
    expect(provenanceOf('hardware')).toBe('live')
    expect(provenanceOf('simulation')).toBe('sim')
    expect(provenanceOf('replay')).toBe('sim')
    expect(provenanceOf(undefined)).toBe('sim')
  })
  it('runs from near-black to near-white through the provenance colour', () => {
    for (const p of ['live', 'sim'] as const) {
      expect(lum(rampColor(0, p))).toBeLessThan(12)
      expect(lum(rampColor(1, p))).toBeGreaterThan(235)
      let prev = -1
      for (let t = 0; t <= 1.0001; t += 0.02) {
        const l = lum(rampColor(t, p))
        expect(l).toBeGreaterThanOrEqual(prev - 0.5)      // brightens monotonically
        prev = l
      }
    }
    expect(rampColor(0.8, 'live')).toEqual([0x5c, 0xe1, 0xff])  // --live
    expect(rampColor(0.8, 'sim')).toEqual([0xff, 0xb0, 0x20])   // --sim
  })
  it('keeps each ramp in its own hue: blue never warms, amber never cools', () => {
    for (let t = 0.05; t <= 0.95; t += 0.05) {
      const [r, , b] = rampColor(t, 'live')
      const [r2, , b2] = rampColor(t, 'sim')
      expect(b).toBeGreaterThanOrEqual(r)
      expect(r2).toBeGreaterThanOrEqual(b2)
    }
  })
  it('clamps and survives junk', () => {
    expect(rampColor(-3, 'live')).toEqual(rampColor(0, 'live'))
    expect(rampColor(7, 'sim')).toEqual(rampColor(1, 'sim'))
    expect(rampColor(NaN, 'live')).toEqual(rampColor(0, 'live'))
  })
  it('gives the shaders a 256-entry opaque table matching the stops', () => {
    const t = rampTable('live')
    expect(t).toHaveLength(1024)
    for (let i = 3; i < t.length; i += 4) expect(t[i]).toBe(255)
    expect(Array.from(t.slice(0, 3))).toEqual(rampColor(0, 'live'))
    expect(Array.from(t.slice(1020, 1023))).toEqual(rampColor(1, 'live'))
    expect(RAMPS.live[0][0]).toBe(0)
    expect(RAMPS.sim[RAMPS.sim.length - 1][0]).toBe(1)
  })
})

describe('brightness', () => {
  it('keeps a still room dark and saturates at the clip', () => {
    expect(intensity(0)).toBe(0)
    expect(intensity(0.3)).toBe(0)                       // the 100 ms mean of pure noise
    expect(intensity(KNEE)).toBe(0)
    expect(intensity(CLIP_Z)).toBe(1)
    expect(intensity(40)).toBe(1)
    expect(intensity(NaN)).toBe(0)
  })
  it('reads |z|: above and below the baseline look the same, and more is brighter', () => {
    expect(intensity(-3)).toBe(intensity(3))
    let prev = 0
    for (let z = KNEE + 0.1; z <= Z_TOP; z += 0.1) {
      expect(intensity(z)).toBeGreaterThan(prev)
      prev = intensity(z)
    }
    for (let z = Z_TOP; z <= CLIP_Z; z += 0.5) expect(intensity(z)).toBe(1)   // white from Z_TOP up
    expect(intensity(1.5)).toBeGreaterThan(0.3)           // a small real change can be seen
  })
  it('the strip is black at the noise floor and white at 300x', () => {
    expect(stripIntensity(0)).toBe(0)
    expect(stripIntensity(-0.4)).toBe(0)
    expect(stripIntensity(STRIP_TOP)).toBe(1)
    expect(stripIntensity(1)).toBeGreaterThan(0.2)
  })
})

describe('the rhythm', () => {
  it('lays 0.1-10 Hz out on a log axis: every decade the same width', () => {
    expect(freqToX(0.1, 600)).toBeCloseTo(0)
    expect(freqToX(1, 600)).toBeCloseTo(300)
    expect(freqToX(10, 600)).toBeCloseTo(600)
    expect(freqToX(2, 600) - freqToX(1, 600)).toBeCloseTo(freqToX(0.4, 600) - freqToX(0.2, 600))
    for (const f of [0.15, 0.7, 3.3, 9]) expect(xToFreq(freqToX(f, 480), 480)).toBeCloseTo(f, 6)
  })
  it('gives breathing room: 0.1-0.5 Hz gets a third of the width, not 4 %', () => {
    expect(freqToX(0.5, 100) - freqToX(0.1, 100)).toBeGreaterThan(30)
  })
  it('maps the spectrum to points top-down, clamped, skipping what is off the axis', () => {
    const hz = [0.05, 0.156, 1.5, 10, 12]
    const power = [5, 0, 2, -0.2, 9]
    const pts = spectrumPoints(hz, power, 640, 100, [-0.4, 2.4])
    expect(pts).toHaveLength(3)
    expect(pts[0].x).toBeCloseTo(freqToX(0.156, 640))
    expect(pts[1].y).toBeLessThan(pts[0].y)               // more power is higher on screen
    for (const p of pts) { expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(100) }
  })
  it('keeps at least 100x of headroom, grows with a strong peak, and stops at 10^4', () => {
    expect(powerRange([0, 0.2, 0.1])).toEqual([-0.4, 2])
    expect(powerRange([0, 3])[1]).toBeCloseTo(3.35)
    expect(powerRange([7])[1]).toBe(4)
  })
  it('draws a smooth path through every point without overshooting the plot', () => {
    const pts = [{ x: 0, y: 90 }, { x: 10, y: 2 }, { x: 20, y: 95 }, { x: 30, y: 0 }]
    const d = smoothPath(pts, 100)
    expect(d.startsWith('M0.0 90.0')).toBe(true)
    for (const p of pts.slice(1)) expect(d).toContain(`${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    const ys = [...d.matchAll(/C[\d.]+ ([\d.-]+) [\d.]+ ([\d.-]+)/g)].flatMap((m) => [Number(m[1]), Number(m[2])])
    for (const y of ys) { expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(100) }
    expect(smoothPath([], 10)).toBe('')
  })
  it('names what moves at a speed, and admits the overlap', () => {
    expect(bandsAt(0.25)).toEqual(['breathing'])
    expect(bandsAt(1.5).sort()).toEqual(['walking', 'waving'])
    expect(bandsAt(2.5)).toEqual(['waving'])
    expect(bandsAt(6)).toEqual(['typing'])
    expect(bandsAt(0.7)).toEqual([])
    expect(bandsAt(null)).toEqual([])
    expect(ACTIVITY_BANDS.every((b) => b.lo < b.hi)).toBe(true)
  })
  it('says a rhythm in hertz and per minute', () => {
    expect(fmtRhythm(1.5)).toEqual({ hz: '1.50', perMin: '90' })
    expect(fmtRhythm(0.25)).toEqual({ hz: '0.25', perMin: '15' })
    expect(fmtRhythm(null)).toBeNull()
  })
})

describe('the scroll clock', () => {
  /** Columns every ~100 ms with +-30 ms jitter, drawn at 60 fps. */
  function run(seconds: number, jitter = 30, seed = 7) {
    let s = seed
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    const c = newClock()
    const frames: { pos: number; count: number }[] = []
    let next = 100, t = 0
    while (t < seconds * 1000) {
      t += 1000 / 60
      while (t >= next) { clockArrive(c, next); next += 100 + (rnd() * 2 - 1) * jitter }
      frames.push({ pos: clockStep(c, t, 1000 / 60), count: c.count })
    }
    return { c, frames }
  }
  it('moves smoothly forward and never shows a column that has not arrived', () => {
    const { frames } = run(8)
    for (let i = 1; i < frames.length; i++) {
      if (frames[i - 1].count === 0) continue            // nothing had arrived yet
      expect(frames[i].pos).toBeGreaterThanOrEqual(frames[i - 1].pos - 1e-9)
      expect(frames[i].pos).toBeLessThanOrEqual(frames[i].count - 0.5 + 1e-9)
      expect(frames[i].pos - frames[i - 1].pos).toBeLessThan(0.45)    // no visible jumps
    }
  })
  it('trails the newest column by about LAG once settled', () => {
    const { frames } = run(10)
    const late = frames.slice(-200).map((f) => f.count - f.pos)
    const mean = late.reduce((a, b) => a + b, 0) / late.length
    expect(mean).toBeGreaterThan(0.5)
    expect(mean).toBeLessThan(LAG + 1)
  })
  it('stops at the newest column when the stream stops', () => {
    const c = newClock()
    for (let i = 1; i <= 30; i++) clockArrive(c, i * 100)
    let pos = 0
    for (let t = 3000; t < 6000; t += 16) pos = clockStep(c, t, 16)
    expect(pos).toBeCloseTo(c.count - 0.5)
  })
})

describe('the body', () => {
  const L = (state: string, act?: string, p = 0.8, ap = 0.6): LearnedLike => ({
    state, p: { [state]: p }, activity: act ? { state: act, p: { [act]: ap } } : null,
  })
  const cases: [LearnedLike, Pose][] = [
    [L('desk', 'typing'), 'typing'],
    [L('desk', 'still'), 'seated'],
    [L('bed', 'still'), 'lying'],
    [L('bed', 'waving'), 'lying-wave'],
    [L('room', 'waving'), 'waving'],
    [L('desk', 'waving'), 'waving'],
    [L('room', 'walking'), 'walking'],
    [L('room', 'still'), 'standing'],
    [L('room'), 'standing'],
    [L('outside', 'none'), 'away'],
    [L('empty', 'still'), 'away'],
    [L('room', 'none'), 'away'],
  ]
  it.each(cases)('poses %j as %s', (l, pose) => {
    expect(readBody(l).pose).toBe(pose)
  })
  it('says where in words, with the estimate’s probability', () => {
    const b = readBody(L('desk', 'typing', 0.72, 0.55))
    expect(b.zoneText).toBe('at the desk')
    expect(b.zoneP).toBeCloseTo(0.72)
    expect(b.actText).toBe('typing')
    expect(b.actP).toBeCloseTo(0.55)
    expect(readBody(L('outside', 'none')).actText).toBe('not in the room')
    expect(readBody(L('empty')).zoneText).toBe('room empty')
  })
  it('says plainly when there is no model at all', () => {
    const b = readBody(null)
    expect(b.pose).toBe('unknown')
    expect(b.zoneText).toMatch(/no trained model/)
    expect(b.zoneP).toBeNull()
  })
  it('has a complete, finite pose for every reading, shaped as the activity', () => {
    for (const [name, g] of Object.entries(POSES)) {
      for (const v of Object.values(g)) if (typeof v === 'number') expect(Number.isFinite(v), name).toBe(true)
    }
    expect(POSES.seated.thigh).toBeLessThan(0.5)          // thighs toward me: shortened
    expect(POSES.seated.drop).toBeGreaterThan(0)          // on the seat
    expect(POSES.typing.desk).toBe(true)                  // hands at desk height
    expect(POSES.typing.foreL).toBeLessThan(1)
    expect(POSES.waving.shR).toBeLessThan(-90)            // the right arm is up
    expect(POSES.lying.tilt).toBe(-90)
    expect(POSES.lying.bed).toBe(true)
    expect(POSES.standing.tilt).toBe(0)
  })
})

describe('what I see right now', () => {
  it('prefers the movement agent’s own words, still marked as an estimate', () => {
    const s = seeSentence({ staffSummary: 'Aman is typing at the desk', learned: { state: 'bed', p: { bed: 1 } } })
    expect(s).toEqual({ text: 'Aman is typing at the desk', estimate: true, from: 'staff' })
  })
  it('falls back to the models, then to presence, then says there is nothing', () => {
    expect(seeSentence({ learned: { state: 'desk', p: { desk: 0.9 }, activity: { state: 'typing', p: { typing: 0.7 } } } }))
      .toEqual({ text: 'At the desk, typing', estimate: true, from: 'model' })
    expect(seeSentence({ learned: { state: 'outside', p: { outside: 0.9 } } }).text).toMatch(/^Outside the room/)
    expect(seeSentence({ presence: { state: 'occupied', count: 1 } }).text).toBe('Room occupied · 1 person')
    expect(seeSentence({ staffSummary: '   ' }).from).toBe('none')
    expect(seeSentence({}).estimate).toBe(false)
  })
})
