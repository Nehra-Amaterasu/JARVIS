/**
 * The bridge between the game and JARVIS. Started once at idle by App, so it works
 * whatever tab is open:
 *
 *   JARVIS (voice) ──POST /api/game/action──▶ server ──bus "game/action"──▶ here
 *        ▲                                                                   │ runs it
 *        └───────── one spoken line ◀── POST /api/game/result ◀──────────────┘
 *
 * Since Mission v2 only the window-side game goes this way (the Floor, Marks, the
 * Armory, the Crucible). The plan (contracts, the tree, exam mode, logging) is
 * answered by the server itself (/api/mission/voice), window or no window; this
 * bridge pulls the plan's events in so the Floor ticks for work done by voice.
 *
 * It also keeps the brief where JARVIS reads it, nudges at the configured hour
 * when the floor is still open, and rolls the day over at midnight.
 */
import { post } from '../../lib/api'
import { useStore } from '../../lib/store'
import AsyncStorage from '../platform'
import { usePlayerStore } from '../stores/player-store'
import { TRACKS, type Track } from './characters'
import * as E from './engine'
import { useBanners } from './fx'
import { usePlan } from './plan'
import { sfx } from './sfx'
import { gameBrief, useGame } from './store'
import { wordScore } from './util'

export const BRIEF_KEY = '@silicon_game_brief'

export interface ActionResult { ok: boolean; say: string; data?: unknown }
type Args = Record<string, unknown>

const hm = (min: number) => (min >= 60 ? `${+(min / 60).toFixed(min % 60 ? 1 : 0)} hour${min === 60 ? '' : 's'}` : `${Math.round(min)} minutes`)

function floorLine(): string {
  const { g, today } = useGame.getState()
  const day = g.days[today]
  const open = E.REPS.filter((r) => !day?.reps[r]).map((r) => E.REP_LABEL[r])
  if (E.isSecured(g, today)) return `Floor secured, streak ${E.streakInfo(g, today).current}.${g.chests[today] ? '' : ' Your supply drop is waiting on Today.'}`
  return `Floor: ${3 - open.length} of 3. Still open: ${open.join(', ')}.`
}

/** Execute one game action. Exported for tests and for the command palette. */
export function runAction(action: string, args: Args = {}): ActionResult {
  const st = useGame.getState()
  const { g, today } = st
  switch (action) {
    case 'brief': {
      st.logBrief()
      return { ok: true, say: gameBrief().text }
    }
    case 'streak': {
      const s = E.streakInfo(g, today)
      return { ok: true, say: `Streak ${s.current}, best ${s.best}. ${g.shields} shield${g.shields === 1 ? '' : 's'}. ${floorLine()}` }
    }
    case 'log': {
      // The one log is the plan's (it pays the XP); the Floor ticks when its event comes back.
      const track = String(args.track ?? '') as Track
      const minutes = Math.max(1, Math.min(600, Number(args.minutes) || 0))
      if (!['deutsch', 'silicon', 'body'].includes(track)) return { ok: false, say: 'Log what: German, Silicon or a workout?' }
      void usePlan.getState().log({ minutes, track, note: 'voice' })
      usePlayerStore.getState().recordHours(track === 'deutsch' ? 'german' : track === 'body' ? 'workout' : 'stamina', minutes / 60)
      const what = track === 'body' ? 'a training session' : `${hm(minutes)} of ${TRACKS[track].label}`
      return { ok: true, say: `Logging ${what}.` }
    }
    case 'rep': {
      const rep = String(args.rep) as E.Rep
      if (!E.REPS.includes(rep)) return { ok: false, say: 'Which rep: Silicon, Deutsch or Body?' }
      st.markRep(rep, 'voice', false)
      return { ok: true, say: `${E.REP_LABEL[rep]} claimed. ${floorLine()}` }
    }
    case 'focus': {
      const minutes = [25, 50, 90, 120].reduce((best, m) => (Math.abs(m - (Number(args.minutes) || 50)) < Math.abs(best - (Number(args.minutes) || 50)) ? m : best), 50)
      const track = (['silicon', 'deutsch', 'capital', 'paper', 'academy'].includes(String(args.track)) ? args.track : 'silicon') as Track
      st.requestFocus(minutes, track)
      useStore.getState().setTab('crucible')
      return { ok: true, say: `Focus armed: ${minutes} minutes on ${TRACKS[track].label}. A distraction in front for twenty seconds ends it. Go.` }
    }
    case 'marks': {
      const rewards = g.shop.filter((i) => i.kind === 'reward').sort((a, b) => a.cost - b.cost)
      const can = rewards.filter((i) => i.cost <= g.marks).map((i) => i.label)
      return { ok: true, say: `${g.marks} Marks. ${can.length ? `That buys: ${can.slice(0, 4).join(', ')}.` : `Cheapest reward is ${rewards[0]?.label ?? 'nothing'} at ${rewards[0]?.cost ?? 0}.`}` }
    }
    case 'buy': {
      const query = String(args.query ?? '')
      const best = g.shop.map((i) => ({ i, s: wordScore(query, i.label) })).sort((a, b) => b.s - a.s)[0]
      if (!best || best.s < 0.5) return { ok: false, say: `Buy what? The Armory has: ${g.shop.filter((i) => i.kind === 'reward').map((i) => i.label).join(', ')}.` }
      const err = st.buy(best.i.id)
      if (err) return { ok: false, say: err }
      return { ok: true, say: `${best.i.label}: bought for ${best.i.cost} Marks. ${useGame.getState().g.marks} left. Enjoy it, you paid for it with work.` }
    }
    default:
      return { ok: false, say: `I don't know the game action "${action}".` }
  }
}

/* ------------------------------------------------------------------ start */
let started = false

export async function startBridge(): Promise<void> {
  if (started) return
  started = true
  await useGame.getState().hydrate()

  // 0. The plan: pulled now, every minute, and whenever the server says it changed
  //    (a contract done by voice with the window closed shows up within seconds).
  void usePlan.getState().refresh()
  window.setInterval(() => void usePlan.getState().refresh(), 60_000)

  // 1. Keep the brief where JARVIS reads it.
  let timer: number | null = null
  const writeBrief = () => {
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      const b = gameBrief()
      void AsyncStorage.setItem(BRIEF_KEY, JSON.stringify({ at: Date.now(), text: b.text, data: b.data }))
    }, 1500)
  }
  useGame.subscribe(writeBrief)
  usePlayerStore.subscribe(writeBrief)
  usePlan.subscribe(writeBrief)
  writeBrief()

  // 2. Actions from JARVIS arrive as ephemeral bus events; plan updates as "mission".
  const seen = new Set<string>()
  const t0 = Date.now() / 1000 - 5
  let lastMission = t0
  useStore.subscribe((s, prev) => {
    if (s.events === prev.events) return
    for (const ev of s.events) {
      if (ev.source === 'mission' && ev.ts > lastMission) {
        lastMission = ev.ts
        void usePlan.getState().refresh()
        continue
      }
      if (ev.source !== 'game' || ev.kind !== 'action' || ev.ts < t0) continue
      const id = String(ev.action_id ?? '')
      if (!id || seen.has(id)) continue
      seen.add(id)
      let res: ActionResult
      try {
        res = runAction(String(ev.action ?? ''), (ev.args as Args) ?? {})
      } catch (e) {
        res = { ok: false, say: `The game failed: ${String(e)}` }
      }
      void post('/api/game/result', { id, ...res }).catch(() => {})
    }
  })

  // 3. Midnight roll-over and the evening nudge (a reminder, never a scolding).
  const tick = () => {
    const st = useGame.getState()
    st.tickDay()
    const { g, today } = useGame.getState()
    const now = new Date()
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    if (hhmm < g.settings.nudgeAt || g.nudged[today] || E.isSecured(g, today) || E.isRestDay(g, today)) return
    const rep = E.cheapestOpenRep(g, today)
    if (!rep) return
    const left = 24 * 60 - (now.getHours() * 60 + now.getMinutes())
    const streak = E.streakInfo(g, today).current
    const text = `The floor is still open, ${hm(left)} to midnight. Quickest win: ${E.REP_LABEL[rep]}, ${E.REP_HINT[rep].split(' — ')[0]}. ${streak ? `That keeps a ${streak}-day streak going${g.shields ? `, and you have ${g.shields} shield${g.shields > 1 ? 's' : ''} in reserve` : ''}.` : 'A good night to start a streak.'}`
    st.markNudged()
    sfx.warn()
    useBanners.getState().show({ kicker: 'JARVIS', title: 'Floor open', sub: text, tone: 'sim' })
    useStore.getState().toast(text, 'info')
    if (g.settings.voiceNudges && useStore.getState().core?.running) void post('/api/core/speak', { text }).catch(() => {})
  }
  window.setInterval(tick, 30_000)
  tick()
}
