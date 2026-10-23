/**
 * Mission v2 migration, end to end in the window: an old save (an active weekly
 * operation with a stake, a Purgatory) is loaded, the stake comes back, the
 * Purgatory is lifted, and the plan's events and XP reach the game exactly once.
 */
import { describe, expect, it, vi } from 'vitest'

const TODAY = new Date()
const today = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}-${String(TODAY.getDate()).padStart(2, '0')}`
const kv = new Map<string, string>([
  ['@silicon_game_v1', JSON.stringify({ v: 1, marks: 100, operations: { '2026-10-19': { chosen: 'op-x', stake: 50, status: 'active' } }, firstPlay: today })],
  ['@silicon_player_v2', JSON.stringify({ xp: 500, level: 2, isPurgatoryActive: true, purgatoryHoursRemaining: 3, levelBeforePurgatory: 3 })],
])
const plan = {
  today: { date: today, weekday: 1, track: 'digital', track_label: 'Digital', blocks: [], contracts: [], exam: null, note: null,
    wins: { contracts: 1, minutes: 60, xp: 30, nodes: [], mastered: 0, shipped: 0 }, wip: [], wip_cap: 3, level: { level: 4, into: 0, need: 1 }, xp: 530, bank_ready: true, academics_ready: false },
  state: { xp: 530, events: [{ id: `${today}:1`, t: 0, date: today, kind: 'contract', key: 'n/c1', minutes: 60, xp: 30, rep: 'silicon', verified: false }] },
}
vi.stubGlobal('fetch', async (url: string, init?: { method?: string; body?: string }) => {
  const u = String(url)
  if (u === '/api/mission/today') return new Response(JSON.stringify(plan.today), { status: 200 })
  if (u === '/api/mission/state') return new Response(JSON.stringify(plan.state), { status: 200 })
  const key = decodeURIComponent(u.replace('/api/kv/', ''))
  if (init?.method === 'PUT') kv.set(key, JSON.parse(init.body!).value)
  return new Response(JSON.stringify({ value: kv.get(key) ?? null, ok: true }), { status: 200 })
})

const { useGame } = await import('../germoney/game/store')
const { usePlan } = await import('../germoney/game/plan')
const { usePlayerStore } = await import('../germoney/stores/player-store')

describe('Mission v2 migration', () => {
  it('returns an active operation stake, lifts Purgatory, and never loses the save', async () => {
    await useGame.getState().hydrate()
    const g = useGame.getState().g
    expect(g.flags.v2).toBe(true)
    expect(g.marks).toBeGreaterThanOrEqual(150)                    // 100 + the 50 stake back
    expect(g.operations['2026-10-19'].status).toBe('lost')         // closed, with a note, not deleted
    expect(g.ledger.some((e) => e.ref === 'refund' && e.marks === 50)).toBe(true)
    const p = usePlayerStore.getState().player
    expect([p.isPurgatoryActive, p.level]).toEqual([false, 3])
  })
  it('a second load does not refund again', async () => {
    const m = useGame.getState().g.marks
    useGame.setState({ loaded: false })
    await useGame.getState().hydrate()
    expect(useGame.getState().g.marks).toBe(m)
  })
  it("pulling the plan mirrors the server's XP and applies its events once", async () => {
    await usePlan.getState().refresh()
    expect(usePlayerStore.getState().player.xp).toBe(530)
    expect(useGame.getState().g.days[today].reps.silicon).toBeTruthy()
    const n = useGame.getState().g.ledger.filter((e) => e.kind === 'contract').length
    await usePlan.getState().refresh()
    expect(useGame.getState().g.ledger.filter((e) => e.kind === 'contract').length).toBe(n)
    expect(usePlan.getState().offline).toBe(false)
  })
})
