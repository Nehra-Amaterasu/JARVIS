// Chunk 10: the Focus workspace (plan 8.1 "Focus"). Fictional rotation; the clock is driven by hand.
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { mount, resetHtml } from './_stubs'
import { computeTokens, contrast, designFilesInOrder, over, parseColor, read, WW_DIR } from './_css'
import { usePlan } from '../../germoney/game/plan'
import AsyncStorage from '../../germoney/platform'
import { usePlayerStore } from '../../germoney/stores/player-store'
import { resetFrameStore, useFrame } from '../../ww/frame/frameStore'
import { workspaceMemory } from '../../ww/frame/workspaceMemory'
import { PrimaryOwner } from '../../ww/kit'
import { WwFocusPage } from '../../ww/focus/FocusWorkspace'
import { WwCrucible } from '../../ww/focus/Crucible'
import {
  DEFAULT_LENGTH, LENGTHS, MIN_COUNTED_MIN, STORAGE_KEY, endedLine, remainingS, resumeVerdict, todaysTrack, tracksFromRotation, wagerShortfall, type Active,
} from '../../ww/focus/session'

const ROTATION = {
  '1': { track: 'digital', label: 'Digital logic', match: [] },
  '2': { track: 'math', label: 'Maths', match: [] },
  '3': { track: 'digital', label: 'Digital logic', match: [] },
  '4': { track: 'academics', label: 'Academics', match: [] },
}
const posts: { url: string; body: unknown }[] = []
function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (init?.method === 'POST' || init?.method === 'PUT') posts.push({ url: u, body: init.body ? JSON.parse(String(init.body)) : null })
    let body: unknown = {}
    if (u.includes('/api/kv/')) body = { value: null }
    else if (u.includes('/api/mission/log')) body = { ok: true, say: 'Logged.' }
    else if (u.includes('/api/mission/state')) body = usePlan.getState().state
    else if (u.includes('/api/aankhen/snapshot')) body = { source: null, presence: null }
    else if (u.includes('/api/germoney/focus')) body = { supported: true, distraction: null }
    return { ok: true, status: 200, statusText: 'OK', json: async () => body }
  }))
}
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })
const q = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T
const click = (el: Element | null) => act(() => void (el as HTMLElement).click())
const byText = (s: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(s)) ?? null

let m: ReturnType<typeof mount> | null = null
beforeEach(async () => {
  posts.length = 0
  stubFetch()
  await AsyncStorage.removeItem(STORAGE_KEY)   // the shim caches in memory: a session left running by one test would resume in the next
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  workspaceMemory.clear()
  resetFrameStore()
  usePlan.setState({ state: { rotation: ROTATION, statuses: {}, nodes: {}, contracts: {}, wip_cap: 3, certs: {} } as never, refresh: async () => {} })
  usePlayerStore.setState((s) => ({ player: { ...s.player, xp: 100, isPurgatoryActive: false } }))
})
afterEach(() => {
  m?.unmount()
  m = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
  resetHtml()
  document.body.innerHTML = ''
})

/** A frame-shaped wrapper so the page can find the left column and mark the frame. */
const inFrame = () => (
  <div className="ww-frame"><aside className="ww-left"><span data-left-card>Today</span></aside><PrimaryOwner><WwFocusPage /></PrimaryOwner></div>
)

describe('the page', () => {
  it('draws no h1 of its own (the frame draws the one), and Crucible | Drill is a view switch', async () => {
    stubFetch()
    m = mount(inFrame())
    await flush()
    expect(document.querySelector('h1')).toBeNull()
    const seg = q('[aria-label="Focus view"]')
    expect([...seg.querySelectorAll('[role="radio"]')].map((o) => o.textContent)).toEqual(['Crucible', 'Drill'])
  })
  it('length chips are Segmented at the 44 px choice class, and the selected state passes contrast in every theme', async () => {
    stubFetch()
    m = mount(inFrame())
    await flush()
    const group = q('[aria-label="Length in minutes"]')
    expect(group.getAttribute('data-variant')).toBe('choice')
    expect([...group.querySelectorAll('[role="radio"]')].map((o) => o.textContent)).toEqual(LENGTHS.map((l) => `${l} min`))
    expect(group.querySelector('[aria-checked="true"]')?.textContent).toBe(`${DEFAULT_LENGTH} min`)
    const css = designFilesInOrder().map(read).join('\n')
    const controls = read(join(WW_DIR, 'kit/controls.css'))
    expect(controls).toMatch(/\[data-variant='choice'\] \.ww-seg-opt\s*\{\s*min-height:\s*var\(--hit\)/)
    for (const theme of ['ash', 'paper', 'indigo']) {
      const t = computeTokens(css, { html: theme === 'ash' ? {} : { 'data-theme': theme }, ws: 'focus' }, 'centre')
      // the selected wash is translucent: it is composited onto each of the four surfaces it can sit on
      const wash = parseColor(t['--selected-bg'])
      for (const n of [0, 1, 2, 3]) expect(contrast(parseColor(t['--selected-ink']), over(wash, parseColor(t[`--surface-${n}`]))), `${theme} surface-${n}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('tracks and rules (pure)', () => {
  it('tracks are built from the rotation, once each, in weekday order', () => {
    expect(tracksFromRotation(ROTATION)).toEqual([{ id: 'digital', label: 'Digital logic' }, { id: 'math', label: 'Maths' }, { id: 'academics', label: 'Academics' }])
    expect(tracksFromRotation(null)).toEqual([])
    expect(todaysTrack(ROTATION, new Date('2026-11-10T09:00:00'))).toBe('math')          // a Tuesday
    expect(todaysTrack(ROTATION, new Date('2026-11-14T09:00:00'))).toBe('digital')       // a Saturday has none: the first track
  })
  it('an early end counts from 10 minutes and says "ended", never "failed"', () => {
    expect(endedLine(9.4, 'you stopped it.')).toEqual({ counted: 0, text: 'Session ended: you stopped it. Under 10 minutes, so nothing was logged.' })
    expect(endedLine(MIN_COUNTED_MIN, 'x.').counted).toBe(10)
    expect(endedLine(30.2, 'x.').text).toMatch(/30 min counted/)
    for (const t of [endedLine(3, 'a.').text, endedLine(40, 'b.').text]) expect(t).not.toMatch(/fail|lost|forfeit/i)
  })
  it('a stored session resumes, completes, or ends by the guards', () => {
    const a: Active = { startedAt: 0, durationS: 1500, lastBeat: 0, track: 'math', trackLabel: 'Maths', wager: false, guards: true, length: 25 }
    expect(resumeVerdict(a, 30_000)).toBe('running')
    expect(resumeVerdict(a, 61_000)).toBe('ended')                       // guards on: a minute without a beat means the window was closed
    expect(resumeVerdict({ ...a, guards: false }, 61_000)).toBe('running') // guards off: a gap proves nothing
    expect(resumeVerdict({ ...a, guards: false }, 1_600_000)).toBe('done')
    expect(remainingS(a, 600_000)).toBe(900)
  })
  it('the wager needs the XP and says so before Start', () => {
    expect(wagerShortfall(5, 50)).toMatch(/needs 20 XP; you have 5/)
    expect(wagerShortfall(100, 50)).toBeNull()
  })
})

describe('the Crucible', () => {
  it('tracks on the page are the rotation\'s, the wager and guards are off, and no countdown renders before Start', async () => {
    stubFetch()
    m = mount(inFrame())
    await flush()
    expect([...q('[aria-label="Track"]').querySelectorAll('[role="radio"]')].map((o) => o.textContent)).toEqual(['Digital logic', 'Maths', 'Academics'])
    expect(byText('Wager off')).not.toBeNull()
    expect(byText('Guards off')).not.toBeNull()
    expect(document.querySelector('[role="timer"]')).toBeNull()
    expect(document.body.textContent).not.toMatch(/\d\d:\d\d/)
    expect(q('[data-primary="true"]').textContent).toBe('Start session')
  })
  it('an empty rotation says so in words instead of inventing tracks', async () => {
    stubFetch()
    usePlan.setState({ state: { rotation: {}, statuses: {}, nodes: {}, contracts: {}, wip_cap: 3, certs: {} } as never })
    m = mount(inFrame())
    await flush()
    expect(document.body.textContent).toContain('The rotation is empty. Add it in Setup > Rotation.')
    expect(byText('Start session')!.getAttribute('aria-disabled')).toBe('true')
  })
  it('the wager with too little XP disables Start with the reason, and it is turned on by the owner, not by default', async () => {
    stubFetch()
    usePlayerStore.setState((s) => ({ player: { ...s.player, xp: 5 } }))
    m = mount(inFrame())
    await flush()
    expect(byText('Start session')!.getAttribute('aria-disabled')).toBeNull()
    click(byText('Wager off'))
    expect(byText('Start session')!.getAttribute('aria-disabled')).toBe('true')
    expect(document.body.textContent).toContain('Wager needs 20 XP; you have 5.')
  })
  it('Start collapses the left and the proof rail to a timer rail, and Esc (focus mode off) restores them', async () => {
    stubFetch()
    m = mount(inFrame())
    await flush()
    click(byText('Start session'))
    await flush()
    const frame = q('.ww-frame')
    expect(frame.getAttribute('data-focus')).toBe('on')
    expect(useFrame.getState().focus).toBe(true)
    expect(q('.ww-left .ww-focus-rail').textContent).toMatch(/^\d\d:\d\d$/)
    expect(q('.ww-crucible [role="timer"]')).not.toBeNull()
    act(() => useFrame.getState().setFocus(false))                      // what Frame's Esc handler does
    expect(frame.getAttribute('data-focus')).toBeNull()
    const css = read(join(WW_DIR, 'focus/focus.css'))
    expect(css).toMatch(/\.ww-frame\[data-focus='on'\]\[data-density\]\s*\{[^}]*--col-l:\s*48px/)
  })
  it('a finished session writes through usePlan.log (the one log writer) once, with the track and the full minutes', async () => {
    stubFetch()
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-11-10T09:00:00'))
    m = mount(inFrame())
    await flush()
    click(byText('25 min'))
    click(byText('Start session'))
    await flush()
    vi.setSystemTime(new Date('2026-11-10T09:25:30'))
    await act(async () => { vi.advanceTimersByTime(1000) })
    await flush()
    const logs = posts.filter((p) => p.url.includes('/api/mission/log'))
    expect(logs).toHaveLength(1)
    expect(logs[0].body).toMatchObject({ minutes: 25, track: 'math', note: 'Crucible: Maths' })
    expect(document.body.textContent).toContain('Session complete: 25 min on Maths logged.')
    expect(document.querySelector('[role="timer"]')).toBeNull()
    expect(useFrame.getState().focus).toBe(false)
  })
  it('End session is a press-and-hold; Enter opens a plain confirm, and an early end logs only the held minutes in neutral words', async () => {
    stubFetch()
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-11-10T09:00:00'))
    m = mount(inFrame())
    await flush()
    click(byText('Start session'))
    await flush()
    const hold = q('.ww-crucible .ww-hold')
    expect(hold.textContent).toContain('End session')
    vi.setSystemTime(new Date('2026-11-10T09:12:10'))
    act(() => void hold.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    const confirm = q('[role="alertdialog"]')
    expect(confirm).not.toBeNull()
    expect(posts.filter((p) => p.url.includes('/api/mission/log'))).toHaveLength(0)   // asking is not ending
    click([...confirm.querySelectorAll('button')].find((b) => b.textContent === 'Confirm')!)
    await flush()
    const logs = posts.filter((p) => p.url.includes('/api/mission/log'))
    expect(logs).toHaveLength(1)
    expect(logs[0].body).toMatchObject({ minutes: 12 })
    expect(document.body.textContent).toContain('Session ended: you stopped it. 12 min counted.')
    expect(document.body.textContent).not.toMatch(/failed|forfeit|lost/i)
  })
})

describe('the Drill', () => {
  it('keeps the game store\'s cards: a deck switch, Reveal as the primary, and the honest empty deck', async () => {
    stubFetch()
    workspaceMemory.set('focus', 'view', 'drill', 'crucible')
    m = mount(inFrame())
    await flush()
    expect(q('[aria-label="Deck"]')).not.toBeNull()
    const primary = q('[data-primary="true"]')
    expect(primary.textContent === 'Reveal (Space)' || document.body.textContent!.includes('Deck clear for today.')).toBe(true)
    expect(document.querySelectorAll('[data-primary="true"]').length).toBeLessThanOrEqual(1)
  })
  it('the Crucible alone also mounts (the page can be used without the switch)', async () => {
    stubFetch()
    m = mount(<PrimaryOwner><WwCrucible /></PrimaryOwner>)
    await flush()
    expect(q('.ww-crucible')).not.toBeNull()
  })
})
