// The v3 shell rendered through ShellV2's one branch in happy-dom: the contracts the rest of the app finds the shell by, the
// spine, the top plate, the lamp pill, the dock and the keyboard paths. The look is switched on the way a person does it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { mount } from '../../ww/_stubs'
import ShellV2 from '../../../shell/ShellV2'
import { LOOK_KEY, resetLookForTests } from '../../../shell/look'
import { resetShellForTests, useShell } from '../../../shell/store'
import { resetPortsForTests } from '../../../shell/ports'
import { setViewsForTests } from '../../../shell/views'
import { useStore } from '../../../lib/store'

// the Setup page is a lazy chunk of the panes, the plan store and their routes: these tests are about the place, the row and the keys, so the chunk is
// a stub (the page itself is proved by ww/setup tests and by e2e/setup-v3.spec.ts)
vi.mock('../../../ww/setup/SetupV3', () => ({ default: () => null, showSetupPane: () => undefined }))

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
  setViewsForTests(null)
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

describe('Setup (R18): the page the older frame kept behind Alt+6', () => {
  const at = () => [q('.s2-page')!.dataset.section, q('.s2-page')!.dataset.view]

  it('is a row at the foot of the Well Wisher group, and the row opens it with its own hash', async () => {
    await render()
    click(q('.s3-head[data-project="wellwisher"]'))
    const row = qa('.s3-slot .s3-item').pop()!
    expect(row.dataset.section).toBe('setup')
    expect(row.getAttribute('aria-keyshortcuts')).toBe('Alt+6')
    click(row)
    expect(at()).toEqual(['app', 'setup'])
    expect(location.hash).toBe('#setup')
    expect(q('.s3-item[data-section="setup"]')!.getAttribute('aria-current')).toBe('page')
    // Well Wisher stays the open project, on its light ground, and no other row claims to be the place
    expect(qa('.s3-grp').filter((g) => g.dataset.open === 'true').map((g) => g.dataset.p)).toEqual(['wellwisher'])
    expect(q('.s3')!.dataset.ground).toBe('light')
    expect(qa('.s3-item[aria-current="page"]')).toHaveLength(1)
    expect(q('.s3-loc-s')!.textContent).toBe('Setup')
  })

  it('Alt+6 opens it from anywhere (the key of the older frame for Setup)', async () => {
    await render()
    expect(section()).toBe('core')
    key('6', { altKey: true, code: 'Digit6' })
    expect(at()).toEqual(['app', 'setup'])
  })

  it('#setup and #setup/<pane> open it; a hash of another place leaves it', async () => {
    history.replaceState(null, '', '/#setup/subjects')
    await render()
    expect(at()).toEqual(['app', 'setup'])
    act(() => { location.hash = '#today'; window.dispatchEvent(new HashChangeEvent('hashchange')) })
    expect(at()).toEqual(['day', 'today'])
  })

  it('does not change the ten sections: Alt+Down still walks them and never stops on Setup', async () => {
    await render()
    const seen: string[] = []
    for (let i = 0; i < 10; i++) {
      key('ArrowDown', { altKey: true })
      seen.push(section()!)
    }
    expect(seen).not.toContain('app')
  })
})

describe('the spine', () => {
  it('names the four sub-projects, each with a state line, and opens the one that holds the section', async () => {
    await render()
    expect(qa('.s3-grp').map((g) => g.dataset.p)).toEqual(['jarvis', 'aankhen', 'yadaash', 'wellwisher'])
    expect(qa('.s3-grp').filter((g) => g.dataset.open === 'true').map((g) => g.dataset.p)).toEqual(['jarvis'])
    expect(qa('.s3-item').map((b) => b.dataset.section)).toEqual(['core', 'room', 'console'])
    for (const g of qa('.s3-grp')) {
      // every row is ONE line: icon, name and a lamp; the word and its reason are the lamp's title (and the row's accessible name)
      expect(g.querySelector('.s3-lamp')!.getAttribute('title')).toMatch(/^(LIVE|WAITING|SIMULATED|PLANNED|FAULT) · \S/)
      expect(g.querySelector('.s3-head')!.querySelectorAll('.s3-pi, .s3-pn, .s3-lamp')).toHaveLength(3)
    }
    // the state is printed as a word only under the OPEN project
    expect(qa('.s3-pw small').map((n) => n.closest('.s3-grp')!.getAttribute('data-p'))).toEqual(['jarvis'])
    expect(q('.s3-pw small')!.textContent).toMatch(/^(LIVE|WAITING|SIMULATED|PLANNED|FAULT)$/)
  })

  it('shows the relation by order and one small gap between groups: the room, memory, his day', async () => {
    await render()
    expect(qa('.s3-grp').map((g) => g.dataset.gap)).toEqual(['0', '0', '1', '1'])
  })

  it('Yadaash carries one planned row, Agents, that opens the planned pose and never a place', async () => {
    await render()
    expect(q('[data-extra="agents"]')).toBeNull() // only under the open project
    click(q('.s3-head[data-project="yadaash"]'))
    expect(section()).toBe('memory')
    const row = q<HTMLButtonElement>('.s3-extra[data-extra="agents"]')!
    expect(row.getAttribute('data-state')).toBe('planned')
    expect(row.getAttribute('aria-label')).toBe('Agents, planned. Agents are being planned; nothing runs here yet')
    click(row)
    expect(section()).toBe('memory') // the place did not change
    expect(useShell.getState().overlay).toBe('roadmap')
    expect(useShell.getState().roadmapFocus).toBe('jarvis.agents')
  })

  it('the open project sets the hue on the root and the shell, and the page ground follows it', async () => {
    await render()
    expect(document.documentElement.getAttribute('data-hue')).toBe('jarvis')
    click(q('.s3-head[data-project="aankhen"]'))
    expect(document.documentElement.getAttribute('data-hue')).toBe('aankhen')
    expect(q('.s3')!.dataset.project).toBe('aankhen')
    click(q('.s3-head[data-project="wellwisher"]'))
    expect(document.documentElement.getAttribute('data-hue')).toBe('wellwisher')
  })

  // 28 Nov (V1): the spine now folds by itself below 1420 px of window (ShellV3 AUTO_RAIL_BELOW) and the stored key is a PIN,
  // kept only while it differs from what the window would choose. These two tests used to start full at any width and store
  // every choice; they now set the window width and hold the pin rule.
  const width = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value: w })
  afterEach(() => {
    delete (window as unknown as { innerWidth?: number }).innerWidth
  })
  it('on a wide window starts open, folds to a 64 px icon rail, keeps every row reachable by its accessible name, and pins the choice', async () => {
    width(1600)
    await render()
    expect(q('.s3')!.dataset.spine).toBe('full')
    expect(q('.s3')!.dataset.spinePin).toBe('auto')
    const fold = q<HTMLButtonElement>('.s3-fold')!
    expect(fold.getAttribute('aria-pressed')).toBe('false')
    click(fold)
    expect(q('.s3')!.dataset.spine).toBe('rail')
    expect(q('.s3')!.dataset.spinePin).toBe('pinned')
    expect(localStorage.getItem('app.spine')).toBe('rail')
    expect(q('.s3-fold')!.getAttribute('aria-label')).toBe('Unfold the sidebar')
    // names live in the tooltip, the flyout and the accessible name once the text is hidden by CSS
    expect(q('.s3-head[data-project="aankhen"]')!.getAttribute('title')).toContain('Aankhen')
    expect(q('.s3-item[data-section="room"]')!.getAttribute('aria-label')).toBe('Room')
    expect(q('.s3-item[data-section="room"]')!.getAttribute('data-fly')).toBe('Room')
    click(q('.s3-item[data-section="room"]'))
    expect(section()).toBe('room')
    // folding back to what the window wants returns the sidebar to automatic and forgets the pin
    click(q('.s3-fold'))
    expect(q('.s3')!.dataset.spine).toBe('full')
    expect(q('.s3')!.dataset.spinePin).toBe('auto')
    expect(localStorage.getItem('app.spine')).toBeNull()
  })

  it('on a 1366 px window starts as the rail by itself, and pinning it open is kept', async () => {
    width(1366)
    await render()
    expect(q('.s3')!.dataset.spine).toBe('rail')
    expect(q('.s3')!.dataset.spinePin).toBe('auto')
    click(q('.s3-fold'))
    expect(q('.s3')!.dataset.spine).toBe('full')
    expect(localStorage.getItem('app.spine')).toBe('full')
  })

  it('reads the stored fold on load', async () => {
    width(1600)
    localStorage.setItem('app.spine', 'rail')
    await render()
    expect(q('.s3')!.dataset.spine).toBe('rail')
  })

  it('draws no look key: nothing to press switches to another look or to the classic interface', async () => {
    await render()
    const words = [...document.querySelectorAll('button')].map((b) => `${b.textContent} ${b.getAttribute('aria-label') ?? ''}`).join('|')
    expect(words).not.toMatch(/New look|Current look|Classic UI|New UI/i)
    click(q('.s3-iconkey[aria-haspopup]'))
    expect(q('.s3-pop')!.textContent).not.toMatch(/look|Classic/i)
    expect(q('[data-more="current-look"], [data-more="classic-ui"]')).toBeNull()
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
    // Setup (R18) is the last row of Well Wisher: a real place of the shell's own, not one of the ten sections
    expect(qa('.s3-item').map((b) => b.dataset.section)).toEqual(['day', 'focus', 'study', 'tree', 'career', 'setup'])
  })

  it('every section of the ten is reachable by pointer through the spine', async () => {
    await render()
    const seen = new Set<string>()
    for (const proj of ['jarvis', 'aankhen', 'yadaash', 'wellwisher']) {
      const tile = q(`.s3-head[data-project="${proj}"]`) // the open multi-section tile is not a key: it is already open
      if (tile) click(tile)
      for (const b of qa('.s3-item:not(.s3-extra):not([data-section="setup"])')) {
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
    // the first views (Day / Today, Core / Talk) register a dock mode and More rows since the layout pass of 21 Nov; this test is about
    // a view that registers nothing, so their registrations are hidden and the host page stands in
    setViewsForTests(null, ['day.today', 'core.talk'])
    await render()
    const more = q('.s3-iconkey[aria-haspopup]')!
    // the two look keys are gone (25 Nov), so a view with no registered action has none: More holds the Frosted switch and the keys
    expect(more.getAttribute('data-tip')).toBe('Appearance and keys')
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
    expect(q('.s3-pop')!.textContent).not.toContain('RARELY NEEDED')
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
    expect(q('.s3-grp[data-p="jarvis"] .s3-lamp')!.getAttribute('title')).toBe('FAULT · steward')
    expect(q('.s3-grp[data-p="aankhen"] .s3-lamp')!.getAttribute('title')).toBe('WAITING · no sensor')
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
    // the first views (Day / Today, Core / Talk) register a dock mode and More rows since the layout pass of 21 Nov; this test is about
    // a view that registers nothing, so their registrations are hidden and the host page stands in
    setViewsForTests(null, ['day.today', 'core.talk'])
    await render()
    const main = q('.s3-main')!
    expect(main.lastElementChild).toBe(q('.s3-dock'))
    expect(qa('.s3-mode button')).toHaveLength(0)
    expect(q('.s3-wellin input')!.getAttribute('placeholder')).toMatch(/^e\.g\. /)
  })

  it('Enter in Ask opens the palette', async () => {
    // the first views (Day / Today, Core / Talk) register a dock mode and More rows since the layout pass of 21 Nov; this test is about
    // a view that registers nothing, so their registrations are hidden and the host page stands in
    setViewsForTests(null, ['day.today', 'core.talk'])
    await render()
    click(q('.s3-send'))
    expect(useShell.getState().overlay).toBe('palette')
  })
})
