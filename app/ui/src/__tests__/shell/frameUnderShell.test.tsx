// A.N02 (a) and (b) on the real Well Wisher Frame: under shell v2 the frame draws no strip of its own; its season
// switch, Roadmap and extras are portalled into the shell's view row (#s2-frame-tools) and stay reachable; the
// centre is not a second <main>; and the shell's view switch moves Life's view (Life keeps its view in workspace
// memory, and its own switch is hidden under the shell). Without the shell the frame is unchanged.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, createElement, useEffect, type ComponentType } from 'react'
import { mount, resetHtml } from '../ww/_stubs'
import { Frame, resetConsumedTabForTests } from '../../ww/frame/Frame'
import { resetFrameStore, useFrame } from '../../ww/frame/frameStore'
import { useWorkspaceValue, workspaceMemory } from '../../ww/frame/workspaceMemory'
import { WS_IDS, type WsId } from '../../ww/frame/workspaces'
import { closeOverlay } from '../../ww/frame/overlayRegistry'

class FakeRO {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** A stand-in for LifeWorkspace: its view lives in workspace memory, as the real one does. */
function LifeStub() {
  const [view] = useWorkspaceValue<'today' | 'week'>('life', 'view', 'today')
  useEffect(() => undefined, [])
  return createElement('output', { 'data-life-view': '' }, view)
}
const pages = Object.fromEntries(WS_IDS.map((id) => [id, id === 'life' ? LifeStub : () => createElement('div', { 'data-page': id })])) as unknown as Record<WsId, ComponentType>

let m: ReturnType<typeof mount> | null = null
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T & Element>(sel) as T | null
const flush = () => act(async () => void (await Promise.resolve()))

/** The frame inside a minimal shell: the root marker and the tools row the shell renders before the lazy frame. */
function underShell() {
  const shell = document.createElement('div')
  shell.setAttribute('data-shell', 'v2')
  const tools = document.createElement('div')
  tools.id = 's2-frame-tools'
  shell.appendChild(tools)
  const host = document.createElement('div')
  shell.appendChild(host)
  document.body.appendChild(shell)
  return { shell, tools, host }
}

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
  resetHtml()
  document.body.innerHTML = ''
})

describe('(a) the frame folded into the shell', () => {
  it('draws no strip, puts season, Roadmap and the extras in the shell row, and keeps them working', async () => {
    const { tools, host } = underShell()
    const { createRoot } = await import('react-dom/client')
    const root = createRoot(host)
    act(() => root.render(createElement(Frame, { loaded: true, pages, extras: createElement('button', { type: 'button', 'data-extra': '' }, 'Settings') })))
    await flush()
    // no second navigation: the frame's strip and its workspace tabs are not drawn at all
    expect(q('.ww-strip')).toBeNull()
    expect(q('.ww-tabs')).toBeNull()
    // the tools live in the shell's row, inside a .ww-portal so the design layer still styles them
    const folded = tools.querySelector('.ww-portal[data-frame-tools]')
    expect(folded).not.toBeNull()
    expect(folded!.querySelector('[role="radiogroup"][aria-label="Season"]')).not.toBeNull()
    expect(folded!.querySelector('[data-open="roadmap"]')).not.toBeNull()
    expect(folded!.querySelector('[data-extra]')).not.toBeNull()
    // reachable and working: picking a season mode from the shell row changes the frame
    const exams = [...folded!.querySelectorAll<HTMLElement>('[role="radio"]')].find((b) => /Exams/.test(b.textContent ?? ''))!
    act(() => exams.click())
    expect(useFrame.getState().seasonMode).toBe('exams')
    // the canvas is the one main landmark: the centre is a labelled section, its panel no tabpanel of absent tabs
    expect(q('main.ww-centre')).toBeNull()
    expect(q('section.ww-centre')!.getAttribute('aria-label')).toBeTruthy()
    expect(q('.ww-centre [role="tabpanel"]')).toBeNull()
    act(() => root.unmount())
  })

  it('without the shell the strip, the tabs and the main landmark are exactly as before', async () => {
    m = mount(createElement(Frame, { loaded: true, pages }))
    await flush()
    expect(q('.ww-strip [role="tablist"]')).not.toBeNull()
    expect(q('.ww-strip [data-open="roadmap"]')).not.toBeNull()
    expect(q('main.ww-centre [role="tabpanel"]')).not.toBeNull()
    expect(q('[data-frame-tools]')).toBeNull()
  })
})

describe('(c) a remounted frame never moves itself under the shell', () => {
  // The keyboard-reach spec's bounce: after Day / Close (no frame) Ctrl+2 remounted the frame, whose mount effect
  // deep-linked from the app tab (quests -> Life) before the shell's push, and the shell followed it to Day / Today.
  it('under the shell, a legacy tab at mount does not pull the frame off the shell\'s workspace', async () => {
    useFrame.setState({ ws: 'focus', view: 'drill', chosen: true })
    const { host } = underShell()
    const { createRoot } = await import('react-dom/client')
    const root = createRoot(host)
    act(() => root.render(createElement(Frame, { loaded: true, pages, legacyTab: 'quests' })))
    await flush()
    expect(useFrame.getState()).toMatchObject({ ws: 'focus', view: 'drill' })
    act(() => root.unmount())
  })

  it('under the shell, the season default does not choose a workspace either', async () => {
    const { host } = underShell()
    useFrame.setState({ ws: 'career', view: null, chosen: false })
    const { createRoot } = await import('react-dom/client')
    const root = createRoot(host)
    act(() => root.render(createElement(Frame, { loaded: true, pages })))
    await flush()
    expect(useFrame.getState().ws).toBe('career')
    act(() => root.unmount())
  })

  it('without the shell the legacy deep link still works (today\'s behaviour)', async () => {
    useFrame.setState({ ws: 'focus', view: 'drill', chosen: true })
    m = mount(createElement(Frame, { loaded: true, pages, legacyTab: 'quests' }))
    await flush()
    expect(useFrame.getState().ws).toBe('life')
  })
})

describe('(b) the shell\'s view switch drives Life, whose own switch it hides', () => {
  it('a frame view of week under the shell shows Life\'s week view, and back to today', async () => {
    const { host } = underShell()
    const { createRoot } = await import('react-dom/client')
    const root = createRoot(host)
    act(() => root.render(createElement(Frame, { loaded: true, pages })))
    await flush()
    act(() => useFrame.getState().select('life', 'week'))
    await flush()
    expect(q('[data-life-view]')!.textContent).toBe('week')
    act(() => useFrame.getState().select('life', 'today'))
    await flush()
    expect(q('[data-life-view]')!.textContent).toBe('today')
    act(() => root.unmount())
  })

  it('without the shell the frame view does not touch Life\'s own choice (today\'s behaviour)', async () => {
    m = mount(createElement(Frame, { loaded: true, pages }))
    await flush()
    act(() => useFrame.getState().select('life', 'week'))
    await flush()
    expect(q('[data-life-view]')!.textContent).toBe('today')
  })

  it('useWorkspaceValue adopts a write made outside the component', async () => {
    m = mount(createElement(LifeStub))
    expect(q('[data-life-view]')!.textContent).toBe('today')
    act(() => workspaceMemory.set('life', 'view', 'week', 'today'))
    await flush()
    expect(q('[data-life-view]')!.textContent).toBe('week')
  })
})
