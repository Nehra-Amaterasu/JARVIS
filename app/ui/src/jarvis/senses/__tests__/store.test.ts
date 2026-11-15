// The live store of Senses (moved from pages/Aankhen.tsx): frames to rows, history, the tape, pause, the socket's life
// and the actions, on a fake socket and a fake clock. No real network is touched.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HIST_MAX, SensesStore, type Deps, type Raw } from '../store'
import { fixtureFrameMsg } from '../fixtures'
import type { FrameMsg } from '../../../twin/SpatialTwin'

interface Sock { onMsg: (m: unknown) => void; onState: (s: 'open' | 'closed') => void; sent: unknown[]; closed: boolean }

function setup(clock = { t: new Date(2026, 10, 15, 12, 0, 0).getTime() }) {
  const socks: Sock[] = []
  const post = vi.fn(async () => ({}))
  const api = vi.fn(async (path: string) => (path.includes('zones') ? { zones: [{ id: 'desk', name: 'Desk' }] } : path.includes('readiness') ? { ready: false, items: [], drill_days: 0, zones_trusted: false, layout_measured: false, zone_floor: null, missing: [] } : {}))
  const openSocket = ((_: string, onMsg: Sock['onMsg'], onState: Sock['onState']) => {
    const s: Sock = { onMsg, onState, sent: [], closed: false }
    socks.push(s)
    return { send: (o: unknown) => s.sent.push(o), close: () => { s.closed = true } }
  }) as unknown as Deps['openSocket']
  const store = new SensesStore({ openSocket, api: api as unknown as Deps['api'], post: post as unknown as Deps['post'], now: () => clock.t, storage: null })
  return { store, socks, clock, post, api }
}

const frame = (over: { source?: string; quiet?: boolean } = {}): FrameMsg => {
  const f = fixtureFrameMsg()
  return { ...f, source: over.source ?? 'hardware', motion_detail: { ...f.motion_detail, state: over.quiet === true ? 'quiet' : 'motion' } } as FrameMsg
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('the socket', () => {
  it('opens on the first view, asks for a snapshot when it opens, and closes three seconds after the last view', () => {
    const { store, socks } = setup()
    const release = store.retain()
    expect(socks).toHaveLength(1)
    socks[0].onState('open')
    expect(store.getState().online).toBe(true)
    expect(socks[0].sent).toContainEqual({ type: 'hello', want: 'snapshot', layer: 'live' })
    const second = store.retain()
    release()
    vi.advanceTimersByTime(5000)
    expect(socks[0].closed).toBe(false)
    second()
    vi.advanceTimersByTime(2900)
    expect(socks[0].closed).toBe(false)
    vi.advanceTimersByTime(200)
    expect(socks[0].closed).toBe(true)
    expect(store.getState().online).toBe(false)
  })
  it('a view that returns inside the delay keeps the same connection', () => {
    const { store, socks } = setup()
    const a = store.retain()
    a()
    vi.advanceTimersByTime(1000)
    store.retain()
    vi.advanceTimersByTime(10000)
    expect(socks).toHaveLength(1)
    expect(socks[0].closed).toBe(false)
  })
  it('loads readiness, the model status and the zones when it opens', async () => {
    const { store, api } = setup()
    store.retain()
    await vi.advanceTimersByTimeAsync(10)
    expect(api.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['/api/aankhen/readiness', '/api/aankhen/zones']))
    expect(store.getState().zones).toEqual([{ id: 'desk', name: 'Desk' }])
  })
})

describe('frames', () => {
  it('keeps at most 24 terrain rows, 240 ms apart, and a motion history', () => {
    const { store, socks, clock } = setup()
    store.retain()
    for (let i = 0; i < 60; i++) { clock.t += 250; socks[0].onMsg(frame()) }
    const s = store.getState()
    expect(s.frames).toHaveLength(24)
    expect(s.hist.length).toBeGreaterThan(0)
    expect(s.hist.length).toBeLessThanOrEqual(HIST_MAX)
    expect(s.latest?.source).toBe('hardware')
    expect(s.lastAt).toBe(clock.t)
  })
  it('records motion seen on the live tape for a board frame and on the simulated tape for a simulation, never the other way', () => {
    const { store, socks, clock } = setup()
    store.retain()
    clock.t += 300
    socks[0].onMsg(frame({ source: 'hardware' }))
    expect(store.tapeLive.size).toBe(1)
    expect(store.tapeSim.size).toBe(0)
    clock.t += 10 * 60000
    socks[0].onMsg(frame({ source: 'simulation' }))
    expect(store.tapeLive.size).toBe(1)
    expect(store.tapeSim.size).toBe(1)
  })
  it('a quiet frame records nothing: blank is not a finding', () => {
    const { store, socks, clock } = setup()
    store.retain()
    clock.t += 300
    socks[0].onMsg(frame({ quiet: true }))
    expect(store.tapeLive.size).toBe(0)
  })
  it('a pause stops reading frames, records the pause, and keeps the raw stream from the twin', () => {
    const { store, socks, clock } = setup()
    store.retain()
    const raw: Raw[] = []
    store.onRaw((m) => raw.push(m))
    clock.t += 300
    socks[0].onMsg(frame())
    const before = store.getState()
    store.setPaused(true)
    clock.t += 300
    socks[0].onMsg(frame())
    expect(store.getState().latest).toBe(before.latest)
    expect(raw.filter((m) => m.type === 'frame')).toHaveLength(1)
    expect(store.tapeLive.week(clock.t)[6].cells.some((c) => c === 'paused' || c === 'seen')).toBe(true)
    store.setPaused(false)
    clock.t += 300
    socks[0].onMsg(frame())
    expect(raw.filter((m) => m.type === 'frame')).toHaveLength(2)
  })
  it('passes the room, the status and the heat to the twin and keeps the room and the status', () => {
    const { store, socks } = setup()
    store.retain()
    const raw: Raw[] = []
    store.onRaw((m) => raw.push(m))
    socks[0].onMsg({ type: 'room', room: { name: 'r', width: 4, depth: 3 } })
    socks[0].onMsg({ type: 'status', source: 'hardware', sensors: {}, link: {} })
    socks[0].onMsg({ type: 'heatmap', layer: 'live' })
    expect(raw.map((m) => m.type)).toEqual(['room', 'status', 'heatmap'])
    expect(store.getState().room?.width).toBe(4)
    expect(store.getState().status?.source).toBe('hardware')
  })
})

describe('actions', () => {
  it('start posts the body to the engine and clears the picture it replaces', async () => {
    const { store, socks, post, clock } = setup()
    store.retain()
    clock.t += 300
    socks[0].onMsg(frame())
    await store.start({ mode: 'simulation', scenario: 'walk' })
    expect(post).toHaveBeenCalledWith('/api/aankhen/start', { mode: 'simulation', scenario: 'walk' })
    expect(store.getState().frames).toHaveLength(0)
    expect(store.getState().hist).toHaveLength(0)
  })
  it('a failed start throws so the view can say so, and changes nothing', async () => {
    const { store, post } = setup()
    post.mockRejectedValueOnce(new Error('port busy'))
    await expect(store.start({ mode: 'hardware' })).rejects.toThrow('port busy')
  })
  it('asks the hub for the heat layer it was told to show', () => {
    const { store, socks } = setup()
    store.retain()
    store.askHeat('learned')
    expect(socks[0].sent).toContainEqual({ type: 'hello', want: 'heatmap', layer: 'learned' })
  })
})
