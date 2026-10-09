/** The game's rules (engine.ts) — pure functions, no store, no network. */
import { describe, expect, it } from 'vitest'
import { seasonBosses } from '../germoney/game/campaign'
import { dailyContracts } from '../germoney/game/contracts'
import * as E from '../germoney/game/engine'
import { weeklyOffers } from '../germoney/game/operations'
import { addDays } from '../germoney/game/util'

const MON = '2026-10-05' // a Monday; Sunday is the default rest day

function secure(g: E.GameData, date: string, reps: E.Rep[] = E.REPS) {
  g.days[date] = { reps: Object.fromEntries(reps.map((r) => [r, { at: 0, source: 'test', verified: true }])) }
}
const ev = (date: string, e: Partial<E.LedgerEvent>): E.LedgerEvent => ({ t: 0, date, kind: 'contract', ...e }) as E.LedgerEvent

describe('levels', () => {
  it('level 2 at 100 XP, +20 XP more per level after that', () => {
    expect([E.xpToReach(1), E.xpToReach(2), E.xpToReach(3), E.xpToReach(4)]).toEqual([0, 100, 220, 360])
    expect(E.levelInfo(99).level).toBe(1)
    expect(E.levelInfo(100).level).toBe(2)
    expect(E.levelInfo(28420).level).toBe(50)
  })
  it('level rewards: Marks every level, a shield every 5th', () => {
    const r = E.levelRewards(1, 5)
    expect(r.shields).toBe(1)
    expect(r.marks).toBe([2, 3, 4, 5].reduce((a, L) => a + 30 + 5 * L, 0))
  })
})

describe('the floor and the streak', () => {
  it('needs all three reps normally; rest days and shields keep the streak', () => {
    const g = E.defaultGame(MON)
    secure(g, MON)
    secure(g, addDays(MON, 1), ['silicon', 'deutsch'])
    expect(E.isSecured(g, MON)).toBe(true)
    expect(E.isSecured(g, addDays(MON, 1))).toBe(false)
    expect(E.isKept(g, addDays(MON, 6))).toBe(true) // Sunday
  })

  it('a run of only rest days is not a streak', () => {
    const g = E.defaultGame(addDays(MON, 6))
    expect(E.streakInfo(g, addDays(MON, 6)).current).toBe(0)
  })

  it('never miss twice: a missed day burns a shield; with none, the streak breaks and Phoenix arms', () => {
    let g = E.defaultGame(MON)
    g.shields = 1
    secure(g, MON)
    secure(g, addDays(MON, 1))
    // Wednesday missed
    secure(g, addDays(MON, 3))
    let s = E.settleDays(g, addDays(MON, 4))
    g = s.g
    expect(s.events.map((e) => e.kind)).toEqual(['shield'])
    expect(g.shields).toBe(0)
    expect(E.streakInfo(g, addDays(MON, 3)).current).toBe(4)
    // Friday missed with no shield
    secure(g, addDays(MON, 5))
    s = E.settleDays(g, addDays(MON, 5))
    g = s.g
    expect(s.events.map((e) => e.kind)).toEqual(['break'])
    expect(g.phoenixLeft).toBe(3)
    expect(E.streakInfo(g, addDays(MON, 5)).current).toBe(1)
  })

  it('settling is idempotent', () => {
    const g = E.defaultGame(MON)
    secure(g, MON)
    const a = E.settleDays(g, addDays(MON, 3))
    const b = E.settleDays(a.g, addDays(MON, 3))
    expect(b.events).toEqual([])
  })

  it('a moved rest day: the declared day rests, the default one does not', () => {
    const g = E.defaultGame(MON)
    g.days[addDays(MON, 2)] = { reps: {}, rest: true }
    g.days[addDays(MON, 6)] = { reps: {}, noRest: true }
    expect(E.isRestDay(g, addDays(MON, 2))).toBe(true)
    expect(E.isRestDay(g, addDays(MON, 6))).toBe(false)
  })

  it('exam mode: the silicon rep (exam study) secures; recovery: any one rep', () => {
    const g = E.defaultGame(MON)
    g.modes.exam.push({ from: MON, to: MON })
    g.modes.recovery.push({ from: addDays(MON, 1), to: addDays(MON, 1) })
    secure(g, MON, ['silicon'])
    secure(g, addDays(MON, 1), ['body'])
    expect(E.isSecured(g, MON)).toBe(true)
    expect(E.isSecured(g, addDays(MON, 1))).toBe(true)
    expect(E.xpMultiplier(g, addDays(MON, 1))).toBeCloseTo(0.6)
  })

  it('floor reward grows with the streak and doubles under Phoenix; a shield every 7 days', () => {
    expect(E.floorReward(1, false).marks).toBe(21)
    expect(E.floorReward(100, false).marks).toBe(50)
    expect(E.floorReward(3, true).marks).toBe(46)
    expect([6, 7, 14].map(E.shieldEarned)).toEqual([false, true, true])
  })
})

describe('supply drop', () => {
  it('is fixed per date (no rerolling by reopening)', () => {
    expect(E.rollChest('2026-10-09', 4)).toEqual(E.rollChest('2026-10-09', 4))
  })
  it('every 7th streak day is legendary: double Marks and a shield', () => {
    const l = E.rollChest('2026-10-09', 7)
    expect(l.legendary && l.shield).toBe(true)
    expect(l.marks).toBeGreaterThanOrEqual(2 * (20 + 7))
  })
})

describe('contracts', () => {
  const ctx = { date: '2026-10-07', rank: 0, seasonMonth: 1, activeBossIds: ['b1'], rest: false }
  it('three a day, deterministic, exactly one hidden crit', () => {
    const a = dailyContracts(ctx)
    expect(a.map((c) => c.key)).toEqual(dailyContracts(ctx).map((c) => c.key))
    expect(a).toHaveLength(3)
    expect(a.filter((c) => c.crit)).toHaveLength(1)
    expect(new Set(a.map((c) => c.def.npc)).size).toBe(3)
  })
  it('the rest day has none', () => {
    expect(dailyContracts({ ...ctx, rest: true })).toEqual([])
  })
  it('a reroll changes only that slot', () => {
    const a = dailyContracts(ctx)
    let changed = false
    for (let n = 1; n < 6 && !changed; n++) {
      const b = dailyContracts({ ...ctx, rerolls: { deutsch: n } })
      expect(b[0].key).toBe(a[0].key)
      changed = b[1].key !== a[1].key
    }
    expect(changed).toBe(true)
  })
  it('respects the rank band: a rank-0 player never gets a RISC-V contract', () => {
    for (let d = 0; d < 60; d++) {
      const day = addDays('2026-10-05', d)
      for (const c of dailyContracts({ ...ctx, date: day })) expect(['s33', 's34', 's35', 's36']).not.toContain(c.def.id)
    }
  })
  combo()
})

function combo() {
  it('combo and crit multiply XP; crit doubles Marks', () => {
    expect(E.contractReward(20, { crit: false, nth: 1, mult: 1 })).toEqual({ xp: 20, marks: 10 })
    expect(E.contractReward(20, { crit: false, nth: 3, mult: 1 }).xp).toBe(25)
    expect(E.contractReward(20, { crit: true, nth: 4, mult: 1 })).toEqual({ xp: 60, marks: 20 })
  })
}

describe('bosses', () => {
  it('twelve bosses, one per month from the season start; exam days extend the deadline', () => {
    const bs = seasonBosses('2026-10-01')
    expect(bs).toHaveLength(12)
    expect(bs[0]).toMatchObject({ id: 'b1', start: '2026-10-01', deadline: '2026-10-31' })
    expect(bs[11]).toMatchObject({ id: 'b9', start: '2027-09-01' })
    const ext = seasonBosses('2026-10-01', (from) => (from === '2026-10-01' ? 5 : 0))
    expect(ext[0].deadline).toBe('2026-11-05')
  })

  it('daily work damages the boss; the kill needs the deliverable', () => {
    const g = E.defaultGame('2026-10-01')
    const b1 = E.datedBosses(g)[0]
    g.ledger.push(
      ev('2026-10-03', { kind: 'contract', track: 'silicon' }),
      ev('2026-10-03', { kind: 'contract', track: 'silicon', note: 'crit' }),
      ev('2026-10-03', { kind: 'contract', track: 'deutsch' }), // wrong track: no damage
      ev('2026-10-04', { kind: 'focus', track: 'silicon', amount: 300 }), // capped at 12
      ev('2026-10-04', { kind: 'floor' }),
    )
    expect(E.bossDamage(b1, g, '2026-10-09')).toBe(8 + 16 + 12 + 2)
    const st = E.bossState(b1, g, '2026-10-09')
    expect(st).toMatchObject({ status: 'active', hp: 100 - 38, hpMax: 100, daysLeft: 22 })
  })

  it('an undefeated boss escapes after its deadline: debuff, and +25% HP', () => {
    let g = E.defaultGame('2026-10-01')
    const s = E.settleBosses(g, '2026-11-02')
    g = s.g
    expect(s.events.map((e) => e.ref)).toEqual(['b1'])
    const b1 = E.datedBosses(g)[0]
    expect(E.bossState(b1, g, '2026-11-02')).toMatchObject({ status: 'escaped', hpMax: 125 })
    expect(E.xpMultiplier(g, '2026-11-03')).toBeCloseTo(0.9)
    expect(E.xpMultiplier(g, '2026-11-09')).toBe(1)
  })

  it('a kill with more than 25% HP left is an Ambush (+20%)', () => {
    const b1 = seasonBosses('2026-10-01')[0]
    expect(E.defeatReward(b1, 60, 100)).toMatchObject({ ambush: true, xp: 600 })
    expect(E.defeatReward(b1, 10, 100)).toMatchObject({ ambush: false, xp: 500 })
  })

  it('season month counts from the season start', () => {
    const g = E.defaultGame('2026-10-01')
    expect(E.seasonMonth(g, '2026-10-09')).toBe(1)
    expect(E.seasonMonth(g, '2027-01-15')).toBe(4)
  })
})

describe('operations', () => {
  it('three offers a week — one Silicon, one Deutsch, one other — fixed for the week', () => {
    const o = weeklyOffers(MON)
    expect(o.map((x) => x.track).slice(0, 2)).toEqual(['silicon', 'deutsch'])
    expect(weeklyOffers(MON)).toEqual(o)
  })
  it('progress is measured from the ledger', () => {
    const g = E.defaultGame(MON)
    g.operations[MON] = { chosen: 'op-funf', stake: 50, status: 'active' }
    for (let i = 0; i < 5; i++) g.ledger.push(ev(addDays(MON, i), { kind: 'contract', track: 'deutsch' }))
    expect(E.operationProgress(g, MON, addDays(MON, 4))).toMatchObject({ value: 5, n: 5, done: true })
  })
})

describe('the brief', () => {
  it('says the streak, the open reps and the boss', () => {
    const g = E.defaultGame('2026-10-08')
    secure(g, '2026-10-08', ['silicon'])
    const b = E.buildBrief(g, '2026-10-09', 0, 0, [])
    expect(b.text).toContain('Floor open: Silicon, Deutsch, Body.')
    expect(b.text).toContain('The Boolean Sentinel')
    expect(b.data.boss.id).toBe('b1')
  })
})

describe('saves', () => {
  it('a damaged or older save never crashes the game', () => {
    const g = E.mergeGame({ marks: 'lots', days: [], settings: { sound: false } }, MON)
    expect(g.marks).toBe(0)
    expect(g.days).toEqual({})
    expect(g.settings.sound).toBe(false)
    expect(g.settings.targets.silicon).toBe(10)
  })
})
