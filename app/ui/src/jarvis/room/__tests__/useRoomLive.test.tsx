// A.J02: the moved logic. The classic page's `send` (same routes, same bodies, same toast) plus the bookkeeping of an ask: a press
// records what was asked and when, the board's own report is what confirms it, and a silent board leaves "asked, no report".
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '../../../__tests__/ww/_stubs'
import { fixtureRoom } from '../fixtures'
import { keySlots, ASK_WINDOW_MS } from '../model'
import { useRoomLive, type RoomLive } from '../useRoomLive'

const h = vi.hoisted(() => ({ room: null as unknown, posts: [] as { path: string; body: unknown }[], delivered: {} as Record<string, boolean> }))
vi.mock('../../../lib/api', () => ({
  api: async (path: string) => { if (path === '/api/limbs') return JSON.parse(JSON.stringify(h.room)); throw new Error(`no stub for ${path}`) },
  post: async (path: string, body: unknown) => { h.posts.push({ path, body }); return { delivered: h.delivered } },
}))

let live: RoomLive
function Probe() { live = useRoomLive(); return null }
let m: ReturnType<typeof mount> | null = null
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); await Promise.resolve() })
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => {
  vi.useFakeTimers()
  h.room = fixtureRoom('live')
  h.posts = []
  h.delivered = {}
})
afterEach(() => { m?.unmount(); m = null; vi.useRealTimers() })

const slotOf = (id: string) => keySlots(live.view, live.asked, live.now, live.confirmedAt).find((s) => s.id === id)!

describe('useRoomLive', () => {
  it('reads /api/limbs and answers nothing by itself: no request leaves before a press', async () => {
    m = mount(<Probe />)
    await flush()
    expect(live.view?.devices).toHaveLength(6)
    expect(h.posts).toEqual([])
    expect(live.log).toEqual([])
  })

  it('a press sends the classic body once, records the ask, and the lamp is WAITING until the board reports', async () => {
    m = mount(<Probe />)
    await flush()
    await act(async () => { await live.actions.press('fan', true) })
    expect(h.posts).toEqual([{ path: '/api/limbs/fan', body: { action: 'on' } }])
    expect(slotOf('fan')).toMatchObject({ phase: 'asked', lamp: 'waiting', capOn: false })
    expect(live.log[0]).toMatchObject({ text: 'asked: Ceiling fan ON', state: 'waiting' })
  })

  it('the board agreeing turns the ask into a confirmation with a log line, then the key settles', async () => {
    m = mount(<Probe />)
    await flush()
    await act(async () => { await live.actions.press('fan', true) })
    ;(h.room as ReturnType<typeof fixtureRoom>).devices.find((d) => d.id === 'fan')!.hardware_on = true
    await tick(2100) // the 2 s poll reads the board's new report
    expect(slotOf('fan')).toMatchObject({ phase: 'confirmed', lamp: 'live', capOn: true })
    expect(live.log.some((l) => l.text === 'confirmed by board: Ceiling fan ON' && l.state === 'live')).toBe(true)
    await tick(4500)
    expect(slotOf('fan')).toMatchObject({ phase: 'steady', capOn: true })
  })

  it('a silent board leaves the key at "asked, no report" after 6 s and says so once in the log', async () => {
    m = mount(<Probe />)
    await flush()
    await act(async () => { await live.actions.press('fan', true) })
    await tick(ASK_WINDOW_MS + 600)
    expect(slotOf('fan')).toMatchObject({ phase: 'unconfirmed', lamp: 'fault', word: 'asked, no report' })
    expect(live.log.filter((l) => l.state === 'fault')).toHaveLength(1)
  })

  it('a mode asks only the channels the board reports differently, and posts the classic scene route', async () => {
    m = mount(<Probe />)
    await flush()
    await act(async () => { await live.actions.scene('sleep') })
    expect(h.posts).toEqual([{ path: '/api/limbs/scene/sleep', body: {} }])
    // sleep: light off (was on), fan on (was off), light2 off (was on); light3 to light5 already off or not on the board
    expect(Object.keys(live.asked).sort()).toEqual(['fan', 'light', 'light2'])
  })

  it('All off uses the all_off mode when it exists and asks only the channels reported on', async () => {
    m = mount(<Probe />)
    await flush()
    await act(async () => { await live.actions.allOff() })
    expect(h.posts).toEqual([{ path: '/api/limbs/scene/all_off', body: {} }])
    expect(Object.keys(live.asked).sort()).toEqual(['light', 'light2'])
  })

  it('without an all_off mode it switches each channel off, one request each', async () => {
    h.room = { ...(fixtureRoom('live') as object), modes: [] }
    m = mount(<Probe />)
    await flush()
    await act(async () => { await live.actions.allOff() })
    expect(h.posts.map((p) => p.path)).toEqual(['/api/limbs/light', '/api/limbs/light2'])
    expect(h.posts.every((p) => (p.body as { action: string }).action === 'off')).toBe(true)
  })

  it('the heavy-load flags persist in the browser store and survive a remount', async () => {
    try { localStorage.clear() } catch { /* none */ }
    m = mount(<Probe />)
    await flush()
    act(() => live.setHeavy({ light3: true }))
    expect(live.heavy).toEqual({ light3: true })
    m.unmount()
    m = mount(<Probe />)
    await flush()
    expect(live.heavy).toEqual({ light3: true })
    try { localStorage.clear() } catch { /* none */ }
  })
})
