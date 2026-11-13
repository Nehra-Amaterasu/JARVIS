// A.N02 shell fixes from the B05 review, each written before its fix:
//   (4) the Resume pill is a breadcrumb: it names where the student was BEFORE the current place, with the time,
//       one press goes there, Esc dismisses it, it is a labelled nav landmark, and the open view keeps its record
//       confirmed (lastConfirmedAt) on the shell's one clock tick, with no timer of its own;
//   (5) the first-run pill is worded as navigation and only navigates;
//   (6) "Skip to canvas" is the first Tab stop;
//   (g) the place app.new (Alt+N, palette "What is new") mounts the gallery lazily or an honest plate;
//   (2) one view switch: the shell's switch is marked data-shell-owned and the page root says the shell owns it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { mount } from '../ww/_stubs'
import ShellV2 from '../../shell/ShellV2'
import { resetShellForTests, useShell } from '../../shell/store'
import { resetPortsForTests } from '../../shell/ports'
import { pillState, readPrev, readRecord, STALE_MS } from '../../shell/record'

const stub = (id: string) => () => createElement('div', { 'data-stub': id }, `stub ${id}`)
const PAGES = Object.fromEntries(['core', 'limbs', 'aankhen', 'yaadash', 'connect', 'system'].map((t) => [t, stub(t)]))

let m: ReturnType<typeof mount> | null = null
const q = <T extends Element = HTMLElement>(sel: string) => m!.container.querySelector<T>(sel)
const key = (k: string, init: KeyboardEventInit = {}) =>
  act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })))
const go = (section: string, view: string, product: 'jarvis' | 'ww' = 'jarvis') => act(() => useShell.getState().go({ product, section, view }))
/** the wide pill (the title bar copy; the narrow row holds the same nav) */
const pill = () => q<HTMLElement>('.s2-title nav[aria-label="Resume"]')

beforeEach(() => {
  localStorage.clear()
  resetShellForTests()
  resetPortsForTests()
})
afterEach(() => {
  m?.unmount()
  m = null
  vi.useRealTimers()
})

const render = (verbs: Parameters<typeof ShellV2>[0]['verbs'] = []) => {
  m = mount(createElement(ShellV2, { pages: PAGES, wwRoot: stub('ww'), verbs, serverUp: true }))
}

describe('(5) the first-run pill', () => {
  it('is worded as navigation, never as an action it does not run', () => {
    expect(pillState('ww', null, 0)).toEqual({ kind: 'start', text: 'Go to Day / Today' })
    expect(pillState('jarvis', null, 0)).toEqual({ kind: 'start', text: 'Go to Core / Talk' })
  })

  it('away from home, pressing it runs no verb: it only goes home', () => {
    localStorage.setItem('shell.place.jarvis', JSON.stringify({ product: 'jarvis', section: 'room', view: 'switches' }))
    resetShellForTests()
    const wake = vi.fn(async () => ({ ok: true }))
    render([{ id: 'wake', label: 'Wake JARVIS', run: wake }])
    const btn = pill()!.querySelector('button')!
    expect(btn.textContent).toMatch(/Go to Core \/ Talk/)
    act(() => btn.click())
    expect(wake).not.toHaveBeenCalled()
    expect(q('.s2-page')!.dataset.view).toBe('talk')
  })

  it('already home on a first run, it is a "you are here" crumb with no button that would do nothing', () => {
    render()
    expect(pill()!.querySelector('button')).toBeNull()
    expect(pill()!.querySelector('[aria-current="location"]')!.textContent).toBe('Core / Talk')
  })
})

describe('(4) the Resume pill is a breadcrumb', () => {
  it('names where the student was before the current place, with the time, inside a labelled nav', () => {
    render()
    go('room', 'switches')
    expect(pill()).not.toBeNull()
    const text = pill()!.textContent ?? ''
    expect(text).toMatch(/Core \/ Talk/)
    expect(text).not.toMatch(/Room \/ Switches/)
    expect(text).toMatch(/left \d\d:\d\d/)
    // one press goes there, and the pill then names the place just left
    act(() => pill()!.querySelector('button')!.click())
    expect(q('.s2-page')!.dataset.section).toBe('core')
    expect(pill()!.textContent).toMatch(/Room \/ Switches/)
  })

  it('Alt+R goes to the place before, the same as the pill', () => {
    render()
    go('senses', 'signal')
    go('memory', 'keep')
    key('r', { altKey: true })
    expect([q('.s2-page')!.dataset.section, q('.s2-page')!.dataset.view]).toEqual(['senses', 'signal'])
  })

  it('Esc on the pill dismisses it until the next navigation', () => {
    render()
    go('room', 'switches')
    const btn = pill()!.querySelector('button')!
    btn.focus()
    act(() => void btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(pill()).toBeNull()
    expect(document.activeElement?.id).toBe('s2-canvas')
    go('senses', 'presence')
    expect(pill()).not.toBeNull()
  })

  it('a place left long ago reads "last seen" with Pick up and Drop it, and shows no running time', () => {
    const r = { product: 'ww' as const, section: 'study', view: 'practice', object: 'Paper 2', openedAt: 0, lastConfirmedAt: 0 }
    expect(pillState('ww', r, 60_000)).toMatchObject({ kind: 'open', text: expect.stringMatching(/^Study \/ Practice: Paper 2, left \d\d:\d\d$/) })
    const stale = pillState('ww', r, STALE_MS + 60 * 60_000 * 20)
    expect(stale.kind).toBe('stale')
    expect(stale.text).toMatch(/^Paper 2, last seen /)
  })

  it('the open view keeps its record confirmed on the clock tick, and the place left keeps its own time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-13T10:00:00'))
    render()
    const t0 = readRecord('jarvis')?.lastConfirmedAt ?? 0
    act(() => void vi.advanceTimersByTime(3 * 60_000))
    const t1 = readRecord('jarvis')!.lastConfirmedAt
    expect(t1 - t0).toBeGreaterThanOrEqual(2 * 60_000)
    go('room', 'switches')
    expect(readPrev('jarvis')).toMatchObject({ section: 'core', view: 'talk', lastConfirmedAt: t1 })
  })

  it('app.new is never recorded as a place to resume', () => {
    render()
    go('room', 'switches')
    key('n', { altKey: true, code: 'KeyN' })
    expect(q('.s2-page')!.dataset.section).toBe('app')
    expect(readPrev('jarvis')).toMatchObject({ section: 'core', view: 'talk' })
    expect(readRecord('jarvis')).toMatchObject({ section: 'room', view: 'switches' })
  })

  it('from app.new the pill and Alt+R name and go to the place just left, not the one before it', () => {
    render()
    go('room', 'switches')
    key('n', { altKey: true, code: 'KeyN' })
    expect(q('.s2-page')!.dataset.section).toBe('app')
    expect(pill()!.textContent).toMatch(/Room \/ Switches/)
    key('r', { altKey: true })
    expect([q('.s2-page')!.dataset.section, q('.s2-page')!.dataset.view]).toEqual(['room', 'switches'])
  })
})

describe('(6) Skip to canvas', () => {
  it('is the first Tab stop and moves focus to the canvas', () => {
    render()
    const focusables = [...m!.container.querySelectorAll<HTMLElement>('a[href], button, input, [tabindex="0"]')]
    expect(focusables[0].textContent).toBe('Skip to canvas')
    act(() => focusables[0].click())
    expect(document.activeElement).toBe(q('#s2-canvas'))
    expect(location.hash).not.toMatch(/s2-canvas/)
  })
})

describe('(g) the place app.new', () => {
  it('Alt+N opens What is new for the product on screen and mounts the gallery or an honest plate', async () => {
    render()
    key('n', { altKey: true, code: 'KeyN' })
    const root = q('.s2-page')!
    expect([root.dataset.product, root.dataset.section, root.dataset.view]).toEqual(['jarvis', 'app', 'new'])
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(q('[data-place="app.new"]')).not.toBeNull()
    expect(q('.s2-canvas')!.getAttribute('aria-label')).toBe('What is new')
    // no rail slot claims it
    expect(q('.s2-rail [aria-current="page"]')).toBeNull()
  })

  it('the palette lists "What is new" with its real key', () => {
    render()
    key('k', { ctrlKey: true })
    const input = q<HTMLInputElement>('[data-overlay="palette"] input')!
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(input, 'what is new')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const row = q('[data-overlay="palette"] [role="option"]')!
    expect(row.textContent).toMatch(/What is new/)
    expect(row.querySelector('kbd')?.textContent).toBe('Alt N')
    act(() => (row as HTMLElement).click())
    expect(q('.s2-page')!.dataset.section).toBe('app')
  })
})

describe('(2) one view switch', () => {
  it('the shell switch is marked as the shell\'s, and the page root tells legacy pages the shell owns the views', () => {
    render()
    go('study', 'plan', 'ww')
    expect(q('.s2-views')!.hasAttribute('data-shell-owned')).toBe(true)
    expect(q('.s2-page')!.dataset.shellOwned).toMatch(/\bviews\b/)
    go('tree', 'tree', 'ww')
    // Tree has one view: no switch, so nothing is hidden, but the frame's tools still get their row
    expect(q('.s2-viewlist')).toBeNull()
    expect(q('.s2-page')!.dataset.shellOwned ?? '').not.toMatch(/\bviews\b/)
    expect(q('#s2-frame-tools')).not.toBeNull()
  })
})
