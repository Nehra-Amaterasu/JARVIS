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

const { useGame, contractsFor } = await import('../germoney/game/store')
const { usePlayerStore } = await import('../germoney/stores/player-store')
const { useProofStore } = await import('../germoney/stores/proof-store')
const E = await import('../germoney/game/engine')
const { weeklyOffers } = await import('../germoney/game/operations')

const TODAY = '2026-10-07' // a Wednesday in the Boolean Sentinel's month

beforeAll(async () => {
  await useGame.getState().hydrate()
  useGame.setState({ today: TODAY, g: { ...E.defaultGame(TODAY), levelSeen: 1 } })
  usePlayerStore.setState({ player: { ...usePlayerStore.getState().player, xp: 0, level: 0 } })
})

const g = () => useGame.getState().g
const xp = () => usePlayerStore.getState().player.xp

describe('contracts pay out', () => {
  it('XP goes to the player, Marks to the game, proof to the proof store; the rep ticks', () => {
    const [c] = contractsFor(g(), TODAY, 0)
    const r = useGame.getState().completeContract(c.key, { type: 'text', value: 'https://github.com/me/rca' })!
    expect(r.nth).toBe(1)
    expect(xp()).toBeGreaterThanOrEqual(r.xp)
    expect(g().marks).toBeGreaterThanOrEqual(r.marks)
    expect(useProofStore.getState().proofs[c.key]?.value).toContain('github.com')
    expect(g().contracts[c.key].verified).toBe(true) // a link counts as evidence
    expect(g().days[TODAY].reps.silicon).toBeTruthy()
    expect(useGame.getState().completeContract(c.key, { type: 'text', value: 'again' })).toBeNull() // never twice
  })

  it('the second contract of the day gets the combo', () => {
    const [, c2] = contractsFor(g(), TODAY, 0)
    const r = useGame.getState().completeContract(c2.key, { type: 'text', value: 'done' })!
    expect(r.nth).toBe(2)
    expect(g().contracts[c2.key].verified).toBe(false) // a bare note is a claim
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

describe('weekly operations', () => {
  it('committing stakes Marks; one per week', () => {
    useGame.setState({ g: { ...g(), marks: 200 } })
    const week = '2026-10-05'
    const offer = weeklyOffers(week)[1]
    expect(useGame.getState().chooseOperation(offer.id)).toBeNull()
    expect(g().operations[week].stake).toBe(50)
    expect(useGame.getState().chooseOperation(weeklyOffers(week)[0].id)).toMatch(/already/)
  })
})

describe('bosses and rank', () => {
  it('defeating a boss pays, promotes rank, and is final', () => {
    const before = xp()
    const r = useGame.getState().defeatBoss('b1', { type: 'text', value: 'https://github.com/me/rca' })!
    expect(r.ambush).toBe(true) // most of its HP was still there
    expect(xp()).toBeGreaterThanOrEqual(before + r.xp)
    expect(usePlayerStore.getState().player.level).toBe(1)
    expect(useGame.getState().defeatBoss('b1', { type: 'text', value: 'x' })).toBeNull()
    expect(useGame.getState().defeatBoss('b6', { type: 'text', value: 'x' })).toBeNull() // not started yet
  })

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
