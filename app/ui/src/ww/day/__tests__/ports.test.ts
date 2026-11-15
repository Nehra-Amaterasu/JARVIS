// L01 Day ports: every member of the Day port has a null adapter that answers WAITING (or PLANNED) with a reason and no data; adapters
// compose by rank per member; a member nobody supplies is still WAITING, never a throw.
import { describe, expect, it } from 'vitest'
import registration, { nullDayPort } from '../adapters/null.register'
import { planned, waiting } from '../adapters/types'
import { DAY_MEMBERS, DAY_PORT, collectAdapters, composePort, type DayPort } from '../ports'

const args: Record<string, unknown[]> = {
  month: ['2026-11'], day: ['2026-11-18'], intake: ['2026-11'], intents: [{ from: '2026-11-01', to: '2026-11-30' }],
  logs: [{ op: 'done', date: '2026-11-18', id: 'x' }], reminders: ['2026-11-18'], gcal: ['2026-11'], dashboards: ['2026-11'],
}

describe('the Day port', () => {
  it('has the eight members of the contract', () => {
    expect([...DAY_MEMBERS]).toEqual(['month', 'day', 'intake', 'intents', 'logs', 'reminders', 'gcal', 'dashboards'])
    expect(Object.keys(nullDayPort).sort()).toEqual([...DAY_MEMBERS].sort())
  })

  it('answers WAITING or PLANNED with a reason and no data, from every member of the null adapter', async () => {
    for (const k of DAY_MEMBERS) {
      const r = await (nullDayPort[k] as (...a: unknown[]) => Promise<{ state: string; reason: string; data: unknown; since: unknown }>)(...args[k])
      expect(['waiting', 'planned'], k).toContain(r.state)
      expect(r.reason.length, k).toBeGreaterThan(10)
      expect(r.data, k).toBeNull()
      expect(r.since, k).toBeNull()
    }
  })

  it('says the Google link and the dashboards are PLANNED, and a save is not claimed', async () => {
    expect((await nullDayPort.gcal('2026-11')).state).toBe('planned')
    expect((await nullDayPort.dashboards('2026-11')).state).toBe('planned')
    const w = await nullDayPort.logs({ op: 'done', date: '2026-11-18', id: 'x' })
    expect(w.state).toBe('waiting')
    expect(w.reason).toContain('nothing was saved')
  })

  it('is rank 0, so a real adapter replaces only the members it supplies', async () => {
    expect(registration.rank).toBe(0)
    const real: Partial<DayPort> = { month: async () => ({ state: 'live', reason: 'read', since: 1, data: [] }) }
    const port = composePort([{ id: 'real', rank: 10, port: real }, registration])
    expect((await port.month('2026-11')).state).toBe('live')
    expect((await port.day('2026-11-18')).state).toBe('waiting')
  })

  it('answers WAITING for a member nobody supplies, and skips a file with no registration', async () => {
    const port = composePort([])
    for (const k of DAY_MEMBERS) expect((await (port[k] as (...a: unknown[]) => Promise<{ state: string }>)(...args[k])).state).toBe('waiting')
    expect(collectAdapters({ './a.register.ts': {}, './b.register.ts': { default: registration }, './c.register.ts': { registration: { id: 1 } } })).toEqual([registration])
  })

  it('collects the null adapter by glob, so the screens read WAITING until another adapter is added', async () => {
    expect((await DAY_PORT.month('2026-11')).state).toBe('waiting')
    expect((await DAY_PORT.intents({ from: 'a', to: 'b' })).state).toBe('waiting')
  })

  it('has the two honest answers an adapter reaches for', () => {
    expect(waiting('x')).toEqual({ state: 'waiting', reason: 'x', since: null, data: null })
    expect(planned('y').state).toBe('planned')
  })
})
