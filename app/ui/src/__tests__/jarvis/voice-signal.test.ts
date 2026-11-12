// The signal ring (spec 9.3, 9.8): smoothing on ingest, staleness, final, drops, interpolation and the latency shift.
import { describe, expect, it } from 'vitest'
import { VoiceSignal, attachVoiceFeed, parseFrame } from '../../jarvis/voice/signal'
import { N_BANDS, STALE_MS } from '../../jarvis/voice/constants'
import { flat, frame, speechRow } from './voice-helpers'

const feed = (s: VoiceSignal, ch: 'in' | 'out', start: number, n: number, bands: number[], step = 50, seq0 = 0) => {
  for (let i = 0; i < n; i++) s.ingest(frame(ch, start + i * step, bands, { seq: seq0 + i }))
}

describe('smoothing (V-07)', () => {
  it('a step gives 0.713 of the step after one 50 ms frame (attack) and loses 0.268 of the gap per frame on release, within 0.001', () => {
    const s = new VoiceSignal()
    s.ingest(frame('out', 1000, flat(0)))
    s.ingest(frame('out', 1050, flat(200)))
    expect(s.latest('out')!.smooth![5] / 200).toBeCloseTo(0.713, 3)
    const s2 = new VoiceSignal()
    s2.ingest(frame('out', 1000, flat(200)))
    s2.ingest(frame('out', 1050, flat(0)))
    expect(1 - s2.latest('out')!.smooth![5] / 200).toBeCloseTo(0.268, 3)
  })

  it('V-05: a constant input gives identical smoothed rows for 50 frames (no idle jitter), and the same sequence twice is byte-identical', () => {
    const run = () => {
      const s = new VoiceSignal()
      const rows: string[] = []
      for (let i = 0; i < 50; i++) {
        s.ingest(frame('in', 1000 + i * 50, speechRow()))
        rows.push(Array.from(s.latest('in')!.smooth!).join(','))
      }
      return rows
    }
    const a = run()
    expect(new Set(a).size).toBe(1)
    expect(run()).toEqual(a)
  })

  it('a new stream starts at its first real value instead of rising from a made-up zero', () => {
    const s = new VoiceSignal()
    s.ingest(frame('out', 1000, flat(180)))
    expect(s.latest('out')!.smooth![0]).toBe(180)
  })
})

describe('staleness, final and drops (V-08)', () => {
  it('is fresh at 399 ms and 400 ms and stale at 401 ms', () => {
    const s = new VoiceSignal()
    s.ingest(frame('in', 5000, flat(10)))
    expect(s.view('in', 5399).fresh).toBe(true)
    expect(s.view('in', 5000 + STALE_MS).fresh).toBe(true)
    expect(s.view('in', 5401).fresh).toBe(false)
  })

  it('no frame at all is never fresh, and says so', () => {
    const s = new VoiceSignal()
    const v = s.view('out', 1e9)
    expect(v.hasFrame).toBe(false)
    expect(v.fresh).toBe(false)
    expect(s.sampleBands('out', 1e9)).toBeNull()
  })

  it('a final frame drops to the floor on the same tick: not fresh, no bands to draw, smoothing restarted', () => {
    const s = new VoiceSignal()
    feed(s, 'out', 1000, 5, flat(200))
    expect(s.sampleBands('out', 1300)).not.toBeNull()
    s.ingest(frame('out', 1250, flat(0), { final: true }))
    expect(s.view('out', 1250).final).toBe(true)
    expect(s.view('out', 1250).fresh).toBe(false)
    expect(s.sampleBands('out', 1260)).toBeNull()
    // the next sentence does not blend with the last word's shape
    s.ingest(frame('out', 2000, flat(40)))
    expect(s.latest('out')!.smooth![3]).toBe(40)
  })

  it('counts frames lost to seq gaps', () => {
    const s = new VoiceSignal()
    s.ingest(frame('out', 1000, flat(1), { seq: 1 }))
    s.ingest(frame('out', 1150, flat(1), { seq: 4 }))
    expect(s.dropped).toBe(2)
  })
})

describe('reading frames (9.2) and the bus feed', () => {
  const ok = { kind: 'out_level', t: 10, seq: 1, sr: 24000, rms_db: -20, peak_db: -15, bands: Array(24).fill(100), lat_ms: 90, final: false }
  it('parses an out_level event and keeps latency only when the stream reported one', () => {
    const f = parseFrame(ok, 1)!
    expect(f.channel).toBe('out')
    expect(f.latMs).toBe(90)
    expect(parseFrame({ ...ok, lat_ms: null }, 1)!.latMs).toBeNull()
    expect(parseFrame({ ...ok, lat_ms: -5 }, 1)!.latMs).toBeNull()
  })
  it('rejects malformed frames instead of guessing: wrong band count, non-numbers, unknown kinds, null', () => {
    expect(parseFrame({ ...ok, bands: [1, 2, 3] }, 1)).toBeNull()
    expect(parseFrame({ ...ok, bands: Array(24).fill('x') }, 1)).toBeNull()
    expect(parseFrame({ kind: 'turn' }, 1)).toBeNull()
    expect(parseFrame({ kind: 'out_level' }, 1)).toBeNull()
    expect(parseFrame(null, 1)).toBeNull()
    expect(parseFrame('x', 1)).toBeNull()
  })
  it('clamps and rounds bands to 0..255', () => {
    const f = parseFrame({ ...ok, bands: Array.from({ length: 24 }, (_, i) => (i === 0 ? 300 : i === 1 ? -4 : 12.6)) }, 1)!
    expect(f.bands![0]).toBe(255)
    expect(f.bands![1]).toBe(0)
    expect(f.bands![2]).toBe(13)
  })
  it('reads the legacy scalar level as a tier-0 input frame with no bands', () => {
    const f = parseFrame({ kind: 'level', level: 3.2, threshold: 0.04 }, 5)!
    expect(f.channel).toBe('in')
    expect(f.bands).toBeNull()
    expect(f.level).toBe(3.2)
  })
  it('attachVoiceFeed routes events to the signal with the caller clock, and returns an unsubscribe', () => {
    const s = new VoiceSignal()
    let handler: ((ev: unknown) => void) | null = null
    const off = attachVoiceFeed(
      s,
      (h) => {
        handler = h
        return () => {
          handler = null
        }
      },
      () => 777,
    )
    handler!(ok)
    handler!({ kind: 'noise' })
    expect(s.latest('out')!.arrival).toBe(777)
    expect(s.received).toBe(1)
    off()
    expect(handler).toBeNull()
  })
  it('subscribers are told on ingest and can leave', () => {
    const s = new VoiceSignal()
    let n = 0
    const off = s.subscribe(() => n++)
    s.ingest(frame('in', 1, flat(1)))
    off()
    s.ingest(frame('in', 2, flat(1)))
    expect(n).toBe(1)
  })
})

describe('interpolation and latency (9.8)', () => {
  it('shows a frame no earlier than t + lat_ms: audibleAt = max(arrival, t + lat)', () => {
    const s = new VoiceSignal()
    s.ingest(frame('out', 1000, flat(100), { t: 1.0, latMs: 90 }))
    expect(s.latest('out')!.audibleAt).toBe(1090)
    expect(s.sampleBands('out', 1050)).toBeNull() // arrived, not yet audible
    expect(s.sampleBands('out', 1100)).not.toBeNull()
  })
  it('never invents a latency: with none reported, a frame is shown on arrival', () => {
    const s = new VoiceSignal()
    s.ingest(frame('out', 1000, flat(100), { latMs: null }))
    expect(s.latest('out')!.audibleAt).toBe(1000)
  })
  it('interpolates between the two real frames around now - 50 ms, and never extrapolates past the newest', () => {
    const s = new VoiceSignal()
    s.ingest(frame('in', 1000, flat(0), { seq: 0 }))
    s.ingest(frame('in', 1050, flat(100), { seq: 1 })) // smoothed: 0.713 * 100
    const target = s.latest('in')!.smooth![0]
    const mid = s.sampleBands('in', 1075)![0] // render time 1025: halfway between the frames
    expect(mid).toBeCloseTo(target / 2, 3)
    expect(s.sampleBands('in', 1100)![0]).toBeCloseTo(target, 5) // reached the newest
    expect(s.sampleBands('in', 5000)![0]).toBeCloseTo(target, 5) // far later: the newest, not more
  })
  it('history rows with no real frame near their time are absent, never filled in', () => {
    const s = new VoiceSignal()
    feed(s, 'in', 1000, 3, flat(120)) // 100 ms of stream only
    const rows = s.historyBands('in', 1100, 100, 8)
    expect(rows[0]).not.toBeNull()
    expect(rows[1]).not.toBeNull() // the frame at 1000
    for (let j = 2; j < 8; j++) expect(rows[j]).toBeNull()
  })
  it('rates: 20 Hz from the arrival spacing, null with no frames', () => {
    const s = new VoiceSignal()
    feed(s, 'out', 0, 10, flat(5))
    expect(s.rateHz('out')).toBe(20)
    expect(s.rateHz('in')).toBeNull()
  })
  it('a view of the legacy scalar has no bands and keeps the samples for the envelope', () => {
    const s = new VoiceSignal()
    s.ingest(frame('in', 1000, null, { level: 1.5 }))
    s.ingest(frame('in', 1080, null, { level: 2.5 }))
    expect(s.view('in', 1100).hasBands).toBe(false)
    expect(s.scalarHistory('in', 1100)).toEqual([
      [1000, 1.5],
      [1080, 2.5],
    ])
    expect(N_BANDS).toBe(24)
  })
})
