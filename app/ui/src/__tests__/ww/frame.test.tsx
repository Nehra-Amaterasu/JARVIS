// Chunk 4: the Studio frame (plan 8.1 "Frame and tabs"). Fictional data only; every page is a stub.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useEffect, type ComponentType } from 'react'
import { mount, resetHtml } from './_stubs'
import { Frame, resetConsumedTabForTests } from '../../ww/frame/Frame'
import { resetFrameFlagForTests, wwFrameEnabled, FLAG_KEY } from '../../ww/frame/flag'
import { resetFrameStore, useFrame } from '../../ww/frame/frameStore'
import { goBack, jumpTo, switchWorkspace } from '../../ww/frame/navigate'
import { OVERLAYS, closeOverlay, openOverlay, registerOverlay, useOverlay, type OverlayId } from '../../ww/frame/overlayRegistry'
import { densityOf, proofModeOf } from '../../ww/frame/density'
import { featureTokens, probeFeatures } from '../../ww/frame/features'
import { LEGACY, LEGACY_IDS, WORKSPACES, WS_IDS, destinationOf, type WsId } from '../../ww/frame/workspaces'
import { resolveSeason, type ServerSeason } from '../../ww/frame/season'
import { useWorkspaceValue, workspaceMemory } from '../../ww/frame/workspaceMemory'
import { TABS } from '../../lib/store'

// ---- a ResizeObserver whose width the test sets
const observers: { cb: (e: unknown[]) => void }[] = []
class FakeRO {
  cb: (e: unknown[]) => void
  constructor(cb: (e: unknown[]) => void) {
    this.cb = cb
    observers.push(this)
  }
  observe() {}
  unobserve() {}
  disconnect() {
    const i = observers.indexOf(this)
    if (i >= 0) observers.splice(i, 1)
  }
}
const setWidth = (w: number) => act(() => observers.forEach((o) => o.cb([{ contentRect: { width: w } }])))

function Stub({ id }: { id: WsId }) {
  const [sel, setSel] = useWorkspaceValue(id, 'selected', 'none')
  const [view, setView] = useWorkspaceValue(id, 'view', 'papers')
  const [draft, setDraft] = useWorkspaceValue(id, 'draft', '')
  useEffect(() => void (document.body.dataset.lastMounted = id), [id])
  return (
    <div data-page={id}>
      <h1>Legacy {id}</h1>
      <output data-sel>{sel}</output>
      <output data-view>{view}</output>
      <output data-draft>{draft}</output>
      <button data-pick onClick={() => setSel('node-7')}>pick</button>
      <button data-view-btn onClick={() => setView('plan')}>plan</button>
      <button data-type onClick={() => setDraft('half a sentence')}>type</button>
    </div>
  )
}
const pages = Object.fromEntries(WS_IDS.map((id) => [id, () => <Stub id={id} />])) as unknown as Record<WsId, ComponentType>

let m: ReturnType<typeof mount> | null = null
const show = (props: Partial<Parameters<typeof Frame>[0]> = {}) => {
  m = mount(<Frame loaded pages={pages} {...props} />)
  return m
}
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T
const tab = (id: WsId) => q<HTMLButtonElement>(`#ww-tab-${id}`)
const active = () => q('.ww-centre').getAttribute('data-ws')
const key = (init: KeyboardEventInit, target: EventTarget = document.body) => act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })))
const alt = (n: number) => key({ key: String(n), code: `Digit${n}`, altKey: true })
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms))
const flush = () => act(async () => void (await Promise.resolve()))

beforeEach(() => {
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeRO
  resetFrameStore()
  resetConsumedTabForTests()
  workspaceMemory.clear()
  closeOverlay()
  sessionStorage.clear()
  localStorage.clear()
})
afterEach(() => {
  m?.unmount()
  m = null
  vi.useRealTimers()
  delete (document as { startViewTransition?: unknown }).startViewTransition
  resetHtml()
  document.body.innerHTML = ''
  delete document.body.dataset.lastMounted
  location.hash = ''
  resetFrameFlagForTests()
})

describe('the regions and the tabs', () => {
  it('renders left, centre and right regions with landmarks and one h1 per workspace named like its tab', async () => {
    show()
    await flush()
    expect(q('aside[aria-label="Today"]')).toBeTruthy()
    expect(q('main.ww-centre')).toBeTruthy()
    expect(q('aside[aria-label="Proof"]')).toBeTruthy()
    expect(q('[role="tablist"]')).toBeTruthy()
    // the legacy page's own h1 is demoted, so exactly one real h1 is left and it is the tab's name
    const h1s = [...document.querySelectorAll('h1')].filter((h) => h.getAttribute('role') !== 'heading')
    expect(h1s).toHaveLength(1)
    expect(h1s[0].textContent).toBe(WORKSPACES.find((w) => w.id === active())!.label)
    expect(q('.ww-centre').getAttribute('data-ws')).toBe(active())
  })

  it('has exactly six tabs in the order Study, Tree, Life, Career, Focus, Setup and none is dimmed', () => {
    show()
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    expect(tabs.map((t) => t.textContent)).toEqual(['Study', 'Tree', 'Life', 'Career', 'Focus', 'Setup'])
    for (const t of tabs) {
      expect(t.disabled).toBe(false)
      expect(t.hasAttribute('aria-disabled')).toBe(false)
    }
    expect(tabs.filter((t) => t.getAttribute('aria-selected') === 'true')).toHaveLength(1)
  })

  it('opens on Life in normal season and on Study in exam season, until something chooses', () => {
    show({ server: { ...base(), season: 'exams', opens: 'study' } })
    expect(active()).toBe('study')
    m!.unmount()
    resetFrameStore()
    show({ server: { ...base(), season: 'normal' } })
    expect(active()).toBe('life')
  })
})

describe('keys', () => {
  it('Alt+1..6 switch workspace and move focus to the new workspace heading', async () => {
    show()
    for (const w of WORKSPACES) {
      alt(w.key)
      await flush()
      expect(active()).toBe(w.id)
      expect(document.activeElement).toBe(q('h1[data-ww-h1]'))
      expect(document.activeElement!.textContent).toBe(w.label)
    }
  })

  it('Ctrl+n and Alt+Shift+n are not ours: Ctrl+1..6 stays the app shell\'s and nothing here handles it', () => {
    show()
    const before = active()
    const e = new KeyboardEvent('keydown', { key: '2', code: 'Digit2', ctrlKey: true, bubbles: true, cancelable: true })
    act(() => void document.body.dispatchEvent(e))
    expect(active()).toBe(before)
    expect(e.defaultPrevented).toBe(false) // Shell's own handler is the one that prevents it
    key({ key: '2', code: 'Digit2', altKey: true, shiftKey: true })
    expect(active()).toBe(before)
  })

  it('arrow keys walk the tabs and select', async () => {
    show()
    await act(async () => void tab('study').click())
    key({ key: 'ArrowRight' }, tab('study'))
    await flush()
    expect(active()).toBe('tree')
    key({ key: 'End' }, tab('tree'))
    await flush()
    expect(active()).toBe('setup')
  })
})

describe('density and the Proof column', () => {
  it('sets data-density compact at 1290, regular at 1600, roomy at 1844 (stubbed sizes), narrow under 1000', () => {
    show()
    const root = q('.ww-frame')
    setWidth(1290)
    expect(root.dataset.density).toBe('compact')
    setWidth(1600)
    expect(root.dataset.density).toBe('regular')
    setWidth(1844)
    expect(root.dataset.density).toBe('roomy')
    setWidth(900)
    expect(root.dataset.density).toBe('narrow')
    expect([999, 1000, 1499, 1500, 1799, 1800].map(densityOf)).toEqual(['narrow', 'compact', 'compact', 'regular', 'regular', 'roomy'])
  })

  it('shows the proof column as a rail below 1500 and pinned from 1500', () => {
    show()
    setWidth(1290)
    expect(q('aside[aria-label="Proof"]').dataset.mode).toBe('rail')
    expect(q('aside[aria-label="Proof"] button[aria-label="Open Proof"]')).toBeTruthy()
    setWidth(1500)
    expect(q('aside[aria-label="Proof"]').dataset.mode).toBe('pinned')
    // a pinned panel owns no primary and no open/close toggle; since chunk 9 its cards hold their own quiet links
    expect(q('aside[aria-label="Proof"] button[aria-label="Open Proof"], aside[aria-label="Proof"] button[aria-label="Close Proof"]')).toBeNull()
    expect(q('aside[aria-label="Proof"] [data-primary]')).toBeNull()
    expect([999, 1000, 1499, 1500].map(proofModeOf)).toEqual(['sheet', 'rail', 'rail', 'pinned'])
  })
})

describe('the frame stays put, the centre moves', () => {
  it('keeps the left column mounted, with identical DOM nodes, across a switch', async () => {
    show()
    const left = q('.ww-left')
    const slot = q('.ww-left [data-slot="now"]')
    const strip = q('.ww-strip')
    await act(async () => void (await switchWorkspace('career')))
    await act(async () => void (await switchWorkspace('focus')))
    expect(active()).toBe('focus')
    expect(q('.ww-left')).toBe(left)
    expect(q('.ww-left [data-slot="now"]')).toBe(slot)
    expect(q('.ww-strip')).toBe(strip)
  })

  it('a workspace switch names only the centre (ww-centre) and, under data-ww, unnames the Shell .main page', () => {
    const dir = join(__dirname, '../../ww')
    const motion = readFileSync(join(dir, 'design/motion.css'), 'utf8')
    const frame = readFileSync(join(dir, 'frame/frame.css'), 'utf8')
    expect(motion).toMatch(/\.ww-centre\s*\{\s*view-transition-name:\s*ww-centre/)
    expect(frame).toMatch(/html\[data-ww\]\s+\.main\s*\{\s*view-transition-name:\s*none/)
    // nothing else in the frame names a transition group
    expect(frame.match(/view-transition-name/g)).toHaveLength(1)
    show()
    expect(document.documentElement.hasAttribute('data-ww')).toBe(true)
  })

  it('every one of the 30 ordered pairs lands, through one view transition when there is one', async () => {
    vi.useFakeTimers()
    let clock = 10_000 // runSwitch reads performance.now() for its 600 ms rapid-switch rule
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    const calls: number[] = []
    ;(document as unknown as { startViewTransition: unknown }).startViewTransition = (cb: () => void) => {
      calls.push(1)
      cb()
      return { finished: Promise.resolve(), skipTransition() {} }
    }
    show({ server: null, glass: 'blur' }) // flat glass means the low governor, which takes the 160 ms fade
    let n = 0
    for (const a of WS_IDS) {
      for (const b of WS_IDS) {
        if (a === b) continue
        await act(async () => void (await switchWorkspace(a)))
        clock += 700 // past the 600 ms rapid-switch window, so each pair takes the transition path
        const before = calls.length
        await act(async () => void (await switchWorkspace(b)))
        expect(active(), `${a} to ${b}`).toBe(b)
        expect(calls.length - before, `${a} to ${b}`).toBe(1)
        clock += 700
        n++
      }
    }
    expect(n).toBe(30)
  })

  it('without startViewTransition a switch is the 160 ms fade on the centre and still lands', async () => {
    show()
    await act(async () => void (await switchWorkspace('tree')))
    expect(active()).toBe('tree')
    expect(q('.ww-centre').getAttribute('data-switch')).toBe('fade')
  })
})

describe('scene memory', () => {
  it('restores scroll, selected id, view and a draft text when returning to a workspace', async () => {
    show()
    await act(async () => void (await switchWorkspace('study')))
    act(() => void q('[data-pick]').click())
    act(() => void q('[data-view-btn]').click())
    act(() => void q('[data-type]').click())
    q('.ww-scroll').scrollTop = 240
    await act(async () => void (await switchWorkspace('tree')))
    expect(q('[data-sel]').textContent).toBe('none') // another workspace has its own scene
    expect(q('.ww-scroll').scrollTop).toBe(0)
    await act(async () => void (await switchWorkspace('study')))
    expect(q('[data-sel]').textContent).toBe('node-7')
    expect(q('[data-view]').textContent).toBe('plan')
    expect(q('[data-draft]').textContent).toBe('half a sentence')
    expect(q('.ww-scroll').scrollTop).toBe(240)
  })

  it('workspaceMemory remembers view and selection per tree id, not only per workspace', () => {
    workspaceMemory.setTree('gate-core', { view: 'fit', selection: 'n12' })
    workspaceMemory.setTree('german', { view: 'zoom', selection: null })
    workspaceMemory.setTree('gate-core', { selection: 'n13' })
    expect(workspaceMemory.tree('gate-core')).toEqual({ view: 'fit', selection: 'n13' })
    expect(workspaceMemory.tree('german')).toEqual({ view: 'zoom', selection: null })
    expect(workspaceMemory.tree('unknown')).toEqual({})
  })

  it('marks a tab with a static neutral dot when its scene is not default, and Tab badges off hides every dot', () => {
    show()
    expect(document.querySelectorAll('.ww-tab-dot')).toHaveLength(0)
    act(() => void q('[data-pick]').click())
    expect(tab(active() as WsId).querySelector('.ww-tab-dot')).toBeTruthy()
    act(() => useFrame.getState().setDirty('setup', true))
    expect(tab('setup').querySelector('.ww-tab-dot')!.getAttribute('data-kind')).toBe('unsaved')
    m!.unmount()
    localStorage.setItem('ww.tabBadges', 'off')
    show()
    expect(document.querySelectorAll('.ww-tab-dot')).toHaveLength(0)
  })

  it('survives blocked storage: the memory still works for the page', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => workspaceMemory.set('life', 'filter', 'open', 'all')).not.toThrow()
    expect(workspaceMemory.get('life', 'filter', 'all')).toBe('open')
    spy.mockRestore()
  })
})

describe('Back chip and Esc order', () => {
  it('shows a Back chip after a cross-workspace jump and returns on Alt+Left and Esc; the chip has no timer and goes away on the next navigation', async () => {
    vi.useFakeTimers()
    show()
    await act(async () => void (await switchWorkspace('tree')))
    await act(async () => void (await jumpTo('study', 'library')))
    expect(active()).toBe('study')
    expect(q('.ww-back').textContent).toContain('Back to Tree')
    tick(30 * 60 * 1000) // half an hour: the only route back must not expire
    expect(q('.ww-back')).toBeTruthy()
    key({ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true })
    await flush()
    expect(active()).toBe('tree')
    expect(q('.ww-back')).toBeNull()

    await act(async () => void (await jumpTo('career')))
    expect(q('.ww-back')).toBeTruthy()
    key({ key: 'Escape' })
    await flush()
    expect(active()).toBe('tree')
    expect(q('.ww-back')).toBeNull()

    await act(async () => void (await jumpTo('focus')))
    expect(q('.ww-back')).toBeTruthy()
    await act(async () => void (await switchWorkspace('life'))) // the next navigation
    expect(q('.ww-back')).toBeNull()
  })

  it('the chip returns to the stored scene (view and scroll), and the X dismisses it without moving', async () => {
    show()
    await act(async () => void (await switchWorkspace('tree', 'fit')))
    q('.ww-scroll').scrollTop = 90
    await act(async () => void (await jumpTo('study')))
    act(() => void q('.ww-back-go').click())
    await flush()
    expect(active()).toBe('tree')
    expect(useFrame.getState().view).toBe('fit')
    expect(q('.ww-scroll').scrollTop).toBe(90)
    await act(async () => void (await jumpTo('career')))
    act(() => void q('.ww-back-x').click())
    expect(q('.ww-back')).toBeNull()
    expect(active()).toBe('career')
    await act(async () => void (await goBack())) // nothing to go back to: a no-op
    expect(active()).toBe('career')
  })

  it('Esc closes the top overlay first, then focus mode, then the Back chip', async () => {
    vi.useFakeTimers()
    show()
    await act(async () => void (await jumpTo('study')))
    act(() => useFrame.getState().setFocus(true))
    act(() => void openOverlay('log'))
    expect(useOverlay.getState().open).toBe('log')
    key({ key: 'Escape' }, document.activeElement ?? document.body)
    expect(useOverlay.getState().open).toBeNull()
    expect(useFrame.getState().focus).toBe(true)
    expect(useFrame.getState().back).not.toBeNull()
    tick(300)
    key({ key: 'Escape' })
    expect(useFrame.getState().focus).toBe(false)
    expect(useFrame.getState().back).not.toBeNull()
    key({ key: 'Escape' })
    await flush()
    expect(useFrame.getState().back).toBeNull()
  })
})

describe('overlays', () => {
  it('openOverlay(id) mounts a stub for every id O1 to O8, and Esc closes it', () => {
    vi.useFakeTimers()
    show()
    expect(OVERLAYS.map((o) => o.n)).toEqual(['O1', 'O2', 'O3', 'O4', 'O5', 'O6', 'O7', 'O8'])
    for (const o of OVERLAYS) {
      act(() => void openOverlay(o.id))
      const stub = document.querySelector(`[data-overlay-stub="${o.id}"]`)
      expect(stub, o.id).toBeTruthy()
      expect(stub!.textContent).toContain(o.title)
      expect(document.querySelector('.ww-sheet')!.getAttribute('data-state')).toBe('open')
      key({ key: 'Escape' }, document.activeElement ?? document.body)
      expect(useOverlay.getState().open, o.id).toBeNull()
      tick(300)
    }
  })

  it('an unknown id opens nothing, a second open replaces the first, and a registered overlay replaces the stub', () => {
    show()
    expect(openOverlay('nope' as OverlayId)).toBe(false)
    expect(useOverlay.getState().open).toBeNull()
    openOverlay('add')
    openOverlay('date')
    expect(useOverlay.getState().open).toBe('date') // never more than one deep
    const undo = registerOverlay('date', ({ title }) => <p data-real>{String(title)}</p>)
    act(() => void openOverlay('date', { title: 'real one' }))
    expect(document.querySelector('[data-real]')!.textContent).toBe('real one')
    expect(document.querySelector('[data-overlay-stub="date"]')).toBeNull()
    undo()
  })

  it('an overlay stub holds no button but the close X, so it never claims the primary fill', () => {
    show()
    act(() => void openOverlay('record'))
    const buttons = [...document.querySelectorAll('.ww-sheet button')]
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Close Record'])
    expect(document.querySelectorAll('[data-primary]')).toHaveLength(0)
  })
})

describe('legacy ids', () => {
  it('every one of the 15 legacy tab ids resolves to the destination in 3.2', () => {
    const mission = TABS.filter((t) => t.group === 'mission').map((t) => t.id).sort()
    expect(LEGACY_IDS.sort()).toEqual(mission)
    expect(mission).toHaveLength(15)
    const first: WsId = 'life'
    const where = (id: string) => {
      const d = destinationOf(id, first)!
      return `${d.ws}${d.view ? '/' + d.view : ''}${d.panel ? '+' + d.panel : ''}${d.overlay ? '+' + d.overlay : ''}`
    }
    expect(Object.fromEntries(mission.map((id) => [id, where(id)]))).toEqual({
      mission: 'life', schedule: 'study/plan', syllabus: 'tree', quests: 'life', campaign: 'career/pipeline', trials: 'career/abroad',
      armory: 'career/money', status: 'life+proof', proof: 'life+proof', crucible: 'focus/crucible', drill: 'focus/drill',
      terminal: 'life+log', forge: 'life', interrogation: 'study/library', calibration: 'setup/calibration',
    })
    expect(destinationOf('mission', 'study')!.ws).toBe('study') // 'default' follows the season
    expect(destinationOf('core', 'study')).toBeNull()
    expect(LEGACY.status.panel).toBe('proof')
  })

  it('one deep link per alias opens its destination', () => {
    for (const id of LEGACY_IDS) {
      resetFrameStore()
      resetConsumedTabForTests()
      closeOverlay()
      const first: WsId = 'life'
      const want = destinationOf(id, first)!
      show({ legacyTab: id })
      if (id !== 'mission') {
        expect(active(), id).toBe(want.ws)
        expect(useFrame.getState().view, id).toBe(want.view ?? null)
        if (want.panel) expect(useFrame.getState().proofOpen, id).toBe(true)
        if (want.overlay) expect(useOverlay.getState().open, id).toBe(want.overlay)
      }
      m!.unmount()
      m = null
      closeOverlay()
      document.body.innerHTML = ''
    }
  })

  it('a remount with the same tab restores the workspace the user moved to instead of deep-linking again', async () => {
    show({ legacyTab: 'schedule' })
    expect(active()).toBe('study')
    await act(async () => void (await switchWorkspace('career')))
    m!.unmount()
    show({ legacyTab: 'schedule' })
    expect(active()).toBe('career')
  })
})

describe('season', () => {
  it('the season pill switches the left column between Countdown and Horizon, announces it once in an aria-live line, and reserves its space', async () => {
    show({ server: { ...base(), season: 'normal', left_top: 'horizon', nearest_days: 90 } })
    const kicker = () => q('.ww-left [data-slot="season"] .ww-kicker').textContent
    expect(kicker()).toBe('Horizon')
    expect(q('[data-season-live]').textContent).toBe('') // nothing announced on first paint
    const pill = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Season"] button, [role="radiogroup"][aria-label="Season"] button')].find((b) => b.textContent === name)!
    act(() => void pill('Exams').click())
    expect(kicker()).toBe('Countdown')
    expect(q('.ww-frame').dataset.season).toBe('exams')
    expect(q('[data-season-live]').textContent).toMatch(/Exam season/)
    act(() => void pill('Auto').click())
    expect(kicker()).toBe('Horizon')
    expect(q('[data-season-live]').textContent).toMatch(/Normal season/)
    // the slot keeps its height whichever name it carries
    const css = readFileSync(join(__dirname, '../../ww/frame/frame.css'), 'utf8')
    expect(css).toMatch(/\.ww-left-slot\s*\{[^}]*min-height:/)
  })

  it('shows Close the day in the second slot in the evening, and says so honestly when no season was read', () => {
    show({ server: { ...base(), evening: true, now_card: 'close_the_day' } })
    expect(q('.ww-left [data-slot="now"] .ww-kicker').textContent).toBe('Close the day')
    m!.unmount()
    show({ server: null })
    expect(q('.ww-left [data-slot="season"]').textContent).toContain('Season not read yet')
    expect(resolveSeason(null, 'auto').known).toBe(false)
  })

  it('resolveSeason applies the pill over the server dict with the same table the server uses', () => {
    const exams = resolveSeason({ ...base(), season: 'normal' }, 'exams')
    expect([exams.season, exams.left_top, exams.opens, exams.due_soon_days, exams.findings_hidden, exams.firstWorkspace]).toEqual(['exams', 'countdown', 'study', 3, true, 'study'])
    const normal = resolveSeason({ ...base(), season: 'exams' }, 'normal')
    expect([normal.season, normal.left_top, normal.opens, normal.due_soon_days, normal.findings_hidden, normal.firstWorkspace]).toEqual(['normal', 'horizon', 'life', 7, false, 'life'])
  })
})

describe('the flag', () => {
  it('is off by default and with a junk value', () => {
    expect(wwFrameEnabled()).toBe(false)
    resetFrameFlagForTests()
    localStorage.setItem(FLAG_KEY, 'maybe')
    expect(wwFrameEnabled()).toBe(false)
  })
  it('turns on from localStorage, or from the URL fragment (which it then remembers), and is read once', () => {
    localStorage.setItem(FLAG_KEY, 'frame')
    expect(wwFrameEnabled()).toBe(true)
    localStorage.setItem(FLAG_KEY, 'off')
    expect(wwFrameEnabled()).toBe(true) // read once: a mid-session change does not swap the UI

    resetFrameFlagForTests()
    localStorage.clear()
    location.hash = '#t=abc123&ww=frame'
    expect(wwFrameEnabled()).toBe(true)
    expect(localStorage.getItem(FLAG_KEY)).toBe('frame')

    resetFrameFlagForTests()
    location.hash = '#ww=off'
    expect(wwFrameEnabled()).toBe(false)
    expect(localStorage.getItem(FLAG_KEY)).toBe('off')
  })
  it('survives blocked storage', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(wwFrameEnabled()).toBe(false)
    spy.mockRestore()
  })
})

describe('feature probe', () => {
  it('reports what the browser has and lists only the present ones in data-feat', () => {
    ;(document as unknown as { startViewTransition: unknown }).startViewTransition = () => ({})
    const f = probeFeatures()
    expect(f.viewTransition).toBe(true)
    expect(featureTokens({ inert: true, viewTransition: false, animationTimeline: true, contentVisibility: false, chromium: 130 })).toBe('inert animation-timeline')
    show()
    expect(q('.ww-frame').dataset.feat).toContain('view-transition')
  })
})

function base(): ServerSeason {
  return {
    season: 'normal', mode: 'auto', window_days: 45, nearest_days: null, evening: false, evening_why: null,
    left_top: 'horizon', opens: 'life', due_soon_days: 7, findings_hidden: false, now_card: 'now',
  }
}
