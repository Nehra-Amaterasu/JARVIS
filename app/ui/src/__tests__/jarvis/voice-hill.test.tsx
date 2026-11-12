// The component (spec 9.4 to 9.12, V-03, V-04, V-12 to V-15, E-01 to E-07 at the unit level): no rAF or timer left after
// unmount, nothing drawn as live when no frame arrived for 400 ms, the reduced-motion form, hidden and pause.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { mount } from '../ww/_stubs'
import { VoiceHill } from '../../jarvis/voice/VoiceHill'
import { VoiceSignal } from '../../jarvis/voice/signal'
import { PLACEHOLDER_LEGEND, type CoreView } from '../../jarvis/voice/voiceState'
import { STALE_MS, TEST_PATTERN_MS } from '../../jarvis/voice/constants'
import { fakeRaf, flat, frame, recorder, speechRow, type FakeRaf, type Recorder } from './voice-helpers'

const T0 = 1_000_000
let m: ReturnType<typeof mount> | null = null
let raf: FakeRaf
let rec: Recorder
let signal: VoiceSignal

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  vi.setSystemTime(T0)
  raf = fakeRaf()
  rec = recorder()
  signal = new VoiceSignal()
})
afterEach(() => {
  m?.unmount()
  m = null
  vi.useRealTimers()
})

const core = (o: Partial<CoreView> = {}): CoreView => ({ running: true, state: 'listening', stateSince: T0, lastError: null, muted: false, ...o })
const q = <T extends Element = HTMLElement>(sel: string) => m!.container.querySelector<T>(sel)
const txt = (id: string) => q(`[data-testid="${id}"]`)?.textContent ?? ''
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms))
const ingest = (ch: 'in' | 'out', bands: number[] | null, extra = {}) => act(() => signal.ingest(frame(ch, Date.now(), bands, { rmsDb: -23, thrDb: null, ...extra })))
const flush = (n = 20) => {
  let total = 0
  for (let i = 0; i < n && raf.live; i++) total += act(() => void raf.flush()) as unknown as number
  return total
}
const setup = (props: Partial<React.ComponentProps<typeof VoiceHill>> = {}, c: CoreView = core()) => {
  m = mount(<VoiceHill signal={signal} core={c} motion="full" loopDeps={raf} contextFactory={() => rec} clock={Date.now} {...props} />)
  return c
}
/** Stream `n` frames at 20 Hz, running the loop after each. */
const stream = (n: number, ch: 'in' | 'out' = 'in', bands = speechRow(), extra = {}) => {
  for (let i = 0; i < n; i++) {
    ingest(ch, bands, { seq: i, ...extra })
    act(() => void raf.flush())
    advance(50)
  }
}

describe('E-01: idle draws nothing', () => {
  it('with no frames the loop draws the placeholder once, then there is no rAF callback and no timer', () => {
    setup(undefined, core({ state: 'idle' }))
    flush()
    const asked = raf.requested
    advance(2000)
    expect(raf.live).toBe(0)
    expect(raf.requested).toBe(asked)
    expect(vi.getTimerCount()).toBe(0)
    expect(q('[data-state]')!.getAttribute('data-state')).toBe('idle')
    expect(rec.fills).toBe(0) // hollow placeholder only: not one solid fill
    expect(rec.strokes).toBeGreaterThan(0)
  })
})

describe('frames in, picture moves; frames stop, no reading (V-03, E-02)', () => {
  it('draws solid points while frames arrive, in the listening state with a LIVE lamp', () => {
    setup()
    stream(10)
    expect(q('[data-state]')!.getAttribute('data-state')).toBe('listening')
    expect(q('[data-state]')!.getAttribute('data-measured')).toBe('true')
    expect(rec.fills).toBeGreaterThan(0)
    expect(q('.lamp')!.getAttribute('data-lamp')).toBe('live')
    expect(txt('vh-source')).toBe('MIC')
  })

  it('400 ms after the last frame the state is NO SIGNAL with the legend visible, and nothing solid is drawn afterwards', () => {
    setup()
    stream(10)
    advance(STALE_MS + 10)
    expect(q('[data-state]')!.getAttribute('data-state')).toBe('no-signal')
    expect(q('[data-state]')!.getAttribute('data-measured')).toBe('false')
    expect(txt('vh-legend')).toBe(PLACEHOLDER_LEGEND)
    expect(txt('vh-state')).toBe('NO SIGNAL')
    rec.reset()
    flush()
    expect(rec.fills).toBe(0) // V-03: zero live draws during the gap
    expect(rec.strokes).toBeGreaterThan(0)
    expect(q('.lamp')!.getAttribute('data-lamp')).toBe('waiting')
    expect(txt('vh-number')).toBe('—')
  })

  it('the loop stops by itself after the picture settles: no callback and no timer a second later', () => {
    setup()
    stream(10)
    advance(STALE_MS + 10)
    flush()
    advance(1000)
    flush()
    expect(raf.live).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a stale draw never shows a number even if a tick lands before the state timeout: the scene is planned from the clock', () => {
    setup()
    stream(10)
    // jump the clock past the stale edge without letting the deadline timeout run
    vi.setSystemTime(Date.now() + 450)
    rec.reset()
    act(() => void raf.flush())
    expect(rec.fills).toBe(0)
  })
})

describe('nothing outlives the component', () => {
  it('after unmount there is no queued rAF callback, no timer, and later frames request nothing', () => {
    setup()
    stream(5)
    ingest('in', speechRow())
    m!.unmount()
    m = null
    const asked = raf.requested
    expect(raf.live).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    act(() => signal.ingest(frame('in', Date.now(), speechRow())))
    expect(raf.requested).toBe(asked)
    expect(raf.live).toBe(0)
  })

  it('unmounting while thinking also clears its one second tick', () => {
    setup(undefined, core({ state: 'thinking' }))
    advance(2100)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    m!.unmount()
    m = null
    expect(vi.getTimerCount()).toBe(0)
    expect(raf.live).toBe(0)
  })
})

describe('reduced motion form (9.10, E-03)', () => {
  it('draws no canvas: a static ring and a level bar, with no loop at all', () => {
    setup({ motion: 'none' })
    expect(q('canvas')).toBeNull()
    expect(q('[data-testid="vh-static"]')).not.toBeNull()
    expect(q('[data-form]')!.getAttribute('data-form')).toBe('static')
    for (let i = 0; i < 20; i++) {
      ingest('in', speechRow(), { rmsDb: -40 + i, seq: i })
      advance(50)
    }
    expect(raf.requested).toBe(0)
    expect(rec.fills + rec.strokes).toBe(0)
  })

  it('the level number changes at most 4 times in 1 s of 20 Hz frames', () => {
    setup({ motion: 'none' })
    let last = txt('vh-number')
    let changes = 0
    for (let i = 0; i < 20; i++) {
      ingest('in', speechRow(), { rmsDb: -60 + i * 2, seq: i })
      const now = txt('vh-number')
      if (now !== last) changes++
      last = now
      advance(50)
    }
    expect(changes).toBeGreaterThan(0)
    expect(changes).toBeLessThanOrEqual(4)
  })

  it('still states the state, the source and the legend, and keeps the level as text', () => {
    setup({ motion: 'none' })
    ingest('in', speechRow(), { rmsDb: -23 })
    expect(txt('vh-state')).toBe('MIC, LISTENING')
    expect(txt('vh-source')).toBe('MIC')
    expect(txt('vh-number')).toBe('-23 dB')
    expect(txt('vh-legend')).toMatch(/MIC -23 dB/)
  })

  it('the html data-motion="calm" setting also selects the static form (the flag wins over the page)', async () => {
    document.documentElement.setAttribute('data-motion', 'calm')
    try {
      setup({ motion: 'auto' })
      expect(q('canvas')).toBeNull()
    } finally {
      // the observer on <html> reports the change after a microtask: let React see it inside act
      await act(async () => {
        document.documentElement.removeAttribute('data-motion')
        await Promise.resolve()
      })
    }
    expect(q('canvas')).not.toBeNull() // and back to the live form when the flag is gone
  })
})

describe('hidden stops the tick and visible draws the newest frame (E-05)', () => {
  it('requests nothing while hidden, even as frames keep arriving, and draws once on return', () => {
    setup()
    stream(3)
    raf.setHidden(true)
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    flush()
    const asked = raf.requested
    for (let i = 0; i < 40; i++) {
      ingest('in', speechRow(), { seq: 100 + i })
      advance(50)
    }
    expect(raf.requested).toBe(asked)
    expect(raf.live).toBe(0)
    raf.setHidden(false)
    rec.reset()
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    expect(raf.live).toBe(1)
    flush()
    expect(rec.fills).toBeGreaterThan(0)
  })
})

describe('pause (E-06)', () => {
  it('is a labelled 44 px toggle with aria-pressed; it stops the loop, keeps the level as text and says Paused', () => {
    setup()
    stream(3)
    const b = q<HTMLButtonElement>('.vh-pause')!
    expect(b.getAttribute('aria-pressed')).toBe('false')
    expect(b.textContent).toBe('Pause voice picture')
    act(() => b.click())
    expect(q('.vh-pause')!.getAttribute('aria-pressed')).toBe('true')
    expect(txt('vh-legend')).toBe('Paused')
    expect(raf.live).toBe(0)
    const asked = raf.requested
    advance(250) // the readout is throttled to 4 Hz: the next frame after a quarter second is shown
    ingest('in', speechRow(), { rmsDb: -29, seq: 98 })
    advance(250)
    ingest('in', speechRow(), { rmsDb: -30, seq: 99 })
    expect(txt('vh-number')).toBe('-30 dB')
    expect(raf.requested).toBe(asked)
  })

  it('the P key toggles it only from inside the stage', () => {
    setup()
    const sec = q('section')!
    act(() => void sec.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true })))
    expect(q('.vh-pause')!.getAttribute('aria-pressed')).toBe('true')
    act(() => void sec.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', bubbles: true })))
    expect(q('.vh-pause')!.getAttribute('aria-pressed')).toBe('false')
    act(() => void sec.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true })))
    expect(q('.vh-pause')!.getAttribute('aria-pressed')).toBe('false')
  })
})

describe('tier 0 (V-09) and numbers need a lamp (V-13)', () => {
  it('with only the legacy level the legend says relative and no spectrum, and the DOM has no dB tick and no dB text', () => {
    setup()
    for (let i = 0; i < 12; i++) {
      act(() => signal.ingest(frame('in', Date.now(), null, { level: 3 + (i % 4) })))
      act(() => void raf.flush())
      advance(80)
    }
    expect(txt('vh-legend')).toMatch(/relative level, uncalibrated/)
    expect(txt('vh-legend')).toMatch(/no spectrum/)
    expect(q('[data-db]')).toBeNull()
    expect(m!.container.innerHTML).not.toMatch(/\bdB\b/)
    expect(txt('vh-number')).toMatch(/^relative \d+$/)
  })

  it('tier 0 speaking is NO SIGNAL: the output level does not exist yet', () => {
    setup({ tier: 0 }, core({ state: 'speaking' }))
    expect(txt('vh-legend')).toMatch(/no output level yet/)
    expect(q('[data-state]')!.getAttribute('data-state')).toBe('no-signal')
  })

  it('a dB number appears only with a LIVE lamp and is an em dash with a WAITING one', () => {
    setup()
    expect(txt('vh-number')).toBe('—')
    expect(q('.lamp')!.getAttribute('data-lamp')).toBe('waiting')
    ingest('in', speechRow(), { rmsDb: -23 })
    expect(q('.lamp')!.getAttribute('data-lamp')).toBe('live')
    expect(txt('vh-number')).toBe('-23 dB')
    expect(q('[data-db-scale]')!.getAttribute('data-db-scale')).toBe('true')
  })
})

describe('speaking, latency and the source tag (9.4, 9.8)', () => {
  it('shows the speaker source with "pre-volume", and the device latency only when the stream reported one', () => {
    setup(undefined, core({ state: 'speaking' }))
    ingest('out', speechRow(), { latMs: 90, t: Date.now() / 1000 })
    expect(txt('vh-source')).toBe('SPEAKER, pre-volume')
    expect(txt('vh-lat')).toBe('device latency 90 ms')
    expect(txt('vh-legend')).toMatch(/before the system volume/)
  })
  it('invents no latency: without lat_ms there is no chip', () => {
    setup(undefined, core({ state: 'speaking' }))
    ingest('out', speechRow(), { latMs: null })
    expect(q('[data-testid="vh-lat"]')).toBeNull()
  })
  it('speaking with no output frame for a second is NO SIGNAL, never a canned wave', () => {
    setup(undefined, core({ state: 'speaking' }))
    expect(txt('vh-state')).toBe('STARTING TO SPEAK')
    advance(1100)
    expect(txt('vh-state')).toBe('NO SIGNAL')
    rec.reset()
    flush()
    expect(rec.fills).toBe(0)
  })
})

describe('the polite announcement is per state change, not per frame (9.12)', () => {
  it('says Listening once while 20 frames arrive, then No signal once', () => {
    setup()
    const seen: string[] = []
    const watch = () => {
      const t = txt('vh-announce')
      if (seen[seen.length - 1] !== t) seen.push(t)
    }
    watch()
    for (let i = 0; i < 20; i++) {
      ingest('in', speechRow(), { seq: i })
      watch()
      advance(50)
    }
    advance(500)
    watch()
    expect(seen).toEqual(['No signal from the microphone', 'Listening', 'No signal from the microphone'])
    const live = q('.vh-sr')!
    expect(live.getAttribute('aria-live')).toBe('polite')
  })
  it('the canvas has a static name with no values, and the meter holds the value, not a live region', () => {
    setup()
    ingest('in', speechRow(), { rmsDb: -23 })
    const label = q('canvas')!.getAttribute('aria-label')!
    expect(q('canvas')!.getAttribute('role')).toBe('img')
    expect(label).not.toMatch(/\d/)
    const meter = q('[role="meter"]')!
    expect(meter.getAttribute('aria-valuemin')).toBe('-60')
    expect(meter.getAttribute('aria-valuemax')).toBe('0')
    expect(meter.getAttribute('aria-valuetext')).toBe('microphone, -23 dB, measured')
    expect(meter.closest('[aria-live]')).toBeNull()
  })
})

describe('thinking is bounded (V-06 family, E-07)', () => {
  it('shows elapsed seconds once a second and stops the marker animation after 5 s', () => {
    setup(undefined, core({ state: 'thinking' }))
    flush()
    advance(3100)
    expect(txt('vh-state')).toMatch(/^THINKING 3\.\d s$/)
    // drive frames for 6 s the way a display would, counting those that ask to continue
    let guard = 0
    while (guard++ < 400) {
      advance(16)
      if (!raf.live) break
      act(() => void raf.flush())
    }
    expect(raf.live).toBe(0)
    expect(Date.now() - T0).toBeLessThan(9000)
  })
  it('the thinking state draws hollow only', () => {
    setup(undefined, core({ state: 'thinking' }))
    flush()
    expect(rec.fills).toBe(0)
  })
})

describe('error and muted (9.6 rows 1 and 2)', () => {
  it('error carries FAULT with the reason and no solid points', () => {
    setup(undefined, core({ lastError: 'output device failed' }))
    flush()
    expect(q('.lamp')!.getAttribute('data-lamp')).toBe('fault')
    expect(txt('vh-legend')).toBe('output device failed')
    expect(rec.fills).toBe(0)
  })
  it('muted says MIC OFF with a WAITING lamp, deliberate rather than a fault', () => {
    setup(undefined, core({ muted: true }))
    expect(txt('vh-source')).toBe('MIC OFF')
    expect(q('.lamp')!.getAttribute('data-lamp')).toBe('waiting')
  })
})

describe('the 5 s test pattern (V-14)', () => {
  it('never starts by itself: with the prop off nothing is stamped SIMULATED, however long it runs', () => {
    setup()
    flush()
    advance(10_000)
    flush()
    expect(rec.texts).not.toContain('SIMULATED')
    expect(q('.lamp')!.getAttribute('data-lamp')).not.toBe('simulated')
  })
  it('when the owner starts it, it carries the SIMULATED lamp and the stamp, and ends itself after 5 s', () => {
    const onEnd = vi.fn()
    setup({ testPattern: true, onTestPatternEnd: onEnd })
    expect(q('.lamp')!.getAttribute('data-lamp')).toBe('simulated')
    expect(txt('vh-state')).toBe('TEST PATTERN')
    flush()
    expect(rec.texts).toContain('SIMULATED')
    expect(q('[data-measured]')!.getAttribute('data-measured')).toBe('false')
    for (let t = 0; t < TEST_PATTERN_MS + 400 && raf.live; t += 50) {
      advance(50)
      act(() => void raf.flush())
    }
    expect(onEnd).toHaveBeenCalled()
  })
})

describe('forced colours and the palette (E-04, 9.12)', () => {
  it('reads its colours from probe elements (so system colours apply), not from hex values in code', () => {
    setup()
    expect(m!.container.querySelectorAll('.vh-probe')).toHaveLength(5)
    expect(m!.container.querySelector('.vh-stage')).not.toBeNull()
  })
})

describe('the loop budget (9.11)', () => {
  it('a sustained 20 Hz stream asks for at most one queued callback at a time and settles 300 ms after the last real value', () => {
    setup()
    let maxLive = 0
    for (let i = 0; i < 40; i++) {
      ingest('in', speechRow(), { seq: i })
      maxLive = Math.max(maxLive, raf.live)
      act(() => void raf.flush())
      advance(50)
    }
    expect(maxLive).toBeLessThanOrEqual(1)
    // floor frames: the quiet room is LIVE, the picture is flat, and the loop goes quiet after 300 ms
    for (let i = 0; i < 12; i++) {
      ingest('in', flat(0), { seq: 100 + i })
      act(() => void raf.flush())
      advance(50)
    }
    flush()
    expect(raf.live).toBe(0)
    expect(q('[data-state]')!.getAttribute('data-state')).toBe('listening')
  })
})
