// The v3 shell rendered through ShellV2's one branch in happy-dom: the contracts the rest of the app finds the shell by, the
// spine, the top plate, the lamp pill, the dock and the keyboard paths. The look is switched on the way a person does it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { mount } from '../../ww/_stubs'
import ShellV2 from '../../../shell/ShellV2'
import { LOOK_KEY, resetLookForTests } from '../../../shell/look'
import { resetShellForTests, useShell } from '../../../shell/store'
import { resetPortsForTests } from '../../../shell/ports'
import { useStore } from '../../../lib/store'

const stub = (id: string) => () => createElement('div', { 'data-stub': id }, `stub ${id}`)
const PAGES = Object.fromEntries(['core', 'limbs', 'aankhen', 'yaadash', 'connect', 'system'].map((t) => [t, stub(t)]))

let m: ReturnType<typeof mount> | null = null
const q = <T extends Element = HTMLElement>(sel: string) => m!.container.querySelector<T>(sel)
const qa = (sel: string) => [...m!.container.querySelectorAll<HTMLElement>(sel)]
const key = (k: string, init: KeyboardEventInit = {}, target: EventTarget = window) =>
  act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })))
const click = (el: Element | null) => act(() => void (el as HTMLElement).click())
const section = () => q('.s2-page')!.dataset.section
const view = () => q('.s2-page')!.dataset.view

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(LOOK_KEY, 'v3')
  history.replaceState(null, '', '/')
  resetLookForTests()
  resetShellForTests()
  resetPortsForTests()
  useStore.setState({ readings: {} })
})
afterEach(() => {
  m?.unmount()
  m = null
  localStorage.clear()
  resetLookForTests()
})

async function render() {
  m = mount(createElement(ShellV2, { pages: PAGES, wwRoot: stub('ww'), verbs: [], serverUp: true }))
  // ShellV3 is a lazy chunk: wait for it
  for (let i = 0; i < 100 && !q('.s3'); i++) await act(async () => void (await new Promise((r) => setTimeout(r, 20))))
  expect(q('.s3')).not.toBeNull()
}

describe('the branch', () => {
  it('with the look off renders the current frame and nothing of v3', async () => {
    localStorage.removeItem(LOOK_KEY)
    resetLookForTests()
    m = mount(createElement(ShellV2, { pages: PAGES, wwRoot: stub('ww'), verbs: [], serverUp: true }))
    expect(q('.s2-title')).not.toBeNull()
    expect(q('.s3')).toBeNull()
    expect(document.documentElement.hasAttribute('data-look')).toBe(false)
  })

  it('keeps every contract other code finds the shell by', async () => {
    await render()
    const root = q('.s3')!
    expect(root.dataset.shell).toBe('v2')
    expect(root.dataset.product).toBe('jarvis')
    expect(root.classList.contains('s2')).toBe(true)
    const page = q('.s2-page')!
    expect([page.dataset.product, page.dataset.section, page.dataset.view]).toEqual(['jarvis', 'core', 'talk'])
    expect(q('main.s2-canvas#s2-canvas')).not.toBeNull()
    expect(document.documentElement.getAttribute('data-theme')).toBe('clay-dark')
    expect(document.documentElement.getAttribute('data-product')).toBe('jarvis')
  })

  it('writes the look and the glass choice on the root, and takes them away on unmount', async () => {
    await render()
    const html = document.documentElement
    expect([html.getAttribute('data-look'), html.getAttribute('data-glass')]).toEqual(['v3', 'on'])
    m!.unmount()
    m = null
    expect(html.hasAttribute('data-look')).toBe(false)
    expect(html.hasAttribute('data-glass')).toBe(false)
    expect(html.hasAttribute('data-theme')).toBe(false)
  })

  it('the ground is a sibling behind the content and the only layer that blurs', async () => {
    await render()
    const ground = q('.s3-ground')!
    expect(ground.parentElement).toBe(q('.s3'))
    expect(ground.contains(q('.s2-canvas'))).toBe(false)
    expect(ground.getAttribute('aria-hidden')).toBe('true')
    // nothing else in the shell sets a backdrop filter inline
    expect(qa('[style*="backdrop"]').filter((e) => e !== ground)).toHaveLength(0)
  })
})

describe('the spine', () => {
  it('names the four sub-projects, each with a state line, and opens the one that holds the section', async () => {
    await render()
    expect(qa('.s3-grp').map((g) => g.dataset.p)).toEqual(['jarvis', 'aankhen', 'yadaash', 'wellwisher'])
    expect(qa('.s3-grp').filter((g) => g.dataset.open === 'true').map((g) => g.dataset.p)).toEqual(['jarvis'])
    expect(qa('.s3-item').map((b) => b.dataset.section)).toEqual(['core', 'room', 'console'])
    for (const g of qa('.s3-grp')) {
      // the tile line is the state word alone (one line at 208 px, review of S1); the reason is its title
      expect(g.querySelector('small')!.textContent).toMatch(/^(LIVE|WAITING|SIMULATED|PLANNED|FAULT)$/)
      expect(g.querySelector('small')!.getAttribute('title')).toMatch(/^(LIVE|WAITING|SIMULATED|PLANNED|FAULT) · \S/)
    }
  })

  it('a section key goes to the section, a closed tile to its first section, and the tile opens', async () => {
    await render()
    click(q('.s3-item[data-section="room"]'))
    expect(section()).toBe('room')
    expect(q('.s3-item[aria-current="page"]')!.dataset.section).toBe('room')
    click(q('.s3-head[data-project="aankhen"]'))
    expect(section()).toBe('senses')
    expect(q('.s3-head[data-project="aankhen"]')!.getAttribute('aria-current')).toBe('page')
    click(q('.s3-head[data-project="wellwisher"]'))
    expect(section()).toBe('day')
    expect(q('.s3')!.dataset.ground).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('clay-light')
    expect(qa('.s3-item').map((b) => b.dataset.section)).toEqual(['day', 'focus', 'study', 'tree', 'career'])
  })

  it('every section of the ten is reachable by pointer through the spine', async () => {
    await render()
    const seen = new Set<string>()
    for (const proj of ['jarvis', 'aankhen', 'yadaash', 'wellwisher']) {
      const tile = q(`.s3-head[data-project="${proj}"]`) // the open multi-section tile is not a key: it is already open
      if (tile) click(tile)
      for (const b of qa('.s3-item')) {
        click(b)
        seen.add(section()!)
      }
      seen.add(section()!)
    }
    expect([...seen].sort()).toEqual(['career', 'console', 'core', 'day', 'focus', 'memory', 'room', 'senses', 'study', 'tree'])
  })

  it('Up and Down walk the spine buttons', async () => {
    await render()
    const first = q<HTMLButtonElement>('.s3-item[data-section="core"]')!
    first.focus()
    key('ArrowDown', {}, first)
    expect(document.activeElement).toBe(q('.s3-item[data-section="room"]'))
    key('ArrowUp', {}, document.activeElement!)
    expect(document.activeElement).toBe(first)
  })

  it('the Ctrl+n hint the key table gives is on the section key', async () => {
    await render()
    expect(q('.s3-item[data-section="core"]')!.getAttribute('aria-keyshortcuts')).toBe('Ctrl+1')
  })
})

describe('the top plate', () => {
  it('prints the location three levels deep and never replaces it', async () => {
    await render()
    expect(q('.s3-loc-p')!.textContent).toBe('JARVIS')
    expect(q('.s3-loc-s')!.textContent).toContain('Core')
    expect(q('.s3-loc-s')!.textContent).toContain('Talk')
    act(() => useShell.getState().go({ product: 'jarvis', section: 'senses', view: 'signal' }))
    expect(q('.s3-loc-p')!.textContent).toBe('Aankhen')
    expect(q('.s3-loc-s')!.textContent).toContain('Senses')
    act(() => useShell.getState().openOverlay('palette'))
    expect(q('.s3-loc-s')).not.toBeNull()
  })

  it('the view switch lists the views of the section and a press goes there, with the current one marked', async () => {
    await render()
    act(() => useShell.getState().go({ product: 'jarvis', section: 'console', view: 'health' }))
    expect(qa('.s3-seg button').map((b) => b.dataset.view)).toEqual(['health', 'events', 'connections', 'hardware', 'crew'])
    expect(q('.s3-seg [aria-current="page"]')!.dataset.view).toBe('health')
    click(q('.s3-seg button[data-view="crew"]'))
    expect(view()).toBe('crew')
    expect(q('.s3-seg [aria-current="page"]')!.dataset.view).toBe('crew')
  })

  it('the phone chip names the view, "n OF m VIEWS", and opens an opaque list that never cuts a label', async () => {
    await render()
    act(() => useShell.getState().go({ product: 'ww', section: 'day', view: 'today' }))
    const chip = q('.s3-chipbtn')!
    expect(chip.textContent).toContain('Today')
    expect(chip.textContent).toContain('1 OF 5 VIEWS')
    click(chip)
    expect(qa('.s3-vlist .s3-popitem').map((b) => b.textContent)).toEqual(['Today', 'Week', 'Month', 'Body', 'Close'])
    click(q('.s3-vlist [data-view="month"]'))
    expect(view()).toBe('month')
    expect(q('.s3-vlist')).toBeNull()
  })

  it('More counts its rarely needed actions in a tooltip (no badge) and holds the Frosted switch', async () => {
    await render()
    const more = q('.s3-iconkey[aria-haspopup]')!
    expect(more.getAttribute('data-tip')).toBe('2 more actions')
    expect(more.textContent).toBe('')
    click(more)
    const sw = q('.s3-switch')!
    expect(sw.getAttribute('aria-checked')).toBe('true')
    expect(sw.textContent).toContain('ON')
    click(sw)
    expect(document.documentElement.getAttribute('data-glass')).toBe('off')
    expect(q('.s3')!.dataset.glass).toBe('off')
    expect(q('.s3-switch')!.textContent).toContain('OFF')
    expect(localStorage.getItem('app.glass')).toBe('off')
    expect(q('.s3-pop')!.textContent).toContain('RARELY NEEDED · 2')
  })

  it('has no window keys outside the desktop window', async () => {
    await render()
    expect(q('.s3-wc')).toBeNull()
  })
})

describe('the lamp pill', () => {
  it('is ONE pill counting every lamp, worst first, on every view', async () => {
    await render()
    const text = () => q('.s3-pilltext')!.textContent!.replace(/\s+/g, ' ').trim()
    expect(text()).toBe('7 WAITING')
    act(() => useStore.getState().reportCapability('steward', { state: 'fault', reason: 'Ollama is not answering' }))
    expect(text()).toBe('1 FAULT · 6 WAITING')
    expect(q('.s3-pillbtn')!.getAttribute('aria-label')).toContain('1 FAULT')
    // the pill reports the worst state anywhere in the system, so it is the same on a Well Wisher view
    act(() => useShell.getState().go({ product: 'ww', section: 'day', view: 'today' }))
    expect(text()).toBe('1 FAULT · 6 WAITING')
    expect(qa('.s3-pillbtn')).toHaveLength(1)
  })

  it('the spine tile and the pill agree: JARVIS shows the fault the pill counts', async () => {
    await render()
    act(() => useStore.getState().reportCapability('steward', { state: 'fault', reason: 'Ollama is not answering' }))
    expect(q('.s3-grp[data-p="jarvis"] small')!.textContent).toBe('FAULT')
    expect(q('.s3-grp[data-p="jarvis"] small')!.getAttribute('title')).toBe('FAULT · steward')
    expect(q('.s3-grp[data-p="aankhen"] small')!.getAttribute('title')).toBe('WAITING · no sensor')
  })

  it('opens an opaque list headed STATE, WORST FIRST with a shape, a word and a reason per lamp, and Esc closes it and returns focus', async () => {
    await render()
    act(() => useStore.getState().reportCapability('steward', { state: 'fault', reason: 'Ollama is not answering' }))
    const pill = q<HTMLButtonElement>('.s3-pillbtn')!
    pill.focus()
    click(pill)
    expect(pill.getAttribute('aria-expanded')).toBe('true')
    expect(q('.s3-pop .s3-cap')!.textContent).toBe('STATE, WORST FIRST')
    const rows = qa('.s3-lamprow')
    expect(rows).toHaveLength(7)
    expect(rows[0].dataset.lamp).toBe('steward')
    expect(rows[0].textContent).toContain('FAULT')
    expect(rows[0].textContent).toContain('Ollama is not answering')
    for (const r of rows) {
      expect(r.querySelector('svg[data-glyph]')).not.toBeNull()
      expect(r.textContent).toMatch(/WAITING|FAULT|LIVE|SIMULATED|PLANNED/)
    }
    key('Escape', {}, pill)
    expect(q('.s3-pop')).toBeNull()
    expect(pill.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(pill)
  })

  it('a press on a lamp row opens the lamp section and closes the list', async () => {
    await render()
    click(q('.s3-pillbtn'))
    click(q('.s3-lamprow[data-lamp="phone"]'))
    expect(section()).toBe('day')
    expect(q('.s3-pop')).toBeNull()
  })

  it('only one popover is open at a time', async () => {
    await render()
    click(q('.s3-pillbtn'))
    click(q('.s3-iconkey[aria-haspopup]'))
    expect(qa('.s3-pop')).toHaveLength(1)
    expect(q('.s3-pillbtn')!.getAttribute('aria-expanded')).toBe('false')
  })
})

describe('keyboard paths', () => {
  it('Alt+Down and Alt+Up walk the ten sections in spine order, through the products', async () => {
    await render()
    const seen = [section()!]
    for (let i = 0; i < 9; i++) {
      key('ArrowDown', { altKey: true })
      seen.push(section()!)
    }
    expect(seen).toEqual(['core', 'room', 'console', 'senses', 'memory', 'day', 'focus', 'study', 'tree', 'career'])
    expect(q('.s2-page')!.dataset.product).toBe('ww')
    key('ArrowUp', { altKey: true })
    expect(section()).toBe('tree')
  })

  it('Alt+Right and Alt+Left move through the views of the section (Alt+Left is views here, not Back)', async () => {
    await render()
    act(() => useShell.getState().go({ product: 'jarvis', section: 'console', view: 'health' }))
    act(() => useShell.getState().go({ product: 'jarvis', section: 'console', view: 'events' }))
    key('ArrowRight', { altKey: true })
    expect(view()).toBe('connections')
    key('ArrowLeft', { altKey: true })
    expect(view()).toBe('events')
    key('ArrowLeft', { altKey: true })
    expect(view()).toBe('health')
    key('ArrowLeft', { altKey: true })
    expect(view()).toBe('crew')
  })

  it('the current key table still works: Ctrl+n, ] and Alt+0 act through keymap.ts', async () => {
    await render()
    key('3', { ctrlKey: true })
    expect(section()).toBe('senses')
    expect(q('.s3-head[data-project="aankhen"]')!.getAttribute('aria-current')).toBe('page')
    key(']')
    expect(view()).toBe('signal')
    key('0', { altKey: true, code: 'Digit0' })
    expect(q('.s2-page')!.dataset.product).toBe('ww')
  })

  it('Ctrl+K opens the palette and Esc closes it', async () => {
    await render()
    key('k', { ctrlKey: true })
    expect(useShell.getState().overlay).toBe('palette')
    key('Escape')
    expect(useShell.getState().overlay).toBeNull()
  })
})

describe('routing by hash (3.4)', () => {
  it('a place change writes #section/view and the three drawn views use their short forms', async () => {
    await render()
    expect(location.hash).toBe('#core')
    act(() => useShell.getState().go({ product: 'jarvis', section: 'room', view: 'rules' }))
    expect(location.hash).toBe('#room/rules')
    act(() => useShell.getState().go({ product: 'ww', section: 'day', view: 'today' }))
    expect(location.hash).toBe('#today')
  })

  it('a hashchange to #section/view goes to that place through the store', async () => {
    await render()
    act(() => {
      location.hash = '#study/plan'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect([section(), view()]).toEqual(['study', 'plan'])
  })
})

describe('the dock', () => {
  it('is the last element of the main column on every screen and is Ask alone when the view registers nothing', async () => {
    await render()
    const main = q('.s3-main')!
    expect(main.lastElementChild).toBe(q('.s3-dock'))
    expect(qa('.s3-mode button')).toHaveLength(0)
    expect(q('.s3-wellin input')!.getAttribute('placeholder')).toMatch(/^e\.g\. /)
  })

  it('Enter in Ask opens the palette', async () => {
    await render()
    click(q('.s3-send'))
    expect(useShell.getState().overlay).toBe('palette')
  })
})
