/**
 * The game store wired to the real player and proof stores, with an in-memory
 * server behind fetch: rewards land where Mission Germoney reads them.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'

const kv = new Map<string, string>()
vi.stubGlobal('fetch', async (url: string, init?: { method?: string; body?: string }) => {
  const key = decodeURIComponent(String(url).replace('/api/kv/', ''))
  if (init?.method === 'PUT') kv.set(key, JSON.parse(init.body!).value)
  const body = url === '/api/kv' ? { keys: [...kv.keys()] } : { value: kv.get(key) ?? null }
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
})

const { useGame } = await import('../germoney/game/store')
const { usePlayerStore } = await import('../germoney/stores/player-store')
import type { PlanEvent } from '../germoney/game/plan'
const E = await import('../germoney/game/engine')

const TODAY = '2026-10-07' // a Wednesday

beforeAll(async () => {
  await useGame.getState().hydrate()
  useGame.setState({ today: TODAY, g: { ...E.defaultGame(TODAY), levelSeen: 1 } })
  usePlayerStore.setState({ player: { ...usePlayerStore.getState().player, xp: 0, level: 0 } })
})

const g = () => useGame.getState().g
const xp = () => usePlayerStore.getState().player.xp

describe('plan events reach the Floor once', () => {
  const ev = (id: string, e: Omit<PlanEvent, 'id' | 't' | 'date'>): PlanEvent => ({ id, t: 0, date: TODAY, ...e })
  it('a contract done on the server ticks its rep, pays Marks (never XP: the server counted it), and enters the ledger', () => {
    const x0 = xp()
    const m0 = g().marks
    useGame.getState().syncPlan([ev(`${TODAY}:1`, { kind: 'contract', key: 'hdl/c1', title: 'HDLBits basics', minutes: 60, xp: 30, rep: 'silicon', verified: true })], false)
    expect(g().days[TODAY].reps.silicon?.verified).toBe(true)
    expect(g().marks).toBeGreaterThanOrEqual(m0 + 15)
    expect(xp()).toBe(x0)
    expect(g().ledger.filter((e) => e.kind === 'contract')).toHaveLength(1)
    expect(g().achievements['first-blood']).toBe(TODAY)
  })

  it('is applied once, however often the plan is pulled', () => {
    useGame.getState().syncPlan([ev(`${TODAY}:1`, { kind: 'contract', key: 'hdl/c1', minutes: 60, xp: 30, rep: 'silicon' })], false)
    expect(g().ledger.filter((e) => e.kind === 'contract')).toHaveLength(1)
  })

  it('logged time ticks a rep only when it is enough, and an old day never ticks today', () => {
    useGame.getState().syncPlan([
      { id: '2026-10-01:9', t: 0, date: '2026-10-01', kind: 'log', minutes: 60, rep: 'deutsch', track: 'deutsch' },
      ev(`${TODAY}:2`, { kind: 'log', minutes: 10, rep: 'deutsch', track: 'deutsch' }),
    ], false)
    expect(g().days[TODAY].reps.deutsch).toBeUndefined()
    useGame.getState().syncPlan([ev(`${TODAY}:3`, { kind: 'log', minutes: 20, rep: 'deutsch', track: 'deutsch', note: 'voice' })], false)
    expect(g().days[TODAY].reps.deutsch?.verified).toBe(false)          // a log without a link is a claim
    expect(g().ledger.filter((e) => e.kind === 'log').map((e) => e.amount)).toEqual([1, 10 / 60, 20 / 60])   // hours, as before
  })

  it("the server's exam days put the Floor in exam mode", () => {
    useGame.getState().syncPlan([], true)
    expect(E.modeOn(g(), TODAY)).toBe('exam')
    useGame.getState().syncPlan([], false)
    expect(E.modeOn(g(), TODAY)).toBeNull()
  })
})

describe('the floor', () => {
  it('securing it pays once, opens the supply drop, and starts the streak', () => {
    const before = g().marks
    useGame.getState().markRep('body', 'test', false)
    expect(E.isSecured(g(), TODAY)).toBe(true)
    expect(g().marks).toBeGreaterThan(before)
    expect(g().ledger.filter((e) => e.kind === 'floor')).toHaveLength(1)
    useGame.getState().markRep('body', 'again', false)
    expect(g().ledger.filter((e) => e.kind === 'floor')).toHaveLength(1)
    const loot = useGame.getState().openChest()!
    expect(loot.marks).toBeGreaterThan(0)
    expect(useGame.getState().openChest()).toBeNull() // one crate a day
  })

  it('a verified rep cannot be unticked, and nothing unticks after securing', () => {
    useGame.getState().unmarkRep('body')
    expect(g().days[TODAY].reps.body).toBeTruthy()
  })
})

describe('the Armory', () => {
  it('buys only what you can afford and records it', () => {
    useGame.setState({ g: { ...g(), marks: 100 } })
    expect(useGame.getState().buy('r-movie')).toMatch(/more Marks/)
    expect(useGame.getState().buy('r-episode')).toBeNull()
    expect(g().marks).toBe(100 - 60 + 25) // the first reward also unlocks "Earned It" (+25)
    expect(g().purchases.at(-1)?.kind).toBe('reward')
    expect(g().achievements['earned']).toBe(TODAY)
  })
})

describe('levels', () => {
  it('level-ups are paid exactly once', () => {
    const seen = g().levelSeen
    expect(seen).toBe(E.levelInfo(xp()).level)
    const levelEvents = g().ledger.filter((e) => e.kind === 'level').length
    usePlayerStore.getState().updateXP(0)
    expect(g().ledger.filter((e) => e.kind === 'level').length).toBe(levelEvents)
  })
})

describe('trials', () => {
  it('each new stage pays a little, passing pays the full reward, going back pays nothing', () => {
    const m0 = g().marks
    useGame.getState().setTrialStage('goethe-a1', 1)
    expect(g().marks - m0).toBe(30)
    useGame.getState().setTrialStage('goethe-a1', 4)
    expect(g().trials['goethe-a1'].stage).toBe(4)
    const m1 = g().marks
    useGame.getState().setTrialStage('goethe-a1', 2)
    useGame.getState().setTrialStage('goethe-a1', 4)
    expect(g().marks).toBe(m1)
  })
})

describe('drill', () => {
  it('Leitner: right moves a card up a box, wrong sends it to box 1; 20 German cards tick the Deutsch rep', () => {
    useGame.setState({ today: '2026-10-08' })
    useGame.getState().reviewCard('g1', true)
    expect(g().drill['g1']).toMatchObject({ box: 1, due: '2026-10-09' })
    useGame.getState().reviewCard('g1', false)
    expect(g().drill['g1'].box).toBe(1)
    for (let i = 2; i <= 20; i++) useGame.getState().reviewCard(`g${i}`, true)
    expect(g().days['2026-10-08'].reps.deutsch?.verified).toBe(true)
    expect(g().ledger.filter((e) => e.kind === 'drill' && e.date === '2026-10-08')).toHaveLength(2)
  })
})

describe('persistence', () => {
  it('the game is saved to the key-value store', async () => {
    await new Promise((r) => setTimeout(r, 400))
    const saved = JSON.parse(kv.get('@silicon_game_v1')!)
    expect(saved.marks).toBe(g().marks)
  })
})
