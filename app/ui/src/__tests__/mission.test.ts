/**
 * Mission Germoney's game logic, as ported into JARVIS. The server is replaced by
 * an in-memory fake behind fetch, so these run with no backend.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const kv = new Map<string, string>()
const writes: Array<[key: string, value: string]> = []          // in the order they LANDED
const xpPosts: number[] = []

vi.stubGlobal('fetch', async (url: string, init?: { method?: string; body?: string }) => {
  const key = decodeURIComponent(String(url).replace('/api/kv/', ''))
  const method = init?.method ?? 'GET'
  if (method === 'POST' && String(url) === '/api/mission/xp') xpPosts.push(JSON.parse(init!.body!).amount)
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

const { usePlayerStore } = await import('../germoney/stores/player-store')
const { AsyncStorage } = await import('../germoney/platform')

const fresh = () => JSON.parse(JSON.stringify(usePlayerStore.getState().player))

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
  it('Rule 1 v2: 14 days without a commit no longer drops a rank; an old Purgatory is lifted and the level given back', () => {
    const old = new Date(Date.now() - 15 * 86_400_000).toISOString()
    usePlayerStore.setState({ player: { ...usePlayerStore.getState().player, level: 3, lastCommitDate: old } })
    usePlayerStore.getState().checkIntegrity()
    expect(usePlayerStore.getState().player).toMatchObject({ level: 3, isPurgatoryActive: false })
    usePlayerStore.setState({ player: { ...usePlayerStore.getState().player, level: 2, isPurgatoryActive: true, purgatoryHoursRemaining: 3, levelBeforePurgatory: 3 } })
    usePlayerStore.getState().checkIntegrity()
    expect(usePlayerStore.getState().player).toMatchObject({ level: 3, isPurgatoryActive: false, purgatoryHoursRemaining: 0, levelBeforePurgatory: null })
  })

  it('one XP total: every change made in the window is sent to the server as a delta; the mirror never echoes back', async () => {
    xpPosts.length = 0
    usePlayerStore.getState().updateXP(40)
    usePlayerStore.getState().updateXP(-10)
    await usePlayerStore.getState().flushXp()
    expect(xpPosts).toEqual([40, -10])
    usePlayerStore.getState().syncXP(1234)
    await usePlayerStore.getState().flushXp()
    expect(usePlayerStore.getState().player.xp).toBe(1234)
    expect(xpPosts).toEqual([40, -10])
  })

  it('recordHours keeps the stats with no XP (the plan log pays it)', () => {
    usePlayerStore.setState({ player: { ...usePlayerStore.getState().player, germanHours: 0 } })
    usePlayerStore.getState().recordHours('german', 1.5)
    usePlayerStore.getState().recordHours('commit', 1)
    const p = usePlayerStore.getState().player
    expect([p.germanHours, p.xp, p.commitsCount > 0, !!p.lastCommitDate]).toEqual([1.5, 0, true, true])
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
    usePlayerStore.setState({ player: { ...usePlayerStore.getState().player, germanHours: 0 } })
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
