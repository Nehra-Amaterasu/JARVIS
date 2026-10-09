/**
 * Mission Germoney's game logic, as ported into JARVIS. The server is replaced by
 * an in-memory fake behind fetch, so these run with no backend.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const kv = new Map<string, string>()
const writes: Array<[key: string, value: string]> = []          // in the order they LANDED

vi.stubGlobal('fetch', async (url: string, init?: { method?: string; body?: string }) => {
  const key = decodeURIComponent(String(url).replace('/api/kv/', ''))
  const method = init?.method ?? 'GET'
  if (method === 'PUT') {
    const { value } = JSON.parse(init!.body!)
    // Simulate the network delivering an EARLIER write slower than a later one.
    await new Promise((r) => setTimeout(r, value.includes('slow') ? 30 : 1))
    kv.set(key, value)
    writes.push([key, value])
  } else if (method === 'DELETE') {
    kv.delete(key)
  }
  const body = url === '/api/kv' ? { keys: [...kv.keys()] } : { value: kv.get(key) ?? null, ok: true }
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
})

const { generateDailyQuests } = await import('../germoney/utils/quest-engine')
const { usePlayerStore } = await import('../germoney/stores/player-store')
const { AsyncStorage } = await import('../germoney/platform')

const fresh = () => JSON.parse(JSON.stringify(usePlayerStore.getState().player))

describe('quest engine', () => {
  const player = fresh()
  it('is deterministic per day and rank', () => {
    const d = new Date(2026, 9, 9)
    expect(generateDailyQuests(player, null, d).map((q) => q.id)).toEqual(generateDailyQuests(player, null, d).map((q) => q.id))
    expect(generateDailyQuests(player, null, d).length).toBeGreaterThanOrEqual(3)
  })
  it('always includes German while German is weak (10 h/week mandate)', () => {
    for (let day = 1; day <= 28; day++) {
      const qs = generateDailyQuests(player, null, new Date(2026, 9, day))
      expect(qs.some((q) => q.id.startsWith('ger-'))).toBe(true)
    }
  })
  it('surfaces a weekly quest on Mondays', () => {
    const monday = new Date(2026, 9, 12)
    expect(generateDailyQuests(player, null, monday).some((q) => q.type === 'weekly')).toBe(true)
  })
})

describe('player store', () => {
  beforeEach(() => {
    usePlayerStore.setState({ player: { ...fresh(), xp: 0, level: 0, completedQuests: [], isPurgatoryActive: false } })
  })

  it('awards the XP the quest card promises (the phone app always gave 25)', () => {
    usePlayerStore.getState().completeQuest('wq6', false, 500)
    expect(usePlayerStore.getState().player.xp).toBe(500)
    usePlayerStore.getState().completeQuest('side', false)          // no number on the card
    expect(usePlayerStore.getState().player.xp).toBe(525)
  })
  it('never pays twice for the same quest', () => {
    usePlayerStore.getState().completeQuest('q1', false, 30)
    usePlayerStore.getState().completeQuest('q1', false, 30)
    expect(usePlayerStore.getState().player.xp).toBe(30)
  })
  it('a defeated boss is worth 200 and marked completed', () => {
    usePlayerStore.getState().completeQuest('b1', true)
    const p = usePlayerStore.getState().player
    expect(p.xp).toBe(200)
    expect(p.bosses.find((b) => b.id === 'b1')!.completed).toBe(true)
  })
  it('Rule 1: 14 days without a commit drops a rank and locks Purgatory', () => {
    const old = new Date(Date.now() - 15 * 86_400_000).toISOString()
    usePlayerStore.setState({ player: { ...usePlayerStore.getState().player, level: 3, lastCommitDate: old } })
    usePlayerStore.getState().checkIntegrity()
    const p = usePlayerStore.getState().player
    expect([p.level, p.isPurgatoryActive, p.purgatoryHoursRemaining, p.levelBeforePurgatory]).toEqual([2, true, 3, 3])
  })
  it('a real recent commit from GitHub reverses an unjust drop', () => {
    usePlayerStore.setState({ player: { ...usePlayerStore.getState().player, level: 2, isPurgatoryActive: true,
      purgatoryHoursRemaining: 3, levelBeforePurgatory: 3, lastCommitDate: new Date(Date.now() - 20 * 86_400_000).toISOString() } })
    usePlayerStore.getState().syncGithub(new Date().toISOString(), 40)
    const p = usePlayerStore.getState().player
    expect([p.level, p.isPurgatoryActive]).toEqual([3, false])
  })
  it('three Crucible hours clear Purgatory', () => {
    usePlayerStore.setState({ player: { ...usePlayerStore.getState().player, isPurgatoryActive: true, purgatoryHoursRemaining: 3 } })
    usePlayerStore.getState().resolvePurgatory(3)
    expect(usePlayerStore.getState().player.isPurgatoryActive).toBe(false)
  })
  it('logging German adds hours and the standard 15 XP', () => {
    usePlayerStore.getState().logExecution('german', 2)
    const p = usePlayerStore.getState().player
    expect([p.germanHours, p.xp]).toEqual([2, 15])
  })
})

describe('storage shim', () => {
  it('writes to one key land in the order they were made, even if the network reorders them', async () => {
    const a = AsyncStorage.setItem('@k', 'first-slow')
    const b = AsyncStorage.setItem('@k', 'second')
    await Promise.all([a, b])
    expect(writes.filter(([k]) => k === '@k').map(([, v]) => v)).toEqual(['first-slow', 'second'])
    expect(kv.get('@k')).toBe('second')
  })
  it('reads come from the write-through cache', async () => {
    await AsyncStorage.setItem('@c', 'v')
    kv.set('@c', 'changed-behind-our-back')
    expect(await AsyncStorage.getItem('@c')).toBe('v')
  })
})
