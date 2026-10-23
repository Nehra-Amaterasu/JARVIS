/** The game's rules (engine.ts) — pure functions, no store, no network. */
import { describe, expect, it } from 'vitest'
import { seasonBosses } from '../germoney/game/campaign'
import * as E from '../germoney/game/engine'
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
  })

  it('an exam day announced by the plan (academics) counts as exam mode', () => {
    const g = E.defaultGame(MON)
    g.flags[`examday:${MON}`] = true
    secure(g, MON, ['silicon'])
    expect(E.modeOn(g, MON)).toBe('exam')
    expect(E.isSecured(g, MON)).toBe(true)
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

describe('the brief', () => {
  it("says the streak, the open reps and the plan's next contracts", () => {
    const g = E.defaultGame('2026-10-08')
    secure(g, '2026-10-08', ['silicon'])
    const b = E.buildBrief(g, '2026-10-09', 0, [
      { key: 'a/c1', title: 'Full adder', minutes: 45, done: true },
      { key: 'a/c2', title: 'K-map drill', minutes: 30, done: false },
    ])
    expect(b.text).toContain('Floor open: Silicon, Deutsch, Body.')
    expect(b.text).toContain('1 contract done today.')
    expect(b.text).toContain('Next: K-map drill (30 min).')
    expect(b.data.contracts).toHaveLength(2)
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
