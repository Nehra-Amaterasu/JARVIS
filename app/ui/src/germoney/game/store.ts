/**
 * The game store: GameData + every action, persisted to the JARVIS key-value store.
 *
 * Actions are thin: the rules are in engine.ts (pure, tested). This file applies
 * them, writes the ledger, pays rewards through the player store (XP and rank stay
 * where the rest of Mission Germoney reads them), and makes each moment felt
 * (sound, a banner, a burst) — once.
 */
import { useMemo } from 'react'
import { create } from 'zustand'
import { useStore as useApp } from '../../lib/store'
import AsyncStorage from '../platform'
import { usePlayerStore } from '../stores/player-store'
import { useProofStore, type ProofType } from '../stores/proof-store'
import { useFx } from '../ui'
import { ACHIEVEMENTS } from './achievements'
import { NPCS, npcLine, type Track } from './characters'
import { dailyContracts, type ContractDef, type DailyContract } from './contracts'
import { CARDS, DECKS, INTERVALS, NEW_PER_DAY, type Card, type DeckId } from './decks'
import * as E from './engine'
import { useBanners } from './fx'
import { OPERATION_BY_ID, STAKE, weeklyOffers } from './operations'
import { setSound, sfx } from './sfx'
import { TRIALS } from './trials'
import { addDays, dateKey, inRange, weekStart } from './util'

export const GAME_KEY = '@silicon_game_v1'
type NewEvent = Omit<E.LedgerEvent, 't' | 'date'> & { date?: string }

/* ------------------------------------------------------------------ contracts for a day */
function examContract(g: E.GameData, today: string): DailyContract {
  const p = g.modes.exam.find((x) => inRange(today, x.from, x.to))
  const def: ContractDef = {
    id: 'exam', npc: 'jarvis', track: 'academy', title: `Exam block${p?.label ? `: ${p.label}` : ''}`, minutes: 120, xp: 40,
    task: 'Two 50-minute blocks on the exam syllabus, then one past-paper question set under time. Phone in another room.',
    intel: { why: 'German admissions are decided mainly by your grades. This week the exam is the boss.', concept: 'Retrieval practice — testing yourself — beats re-reading; past papers show what the examiner rewards.' },
  }
  return { key: `${today}:exam:exam`, slot: 'silicon', def, crit: false }
}

export function contractsFor(g: E.GameData, today: string, liveRank: number): DailyContract[] {
  // The day keeps the rank it started with: defeating a boss must not reshuffle today's contracts.
  const rank = g.dayRank[today] ?? liveRank
  const mode = E.modeOn(g, today)
  if (mode === 'exam') return [examContract(g, today)]
  const list = dailyContracts({
    date: today, rank, seasonMonth: E.seasonMonth(g, today),
    activeBossIds: E.activeBosses(g, today).map((b) => b.id),
    rerolls: g.rerolls[today], rest: E.isRestDay(g, today),
  })
  return mode === 'recovery' ? list.slice(0, 1) : list
}

const REP_FOR: Partial<Record<Track, E.Rep>> = { silicon: 'silicon', deutsch: 'deutsch', body: 'body', academy: 'silicon' }

/* ------------------------------------------------------------------ persistence */
let saveTimer: number | null = null
function persist(g: E.GameData) {
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    AsyncStorage.setItem(GAME_KEY, JSON.stringify(g)).catch(() => useApp.getState().toast('Could not save Mission progress.', 'fault'))
  }, 250)
}

/* ------------------------------------------------------------------ the store */
export interface CompleteResult { xp: number; marks: number; crit: boolean; nth: number }

interface GameStore {
  g: E.GameData
  today: string
  loaded: boolean
  /** A Crucible requested by voice, waiting for the Crucible page to start it. Not saved. */
  pendingFocus: { minutes: number; track: Track } | null
  requestFocus: (minutes: number, track: Track) => void
  clearFocus: () => void
  hydrate: () => Promise<void>
  tickDay: () => void
  markRep: (rep: E.Rep, source: string, verified: boolean) => void
  unmarkRep: (rep: E.Rep) => void
  declareRest: (date: string) => string | null
  completeContract: (key: string, proof: { type: ProofType; value: string }) => CompleteResult | null
  reroll: (key: string) => boolean
  openChest: () => E.Loot | null
  recordFocus: (minutes: number, track: Track, verified?: boolean) => void
  useBooster: () => boolean
  recordLog: (type: 'commit' | 'stamina' | 'german' | 'workout', amount: number) => void
  reviewCard: (cardId: string, correct: boolean) => void
  chooseOperation: (id: string) => string | null
  submitOperationProof: (value: string) => void
  defeatBoss: (id: string, proof: { type: ProofType; value: string }) => { xp: number; marks: number; ambush: boolean } | null
  setTrialStage: (id: string, stage: number) => void
  setTrialDate: (id: string, date: string) => void
  buy: (itemId: string) => string | null
  saveShop: (items: E.ShopItem[]) => void
  addSavings: (amount: number, note: string) => void
  setCustomCost: (item: { id: string; label: string; inr: number; due: string } | null, removeId?: string) => void
  setSettings: (s: Partial<E.Settings>) => void
  setSeasonStart: (k: string) => void
  addExam: (p: E.Period) => void
  removeExam: (i: number) => void
  startRecovery: () => string | null
  endRecovery: () => void
  flag: (name: string) => void
  toggleFlag: (name: string) => void
  claimBoot: () => boolean
  logBrief: () => void
  markNudged: () => void
}

export const useGame = create<GameStore>((set, get) => {
  const toast = (t: string, tone: 'live' | 'sim' | 'fault' | 'info' = 'info') => useApp.getState().toast(t, tone)
  const banner = useBanners.getState().show

  /** Apply a change + ledger events, save, then run the follow-up checks. */
  const commit = (fn: (g: E.GameData) => E.GameData, events: NewEvent[] = []) => {
    const today = get().today
    let next = fn(get().g)
    if (events.length) next = { ...next, ledger: [...next.ledger, ...events.map((e) => ({ t: Date.now(), ...e, date: e.date ?? today }))] }
    set({ g: next })
    persist(next)
  }

  const awardXp = (xp: number) => {
    if (xp) usePlayerStore.getState().updateXP(xp)
  }

  /** Level-ups (paid once, ever), achievements, and a weekly operation that just completed. */
  const followUps = () => {
    const today = get().today
    const xp = usePlayerStore.getState().player.xp
    // Levels
    const lv = E.levelInfo(xp).level
    const g0 = get().g
    if (lv > g0.levelSeen) {
      const r = E.levelRewards(g0.levelSeen, lv)
      commit((g) => ({ ...g, levelSeen: lv, marks: g.marks + r.marks, shields: Math.min(E.MAX_SHIELDS, g.shields + r.shields) }),
        [{ kind: 'level', amount: lv, marks: r.marks }])
      banner({ kicker: 'LEVEL UP', title: `Level ${lv}`, sub: `+${r.marks} DM${r.shields ? ' · +1 shield' : ''}`, tone: 'chrome' })
      sfx.level()
    }
    // Operation auto-win
    const week = weekStart(today)
    const op = E.operationProgress(get().g, week, today)
    if (op && op.st.status === 'active' && op.done) {
      const stake = op.st.stake ?? 0
      commit((g) => ({ ...g, marks: g.marks + stake + op.def.reward.marks, operations: { ...g.operations, [week]: { ...op.st, status: 'won' } } }),
        [{ kind: 'operation', ref: op.def.id, note: 'won', track: op.def.track, xp: op.def.reward.xp, marks: op.def.reward.marks + stake }])
      awardXp(op.def.reward.xp)
      banner({ kicker: 'OPERATION COMPLETE', title: op.def.title, sub: `+${op.def.reward.xp} XP · +${op.def.reward.marks} DM · stake returned`, tone: 'live' })
      sfx.secure()
    }
    // Achievements
    const stats = E.computeStats(get().g, today, usePlayerStore.getState().player.xp)
    const fresh = ACHIEVEMENTS.filter((a) => !get().g.achievements[a.id] && a.test(stats))
    if (fresh.length) {
      commit((g) => ({ ...g, marks: g.marks + fresh.reduce((a, x) => a + x.marks, 0), achievements: { ...g.achievements, ...Object.fromEntries(fresh.map((a) => [a.id, today])) } }),
        fresh.map((a) => ({ kind: 'achievement' as const, ref: a.id, marks: a.marks })))
      fresh.forEach((a) => banner({ kicker: 'ACHIEVEMENT', title: a.name, sub: `${a.desc} · +${a.marks} DM`, tone: 'gold' }))
    }
    // XP may have moved again (operation reward) → check levels once more.
    if (E.levelInfo(usePlayerStore.getState().player.xp).level > get().g.levelSeen) followUps()
  }

  const settle = () => {
    const today = get().today
    let g = get().g
    const all: E.LedgerEvent[] = []
    const d = E.settleDays(g, today)
    g = d.g
    all.push(...d.events)
    const b = E.settleBosses(g, today)
    g = b.g
    all.push(...b.events)
    // Operations of finished weeks
    const thisWeek = weekStart(today)
    const ops = { ...g.operations }
    for (const [week, st] of Object.entries(ops)) {
      if (week >= thisWeek || st.status !== 'active') continue
      const p = E.operationProgress(g, week, today)
      const won = !!p?.done
      ops[week] = { ...st, status: won ? 'won' : 'lost' }
      if (won && p) {
        g = { ...g, marks: g.marks + (st.stake ?? 0) + p.def.reward.marks }
        usePlayerStore.getState().updateXP(p.def.reward.xp)
      }
      all.push({ t: Date.now(), date: addDays(week, 6), kind: 'operation', ref: st.chosen, note: won ? 'won' : 'lost', track: p?.def.track })
    }
    g = { ...g, operations: ops }
    if (g.dayRank[today] === undefined) g = { ...g, dayRank: { ...g.dayRank, [today]: usePlayerStore.getState().player.level } }
    if (all.length || g !== get().g) {
      set({ g: { ...g, ledger: [...g.ledger, ...all] } })
      persist(get().g)
    }
    for (const e of all) {
      if (e.kind === 'shield') toast(`Shield burned: ${e.note}.`, 'sim')
      if (e.kind === 'break') {
        toast(`Streak broken (${e.amount} days). Phoenix armed: the next three secured days pay double.`, 'fault')
        banner({ kicker: 'STREAK LOST', title: 'Phoenix armed', sub: 'Secure three days in a row — double Marks each.', tone: 'fault' })
      }
      if (e.kind === 'escape') {
        toast(`${e.note}. XP −10% for 7 days; it returns stronger.`, 'fault')
        sfx.warn()
      }
      if (e.kind === 'operation' && e.note === 'lost') toast('Last week\'s operation failed. The stake is gone.', 'fault')
    }
  }

  return {
    g: E.defaultGame(),
    today: dateKey(),
    loaded: false,
    pendingFocus: null,
    requestFocus: (minutes, track) => set({ pendingFocus: { minutes, track } }),
    clearFocus: () => set({ pendingFocus: null }),

    hydrate: async () => {
      if (get().loaded) return
      await usePlayerStore.getState().hydrate()
      await useProofStore.getState().hydrate()
      try {
        const raw = await AsyncStorage.getItem(GAME_KEY)
        const g = E.mergeGame(raw ? JSON.parse(raw) : null, dateKey())
        if (!raw) g.levelSeen = E.levelInfo(usePlayerStore.getState().player.xp).level
        set({ g, today: dateKey(), loaded: true })
        if (!raw) persist(g)
      } catch {
        set({ loaded: true })
      }
      setSound(get().g.settings.sound)
      settle()
      // Level-ups can come from anywhere that pays XP (Crucible, Forge, Terminal…).
      usePlayerStore.subscribe((s, prev) => {
        if (s.player.xp > prev.player.xp && E.levelInfo(s.player.xp).level > get().g.levelSeen) followUps()
      })
      followUps()
    },

    tickDay: () => {
      const now = dateKey()
      if (now !== get().today) {
        set({ today: now })
        settle()
      }
    },

    markRep: (rep, source, verified) => {
      const today = get().today
      const g = get().g
      const day = g.days[today] ?? { reps: {} }
      if (day.reps[rep]) {
        // A claim can be upgraded to verified evidence, never the other way.
        if (verified && !day.reps[rep]!.verified) commit((x) => ({ ...x, days: { ...x.days, [today]: { ...day, reps: { ...day.reps, [rep]: { ...day.reps[rep]!, verified: true, source } } } } }))
        return
      }
      const wasSecured = E.isSecured(g, today)
      const nextDay: E.DayRecord = { ...day, reps: { ...day.reps, [rep]: { at: Date.now(), source, verified } } }
      commit((x) => ({ ...x, days: { ...x.days, [today]: nextDay } }), [{ kind: 'rep', ref: rep, note: source, verified }])
      const after = get().g
      if (!wasSecured && E.isSecured(after, today)) {
        const streak = E.streakInfo(after, today).current
        const phoenix = after.phoenixLeft > 0
        const r = E.floorReward(streak, phoenix)
        const earned = E.shieldEarned(streak) && after.shields < E.MAX_SHIELDS
        commit((x) => ({
          ...x,
          marks: x.marks + r.marks,
          shields: earned ? x.shields + 1 : x.shields,
          bestStreak: Math.max(x.bestStreak, streak),
          phoenixLeft: phoenix ? x.phoenixLeft - 1 : x.phoenixLeft,
          phoenixEarned: x.phoenixEarned || (phoenix && x.phoenixLeft === 1),
          days: { ...x.days, [today]: { ...x.days[today], securedAt: Date.now() } },
        }), [{ kind: 'floor', amount: streak, xp: r.xp, marks: r.marks }])
        awardXp(r.xp)
        banner({ kicker: 'FLOOR SECURED', title: `Streak ${streak}`, sub: `+${r.marks} DM${phoenix ? ' (Phoenix ×2)' : ''}${earned ? ' · +1 shield' : ''} · supply drop ready`, tone: 'live' })
        sfx.secure()
        followUps()
      } else {
        sfx.rep()
      }
    },

    unmarkRep: (rep) => {
      const today = get().today
      const g = get().g
      const day = g.days[today]
      if (!day?.reps[rep] || day.reps[rep]!.verified || E.isSecured(g, today)) return
      const reps = { ...day.reps }
      delete reps[rep]
      commit((x) => ({ ...x, days: { ...x.days, [today]: { ...day, reps } } }))
    },

    declareRest: (date) => {
      const today = get().today
      const g = get().g
      if (date < today) return 'You can only move the rest day to today or later.'
      if (E.isRestDay(g, date)) return null
      const ws = weekStart(date)
      const week = Array.from({ length: 7 }, (_, i) => addDays(ws, i))
      const current = week.find((d) => E.isRestDay(g, d))
      if (current && current < today) return 'This week’s rest day has already passed.'
      commit((x) => {
        const days = { ...x.days, [date]: { ...(x.days[date] ?? { reps: {} }), rest: true, noRest: false } }
        if (current) days[current] = { ...(days[current] ?? { reps: {} }), rest: false, noRest: true }
        return { ...x, days }
      })
      return null
    },

    completeContract: (key, proof) => {
      const today = get().today
      const g = get().g
      const rank = usePlayerStore.getState().player.level
      const dc = contractsFor(g, today, rank).find((c) => c.key === key)
      if (!dc || g.contracts[key]) return null
      const nth = E.contractsDoneOn(g, today) + 1
      const { xp, marks } = E.contractReward(dc.def.xp, { crit: dc.crit, nth, mult: E.xpMultiplier(g, today) })
      const verified = proof.type === 'photo' || /^https?:\/\//i.test(proof.value.trim())
      useProofStore.getState().addProof({ questId: key, type: proof.type, value: proof.value })
      commit((x) => ({ ...x, marks: x.marks + marks, contracts: { ...x.contracts, [key]: { at: Date.now(), xp, marks, crit: dc.crit, track: dc.def.track, verified } } }),
        [{ kind: 'contract', track: dc.def.track, amount: dc.def.minutes, ref: dc.def.id, xp, marks, note: dc.crit ? 'crit' : undefined, verified }])
      awardXp(xp)
      useFx.getState().burst(`+${xp} XP${dc.crit ? ' · CRIT' : ''}`, dc.crit ? 'sim' : 'live')
      if (dc.crit) {
        banner({ kicker: 'CRITICAL', title: '×2', sub: `${NPCS[dc.def.npc].name}: "${npcLine(dc.def.npc, 'praise', nth)}"`, tone: 'sim' })
        sfx.crit()
      } else sfx.contract()
      const rep = REP_FOR[dc.def.track]
      if (rep && (dc.def.track !== 'academy' || E.modeOn(get().g, today) === 'exam')) get().markRep(rep, `contract:${dc.def.id}`, verified)
      followUps()
      return { xp, marks, crit: dc.crit, nth }
    },

    reroll: (key) => {
      const today = get().today
      const g = get().g
      const slot = key.split(':')[1]
      if (g.marks < E.REROLL_COST || g.contracts[key] || slot === 'exam') return false
      commit((x) => ({ ...x, marks: x.marks - E.REROLL_COST, rerolls: { ...x.rerolls, [today]: { ...(x.rerolls[today] ?? {}), [slot]: ((x.rerolls[today] ?? {})[slot] ?? 0) + 1 } } }),
        [{ kind: 'buy', ref: 'reroll', marks: -E.REROLL_COST, note: slot }])
      sfx.buy()
      return true
    },

    openChest: () => {
      const today = get().today
      const g = get().g
      if (!E.isSecured(g, today) || g.chests[today]) return null
      const loot = E.rollChest(today, E.streakInfo(g, today).current)
      commit((x) => ({
        ...x,
        marks: x.marks + loot.marks,
        shields: loot.shield ? Math.min(E.MAX_SHIELDS, x.shields + 1) : x.shields,
        boosters: x.boosters + (loot.booster ? 1 : 0),
        chests: { ...x.chests, [today]: loot },
      }), [{ kind: 'chest', marks: loot.marks, note: loot.legendary ? 'legendary' : undefined }])
      sfx.chest()
      return loot
    },

    recordFocus: (minutes, track, verified = true) => {
      if (minutes <= 0) return
      commit((x) => x, [{ kind: 'focus', track, amount: Math.round(minutes), verified }])
      if ((track === 'silicon' || track === 'academy') && minutes >= 25) get().markRep('silicon', 'crucible', verified)
      else if (track === 'deutsch' && minutes >= 15) get().markRep('deutsch', 'crucible', verified)
      followUps()
    },

    useBooster: () => {
      if (get().g.boosters <= 0) return false
      commit((x) => ({ ...x, boosters: x.boosters - 1 }))
      return true
    },

    recordLog: (type, amount) => {
      if (type === 'german') {
        commit((x) => x, [{ kind: 'log', track: 'deutsch', amount }])
        if (amount >= 0.25) get().markRep('deutsch', 'log', false)
      } else if (type === 'stamina') {
        commit((x) => x, [{ kind: 'log', track: 'silicon', amount }])
        if (amount >= 0.4) get().markRep('silicon', 'log', false)
      } else if (type === 'commit') {
        commit((x) => x, [{ kind: 'log', track: 'silicon', amount: 0, note: 'commit' }])
        get().markRep('silicon', 'commit', false)
      } else {
        commit((x) => x, [{ kind: 'log', track: 'body', amount: 1 }])
        get().markRep('body', 'workout', false)
      }
      followUps()
    },

    reviewCard: (cardId, correct) => {
      const today = get().today
      const card = CARDS.find((c) => c.id === cardId)
      if (!card) return
      const prev = get().g.drill[cardId] ?? { box: 0, due: today, seen: 0, lapses: 0, first: today }
      const box = correct ? Math.min(INTERVALS.length - 1, prev.box + 1) : 1
      const state: E.CardState = { box, due: addDays(today, INTERVALS[box]), seen: prev.seen + 1, lapses: prev.lapses + (correct ? 0 : 1), first: prev.first ?? today }
      const counts = { ...(get().g.drillDay[today] ?? {}) }
      counts[card.deck] = (counts[card.deck] ?? 0) + 1
      const n = counts[card.deck]
      const events: NewEvent[] = n % 10 === 0 ? [{ kind: 'drill', ref: card.deck, amount: 10, track: DECKS[card.deck].track, xp: 10 }] : []
      commit((x) => ({ ...x, drill: { ...x.drill, [cardId]: state }, drillDay: { ...x.drillDay, [today]: counts } }), events)
      if (events.length) awardXp(10)
      if (n === 20) {
        if (card.deck === 'deutsch') get().markRep('deutsch', 'drill', true)
        if (card.deck === 'vlsi') get().markRep('silicon', 'drill', true)
      }
      if (events.length) followUps()
    },

    chooseOperation: (id) => {
      const today = get().today
      const week = weekStart(today)
      const g = get().g
      if (g.operations[week]?.chosen) return 'You already committed this week.'
      if (!weeklyOffers(week).some((o) => o.id === id)) return 'That operation is not on offer this week.'
      const stake = Math.min(STAKE, g.marks)
      commit((x) => ({ ...x, marks: x.marks - stake, operations: { ...x.operations, [week]: { chosen: id, stake, status: 'active' } } }),
        [{ kind: 'operation', ref: id, note: 'committed', marks: -stake, track: OPERATION_BY_ID[id].track }])
      sfx.buy()
      followUps()
      return null
    },

    submitOperationProof: (value) => {
      const week = weekStart(get().today)
      const st = get().g.operations[week]
      if (!st?.chosen || st.status !== 'active') return
      commit((x) => ({ ...x, operations: { ...x.operations, [week]: { ...st, proof: value } } }))
      followUps()
    },

    defeatBoss: (id, proof) => {
      const today = get().today
      const g = get().g
      const b = E.datedBosses(g).find((x) => x.id === id)
      if (!b) return null
      const st = E.bossState(b, g, today)
      if (st.status === 'defeated' || st.status === 'upcoming') return null
      const r = E.defeatReward(b, st.hp, st.hpMax)
      useProofStore.getState().addProof({ questId: `boss:${id}`, type: proof.type, value: proof.value })
      commit((x) => ({ ...x, marks: x.marks + r.marks, bosses: { ...x.bosses, [id]: { ...x.bosses[id], defeatedAt: today, ambush: r.ambush } } }),
        [{ kind: 'boss', ref: id, xp: r.xp, marks: r.marks, note: r.ambush ? 'ambush' : undefined, track: b.tracks[0] }])
      awardXp(r.xp)
      if (b.reward.rank) usePlayerStore.getState().promote(b.reward.rank)
      useFx.getState().boss()
      sfx.boss()
      banner({ kicker: r.ambush ? 'AMBUSH — BOSS DEFEATED' : 'BOSS DEFEATED', title: b.name, sub: `"${b.taunts.defeated}" · +${r.xp} XP · +${r.marks} DM · ${b.reward.title}`, tone: 'fault' })
      followUps()
      return r
    },

    setTrialStage: (id, stage) => {
      const t = TRIALS.find((x) => x.id === id)
      if (!t) return
      const cur = get().g.trials[id]
      // Pay only beyond the best stage ever reached: stepping back and forward again is free of charge — and of reward.
      const best = Math.max(cur?.stage ?? -1, cur?.best ?? -1)
      const s = Math.max(-1, Math.min(t.stages.length - 1, stage))
      const events: NewEvent[] = []
      let xp = 0
      let marks = 0
      for (let k = best + 1; k <= s; k++) {
        const last = k === t.stages.length - 1
        const kx = last ? t.reward.xp : 20
        const km = last ? t.reward.marks : 15
        xp += kx
        marks += km
        events.push({ kind: 'trial', ref: id, amount: k, xp: kx, marks: km, track: t.track, note: t.stages[k] })
      }
      commit((x) => ({ ...x, marks: x.marks + marks, trials: { ...x.trials, [id]: { ...(x.trials[id] ?? {}), stage: s, best: Math.max(best, s), updated: get().today } } }), events)
      awardXp(xp)
      if (s === t.stages.length - 1 && best < s) {
        banner({ kicker: 'TRIAL PASSED', title: t.name, sub: `+${t.reward.xp} XP · +${t.reward.marks} DM`, tone: 'live' })
        sfx.secure()
      } else if (events.length) sfx.rep()
      followUps()
    },

    setTrialDate: (id, date) => commit((x) => ({ ...x, trials: { ...x.trials, [id]: { ...(x.trials[id] ?? { stage: -1, updated: get().today }), examDate: date } } })),

    buy: (itemId) => {
      const g = get().g
      const item = g.shop.find((s) => s.id === itemId)
      if (!item) return 'Unknown item.'
      if (g.marks < item.cost) return `You need ${item.cost - g.marks} more Marks.`
      if (item.kind === 'shield' && g.shields >= E.MAX_SHIELDS) return `You already hold ${E.MAX_SHIELDS} shields.`
      commit((x) => ({
        ...x,
        marks: x.marks - item.cost,
        shields: item.kind === 'shield' ? x.shields + 1 : x.shields,
        boosters: item.kind === 'booster' ? x.boosters + 1 : x.boosters,
        purchases: [...x.purchases, { t: Date.now(), item: item.id, label: item.label, cost: item.cost, kind: item.kind }],
      }), [{ kind: 'buy', ref: item.id, marks: -item.cost, note: item.label }])
      sfx.buy()
      if (item.kind === 'reward') banner({ kicker: 'EARNED', title: item.label, sub: 'Paid for with work. Enjoy it without guilt.', tone: 'gold' })
      followUps()
      return null
    },

    saveShop: (items) => {
      const clean = items
        .filter((i) => i.label.trim() && Number.isFinite(i.cost) && i.cost > 0)
        .map((i) => ({ ...i, label: i.label.trim().slice(0, 60), cost: Math.min(100000, Math.round(i.cost)) }))
      commit((x) => ({ ...x, shop: clean, shopEdited: true }))
    },

    addSavings: (amount, note) => {
      if (!Number.isFinite(amount) || amount === 0) return
      commit((x) => ({ ...x, warChest: { ...x.warChest, saved: Math.max(0, x.warChest.saved + amount), log: [...x.warChest.log, { t: Date.now(), amount, note: note.slice(0, 80) }] } }))
    },

    setCustomCost: (item, removeId) => commit((x) => {
      let custom = x.warChest.custom.filter((c) => c.id !== removeId && c.id !== item?.id)
      if (item) custom = [...custom, item]
      return { ...x, warChest: { ...x.warChest, custom } }
    }),

    setSettings: (s) => {
      commit((x) => ({ ...x, settings: { ...x.settings, ...s, targets: { ...x.settings.targets, ...(s.targets ?? {}) } } }))
      if (s.sound !== undefined) setSound(s.sound)
    },

    setSeasonStart: (k) => commit((x) => ({ ...x, seasonStart: `${k.slice(0, 7)}-01` })),

    addExam: (p) => {
      if (!p.from || !p.to || p.to < p.from) return
      commit((x) => ({ ...x, modes: { ...x.modes, exam: [...x.modes.exam, p] } }))
    },

    removeExam: (i) => commit((x) => ({ ...x, modes: { ...x.modes, exam: x.modes.exam.filter((_, k) => k !== i) } })),

    startRecovery: () => {
      const today = get().today
      const g = get().g
      if (E.modeOn(g, today) === 'recovery') return 'Recovery is already on.'
      const thisSeason = g.modes.recovery.filter((p) => p.from >= g.seasonStart)
      if (thisSeason.length >= 2) return 'Recovery Mode is limited to twice a season.'
      commit((x) => ({ ...x, modes: { ...x.modes, recovery: [...x.modes.recovery, { from: today, to: addDays(today, 13), label: 'Recovery' }] } }))
      return null
    },

    endRecovery: () => {
      const today = get().today
      commit((x) => ({ ...x, modes: { ...x.modes, recovery: x.modes.recovery.map((p) => (inRange(today, p.from, p.to) ? { ...p, to: today } : p)) } }))
    },

    flag: (name) => {
      if (!get().g.flags[name]) commit((x) => ({ ...x, flags: { ...x.flags, [name]: true } }))
    },

    toggleFlag: (name) => commit((x) => ({ ...x, flags: { ...x.flags, [name]: !x.flags[name] } })),

    claimBoot: () => {
      const today = get().today
      const b = E.bootDay(get().g, today)
      if (!b || b.claimed || !b.done) return false
      commit((x) => ({ ...x, marks: x.marks + 30 }), [{ kind: 'boot', amount: b.n, xp: 40, marks: 30 }])
      awardXp(40)
      banner({ kicker: `BOOT CAMP · DAY ${b.n}`, title: b.day.title, sub: '+40 XP · +30 DM', tone: 'chrome' })
      sfx.contract()
      followUps()
      return true
    },

    logBrief: () => {
      const today = get().today
      if (!get().g.ledger.some((e) => e.kind === 'brief' && e.date === today)) commit((x) => x, [{ kind: 'brief' }])
    },

    markNudged: () => {
      const today = get().today
      commit((x) => ({ ...x, nudged: { ...x.nudged, [today]: true } }))
    },
  }
})

/* ------------------------------------------------------------------ hooks */
export function useTodayContracts(): DailyContract[] {
  const g = useGame((s) => s.g)
  const today = useGame((s) => s.today)
  const rank = usePlayerStore((s) => s.player.level)
  return useMemo(() => contractsFor(g, today, rank), [g, today, rank])
}

/** Cards due today in a deck: due reviews first, then up to NEW_PER_DAY new cards. */
export function dueCards(g: E.GameData, deck: DeckId, today: string): Card[] {
  const inDeck = CARDS.filter((c) => c.deck === deck)
  const due = inDeck.filter((c) => g.drill[c.id] && g.drill[c.id].due <= today)
    .sort((a, b) => g.drill[a.id].due.localeCompare(g.drill[b.id].due))
  const newToday = inDeck.filter((c) => g.drill[c.id]?.first === today).length
  const fresh = inDeck.filter((c) => !g.drill[c.id]).slice(0, Math.max(0, NEW_PER_DAY - newToday))
  return [...due, ...fresh]
}

export function gameBrief(): ReturnType<typeof E.buildBrief> {
  const { g, today } = useGame.getState()
  const p = usePlayerStore.getState().player
  return E.buildBrief(g, today, p.xp, p.level, contractsFor(g, today, p.level))
}
