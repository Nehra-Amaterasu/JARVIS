/**
 * The game store: GameData + every action, persisted to the JARVIS key-value store.
 *
 * Mission v2 split the game in two:
 *   - the PLAN (skill tree, contracts, exam mode, campaigns, XP) runs in the server
 *     (game/plan.ts is its client), so the voice works with the window closed;
 *   - the GAME here keeps the habit layer: the Floor and the streak, Marks and the
 *     Armory, the supply drop, Drill, Trials, the War Chest and the settings.
 * Plan events (a contract done, time logged) are applied here once each by
 * syncPlan: they tick the Floor, pay Marks and enter the ledger. XP is never
 * paid twice: the server already counted it.
 */
import { create } from 'zustand'
import { useStore as useApp } from '../../lib/store'
import AsyncStorage from '../platform'
import { usePlayerStore } from '../stores/player-store'
import { useProofStore } from '../stores/proof-store'
import { ACHIEVEMENTS } from './achievements'
import type { Track } from './characters'
import { CARDS, DECKS, INTERVALS, NEW_PER_DAY, type Card, type DeckId } from './decks'
import * as E from './engine'
import { useBanners } from './fx'
import { onPlanEvents, usePlan, type PlanEvent } from './plan'
import { setSound, sfx } from './sfx'
import { TRIALS } from './trials'
import { addDays, dateKey, inRange, weekStart } from './util'

export const GAME_KEY = '@silicon_game_v1'
type NewEvent = Omit<E.LedgerEvent, 't' | 'date'> & { date?: string }

/* ------------------------------------------------------------------ persistence */
let saveTimer: number | null = null
function persist(g: E.GameData) {
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    AsyncStorage.setItem(GAME_KEY, JSON.stringify(g)).catch(() => useApp.getState().toast('Could not save Mission progress.', 'fault'))
  }, 250)
}

/** A plan event's floor rep, and whether it was enough to count. */
function repFor(e: PlanEvent): E.Rep | null {
  const rep = e.rep ?? null
  if (!rep) return null
  if (e.kind === 'contract') return rep
  const m = e.minutes ?? 0
  if (rep === 'silicon') return m >= 25 ? rep : null
  if (rep === 'deutsch') return m >= 15 ? rep : null
  return rep
}

const TRACK_OF: Record<string, Track> = { silicon: 'silicon', deutsch: 'deutsch', body: 'body' }

/* ------------------------------------------------------------------ the store */
interface GameStore {
  g: E.GameData
  today: string
  loaded: boolean
  /** A Crucible requested by voice, waiting for the Focus page to start it. Not saved. */
  pendingFocus: { minutes: number; track: Track } | null
  requestFocus: (minutes: number, track: Track) => void
  clearFocus: () => void
  hydrate: () => Promise<void>
  tickDay: () => void
  syncPlan: (events: PlanEvent[], examToday: boolean) => void
  markRep: (rep: E.Rep, source: string, verified: boolean) => void
  unmarkRep: (rep: E.Rep) => void
  declareRest: (date: string) => string | null
  openChest: () => E.Loot | null
  recordFocus: (minutes: number, track: Track, verified?: boolean) => void
  useBooster: () => boolean
  reviewCard: (cardId: string, correct: boolean) => void
  setTrialStage: (id: string, stage: number) => void
  setTrialDate: (id: string, date: string) => void
  buy: (itemId: string) => string | null
  saveShop: (items: E.ShopItem[]) => void
  addSavings: (amount: number, note: string) => void
  setCustomCost: (item: { id: string; label: string; inr: number; due: string } | null, removeId?: string) => void
  setSettings: (s: Partial<E.Settings>) => void
  setSeasonStart: (k: string) => void
  startRecovery: () => string | null
  endRecovery: () => void
  flag: (name: string) => void
  toggleFlag: (name: string) => void
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

  /** Level-ups (paid once, ever) and achievements. */
  const followUps = () => {
    const today = get().today
    const xp = usePlayerStore.getState().player.xp
    const lv = E.levelInfo(xp).level
    const g0 = get().g
    if (lv > g0.levelSeen) {
      const r = E.levelRewards(g0.levelSeen, lv)
      commit((g) => ({ ...g, levelSeen: lv, marks: g.marks + r.marks, shields: Math.min(E.MAX_SHIELDS, g.shields + r.shields) }),
        [{ kind: 'level', amount: lv, marks: r.marks }])
      banner({ kicker: 'LEVEL UP', title: `Level ${lv}`, sub: `+${r.marks} DM${r.shields ? ' · +1 shield' : ''}`, tone: 'chrome' })
      sfx.level()
    }
    const stats = E.computeStats(get().g, today, usePlayerStore.getState().player.xp)
    const fresh = ACHIEVEMENTS.filter((a) => !get().g.achievements[a.id] && a.test(stats))
    if (fresh.length) {
      commit((g) => ({ ...g, marks: g.marks + fresh.reduce((a, x) => a + x.marks, 0), achievements: { ...g.achievements, ...Object.fromEntries(fresh.map((a) => [a.id, today])) } }),
        fresh.map((a) => ({ kind: 'achievement' as const, ref: a.id, marks: a.marks })))
      fresh.forEach((a) => banner({ kicker: 'ACHIEVEMENT', title: a.name, sub: `${a.desc} · +${a.marks} DM`, tone: 'gold' }))
    }
  }

  const settle = () => {
    const today = get().today
    const d = E.settleDays(get().g, today)
    if (d.events.length || d.g !== get().g) {
      set({ g: { ...d.g, ledger: [...d.g.ledger, ...d.events] } })
      persist(get().g)
    }
    for (const e of d.events) {
      if (e.kind === 'shield') toast(`Shield used: ${e.note}.`, 'sim')
      if (e.kind === 'break') {
        toast(`New streak starts today. Phoenix is on: the next three secured days pay double.`, 'info')
        banner({ kicker: 'FRESH START', title: 'Phoenix armed', sub: 'Secure three days in a row: double Marks each.', tone: 'chrome' })
      }
    }
  }

  /**
   * Mission v2, once: weekly operations are gone (contracts come from the tree),
   * so every stake still riding on one is paid back. Nothing else in the save
   * changes; the old ledger, bosses and contracts stay as the record.
   */
  const migrateV2 = () => {
    const g = get().g
    if (g.flags.v2) return
    let refund = 0
    const ops = { ...g.operations }
    for (const [week, st] of Object.entries(ops)) {
      if (st.status === 'active') {
        refund += st.stake ?? 0
        ops[week] = { ...st, status: 'lost', proof: st.proof ?? 'refunded: Mission v2 retired weekly operations' }
      }
    }
    commit((x) => ({ ...x, operations: ops, marks: x.marks + refund, flags: { ...x.flags, v2: true } }),
      refund ? [{ kind: 'buy', ref: 'refund', marks: refund, note: 'Operation stake returned (Mission v2)' }] : [])
    if (refund) toast(`Mission v2: weekly operations are gone, so your ${refund} DM stake is back.`, 'live')
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
      migrateV2()
      settle()
      // Level-ups can come from anywhere that pays XP (the plan, the Crucible, Drill...).
      usePlayerStore.subscribe((s, prev) => {
        if (s.player.xp > prev.player.xp && E.levelInfo(s.player.xp).level > get().g.levelSeen) followUps()
      })
      onPlanEvents((events, exam) => get().syncPlan(events, exam))
      followUps()
    },

    tickDay: () => {
      const now = dateKey()
      if (now !== get().today) {
        set({ today: now })
        settle()
      }
    },

    syncPlan: (events, examToday) => {
      const today = get().today
      const g = get().g
      const fresh = events.filter((e) => (e.kind === 'contract' || e.kind === 'log' || e.kind === 'learning') && !g.synced[e.id] && e.date >= addDays(today, -30))
      const examFlag = `examday:${today}`
      if (!fresh.length) {
        if (!!g.flags[examFlag] !== examToday) commit((x) => ({ ...x, flags: { ...x.flags, [examFlag]: examToday } }))
        return
      }
      const marks = fresh.reduce((a, e) => a + (e.kind === 'contract' ? Math.round((e.xp ?? 0) / 2) : 0), 0)
      const cutoff = addDays(today, -45)
      commit((x) => ({
        ...x,
        marks: x.marks + marks,
        flags: { ...x.flags, [examFlag]: examToday },
        synced: { ...Object.fromEntries(Object.entries(x.synced).filter(([, d]) => d >= cutoff)), ...Object.fromEntries(fresh.map((e) => [e.id, e.date])) },
      }), fresh.map((e) => ({
        date: e.date,
        kind: e.kind === 'contract' ? 'contract' as const : 'log' as const,
        track: TRACK_OF[e.rep ?? ''] ?? (e.rep ? 'silicon' : undefined),
        // contracts keep minutes (as before); logs keep hours (as the Terminal did)
        amount: e.kind === 'contract' ? e.minutes ?? 0 : (e.minutes ?? 0) / 60,
        ref: e.key ?? e.node ?? undefined,
        marks: e.kind === 'contract' ? Math.round((e.xp ?? 0) / 2) : undefined,
        note: e.title ?? e.note,
        verified: !!e.verified,
      })))
      for (const e of fresh) {
        const rep = e.date === today ? repFor(e) : null
        if (rep) get().markRep(rep, e.kind === 'contract' ? `contract:${e.key ?? ''}` : 'log', !!e.verified)
        if (e.kind === 'contract' && e.date === today) {
          useProofStore.getState().addProof({ questId: e.key ?? e.id, type: 'text', value: e.verified ? 'link on the server' : 'claimed' })
        }
      }
      followUps()
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

    setTrialStage: (id, stage) => {
      const t = TRIALS.find((x) => x.id === id)
      if (!t) return
      const cur = get().g.trials[id]
      // Pay only beyond the best stage ever reached: stepping back and forward again is free of charge, and of reward.
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

/* ------------------------------------------------------------------ helpers */
/** Cards due today in a deck: due reviews first, then up to NEW_PER_DAY new cards. */
export function dueCards(g: E.GameData, deck: DeckId, today: string): Card[] {
  const inDeck = CARDS.filter((c) => c.deck === deck)
  const due = inDeck.filter((c) => g.drill[c.id] && g.drill[c.id].due <= today)
    .sort((a, b) => g.drill[a.id].due.localeCompare(g.drill[b.id].due))
  const newToday = inDeck.filter((c) => g.drill[c.id]?.first === today).length
  const fresh = inDeck.filter((c) => !g.drill[c.id]).slice(0, Math.max(0, NEW_PER_DAY - newToday))
  return [...due, ...fresh]
}

/** The brief: the Floor from the game, today's contracts from the plan. */
export function gameBrief(): ReturnType<typeof E.buildBrief> {
  const { g, today } = useGame.getState()
  const p = usePlayerStore.getState().player
  return E.buildBrief(g, today, p.xp, usePlan.getState().today?.contracts ?? [])
}
