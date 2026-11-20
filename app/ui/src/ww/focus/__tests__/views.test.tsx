// Y02: the Start, Session and Rest views on the classic engine (moved, not rewritten): Start writes the stored session and moves to Session;
// the Session reads the same record, pauses and resumes without counting the pause, ends through the one log writer and hands Rest its line.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlan } from '../../../germoney/game/plan'
import AsyncStorage from '../../../germoney/platform'
import { usePlayerStore } from '../../../germoney/stores/player-store'
import { resetFrameStore } from '../../frame/frameStore'
import { resetShellForTests, useShell } from '../../../shell/store'
import { FocusRest } from '../FocusRest'
import { FocusStart } from '../FocusStart'
import { Crucible, stripFor } from '../CrucibleSession'
import { nullFocusPort } from '../ports'
import { STORAGE_KEY, type Active } from '../session'
import { useFocusViews } from '../store'
import { buttons, cleanup, click, flush, key, render } from './dom'

const ROTATION = {
  '1': { track: 'digital', label: 'Digital logic', match: [] },
  '2': { track: 'math', label: 'Maths', match: [] },
}
const posts: { url: string; body: unknown }[] = []
const q = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T
const stored = async () => { const raw = await AsyncStorage.getItem(STORAGE_KEY); return raw ? (JSON.parse(raw) as Active) : null }
const active = (over: Partial<Active> = {}): Active => {
  const t = Date.now()
  return { startedAt: t - 32 * 60_000, durationS: 50 * 60, lastBeat: t, track: 'digital', trackLabel: 'Digital logic', wager: false, guards: false, length: 50, ...over }
}

beforeEach(async () => {
  posts.length = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (init?.method === 'POST' || init?.method === 'PUT') posts.push({ url: u, body: init.body ? JSON.parse(String(init.body)) : null })
    let body: unknown = {}
    if (u.includes('/api/kv/')) body = { value: null }
    else if (u.includes('/api/mission/log')) body = { ok: true, say: 'Logged.' }
    else if (u.includes('/api/aankhen/snapshot')) body = { source: null, presence: null }
    else if (u.includes('/api/germoney/focus')) body = { supported: true, distraction: null }
    return { ok: true, status: 200, statusText: 'OK', json: async () => body }
  }))
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  await AsyncStorage.removeItem(STORAGE_KEY)
  resetFrameStore()
  resetShellForTests()
  useFocusViews.setState({ last: null, parked: [], runKind: 'crucible' })
  usePlan.setState({ state: { rotation: ROTATION, statuses: {}, nodes: {}, contracts: {}, wip_cap: 3, certs: {} } as never, refresh: async () => {} })
  usePlayerStore.setState((s) => ({ player: { ...s.player, xp: 100, isPurgatoryActive: false } }))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Start', () => {
  it('shows the rotation as tracks, the four lengths, a cue, two switches that start off, and one accent: Start', async () => {
    render(<FocusStart port={nullFocusPort} />)
    await flush()
    expect([...document.querySelectorAll('.fs [role="radiogroup"][aria-label="Track"] [role="radio"]')].map((b) => b.textContent)).toEqual(['Digital logic', 'Maths'])
    expect(document.querySelectorAll('.fs [role="radiogroup"][aria-label="Length in minutes"] [role="radio"]')).toHaveLength(4)
    const sw = [...document.querySelectorAll('[role="switch"]')]
    expect(sw.map((s) => s.getAttribute('aria-checked'))).toEqual(['false', 'false'])
    expect(document.querySelectorAll('[data-primary]')).toHaveLength(1)
    expect(q('[data-primary]').textContent).toBe('Start session')
    // the null port suggests nothing, so there is no Pick for me strip (nothing is invented)
    expect(document.querySelector('.fs-pick')).toBeNull()
  })

  it('Start stores the session with its cue and moves to the Session view; the wager is paid only when it was turned on', async () => {
    render(<FocusStart port={nullFocusPort} />)
    await flush()
    act(() => { const f = q<HTMLInputElement>('.fs input[type="text"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(f, 'Redo timing'); f.dispatchEvent(new Event('input', { bubbles: true })) })
    click(q('[data-primary]'))
    await flush()
    const a = await stored()
    expect(a).toMatchObject({ track: 'digital', length: 50, durationS: 3000, wager: false, guards: false, cue: 'Redo timing' })
    expect(usePlayerStore.getState().player.xp).toBe(100)
    const s = useShell.getState()
    expect(s.places.ww).toMatchObject({ section: 'focus', view: 'session' })
  })

  it('a wager the XP cannot cover disables Start with the reason before it is pressed', async () => {
    usePlayerStore.setState((s) => ({ player: { ...s.player, xp: 3 } }))
    render(<FocusStart port={nullFocusPort} />)
    await flush()
    click(document.querySelectorAll<HTMLElement>('[role="switch"]')[0])
    expect(q('[data-primary]').getAttribute('aria-disabled')).toBe('true')
    expect(document.body.textContent).toMatch(/Wager needs 20 XP; you have 3/)
  })

  it('with a block running it says so and offers the way back, and Start is held', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(active()))
    render(<FocusStart port={nullFocusPort} />)
    await flush()
    expect(document.body.textContent).toContain('A block is running on Digital logic')
    expect(buttons(document.body, 'Open the session')).toHaveLength(1)
  })
})

describe('Session', () => {
  it('draws one dot per elapsed minute and the readout "32 min . track", and the strip names state, not time', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(active({ cue: 'Redo timing' })))
    render(<Crucible port={nullFocusPort} />)
    await flush()
    expect(q('[data-testid="readout"]').textContent).toMatch(/^32 min\s*\S\s*Digital logic$/)
    expect(document.querySelectorAll('[data-dot="filled"]')).toHaveLength(32)
    expect(q('.cr-ofline').textContent).toContain('of 50 min')
    expect(q('.fv-strip').textContent).toBe('> block 50 min | parked 0 | guards off')
    expect(document.querySelector('[role="timer"]')).toBeNull()
  })

  it('Space holds the dots and resumes; the pause is not counted against the block', async () => {
    const a = active()
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(a))
    render(<Crucible port={nullFocusPort} />)
    await flush()
    key(' ')
    await flush()
    const held = await stored()
    expect(held?.pausedAt).toBeGreaterThan(0)
    expect(q('.cr-ofline').textContent).toContain('held')
    expect(q('.fv-strip').textContent).toContain('held')
    // ten minutes pass while held: nothing moves
    const t0 = held!.pausedAt!
    vi.useFakeTimers({ now: t0 + 10 * 60_000 })
    key(' ')
    await flush()
    const back = await stored()
    expect(back?.pausedAt).toBeUndefined()
    expect(back!.startedAt - a.startedAt).toBeGreaterThanOrEqual(10 * 60_000 - 5)
    expect(q('[data-testid="readout"]').textContent).toMatch(/^32 min/)
  })

  it('P opens the Park field with the focus in it, a thought is filed to the port and the strip counts it', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(active()))
    const kept: string[] = []
    render(<Crucible port={{ ...nullFocusPort, park: async (t) => { kept.push(t); return { stored: true } } }} />)
    await flush()
    key('P')
    const input = q<HTMLInputElement>('.pk-in')
    expect(document.activeElement).toBe(input)
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'ask later'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    act(() => void input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await flush()
    expect(kept).toEqual(['ask later'])
    expect(q('.fv-strip').textContent).toContain('parked 1')
    expect(q('.cr-parked').textContent).toContain('in Parking')
  })

  it('a block whose time ran out while the page was away completes through the one log writer and hands Rest its line', async () => {
    const t = Date.now()
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(active({ startedAt: t - 60 * 60_000, durationS: 50 * 60 })))
    let ended = 0
    render(<Crucible port={nullFocusPort} onEnd={() => { ended++ }} />)
    await flush()
    expect(ended).toBe(1)
    expect(posts.filter((p) => p.url.includes('/api/mission/log'))).toHaveLength(1)
    expect(posts.find((p) => p.url.includes('/api/mission/log'))?.body).toMatchObject({ minutes: 50, track: 'digital' })
    expect(await stored()).toBeNull()
    const last = useFocusViews.getState().last
    expect(last).toMatchObject({ kind: 'done', counted: 50, length: 50 })
    expect(last?.line).toMatch(/Session complete: 50 min on Digital logic logged/)
  })

  it('with no session it says nothing is counting down and offers Start', async () => {
    render(<Crucible port={nullFocusPort} />)
    await flush()
    expect(q('[data-testid="readout"]').textContent).toBe('No session running')
    expect(buttons(document.body, 'Go to Start')).toHaveLength(1)
  })

  it('the strip is a pure function of the block\'s settings and its filed thoughts', () => {
    expect(stripFor({ plannedMin: 50, paused: false, guards: false, parked: 0 })).toBe('> block 50 min | parked 0 | guards off')
    expect(stripFor({ plannedMin: 90, paused: true, guards: true, parked: 2 })).toBe('> block 90 min | held | parked 2 | guards on')
  })
})

describe('Rest', () => {
  it('says "ended" in neutral words, keeps the filled dots, says what counted, and offers a break once after a long block', async () => {
    useFocusViews.setState({ last: { at: Date.now(), kind: 'ended', line: 'Session ended: you stopped it. 52 min counted.', heldMin: 52.3, counted: 52, length: 90, trackLabel: 'Digital logic', parked: 2 } })
    render(<FocusRest />)
    expect(q('.fv-title').textContent).toBe('Block ended')
    expect(document.querySelectorAll('[data-dot="filled"]')).toHaveLength(52)
    expect(document.body.textContent).toContain('52 min logged.')
    expect(document.body.textContent).toContain('2 thoughts parked.')
    expect(document.body.textContent).not.toMatch(/fail|lost|wasted|streak/i)
    expect(buttons(document.body, 'Take a break')).toHaveLength(1)
    click(buttons(document.body, 'Take a break')[0])
    expect(buttons(document.body, 'Take a break')).toHaveLength(0)
    expect(q('.fr-break').textContent).toContain('Nothing counts down')
  })

  it('under ten minutes it says so and logs nothing; with no block it says nothing is counting down', async () => {
    useFocusViews.setState({ last: { at: Date.now(), kind: 'ended', line: 'x', heldMin: 7.2, counted: 0, length: 25, trackLabel: 'Maths', parked: 0 } })
    render(<FocusRest />)
    expect(document.body.textContent).toContain('Under 10 minutes, so nothing was logged.')
    expect(buttons(document.body, 'Take a break')).toHaveLength(0)
    cleanup()
    useFocusViews.setState({ last: null })
    render(<FocusRest />)
    expect(document.body.textContent).toContain('Nothing is counting down')
  })
})

describe('EL-FOCUS: the idle Session', () => {
  it('draws the resting dial with a WAITING lamp and the reason, one title, no duplicate caption', async () => {
    render(<Crucible port={nullFocusPort} />)
    await flush()
    expect(q('[data-testid="readout"]').textContent).toBe('No session running')
    expect(document.querySelectorAll('.cr-field-idle [data-art="resting-dial"]')).toHaveLength(1)
    expect(q('.cr-field-idle').textContent).toContain('WAITING')
    expect(q('.cr-field-idle').textContent).toContain('No block started')
    expect(document.body.textContent).not.toContain('Minutes held')
    expect(document.body.textContent).not.toMatch(/LIVE/)
    expect((document.body.textContent ?? '').match(/No session running/g)).toHaveLength(1)
  })
})
