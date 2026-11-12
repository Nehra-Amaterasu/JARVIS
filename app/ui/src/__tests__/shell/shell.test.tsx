// Shell v2 rendered in happy-dom with stub pages: the rail order and its single tab stop, the page-root ids, the
// <html> attributes it owns (and removes), keys from the one table, the palette's focus return, honest plates.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { mount } from '../ww/_stubs'
import ShellV2 from '../../shell/ShellV2'
import { resetShellForTests, useShell } from '../../shell/store'
import { resetPortsForTests } from '../../shell/ports'

const stub = (id: string) => () => createElement('div', { 'data-stub': id }, `stub ${id}`)
const PAGES = Object.fromEntries(['core', 'limbs', 'aankhen', 'yaadash', 'connect', 'system'].map((t) => [t, stub(t)]))

let m: ReturnType<typeof mount> | null = null
const q = <T extends Element = HTMLElement>(sel: string) => m!.container.querySelector<T>(sel)
const qa = (sel: string) => [...m!.container.querySelectorAll<HTMLElement>(sel)]
const key = (k: string, init: KeyboardEventInit = {}) =>
  act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })))

beforeEach(() => {
  localStorage.clear()
  resetShellForTests()
  resetPortsForTests()
})
afterEach(() => {
  m?.unmount()
  m = null
})

const render = () => {
  m = mount(createElement(ShellV2, { pages: PAGES, wwRoot: stub('ww'), verbs: [], serverUp: true }))
}

describe('Shell v2', () => {
  it('opens JARVIS on core.talk with the three ids on the page root and the clay theme on <html>', () => {
    render()
    const root = q('.s2-page')!
    expect([root.dataset.product, root.dataset.section, root.dataset.view]).toEqual(['jarvis', 'core', 'talk'])
    expect(document.documentElement.getAttribute('data-theme')).toBe('clay-dark')
    expect(document.documentElement.getAttribute('data-product')).toBe('jarvis')
    expect(q('[data-stub="core"]')).not.toBeNull()
  })

  it('takes its <html> attributes away on unmount, so the old frame never sees a clay theme', () => {
    render()
    m!.unmount()
    m = null
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(document.documentElement.hasAttribute('data-product')).toBe(false)
  })

  it('the rail lists the five sections in order and holds exactly one tab stop', () => {
    render()
    expect(qa('.s2-rail [data-slot]').map((b) => b.dataset.slot)).toEqual(['core', 'room', 'senses', 'memory', 'console'])
    expect(qa('.s2-rail [data-rove]').filter((b) => b.tabIndex === 0)).toHaveLength(1)
    expect(q('.s2-rail [aria-current="page"]')!.dataset.slot).toBe('core')
  })

  it('Ctrl+n, Alt+0 and ] act through the binding table', () => {
    render()
    key('3', { ctrlKey: true })
    expect(q('.s2-page')!.dataset.section).toBe('senses')
    key(']')
    expect(q('.s2-page')!.dataset.view).toBe('signal')
    key('0', { altKey: true, code: 'Digit0' })
    expect(q('.s2-page')!.dataset.product).toBe('ww')
    expect(qa('.s2-rail [data-slot]').map((b) => b.dataset.slot)).toEqual(['day', 'focus', 'study', 'tree', 'career'])
    expect(document.documentElement.getAttribute('data-theme')).toBe('clay-light')
  })

  it('a view with nothing built shows a "not built" plate, not content', () => {
    render()
    act(() => useShell.getState().go({ product: 'ww', section: 'day', view: 'close' }))
    expect(q('[data-notbuilt="day.close"]')).not.toBeNull()
    expect(q('[data-stub]')).toBeNull()
  })

  it('a view that shares a legacy page says so in one line', () => {
    render()
    act(() => useShell.getState().go({ product: 'jarvis', section: 'core', view: 'sound' }))
    expect(q('.s2-interim')?.textContent).toMatch(/today.s page for Core/)
  })

  it('Ctrl+K opens the palette with focus in the field; Esc closes it and focus returns to the opener', () => {
    render()
    const slot = q<HTMLButtonElement>('.s2-rail [data-slot="core"]')!
    slot.focus()
    key('k', { ctrlKey: true })
    const dlg = q('[data-overlay="palette"]')
    expect(dlg).not.toBeNull()
    expect(document.activeElement).toBe(dlg!.querySelector('input'))
    key('Escape')
    expect(q('[data-overlay="palette"]')).toBeNull()
    expect(document.activeElement).toBe(slot)
  })

  it('with no ports installed, Ask is one dashed line that names what is missing', () => {
    render()
    key('k', { ctrlKey: true })
    const input = q<HTMLInputElement>('[data-overlay="palette"] input')!
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(input, 'zzqqxx')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const rows = qa('[data-overlay="palette"] [role="option"]')
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringMatching(/Ask needs JARVIS/)])
    expect(rows[0].hasAttribute('data-absent')).toBe(true)
  })

  it('the rail keeps one tab stop when a key moves the section after arrow roving', () => {
    render()
    const core = q<HTMLButtonElement>('.s2-rail [data-slot="core"]')!
    core.focus()
    act(() => void core.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })))
    expect(document.activeElement).toBe(q('.s2-rail [data-slot="room"]'))
    key('3', { ctrlKey: true })
    const stops = qa('.s2-rail [data-rove]').filter((b) => b.getAttribute('tabindex') === '0').map((b) => b.dataset.slot)
    expect(stops).toEqual(['senses'])
  })

  it('the 15 s clock tick does not re-render the page in the canvas', () => {
    vi.useFakeTimers()
    try {
      let renders = 0
      const Counting = () => {
        renders++
        return createElement('div', { 'data-stub': 'core' }, 'core')
      }
      m = mount(createElement(ShellV2, { pages: { ...PAGES, core: Counting }, wwRoot: stub('ww'), verbs: [], serverUp: true }))
      const before = renders
      act(() => void vi.advanceTimersByTime(4 * 15_000))
      expect(renders).toBe(before)
    } finally {
      vi.useRealTimers()
    }
  })

  it('Alt+6 (the old frame key for Setup) does not reach the Well Wisher frame under the shell', () => {
    render()
    act(() => useShell.getState().swapProduct())
    let reached = 0
    const frame = (e: KeyboardEvent) => { if (e.altKey && e.code === 'Digit6') reached++ }
    window.addEventListener('keydown', frame)
    try {
      act(() => void document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '6', code: 'Digit6', altKey: true, bubbles: true, cancelable: true })))
    } finally {
      window.removeEventListener('keydown', frame)
    }
    expect(reached).toBe(0)
    expect(q('.s2-page')!.dataset.section).toBe('day')
  })

  it('no idle timer: an untouched shell schedules no interval', () => {
    const orig = window.setInterval
    let n = 0
    window.setInterval = ((...a: Parameters<typeof setInterval>) => {
      n++
      return orig(...a)
    }) as typeof setInterval
    try {
      render()
    } finally {
      window.setInterval = orig
    }
    // the title-bar clock is the one interval (15 s, lib/format useNow); nothing else ticks
    expect(n).toBeLessThanOrEqual(1)
  })
})
