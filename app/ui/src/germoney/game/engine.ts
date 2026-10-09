/**
 * The game's rules as pure functions over GameData + a ledger. No React, no I/O:
 * every number on screen is computed here, so every rule is unit-tested.
 *
 * Design reasons live in docs/design/mission-game.md.
 */
import type { Stats } from './achievements'
import { seasonBosses, type DatedBoss } from './campaign'
import { NPCS, type Track } from './characters'
import { BOOT_CAMP, type DailyContract } from './contracts'
import { OPERATION_BY_ID, type Metric } from './operations'
import { CARDS } from './decks'
import { addDays, dateKey, daysBetween, inRange, monthStart, rngFor, weekday, weekEnd, weekStart } from './util'

/* ======================================================================= data */
export type Rep = 'silicon' | 'deutsch' | 'body'
export const REPS: Rep[] = ['silicon', 'deutsch', 'body']
export const REP_LABEL: Record<Rep, string> = { silicon: 'Silicon', deutsch: 'Deutsch', body: 'Body' }
export const REP_HINT: Record<Rep, string> = {
  silicon: '25 min of VLSI — a Crucible block, a Silicon contract, or 20 VLSI cards',
  deutsch: '15 min of German — a lesson, a German contract, or 20 German cards',
  body: 'Your training session — or a 20-minute walk',
}

export interface RepMark { at: number; source: string; verified: boolean }
/** rest: a declared rest day. noRest: the default rest weekday given up for it (one rest day a week). */
export interface DayRecord { reps: Partial<Record<Rep, RepMark>>; rest?: boolean; noRest?: boolean; shield?: boolean; securedAt?: number }
export interface Period { from: string; to: string; label?: string }

export type EventKind =
  | 'contract' | 'focus' | 'floor' | 'rep' | 'operation' | 'drill' | 'log' | 'boss' | 'chest' | 'buy'
  | 'trial' | 'level' | 'shield' | 'break' | 'escape' | 'achievement' | 'boot' | 'brief'

export interface LedgerEvent {
  t: number
  date: string
  kind: EventKind
  track?: Track
  amount?: number
  ref?: string
  xp?: number
  marks?: number
  note?: string
  verified?: boolean
}

export interface ShopItem { id: string; label: string; cost: number; kind: 'reward' | 'shield' | 'reroll' | 'booster' }
export interface Loot { marks: number; shield: boolean; booster: boolean; card: string; legendary: boolean }
export interface OperationState { chosen?: string; stake?: number; status?: 'active' | 'won' | 'lost'; proof?: string }
export interface TrialState { stage: number; best?: number; updated: string; examDate?: string; note?: string }
export interface CardState { box: number; due: string; seen: number; lapses: number; first?: string }

export interface Settings {
  restWeekday: number
  sound: boolean
  voiceNudges: boolean
  nudgeAt: string
  focusScene: boolean
  targets: { silicon: number; deutsch: number; workouts: number }
  inrPerEur: number
}

export interface GameData {
  v: 1
  seasonStart: string
  firstPlay: string
  marks: number
  shields: number
  boosters: number
  phoenixLeft: number
  phoenixEarned: boolean
  bestStreak: number
  /** Highest level already rewarded — level rewards are paid exactly once. */
  levelSeen: number
  days: Record<string, DayRecord>
  lastSettled: string | null
  ledger: LedgerEvent[]
  contracts: Record<string, { at: number; xp: number; marks: number; crit: boolean; track: Track; verified: boolean }>
  rerolls: Record<string, Partial<Record<string, number>>>
  /** Rank at the start of each day — today's contracts are generated from it. */
  dayRank: Record<string, number>
  chests: Record<string, Loot>
  operations: Record<string, OperationState>
  bosses: Record<string, { defeatedAt?: string; ambush?: boolean; escapedAt?: string }>
  trials: Record<string, TrialState>
  shop: ShopItem[]
  shopEdited: boolean
  purchases: { t: number; item: string; label: string; cost: number; kind: ShopItem['kind'] }[]
  drill: Record<string, CardState>
  drillDay: Record<string, Record<string, number>>
  achievements: Record<string, string>
  settings: Settings
  modes: { exam: Period[]; recovery: Period[] }
  warChest: { saved: number; log: { t: number; amount: number; note: string }[]; custom: { id: string; label: string; inr: number; due: string }[] }
  flags: Record<string, boolean>
  nudged: Record<string, boolean>
}

export const DEFAULT_SHOP: ShopItem[] = [
  { id: 'r-episode', label: 'One anime episode', cost: 60, kind: 'reward' },
  { id: 'r-game', label: 'One hour of gaming', cost: 120, kind: 'reward' },
  { id: 'r-scroll', label: '30 minutes of reels, guilt-free', cost: 80, kind: 'reward' },
  { id: 'r-meal', label: 'A cheat meal', cost: 200, kind: 'reward' },
  { id: 'r-sleep', label: 'A lazy morning (sleep in)', cost: 150, kind: 'reward' },
  { id: 'r-movie', label: 'A movie night', cost: 250, kind: 'reward' },
  { id: 'i-shield', label: 'Shield (covers one missed day)', cost: 250, kind: 'shield' },
  { id: 'i-booster', label: 'Crucible booster (+50% XP, one session)', cost: 100, kind: 'booster' },
]

export const REROLL_COST = 40
export const MAX_SHIELDS = 3

export function defaultGame(today: string = dateKey()): GameData {
  return {
    v: 1,
    seasonStart: '2026-10-01',
    firstPlay: today,
    marks: 0,
    shields: 1,
    boosters: 0,
    phoenixLeft: 0,
    phoenixEarned: false,
    bestStreak: 0,
    levelSeen: 1,
    days: {},
    lastSettled: null,
    ledger: [],
    contracts: {},
    rerolls: {},
    dayRank: {},
    chests: {},
    operations: {},
    bosses: {},
    trials: {},
    shop: DEFAULT_SHOP.map((s) => ({ ...s })),
    shopEdited: false,
    purchases: [],
    drill: {},
    drillDay: {},
    achievements: {},
    settings: { restWeekday: 0, sound: true, voiceNudges: true, nudgeAt: '21:30', focusScene: false, targets: { silicon: 10, deutsch: 7, workouts: 5 }, inrPerEur: 100 },
    modes: { exam: [], recovery: [] },
    warChest: { saved: 0, log: [], custom: [] },
    flags: {},
    nudged: {},
  }
}

/** Save-format safety net (same idea as player-store's mergePlayer). */
export function mergeGame(raw: unknown, today: string = dateKey()): GameData {
  const d = defaultGame(today)
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Partial<GameData>
  const obj = <T,>(v: unknown, dflt: T): T => (v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : dflt)
  const arr = <T,>(v: unknown, dflt: T[]): T[] => (Array.isArray(v) ? (v as T[]) : dflt)
  const num = (v: unknown, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt)
  return {
    ...d,
    seasonStart: typeof r.seasonStart === 'string' ? r.seasonStart : d.seasonStart,
    firstPlay: typeof r.firstPlay === 'string' ? r.firstPlay : d.firstPlay,
    marks: num(r.marks, 0), shields: num(r.shields, d.shields), boosters: num(r.boosters, 0),
    phoenixLeft: num(r.phoenixLeft, 0), phoenixEarned: !!r.phoenixEarned, bestStreak: num(r.bestStreak, 0), levelSeen: num(r.levelSeen, 1),
    days: obj(r.days, {}), lastSettled: typeof r.lastSettled === 'string' ? r.lastSettled : null,
    ledger: arr(r.ledger, []), contracts: obj(r.contracts, {}), rerolls: obj(r.rerolls, {}), dayRank: obj(r.dayRank, {}), chests: obj(r.chests, {}),
    operations: obj(r.operations, {}), bosses: obj(r.bosses, {}), trials: obj(r.trials, {}),
    shop: arr(r.shop, d.shop), shopEdited: !!r.shopEdited, purchases: arr(r.purchases, []), drill: obj(r.drill, {}), drillDay: obj(r.drillDay, {}),
    achievements: obj(r.achievements, {}),
    settings: { ...d.settings, ...obj(r.settings, {}), targets: { ...d.settings.targets, ...obj(r.settings?.targets, {}) } },
    modes: { exam: arr(r.modes?.exam, []), recovery: arr(r.modes?.recovery, []) },
    warChest: { ...d.warChest, ...obj(r.warChest, {}) },
    flags: obj(r.flags, {}), nudged: obj(r.nudged, {}),
  }
}

/* ======================================================================= levels */
/** Cumulative XP to reach `level`: 100 for level 2, +20 more per level after. */
export function xpToReach(level: number): number {
  const L = Math.max(1, Math.floor(level))
  return 100 * (L - 1) + 10 * (L - 1) * (L - 2)
}

export function levelInfo(xp: number) {
  let level = 1
  while (xpToReach(level + 1) <= xp) level++
  const base = xpToReach(level)
  const next = xpToReach(level + 1)
  return { level, into: xp - base, need: next - base, progress: (xp - base) / (next - base) }
}

/** Rewards for each level gained: Marks always, a Shield every 5th level. */
export function levelRewards(from: number, to: number) {
  let marks = 0
  let shields = 0
  for (let L = from + 1; L <= to; L++) {
    marks += 30 + 5 * L
    if (L % 5 === 0) shields++
  }
  return { marks, shields }
}

/* ======================================================================= modes */
export function modeOn(g: GameData, date: string): 'exam' | 'recovery' | null {
  if (g.modes.exam.some((p) => inRange(date, p.from, p.to))) return 'exam'
  if (g.modes.recovery.some((p) => inRange(date, p.from, p.to))) return 'recovery'
  return null
}

export function examDaysBetween(g: GameData, from: string, to: string): number {
  let n = 0
  for (let d = from; d <= to; d = addDays(d, 1)) if (g.modes.exam.some((p) => inRange(d, p.from, p.to))) n++
  return n
}

/* ======================================================================= the floor & streak */
export function isRestDay(g: GameData, date: string): boolean {
  const d = g.days[date]
  return !!d?.rest || (weekday(date) === g.settings.restWeekday && !d?.noRest)
}

export function isSecured(g: GameData, date: string): boolean {
  const day = g.days[date]
  if (!day) return false
  const n = REPS.filter((r) => day.reps[r]).length
  const mode = modeOn(g, date)
  if (mode === 'recovery') return n >= 1
  if (mode === 'exam') return !!day.reps.silicon
  return n === REPS.length
}

/** Kept = the system was honoured that day: secured, a rest day, or covered by a shield. */
export function isKept(g: GameData, date: string): boolean {
  return isSecured(g, date) || isRestDay(g, date) || !!g.days[date]?.shield
}

/** Length of the kept run ending at `end` (inclusive). A run of only rest/shield days is 0. */
export function runLength(g: GameData, end: string): number {
  let n = 0
  let worked = false
  for (let d = end; d >= g.firstPlay && isKept(g, d); d = addDays(d, -1)) {
    n++
    if (isSecured(g, d)) worked = true
  }
  return worked ? n : 0
}

export function streakInfo(g: GameData, today: string) {
  const todayKept = isKept(g, today)
  const current = todayKept ? runLength(g, today) : runLength(g, addDays(today, -1))
  return { current, todayKept, todaySecured: isSecured(g, today), best: Math.max(g.bestStreak, current) }
}

/**
 * Walk the days since the last settlement. A missed day burns a shield if the
 * streak was alive; with no shield the streak breaks and Phoenix arms (the next
 * three secured days pay double), because the danger after a break is quitting.
 */
export function settleDays(g: GameData, today: string): { g: GameData; events: LedgerEvent[] } {
  const yesterday = addDays(today, -1)
  let from = g.lastSettled ? addDays(g.lastSettled, 1) : g.firstPlay
  if (from > yesterday) return { g, events: [] }
  const out: GameData = { ...g, days: { ...g.days } }
  const events: LedgerEvent[] = []
  for (; from <= yesterday; from = addDays(from, 1)) {
    if (isKept(out, from)) continue
    const before = runLength(out, addDays(from, -1))
    if (before === 0) continue
    if (out.shields > 0) {
      out.shields -= 1
      out.days[from] = { ...(out.days[from] ?? { reps: {} }), shield: true }
      events.push({ t: Date.now(), date: from, kind: 'shield', note: `Shield burned to keep a ${before}-day streak` })
    } else {
      out.phoenixLeft = 3
      events.push({ t: Date.now(), date: from, kind: 'break', amount: before, note: `Streak of ${before} broken` })
    }
  }
  out.lastSettled = yesterday
  return { g: out, events }
}

export function floorReward(streakAfter: number, phoenix: boolean) {
  const marks = 20 + Math.min(30, streakAfter)
  return { xp: 20, marks: phoenix ? marks * 2 : marks }
}

export const shieldEarned = (streakAfter: number) => streakAfter > 0 && streakAfter % 7 === 0

/* ======================================================================= supply drop */
const INTEL_IDS = CARDS.filter((c) => c.deck !== 'deutsch').map((c) => c.id)

export function rollChest(date: string, streak: number): Loot {
  const r = rngFor(`chest|${date}`)
  const legendary = streak > 0 && streak % 7 === 0
  let marks = 20 + Math.floor(r() * 41) + Math.min(streak, 30)
  if (legendary) marks *= 2
  const shield = legendary || (streak >= 3 && r() < 0.08)
  const booster = r() < 0.12
  const card = INTEL_IDS[Math.floor(r() * INTEL_IDS.length) % INTEL_IDS.length]
  return { marks, shield, booster, card, legendary }
}

/* ======================================================================= contracts */
export function comboMult(nth: number): number {
  return nth <= 1 ? 1 : nth === 2 ? 1.1 : nth === 3 ? 1.25 : 1.5
}

export function xpMultiplier(g: GameData, date: string): number {
  let m = 1
  const recentEscape = Object.values(g.bosses).some((b) => b.escapedAt && daysBetween(b.escapedAt, date) >= 0 && daysBetween(b.escapedAt, date) < 7)
  if (recentEscape) m *= 0.9
  if (modeOn(g, date) === 'recovery') m *= 0.6
  return m
}

export function contractReward(baseXp: number, opts: { crit: boolean; nth: number; mult: number }) {
  const crit = opts.crit ? 2 : 1
  return {
    xp: Math.round(baseXp * comboMult(opts.nth) * crit * opts.mult),
    marks: Math.round((baseXp / 2) * crit),
  }
}

export function contractsDoneOn(g: GameData, date: string): number {
  return g.ledger.filter((e) => e.kind === 'contract' && e.date === date).length
}

/* ======================================================================= bosses */
export function datedBosses(g: GameData): DatedBoss[] {
  return seasonBosses(g.seasonStart, (from, to) => examDaysBetween(g, from, to))
}

export function seasonMonth(g: GameData, date: string): number {
  const a = monthStart(g.seasonStart)
  const b = monthStart(date)
  const months = (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)))
  return months + 1
}

/** Damage one ledger event deals to a boss (0 if it does not hit it). */
export function eventDamage(e: LedgerEvent, b: DatedBoss): number {
  const hit = !!e.track && b.tracks.includes(e.track)
  if (e.kind === 'contract' && hit) return e.note === 'crit' ? 16 : 8
  if (e.kind === 'focus' && hit) return Math.min(12, Math.floor((e.amount ?? 0) / 10))
  if (e.kind === 'floor') return 2
  if (e.kind === 'operation' && e.note === 'won' && hit) return 15
  if (e.kind === 'drill' && hit) return 3 * Math.floor((e.amount ?? 0) / 20)
  if (e.kind === 'log' && hit) return Math.min(10, Math.round((e.amount ?? 0) * 5))
  return 0
}

/** Damage dealt to a boss by everything logged since it appeared. */
export function bossDamage(b: DatedBoss, g: GameData, until: string): number {
  const end = g.bosses[b.id]?.defeatedAt ?? until
  let dmg = 0
  for (const e of g.ledger) if (e.date >= b.start && e.date <= end) dmg += eventDamage(e, b)
  return dmg
}

export type BossStatus = 'upcoming' | 'active' | 'escaped' | 'defeated'

export function bossState(b: DatedBoss, g: GameData, today: string) {
  const st = g.bosses[b.id] ?? {}
  const status: BossStatus = st.defeatedAt ? 'defeated' : today < b.start ? 'upcoming' : st.escapedAt || today > b.deadline ? 'escaped' : 'active'
  const hpMax = Math.round(b.hp * (st.escapedAt ? 1.25 : 1))
  const hp = status === 'upcoming' ? hpMax : Math.max(0, hpMax - bossDamage(b, g, today))
  const daysLeft = daysBetween(today, b.deadline)
  return { status, hp, hpMax, daysLeft, ambush: !!st.ambush, defeatedAt: st.defeatedAt, escapedAt: st.escapedAt }
}

/** Bosses you can damage today: started, not defeated (escaped ones still count). */
export function activeBosses(g: GameData, today: string): DatedBoss[] {
  return datedBosses(g).filter((b) => b.start <= today && !g.bosses[b.id]?.defeatedAt)
}

/** The boss the month belongs to (falls back to the next upcoming / last). */
export function currentBoss(g: GameData, today: string): DatedBoss {
  const all = datedBosses(g)
  return all.find((b) => b.start <= today && today <= b.deadline) ?? all.find((b) => b.start > today) ?? all[all.length - 1]
}

/** Mark bosses whose deadline passed undefeated. */
export function settleBosses(g: GameData, today: string): { g: GameData; events: LedgerEvent[] } {
  const events: LedgerEvent[] = []
  let bosses = g.bosses
  for (const b of datedBosses(g)) {
    const st = bosses[b.id] ?? {}
    if (st.defeatedAt || st.escapedAt || today <= b.deadline) continue
    const escapedAt = addDays(b.deadline, 1)
    bosses = { ...bosses, [b.id]: { ...st, escapedAt } }
    events.push({ t: Date.now(), date: escapedAt, kind: 'escape', ref: b.id, note: `${b.name} escaped` })
  }
  return { g: events.length ? { ...g, bosses } : g, events }
}

/** Defeating with more than 25% HP left is an Ambush: +20% reward. */
export function defeatReward(b: DatedBoss, hp: number, hpMax: number) {
  const ambush = hp > hpMax * 0.25
  const k = ambush ? 1.2 : 1
  return { ambush, xp: Math.round(b.reward.xp * k), marks: Math.round(b.reward.marks * k) }
}

/* ======================================================================= weekly operations */

export function metricValue(g: GameData, metric: Metric, from: string, to: string, today: string): number {
  const inWeek = (e: LedgerEvent) => e.date >= from && e.date <= to
  const sum = (f: (e: LedgerEvent) => boolean, v: (e: LedgerEvent) => number = () => 1) =>
    g.ledger.filter((e) => inWeek(e) && f(e)).reduce((a, e) => a + v(e), 0)
  const days = (f: (d: string) => boolean) => {
    let n = 0
    for (let d = from; d <= to; d = addDays(d, 1)) if (f(d)) n++
    return n
  }
  switch (metric) {
    case 'floor.secured': return days((d) => d <= today && isKept(g, d))
    case 'floor.silicon': return days((d) => !!g.days[d]?.reps.silicon)
    case 'floor.deutsch': return days((d) => !!g.days[d]?.reps.deutsch)
    case 'floor.body': return days((d) => !!g.days[d]?.reps.body)
    case 'focus.silicon': return sum((e) => e.kind === 'focus' && e.track === 'silicon', (e) => e.amount ?? 0)
    case 'focus.any': return sum((e) => e.kind === 'focus', (e) => e.amount ?? 0)
    case 'contracts.silicon': return sum((e) => e.kind === 'contract' && e.track === 'silicon')
    case 'contracts.deutsch': return sum((e) => e.kind === 'contract' && e.track === 'deutsch')
    case 'contracts.capital': return sum((e) => e.kind === 'contract' && e.track === 'capital')
    case 'contracts.paper': return sum((e) => e.kind === 'contract' && e.track === 'paper')
    case 'drill.deutsch': return sum((e) => e.kind === 'drill' && e.ref === 'deutsch', (e) => e.amount ?? 0)
    case 'drill.vlsi': return sum((e) => e.kind === 'drill' && e.ref === 'vlsi', (e) => e.amount ?? 0)
    case 'drill.any': return sum((e) => e.kind === 'drill', (e) => e.amount ?? 0)
  }
}

export function operationProgress(g: GameData, week: string, today: string) {
  const st = g.operations[week]
  const def = st?.chosen ? OPERATION_BY_ID[st.chosen] : undefined
  if (!def) return null
  const from = weekStart(week)
  const to = weekEnd(week)
  if (!def.goal) return { def, st, value: st.proof ? 1 : 0, n: 1, done: !!st.proof }
  const value = metricValue(g, def.goal.metric, from, to, today)
  return { def, st, value, n: def.goal.n, done: value >= def.goal.n }
}

/** Weeks of won operations in a row, ending with the last finished week. */
export function momentum(g: GameData, today: string): number {
  let n = 0
  for (let w = addDays(weekStart(today), -7); g.operations[w]?.status === 'won'; w = addDays(w, -7)) n++
  if (g.operations[weekStart(today)]?.status === 'won') n++
  return n
}

/* ======================================================================= attributes */
export function attributes(g: GameData, today: string) {
  const from = addDays(today, -27)
  const recent = g.ledger.filter((e) => e.date >= from && e.date <= today)
  const hours = (t: Track) =>
    recent.filter((e) => e.kind === 'focus' && e.track === t).reduce((a, e) => a + (e.amount ?? 0) / 60, 0) +
    recent.filter((e) => e.kind === 'log' && e.track === t).reduce((a, e) => a + (e.amount ?? 0), 0) +
    recent.filter((e) => e.kind === 'contract' && e.track === t).reduce((a, e) => a + (e.amount ?? 30) / 60, 0)
  const span = Math.max(1, Math.min(28, daysBetween(g.firstPlay, today) + 1))
  const weeks = span / 7
  let kept = 0
  let bodyDays = 0
  for (let d = from; d <= today; d = addDays(d, 1)) {
    if (d < g.firstPlay) continue
    if (isKept(g, d)) kept++
    if (g.days[d]?.reps.body) bodyDays++
  }
  const cap = recent.filter((e) => (e.kind === 'contract' && (e.track === 'capital' || e.track === 'paper')) || e.kind === 'trial').length
  const pct = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 100)
  return {
    SIL: pct(hours('silicon') / (g.settings.targets.silicon * weeks)),
    DEU: pct(hours('deutsch') / (g.settings.targets.deutsch * weeks)),
    VIT: pct(bodyDays / (g.settings.targets.workouts * weeks)),
    CAP: pct(cap / (2 * weeks)),
    WIL: pct(kept / span),
  }
}

/* ======================================================================= stats & achievements */
export function computeStats(g: GameData, today: string, xp: number): Stats {
  const L = g.ledger
  const perDay: Record<string, number> = {}
  for (const e of L) if (e.kind === 'contract') perDay[e.date] = (perDay[e.date] ?? 0) + 1
  const focus = L.filter((e) => e.kind === 'focus')
  const germanHours = L.filter((e) => e.track === 'deutsch' && (e.kind === 'log' || e.kind === 'focus' || e.kind === 'contract'))
    .reduce((a, e) => a + (e.kind === 'log' ? e.amount ?? 0 : (e.amount ?? 0) / 60), 0)
    + L.filter((e) => e.kind === 'drill' && e.ref === 'deutsch').reduce((a, e) => a + (e.amount ?? 0) * 0.75 / 60, 0)
  return {
    contracts: L.filter((e) => e.kind === 'contract').length,
    crits: L.filter((e) => e.kind === 'contract' && e.note === 'crit').length,
    maxCombo: Math.max(0, ...Object.values(perDay)),
    bestStreak: Math.max(g.bestStreak, streakInfo(g, today).current),
    germanHours,
    focusMinutes: focus.reduce((a, e) => a + (e.amount ?? 0), 0),
    longestFocus: Math.max(0, ...focus.map((e) => e.amount ?? 0)),
    bosses: Object.values(g.bosses).filter((b) => b.defeatedAt).length,
    ambushes: Object.values(g.bosses).filter((b) => b.ambush).length,
    trialsPassed: Object.values(g.trials).filter((t) => t.stage >= 4).length,
    drillCards: L.filter((e) => e.kind === 'drill').reduce((a, e) => a + (e.amount ?? 0), 0),
    level: levelInfo(xp).level,
    rewardsBought: g.purchases.filter((p) => p.kind === 'reward').length,
    phoenix: g.phoenixEarned,
    earlyFloors: Object.values(g.days).filter((d) => d.securedAt && new Date(d.securedAt).getHours() < 10).length,
    operationsWon: Object.values(g.operations).filter((o) => o.status === 'won').length,
    momentum: momentum(g, today),
  }
}

/* ======================================================================= investment (sunk cost, doc 09 §2.5) */
export function investment(g: GameData) {
  const L = g.ledger
  const focusH = L.filter((e) => e.kind === 'focus').reduce((a, e) => a + (e.amount ?? 0), 0) / 60
  const logH = L.filter((e) => e.kind === 'log' && e.track !== 'body').reduce((a, e) => a + (e.amount ?? 0), 0)
  const contractH = L.filter((e) => e.kind === 'contract').reduce((a, e) => a + (e.amount ?? 0), 0) / 60
  return {
    hours: Math.round((focusH + logH + contractH) * 10) / 10,
    contracts: L.filter((e) => e.kind === 'contract').length,
    days: Object.keys(g.days).filter((d) => isSecured(g, d)).length,
    bosses: Object.values(g.bosses).filter((b) => b.defeatedAt).length,
    cards: L.filter((e) => e.kind === 'drill').reduce((a, e) => a + (e.amount ?? 0), 0),
  }
}

/* ======================================================================= Boot Camp */
export function bootDay(g: GameData, today: string) {
  const n = daysBetween(g.firstPlay, today) + 1
  if (n < 1 || n > BOOT_CAMP.length) return null
  const day = BOOT_CAMP[n - 1]
  const L = g.ledger.filter((e) => e.date === today)
  const auto: Record<string, boolean> = {
    floor: isSecured(g, today),
    focus25: L.some((e) => e.kind === 'focus' && (e.amount ?? 0) >= 25),
    drill20: L.filter((e) => e.kind === 'drill').reduce((a, e) => a + (e.amount ?? 0), 0) >= 20,
    contract: L.some((e) => e.kind === 'contract'),
    shop: g.shopEdited,
    campaign: !!g.flags.campaignSeen,
    brief: L.some((e) => e.kind === 'brief'),
  }
  const done = !!g.ledger.find((e) => e.kind === 'boot' && e.amount === n) || auto[day.auto]
  return { n, day, done, claimed: !!g.ledger.find((e) => e.kind === 'boot' && e.amount === n) }
}

/* ======================================================================= the brief (HQ + JARVIS) */
export function buildBrief(g: GameData, today: string, xp: number, rank: number, contracts: DailyContract[]) {
  const s = streakInfo(g, today)
  const day = g.days[today]
  const mode = modeOn(g, today)
  const rest = isRestDay(g, today)
  const reps = REPS.map((r) => ({ rep: r, done: !!day?.reps[r] }))
  const open = reps.filter((r) => !r.done).map((r) => REP_LABEL[r.rep])
  const boss = currentBoss(g, today)
  const bs = bossState(boss, g, today)
  const lv = levelInfo(xp)
  const todo = contracts.filter((c) => !g.contracts[c.key])
  const week = weekStart(today)
  const op = operationProgress(g, week, today)
  const dayN = daysBetween(g.firstPlay, today) + 1

  const parts: string[] = []
  parts.push(`Day ${dayN}. Streak ${s.current}${g.shields ? `, ${g.shields} shield${g.shields > 1 ? 's' : ''}` : ''}.`)
  if (mode === 'exam') parts.push('Exam mode: the floor is your exam study.')
  if (rest && !s.todaySecured) parts.push('Rest day — the streak is safe.')
  else if (s.todaySecured || isSecured(g, today)) parts.push('Floor secured.')
  else parts.push(`Floor open: ${open.join(', ')}.`)
  if (todo.length) parts.push(todo.map((c) => `${NPCS[c.def.npc].name}: ${c.def.title}`).join('. ') + '.')
  if (bs.status === 'active' || bs.status === 'escaped') {
    parts.push(`${boss.name}: ${bs.hp} of ${bs.hpMax} HP${bs.status === 'escaped' ? ', escaped and still standing' : `, ${bs.daysLeft} day${bs.daysLeft === 1 ? '' : 's'} left`}.`)
  }
  if (op) parts.push(`${op.def.title}: ${op.value} of ${op.n}${op.def.goal ? ` ${op.def.goal.unit}` : ''}${op.st.status === 'won' ? ', won' : ''}.`)
  parts.push(`${g.marks} Marks. Level ${lv.level}.`)

  return {
    text: parts.join(' '),
    data: {
      day: dayN, date: today, streak: s.current, shields: g.shields, secured: isSecured(g, today), rest, mode,
      floor: Object.fromEntries(reps.map((r) => [r.rep, r.done])),
      contracts: contracts.map((c) => ({ key: c.key, title: c.def.title, npc: NPCS[c.def.npc].name, track: c.def.track, minutes: c.def.minutes, done: !!g.contracts[c.key] })),
      boss: { id: boss.id, name: boss.name, hp: bs.hp, hpMax: bs.hpMax, daysLeft: bs.daysLeft, status: bs.status, deliverable: boss.deliverable,
        nextStep: boss.steps.find((_, i) => !g.flags[`step:${boss.id}:${i}`]) ?? null, tracks: boss.tracks },
      operation: op ? { title: op.def.title, value: op.value, n: op.n, done: op.done } : null,
      marks: g.marks, level: lv.level, xp, rank,
      shop: g.shop.filter((i) => i.kind === 'reward').map((i) => ({ id: i.id, label: i.label, cost: i.cost })),
    },
  }
}

/** The cheapest floor rep still open — what a nudge should name. */
export function cheapestOpenRep(g: GameData, today: string): Rep | null {
  const day = g.days[today]
  for (const r of ['deutsch', 'body', 'silicon'] as Rep[]) if (!day?.reps[r]) return r
  return null
}

