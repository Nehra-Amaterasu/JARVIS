// Plan 8.3: the reduced-motion and motion tests. Token resolution comes from the CSS files
// (_css.ts applies the cascade); the behaviour tests run the real helpers under happy-dom.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, useEffect } from 'react'
import { act } from 'react'
import { WW_DIR, computeTokens, cssFiles, designFilesInOrder, parseCss, read, stripComments } from './_css'
import { mount, resetHtml, setHtml, stubMatchMedia } from './_stubs'
import { Ticker, switchView, useSpring } from '../../lib/motion'
import { isReducedMotion, motionMode, useReducedMotion } from '../../ww/useReducedMotion'
import { ARRIVE_CAP_SCROLL, ARRIVE_CAP_SWITCH, MAX_WILL_CHANGE, STAGGER_MS, STAGGER_TOTAL_MAX_MS, staggerSlot } from '../../ww/design/motion/reveal'
import { Glide, V_CAP, decay, glideBudget, releaseVelocity, rubberBand } from '../../ww/design/motion/glide'
import { HOLD_MS, createHold } from '../../ww/design/motion/hold'
import { runSwitch } from '../../ww/design/motion/transition'
import { motionLoad } from '../../ww/design/motion/governor'
import { FrameSampler, clampTier, p5FromGaps } from '../../lib/liquidGlass'

const allCss = designFilesInOrder().map(read).join('\n')
const wwCss = cssFiles(WW_DIR).map((f) => ({ f, text: read(f) }))
const tokens = (html: Record<string, string>, osReduce = false) => computeTokens(allCss, { html, osReduce }, 'root')
const ms = (v: string) => Number(v.replace('ms', ''))

afterEach(() => resetHtml())

describe('the CSS names only allowed properties and token durations', () => {
  const ALLOWED = new Set(['transform', 'opacity', 'clip-path', 'background-color', 'border-color', 'color', 'offset', 'easing', 'composite'])
  const keyframes = wwCss.flatMap(({ f, text }) => parseCss(text).keyframes.map((k) => ({ f, ...k })))
  it('there are keyframes to check', () => expect(keyframes.length).toBeGreaterThan(8))
  it('every @keyframes in ww CSS animates only transform and opacity (plus clip-path and paint-only colour)', () => {
    for (const k of keyframes) {
      for (const m of k.body.matchAll(/([\w-]+)\s*:/g)) {
        const prop = m[1]
        if (/^(from|to|\d+%)$/.test(prop)) continue
        expect(ALLOWED.has(prop), `${k.name}: ${prop}`).toBe(true)
      }
    }
  })
  it('every transition-property list names only allowed properties; colour transitions run 160 ms or less', () => {
    const t = tokens({})
    for (const { f, text } of wwCss) {
      for (const m of stripComments(text).matchAll(/transition(?:-property)?\s*:\s*([^;]+);/g)) {
        for (const part of m[1].split(/,(?![^(]*\))/)) {
          const prop = part.trim().split(/\s+/)[0]
          if (!prop || prop.startsWith('var(') || prop === 'none') continue
          expect(ALLOWED.has(prop), `${f}: ${prop}`).toBe(true)
          if (/^(background-color|border-color|color)$/.test(prop)) {
            const dur = /var\((--[\w-]+)\)/.exec(part)?.[1]
            expect(dur, `${f}: ${part}`).toBeTruthy()
            expect(ms(t[dur!]), `${dur}`).toBeLessThanOrEqual(160)
          }
        }
      }
    }
  })
  it('durations come from --dur-* or --spring-*-ms only: no literal ms or s in ww CSS outside the token files', () => {
    for (const { f, text } of wwCss) {
      if (/primitive\.css$|springs\.generated\.css$|themes[\\/]/.test(f)) continue
      expect(stripComments(text), f).not.toMatch(/(^|[^\w-])\d*\.?\d+m?s\b(?!\w)/)
    }
  })
  it('no keyframe or transition outlives 400 ms: every duration token is at most 400 ms (the switch envelope is two parts)', () => {
    const t = tokens({})
    for (const [k, v] of Object.entries(t)) if (k.startsWith('--dur-') && /ms$/.test(v)) expect(ms(v), k).toBeLessThanOrEqual(400)
    expect(ms(t['--dur-switch-out']) + 120 + ms(t['--dur-switch-in'])).toBeLessThanOrEqual(700)
  })
})

describe('reduced motion at the token layer', () => {
  const COLLAPSED = ['--dur-switch-in', '--dur-travel', '--dur-celebrate', '--dur-hold']
  const FULL = tokens({})
  it('full motion keeps the plan values', () => {
    expect(ms(FULL['--dur-switch-in'])).toBe(360)
    expect(ms(FULL['--dur-travel'])).toBe(400)
    expect(FULL['--dist-rise']).toBe('12px')
    expect(FULL['--stagger']).toBe('40ms')
  })
  it('the OS flag collapses switch-in, travel, celebrate and hold to 120 ms, stagger to 0, travel to 0', () => {
    const t = tokens({}, true)
    for (const n of COLLAPSED) expect(t[n], n).toBe('120ms')
    expect(t['--stagger']).toBe('0ms')
    expect(t['--dist-rise']).toBe('0px')
    expect(t['--dist-sheet']).toBe('0%')
  })
  it('data-motion="calm" gives the same result when the OS flag is off', () => {
    const calm = tokens({ 'data-motion': 'calm' }, false)
    const os = tokens({}, true)
    for (const n of Object.keys(os).filter((k) => /^--(dur|dist|stagger|pop|press|celebrate|delay)/.test(k))) expect(calm[n], n).toBe(os[n])
  })
  it('data-motion="full" keeps travel when the OS flag is on', () => {
    const t = tokens({ 'data-motion': 'full' }, true)
    expect(t['--dist-rise']).toBe('12px')
    expect(t['--stagger']).toBe('40ms')
  })
  it('feedback survives: the 100 ms press and 160 ms state durations are untouched', () => {
    const t = tokens({ 'data-motion': 'calm' })
    expect(t['--dur-feedback']).toBe('100ms')
    expect(t['--dur-state']).toBe('160ms')
  })
  it('the two collapse blocks (OS flag, calm) declare identical tokens', () => {
    const { rules } = parseCss(read(WW_DIR + '/design/primitive.css'))
    const media = rules.filter((r) => r.media?.includes('prefers-reduced-motion'))
    const calm = rules.filter((r) => r.selectors.some((s) => s.includes("data-motion='calm'")))
    expect(media).toHaveLength(1)
    expect(calm).toHaveLength(1)
    expect(media[0].decls).toEqual(calm[0].decls)
  })
  it('the low-load governor drops stagger and shortens the switch, but never beats calm', () => {
    const low = tokens({ 'data-motion-load': 'low' })
    expect(low['--stagger']).toBe('0ms')
    expect(low['--dur-switch-in']).toBe('160ms')
    const both = tokens({ 'data-motion-load': 'low', 'data-motion': 'calm' })
    expect(both['--dur-switch-in']).toBe('120ms')
  })
  it('the pin scrub is switched off under calm and under the OS flag', () => {
    const css = read(WW_DIR + '/design/motion.css')
    expect(css).toMatch(/html\[data-motion='calm'\] \.ww-pin-title[\s\S]*?animation:\s*none/)
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*?\.ww-pin-title[\s\S]*?animation:\s*none/)
  })
})

describe('stagger and layers stay inside the budget', () => {
  it('stagger total never exceeds 240 ms at a switch or in a scrolled group', () => {
    expect(STAGGER_MS * ARRIVE_CAP_SWITCH).toBe(120)
    expect(STAGGER_MS * ARRIVE_CAP_SCROLL).toBeLessThanOrEqual(STAGGER_TOTAL_MAX_MS)
    expect(tokens({})['--stagger']).toBe(`${STAGGER_MS}ms`)
  })
  it('items past the cap share the last slot, so the delay is bounded', () => {
    expect([0, 1, 2, 3, 9].map((i) => staggerSlot(i, ARRIVE_CAP_SWITCH))).toEqual([0, 1, 2, 2, 2])
  })
  it('at most 8 elements carry will-change, and none in static CSS', () => {
    expect(MAX_WILL_CHANGE).toBe(8)
    for (const { f, text } of wwCss) expect(stripComments(text), f).not.toMatch(/will-change/)
  })
})

describe('behaviour under reduced motion (happy-dom)', () => {
  it('useReducedMotion follows the OS flag, data-motion="calm" forces it, "full" overrides it', () => {
    const restore = stubMatchMedia({ 'prefers-reduced-motion': true })
    expect(isReducedMotion()).toBe(true)
    setHtml({ 'data-motion': 'full' })
    expect(isReducedMotion()).toBe(false)
    restore()
    const restore2 = stubMatchMedia({ 'prefers-reduced-motion': false })
    expect(isReducedMotion()).toBe(false)
    setHtml({ 'data-motion': 'calm' })
    expect(isReducedMotion()).toBe(true)
    expect(motionMode()).toBe('calm')
    restore2()
  })
  it('the hook re-renders when data-motion changes', async () => {
    const restore = stubMatchMedia({ 'prefers-reduced-motion': false })
    const seen: boolean[] = []
    const C = () => {
      seen.push(useReducedMotion())
      return null
    }
    const m = mount(createElement(C))
    await act(async () => {
      setHtml({ 'data-motion': 'calm' })
      await Promise.resolve()
    })
    expect(seen[seen.length - 1]).toBe(true)
    m.unmount()
    restore()
  })
  it('useSpring returns the target in one frame and Ticker shows the final value', () => {
    const restore = stubMatchMedia({ 'prefers-reduced-motion': true })
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    const S = ({ to }: { to: number }) => {
      const v = useSpring(to)
      useEffect(() => {}, [v])
      return createElement('i', { 'data-v': v })
    }
    const m = mount(createElement('div', null, createElement(S, { to: 0 }), createElement(Ticker, { value: 0 })))
    m.render(createElement('div', null, createElement(S, { to: 100 }), createElement(Ticker, { value: 100 })))
    expect(m.container.querySelector('i')!.getAttribute('data-v')).toBe('100')
    expect(m.container.querySelector('.ticker-num')!.textContent).toBe('100')
    expect(raf).not.toHaveBeenCalled()
    m.unmount()
    raf.mockRestore()
    restore()
  })
  it('data-motion="calm" makes useSpring jump even when the OS flag is off (the resolver is registered)', () => {
    const restore = stubMatchMedia({ 'prefers-reduced-motion': false })
    setHtml({ 'data-motion': 'calm' })
    const S = ({ to }: { to: number }) => createElement('i', { 'data-v': useSpring(to) })
    const m = mount(createElement(S, { to: 1 }))
    m.render(createElement(S, { to: 50 }))
    expect(m.container.querySelector('i')!.getAttribute('data-v')).toBe('50')
    m.unmount()
    restore()
  })
  it('switchView applies the change without startViewTransition when motion is reduced', () => {
    const restore = stubMatchMedia({ 'prefers-reduced-motion': true })
    const start = vi.fn()
    ;(document as unknown as { startViewTransition: unknown }).startViewTransition = start
    const change = vi.fn()
    switchView(change)
    expect(change).toHaveBeenCalledOnce()
    expect(start).not.toHaveBeenCalled()
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition
    restore()
  })
})

describe('the workspace switch wrapper', () => {
  const withVT = () => {
    const skip = vi.fn()
    const vt = { finished: new Promise<void>(() => {}), skipTransition: skip }
    const start = vi.fn((cb: () => void) => {
      cb()
      return vt
    })
    ;(document as unknown as { startViewTransition: unknown }).startViewTransition = start
    return { start, skip }
  }
  afterEach(() => {
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition
  })
  it('uses startViewTransition when motion is on; a second switch inside 600 ms skips the first and takes the fade path', () => {
    const restore = stubMatchMedia({ 'prefers-reduced-motion': false })
    const { start, skip } = withVT()
    const a = vi.fn()
    const b = vi.fn()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-09T10:00:00Z'))
    void runSwitch(a)
    expect(start).toHaveBeenCalledOnce()
    void runSwitch(b)
    expect(skip).toHaveBeenCalledOnce()
    expect(b).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledOnce()
    vi.useRealTimers()
    restore()
  })
  it('never starts a view transition under reduced motion', async () => {
    const restore = stubMatchMedia({ 'prefers-reduced-motion': true })
    const { start } = withVT()
    const change = vi.fn()
    await runSwitch(change)
    expect(change).toHaveBeenCalledOnce()
    expect(start).not.toHaveBeenCalled()
    restore()
  })
})

describe('inertia, hold and the governor', () => {
  it('release velocity is read over 80 ms and capped at 3 px/ms', () => {
    const fast = [{ t: 0, x: 0, y: 0 }, { t: 40, x: 400, y: 0 }]
    const v = releaseVelocity(fast, 40)
    expect(Math.hypot(v.vx, v.vy)).toBeCloseTo(V_CAP, 5)
    const old = [{ t: 0, x: 0, y: 0 }, { t: 10, x: 50, y: 0 }]
    expect(releaseVelocity(old, 500)).toEqual({ vx: 0, vy: 0 })
  })
  it('a typical 2 px/ms throw rests in 406 ms; the 3 px/ms cap in 450 ms (plan 5.7.2 #4)', () => {
    expect(glideBudget(2).durationMs).toBeCloseTo(406, 0)
    expect(glideBudget(V_CAP).durationMs).toBeCloseTo(450, 0)
    // measured: 214.5 px for the typical throw (the plan rounded to 220)
    expect(glideBudget(2).distancePx).toBeCloseTo(214.5, 1)
  })
  it('velocity decays by 1/e per tau; the rubber band resists at 0.35', () => {
    expect(decay(1, 110)).toBeCloseTo(Math.exp(-1), 6)
    expect(rubberBand(100)).toBeCloseTo(35, 6)
  })
  it('a glide runs frames only while moving and has stopped at rest (0 callbacks idle)', async () => {
    let cb: FrameRequestCallback | null = null
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((f) => {
      cb = f
      return 1
    })
    const g = new Glide()
    let t = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => t)
    const rest = vi.fn()
    g.start(2, 0, () => {}, rest)
    expect(g.active).toBe(true)
    for (let i = 0; i < 400 && cb; i++) {
      t += 16
      const f = cb as FrameRequestCallback
      cb = null
      f(t)
    }
    expect(rest).toHaveBeenCalledOnce()
    expect(g.active).toBe(false)
    expect(cb).toBeNull()
    raf.mockRestore()
    vi.restoreAllMocks()
  })
  it('hold: 400 ms confirms; an early release does nothing; reduced motion and the keyboard ask with a dialog', () => {
    vi.useFakeTimers()
    const el = document.createElement('button')
    const ok = vi.fn()
    const ask = vi.fn()
    let reduced = false
    const h = createHold({ el, onConfirm: ok, onNeedConfirm: ask, reduced: () => reduced })
    h.start()
    expect(el.getAttribute('data-hold')).toBe('holding')
    vi.advanceTimersByTime(HOLD_MS - 1)
    h.release()
    vi.advanceTimersByTime(1000)
    expect(ok).not.toHaveBeenCalled()
    expect(el.getAttribute('data-hold')).toBe('released')
    h.start()
    vi.advanceTimersByTime(HOLD_MS)
    expect(ok).toHaveBeenCalledOnce()
    h.key()
    expect(ask).toHaveBeenCalledOnce()
    reduced = true
    h.start()
    expect(ask).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
  it('the governor: flat tier, low p5, hidden tab or battery saver lower motion', () => {
    expect(motionLoad({ tier: 'blur', p5: 58 })).toBe('high')
    expect(motionLoad({ tier: 'flat' })).toBe('low')
    expect(motionLoad({ tier: 'blur', p5: 49 })).toBe('low')
    expect(motionLoad({ tier: 'blur', hidden: true })).toBe('low')
    expect(motionLoad({ tier: 'blur', saver: true })).toBe('low')
  })
})

describe('the glass additions', () => {
  it('glass never exceeds its ceiling', () => {
    expect(clampTier('refract', 'blur')).toBe('blur')
    expect(clampTier('blur', 'blur')).toBe('blur')
    expect(clampTier('flat', 'blur')).toBe('flat')
  })
  it('p5 fps is 1000 / the 95th-percentile frame gap', () => {
    const gaps = [...Array(95).fill(16.7), ...Array(5).fill(40)]
    expect(p5FromGaps(gaps)).toBeCloseTo(1000 / 16.7, 1)
    const worse = [...Array(90).fill(16.7), ...Array(10).fill(40)]
    expect(p5FromGaps(worse)).toBeCloseTo(25, 1)
  })
  it('the frame sampler runs only between start and stop, and keeps at most 5 windows', () => {
    let n = 0
    const q: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((f) => {
      q.push(f)
      n++
      return n
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const s = new FrameSampler()
    expect(s.running).toBe(false)
    for (let w = 0; w < 7; w++) {
      s.start()
      expect(s.running).toBe(true)
      for (let i = 0; i < 4; i++) q.shift()?.(16 * (i + 1))
      s.stop()
      expect(s.running).toBe(false)
    }
    expect(s.p5()).not.toBeNull()
    vi.restoreAllMocks()
  })
})
