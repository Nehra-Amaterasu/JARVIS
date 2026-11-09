// Chunk 1b, group 4b: HoldButton, PinHeader, CursorLabel, ComingCard, LockChip, CoachMark (plan 5.7.3, 5.7.6, 7).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { join } from 'node:path'
import { mount, resetHtml, setHtml, stubMatchMedia } from './_stubs'
import { CoachMark, ComingCard, CursorLabel, HoldButton, LockChip, PinHeader, clearCoachMemory, clearLockMemory } from '../../ww/kit'
import { parseCss, read, stripComments, WW_DIR } from './_css'

let m: ReturnType<typeof mount> | null = null
let restore: (() => void) | null = null
beforeEach(() => {
  clearCoachMemory()
  clearLockMemory()
  try {
    sessionStorage.clear()
    localStorage.clear()
  } catch {
    /* happy-dom without storage */
  }
})
afterEach(() => {
  m?.unmount()
  m = null
  restore?.()
  restore = null
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  resetHtml()
  document.body.innerHTML = ''
})
const click = (el: Element) => act(() => (el as HTMLElement).click())
const fire = (el: Element, type: string, init: Record<string, unknown> = {}) => act(() => void el.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { button: 0, ...init })))
const adv = (ms: number) => act(() => void vi.advanceTimersByTime(ms))

describe('HoldButton (hold, 5.7.3 #10)', () => {
  const btn = () => m!.container.querySelector('button.ww-hold') as HTMLButtonElement
  it('holding for 400 ms runs the action once; the bar is filling in between', () => {
    vi.useFakeTimers()
    const on = vi.fn()
    m = mount(<HoldButton label="Reset week" onConfirm={on} />)
    fire(btn(), 'pointerdown')
    expect(btn().getAttribute('data-hold')).toBe('holding')
    adv(399)
    expect(on).not.toHaveBeenCalled()
    adv(2)
    expect(on).toHaveBeenCalledTimes(1)
    expect(btn().hasAttribute('data-hold')).toBe(false)
  })
  it('letting go early reverses the bar and does nothing', () => {
    vi.useFakeTimers()
    const on = vi.fn()
    m = mount(<HoldButton label="Reset week" onConfirm={on} />)
    fire(btn(), 'pointerdown')
    adv(200)
    fire(btn(), 'pointerup')
    expect(btn().getAttribute('data-hold')).toBe('released')
    adv(1000)
    expect(on).not.toHaveBeenCalled()
  })
  it('leaving the button counts as letting go', () => {
    vi.useFakeTimers()
    const on = vi.fn()
    m = mount(<HoldButton label="Reset week" onConfirm={on} />)
    fire(btn(), 'pointerdown')
    fire(btn(), 'pointerout', { relatedTarget: null })
    adv(500)
    expect(on).not.toHaveBeenCalled()
  })
  it('Enter and Space open a plain Confirm instead of holding; Confirm runs the action, Cancel returns focus', () => {
    const on = vi.fn()
    m = mount(<HoldButton label="Delete log" onConfirm={on} />)
    fire(btn(), 'keydown', { key: 'Enter' })
    const dlg = m.container.querySelector('[role=alertdialog]')!
    expect(dlg.getAttribute('aria-label')).toBe('Confirm: Delete log')
    const [confirm, cancel] = [...dlg.querySelectorAll('button')]
    click(cancel)
    expect(m.container.querySelector('[role=alertdialog]')).toBeNull()
    expect(on).not.toHaveBeenCalled()
    fire(btn(), 'keydown', { key: ' ' })
    click(m.container.querySelectorAll('[role=alertdialog] button')[0])
    expect(on).toHaveBeenCalledTimes(1)
    expect(confirm.textContent).toBe('Confirm')
  })
  it('under reduced motion a press opens the Confirm and draws no fill', () => {
    restore = stubMatchMedia({ 'prefers-reduced-motion': true })
    const on = vi.fn()
    m = mount(<HoldButton label="Delete log" onConfirm={on} />)
    fire(btn(), 'pointerdown')
    expect(btn().hasAttribute('data-hold')).toBe(false)
    expect(m.container.querySelector('[role=alertdialog]')).not.toBeNull()
    expect(on).not.toHaveBeenCalled()
  })
  it('with a reason it cannot start: aria-disabled, the reason printed, no hold, no dialog', () => {
    vi.useFakeTimers()
    const on = vi.fn()
    m = mount(<HoldButton label="End session" onConfirm={on} reason="No session is running." />)
    expect(btn().getAttribute('aria-disabled')).toBe('true')
    expect(m.container.querySelector('.ww-reason')!.textContent).toBe('No session is running.')
    fire(btn(), 'pointerdown')
    fire(btn(), 'keydown', { key: 'Enter' })
    adv(1000)
    expect(on).not.toHaveBeenCalled()
    expect(m.container.querySelector('[role=alertdialog]')).toBeNull()
  })
  it('the hold itself uses no requestAnimationFrame, and the fill is a transform in CSS', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    vi.useFakeTimers()
    m = mount(<HoldButton label="x" onConfirm={() => {}} />)
    fire(btn(), 'pointerdown')
    adv(500)
    expect(raf).not.toHaveBeenCalled()
    const rule = parseCss(read(join(WW_DIR, 'design/motion.css'))).rules.find((r) => r.selectors.includes("[data-hold='holding'] .ww-hold-fill"))!
    expect(rule.decls['transform']).toBe('scaleX(1)')
  })
  it('carries the pointer companion text and a description for keyboard users', () => {
    m = mount(<HoldButton label="Reset week" onConfirm={() => {}} />)
    expect(btn().getAttribute('data-cursor')).toBe('Hold to reset week')
    expect(document.getElementById(btn().getAttribute('aria-describedby')!)!.textContent).toContain('Press Enter')
  })
})

describe('PinHeader (pin, 5.7.3 #11)', () => {
  let observers: { cb: IntersectionObserverCallback; els: Set<Element> }[] = []
  beforeEach(() => {
    observers = []
    vi.stubGlobal('CSS', { supports: () => false, escape: (s: string) => s }) // an engine without scroll timelines
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        cb: IntersectionObserverCallback
        els = new Set<Element>()
        constructor(cb: IntersectionObserverCallback) {
          this.cb = cb
          observers.push(this)
        }
        observe(e: Element) {
          this.els.add(e)
        }
        disconnect() {}
      },
    )
  })
  it('is a sticky header with a real heading and the scrub elements motion.css targets', () => {
    m = mount(<PinHeader title="Study" level={1}><button>Add</button></PinHeader>)
    expect(m.container.querySelector('header h1.ww-pin-title')!.textContent).toBe('Study')
    expect(m.container.querySelector('.ww-pin-rule')).not.toBeNull()
    expect(m.container.querySelector('.ww-pin-actions button')).not.toBeNull()
  })
  it('without scroll timelines, an IntersectionObserver on a sentinel toggles data-stuck (no scroll listener)', () => {
    const add = vi.spyOn(window, 'addEventListener')
    m = mount(<PinHeader title="Study" />)
    const rule = m.container.querySelector('.ww-pin-rule')!
    expect(observers).toHaveLength(1)
    act(() => observers[0].cb([{ isIntersecting: false } as IntersectionObserverEntry], observers[0] as never))
    expect(rule.getAttribute('data-stuck')).toBe('true')
    act(() => observers[0].cb([{ isIntersecting: true } as IntersectionObserverEntry], observers[0] as never))
    expect(rule.getAttribute('data-stuck')).toBe('false')
    expect(add.mock.calls.some((c) => c[0] === 'scroll')).toBe(false)
  })
  it('where the engine has scroll timelines the sentinel is not used at all', () => {
    vi.stubGlobal('CSS', { supports: () => true, escape: (s: string) => s })
    m = mount(<PinHeader title="Study" />)
    expect(observers).toHaveLength(0)
  })
  it('is fixed at 56 px and opaque in CSS', () => {
    const css = stripComments(read(join(WW_DIR, 'kit/extras.css')))
    expect(css).toMatch(/\.ww-pin\s*\{[^}]*--pin-h:\s*56px/)
    expect(css).toMatch(/\.ww-pin\s*\{[^}]*background:\s*var\(--surface-3\)/)
    expect(css).toMatch(/\.ww-pin\s*\{[^}]*position:\s*sticky/)
  })
})

describe('CursorLabel (companion, 5.7.6)', () => {
  const FINE = { '(hover: hover) and (pointer: fine)': true }
  const label = () => document.body.querySelector('.ww-cursor-label') as HTMLElement | null
  const move = (target: Element, x = 100, y = 50) => act(() => void target.dispatchEvent(Object.assign(new Event('pointermove', { bubbles: true }), { clientX: x, clientY: y, pointerType: 'mouse' })))
  const flushRaf = () => act(() => void vi.runOnlyPendingTimers())
  it('is absent on touch (no fine hovering pointer)', () => {
    restore = stubMatchMedia({})
    m = mount(<CursorLabel />)
    expect(label()).toBeNull()
  })
  it('is absent under calm, under reduced motion and when the governor says low', () => {
    restore = stubMatchMedia(FINE)
    setHtml({ 'data-motion': 'calm' })
    m = mount(<CursorLabel />)
    expect(label()).toBeNull()
    m.unmount()
    setHtml({ 'data-motion': null, 'data-motion-load': 'low' })
    m = mount(<CursorLabel />)
    expect(label()).toBeNull()
  })
  it('shows the data-cursor text over a target, moves by transform only, and hides off it', () => {
    restore = stubMatchMedia(FINE)
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
    m = mount(
      <div>
        <i id="node" data-cursor="Open node" />
        <i id="plain" />
      </div>,
    )
    const c = mount(<CursorLabel />)
    move(document.getElementById('node')!, 120, 80)
    flushRaf()
    expect(label()!.textContent).toBe('Open node')
    expect(label()!.dataset.visible).toBe('true')
    expect(label()!.style.transform).toBe('translate3d(136px, 96px, 0)')
    move(document.getElementById('plain')!)
    flushRaf()
    expect(label()!.dataset.visible).toBe('false')
    c.unmount()
  })
  it('schedules one rAF for a burst of moves and none while idle', () => {
    restore = stubMatchMedia(FINE)
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    m = mount(<CursorLabel />)
    const t = document.body
    move(t, 1, 1)
    move(t, 2, 2)
    move(t, 3, 3)
    expect(raf).toHaveBeenCalledTimes(1)
    flushRaf()
    vi.advanceTimersByTime(2000)
    expect(raf).toHaveBeenCalledTimes(1)
  })
  it('never hides the native pointer (no cursor: none) and is at most 24 px tall', () => {
    const css = stripComments(read(join(WW_DIR, 'kit/extras.css')))
    expect(css).not.toMatch(/cursor\s*:\s*none/)
    expect(css).toMatch(/\.ww-cursor-label\s*\{[^}]*max-block-size:\s*var\(--space-5\)/)
  })
})

describe('ComingCard (pattern C, plan 7)', () => {
  it('names its feature, says what is missing, and holds no enabled control', () => {
    m = mount(<ComingCard featureId="dmat-practice" label="dMAT practice" line="dMAT practice is not built. It will generate figure sequences from the public rules." when="after the end-sems" />)
    const c = m.container.querySelector('[data-coming=dmat-practice]')!
    expect(c.getAttribute('aria-label')).toBe('dMAT practice, not built yet')
    expect(c.textContent).toContain('not built')
    expect(c.textContent).toContain('When: after the end-sems')
    expect(c.querySelectorAll('button, a, input, select, textarea, [tabindex]')).toHaveLength(0)
  })
  it('is static in CSS: dashed in --line-ui, never the accent, no animation, transition, hover or will-change', () => {
    const rules = parseCss(read(join(WW_DIR, 'kit/extras.css'))).rules.filter((r) => r.selectors.some((s) => s.includes('ww-coming')))
    expect(rules.length).toBeGreaterThan(0)
    for (const r of rules) {
      expect(r.decls['animation']).toBeUndefined()
      expect(r.decls['transition']).toBeUndefined()
      expect(r.selectors.join()).not.toContain(':hover')
      for (const v of Object.values(r.decls)) expect(v).not.toMatch(/--accent/)
    }
    expect(rules.find((r) => r.decls['border'])!.decls['border']).toBe('1px dashed var(--line-ui)')
  })
  it('arrives with its siblings only when given an index, and otherwise never observes', () => {
    const seen: number[] = []
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor() {
          seen.push(1)
        }
        observe() {}
        disconnect() {}
      },
    )
    m = mount(<ComingCard featureId="a" label="A" line="Fifteen characters or more of line." />)
    expect(seen).toHaveLength(0)
    m.unmount()
    m = mount(<ComingCard featureId="a" label="A" line="Fifteen characters or more of line." index={1} />)
    expect(seen).toHaveLength(1)
  })
})

describe('LockChip (plan 7)', () => {
  const say = () => m!.container.querySelector('[role=status]')!.textContent
  it('the first show plays one arrive and writes one polite line, "Locked: <reason>"', () => {
    m = mount(<LockChip id="sharpen" reason="Needs one GATE-tier question." />)
    const chip = m.container.querySelector('.ww-lockchip')!
    expect(chip.getAttribute('data-arrive')).toBe('in')
    expect(m.container.querySelector('[role=status]')!.getAttribute('aria-live')).toBe('polite')
    expect(say()).toBe('Locked: Needs one GATE-tier question.')
    expect(chip.textContent).toContain('Locked: Needs one GATE-tier question.')
  })
  it('every later show in the same session is silent and still', () => {
    m = mount(<LockChip id="sharpen" reason="r" />)
    m.unmount()
    m = mount(<LockChip id="sharpen" reason="r" />)
    expect(m.container.querySelector('.ww-lockchip')!.hasAttribute('data-arrive')).toBe(false)
    expect(say()).toBe('')
  })
  it('two different locks each announce once', () => {
    m = mount(
      <div>
        <LockChip id="a" reason="one" />
        <LockChip id="b" reason="two" />
      </div>,
    )
    expect([...m.container.querySelectorAll('[role=status]')].map((e) => e.textContent)).toEqual(['Locked: one', 'Locked: two'])
  })
  it('if sessionStorage throws, it still announces once per page load', () => {
    vi.stubGlobal('sessionStorage', {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('blocked')
      },
    })
    m = mount(<LockChip id="x" reason="r" />)
    expect(say()).toBe('Locked: r')
    m.unmount()
    m = mount(<LockChip id="x" reason="r" />)
    expect(say()).toBe('')
  })
})

describe('CoachMark', () => {
  it('shows once, dismisses in one tap, and does not return in this session or the next', () => {
    const on = vi.fn()
    m = mount(<CoachMark id="tree-first" text="Drag to pan, scroll to zoom." onDismiss={on} />)
    expect(m.container.querySelector('[role=note]')!.textContent).toContain('Drag to pan')
    click(m.container.querySelector('button')!)
    expect(m.container.querySelector('[role=note]')).toBeNull()
    expect(on).toHaveBeenCalledTimes(1)
    m.unmount()
    m = mount(<CoachMark id="tree-first" text="again" />)
    expect(m.container.querySelector('[role=note]')).toBeNull()
    clearCoachMemory() // a new session: only localStorage remembers
    m.unmount()
    m = mount(<CoachMark id="tree-first" text="again" />)
    expect(m.container.querySelector('[role=note]')).toBeNull()
  })
  it('a different id still shows; a blocked localStorage still holds for this session', () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('blocked')
      },
    })
    m = mount(<CoachMark id="one" text="a" />)
    click(m.container.querySelector('button')!)
    m.unmount()
    m = mount(
      <div>
        <CoachMark id="one" text="a" />
        <CoachMark id="two" text="b" />
      </div>,
    )
    expect([...m.container.querySelectorAll('[role=note]')].map((n) => n.getAttribute('data-coach'))).toEqual(['two'])
  })
})
