/** The actions JARVIS's voice runs in the game (bridge.runAction), against the real store. */
import { beforeAll, describe, expect, it, vi } from 'vitest'

const kv = new Map<string, string>()
const posts: [string, unknown][] = []
vi.stubGlobal('fetch', async (url: string, init?: { method?: string; body?: string }) => {
  const key = decodeURIComponent(String(url).replace('/api/kv/', ''))
  if (init?.method === 'PUT') kv.set(key, JSON.parse(init.body!).value)
  if (init?.method === 'POST') posts.push([String(url), JSON.parse(init.body ?? '{}')])
  return new Response(JSON.stringify({ value: kv.get(key) ?? null }), { status: 200, headers: { 'Content-Type': 'application/json' } })
})

const { runAction } = await import('../germoney/game/bridge')
const { useGame } = await import('../germoney/game/store')
const { usePlayerStore } = await import('../germoney/stores/player-store')
const E = await import('../germoney/game/engine')

const TODAY = '2026-10-07'
beforeAll(async () => {
  await useGame.getState().hydrate()
  useGame.setState({ today: TODAY, g: { ...E.defaultGame(TODAY), marks: 200 } })
  usePlayerStore.setState({ player: { ...usePlayerStore.getState().player, xp: 0, level: 0 } })
})

describe('voice actions', () => {
  it('brief: the day in one breath', () => {
    const r = runAction('brief')
    expect(r.ok).toBe(true)
    expect(r.say).toMatch(/^Day 1\. Streak 0/)
    expect(useGame.getState().g.ledger.some((e) => e.kind === 'brief')).toBe(true)
  })

  it("log goes to the plan's one log (it pays the XP; the rep ticks when the event comes back)", async () => {
    const r = runAction('log', { track: 'deutsch', minutes: 45 })
    expect(r.say).toContain('Logging 45 minutes of Deutsch')
    await new Promise((res) => setTimeout(res, 20))
    expect(posts.find(([u]) => u === '/api/mission/log')?.[1]).toMatchObject({ minutes: 45, track: 'deutsch' })
    expect(usePlayerStore.getState().player.germanHours).toBeCloseTo(0.75)
    expect(runAction('log', { track: 'cooking', minutes: 5 }).ok).toBe(false)
  })

  it('contracts are not a window action any more: the server finishes them (voice works window-closed)', () => {
    expect(runAction('complete', { query: 'adder' }).ok).toBe(false)
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
