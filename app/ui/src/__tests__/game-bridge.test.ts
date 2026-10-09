/** The actions JARVIS's voice runs in the game (bridge.runAction), against the real store. */
import { beforeAll, describe, expect, it, vi } from 'vitest'

const kv = new Map<string, string>()
vi.stubGlobal('fetch', async (url: string, init?: { method?: string; body?: string }) => {
  const key = decodeURIComponent(String(url).replace('/api/kv/', ''))
  if (init?.method === 'PUT') kv.set(key, JSON.parse(init.body!).value)
  return new Response(JSON.stringify({ value: kv.get(key) ?? null }), { status: 200, headers: { 'Content-Type': 'application/json' } })
})

const { runAction } = await import('../germoney/game/bridge')
const { useGame, contractsFor } = await import('../germoney/game/store')
const { usePlayerStore } = await import('../germoney/stores/player-store')
const E = await import('../germoney/game/engine')

const TODAY = '2026-10-07'
beforeAll(async () => {
  await useGame.getState().hydrate()
  useGame.setState({ today: TODAY, g: { ...E.defaultGame(TODAY), marks: 200 } })
  usePlayerStore.setState({ player: { ...usePlayerStore.getState().player, xp: 0, level: 0 } })
})

describe('voice actions', () => {
  it('brief: the day in one breath, and it counts for Boot Camp day 7', () => {
    const r = runAction('brief')
    expect(r.ok).toBe(true)
    expect(r.say).toMatch(/^Day 1\. Streak 0/)
    expect(useGame.getState().g.ledger.some((e) => e.kind === 'brief')).toBe(true)
  })

  it('log German: hours land in the ledger and tick the Deutsch rep (as a claim)', () => {
    const r = runAction('log', { track: 'deutsch', minutes: 45 })
    expect(r.say).toContain('Logged 45 minutes of Deutsch')
    const g = useGame.getState().g
    expect(g.days[TODAY].reps.deutsch?.verified).toBe(false)
    expect(g.ledger.some((e) => e.kind === 'log' && e.track === 'deutsch' && e.amount === 0.75)).toBe(true)
  })

  it('complete matches the contract by its words; a vague query asks which one', () => {
    const open = contractsFor(useGame.getState().g, TODAY, 0)
    const target = open[0]
    expect(runAction('complete', { query: 'something unrelated entirely' }).ok).toBe(false)
    const r = runAction('complete', { query: target.def.title, utterance: `contract done ${target.def.title}` })
    expect(r.ok).toBe(true)
    expect(useGame.getState().g.contracts[target.key].verified).toBe(false) // a voice report is a claim
    expect(runAction('complete', { query: target.def.title }).ok).toBe(false)
  })

  it('focus arms a Crucible for the Crucible page to start', () => {
    const r = runAction('focus', { minutes: 45, track: 'deutsch' })
    expect(r.ok).toBe(true)
    expect(useGame.getState().pendingFocus).toEqual({ minutes: 50, track: 'deutsch' }) // snapped to a real length
  })

  it('buy finds the reward by name and refuses what you cannot afford', () => {
    expect(runAction('buy', { query: 'anime episode' }).ok).toBe(true)
    useGame.setState({ g: { ...useGame.getState().g, marks: 10 } })
    const r = runAction('buy', { query: 'movie night' })
    expect(r.ok).toBe(false)
    expect(r.say).toMatch(/more Marks/)
  })

  it('unknown actions are refused, never guessed', () => {
    expect(runAction('format_disk').ok).toBe(false)
  })
})
