/**
 * The Crucible's engine as a hook: the state, the effects and the two ways in and out (start, finish) that used to live inside
 * Crucible.tsx. They were MOVED here whole so the classic page and the shell v2 views (Start, Session, Rest) run the same code,
 * the same storage key, the same log writer and the same guards; nothing was rewritten. What is new, and only additive:
 *   - `pause` and `resume`: the dots hold while paused; resuming shifts the start forward by the paused time, so the clock
 *     never counts a pause. `pausedAt` is an optional field of the stored session, absent in every old record;
 *   - `tick: 'minute'`: the v2 views draw minutes, so the clock is one timeout armed to the next minute (or the end, if sooner),
 *     not a 1 s interval; nothing wakes while paused or with no session;
 *   - `cue` and `kind`: an optional one-line cue and the track kind ('crucible' is the first), kept with the session;
 *   - `onFinished`: the line the finish wrote, handed to the caller (the Rest view shows it).
 */
import { useEffect, useRef, useState } from 'react'
import { api, post } from '../../lib/api'
import { useStore } from '../../lib/store'
import { usePlan } from '../../germoney/game/plan'
import { useGame } from '../../germoney/game/store'
import AsyncStorage from '../../germoney/platform'
import { usePlayerStore } from '../../germoney/stores/player-store'
import { useFrame } from '../frame/frameStore'
import {
  BEAT_MS, DEFAULT_LENGTH, LENGTHS, ROOM_EMPTY_S, STORAGE_KEY, STRIKE_S, WIN, WAGER,
  elapsedS, endedLine, remainingS, resumeVerdict, todaysTrack, tracksFromRotation, wagerShortfall,
  type Active, type Length,
} from './session'

export interface Foreground { supported: boolean; title?: string; exe?: string; distraction?: string | null }
export const PURGATORY_S = 3 * 3600

export interface Finished {
  kind: 'done' | 'ended'
  line: string
  /** Minutes that were held, and the minutes that count (0 under the 10 minute floor). */
  heldMin: number
  counted: number
  track: string
  trackLabel: string
  length: number
  durationS: number
}

export interface EngineOpts {
  tick?: 'second' | 'minute'
  onFinished?: (f: Finished) => void
  onStarted?: (a: Active) => void
}

/** Milliseconds to the next whole minute counted from the session's own start (so the dots step on the session's minutes). */
export function msToNextSessionMinute(startedAt: number, now: number): number {
  const into = (now - startedAt) % 60_000
  return 60_000 - (into < 0 ? into + 60_000 : into)
}

export function useCrucibleEngine(opts: EngineOpts = {}) {
  const tick = opts.tick ?? 'second'
  const optsRef = useRef(opts)
  optsRef.current = opts
  const rotation = usePlan((s) => s.state?.rotation)
  const planReady = usePlan((s) => !!s.state)
  const log = usePlan((s) => s.log)
  const xp = usePlayerStore((s) => s.player.xp)
  const purgatory = usePlayerStore((s) => s.player.isPurgatoryActive)
  const updateXP = usePlayerStore((s) => s.updateXP)
  const resolvePurgatory = usePlayerStore((s) => s.resolvePurgatory)
  const pending = useGame((s) => s.pendingFocus)
  const toast = useStore((s) => s.toast)
  const setFocusMode = useFrame((s) => s.setFocus)

  const tracks = tracksFromRotation(rotation)
  const [active, setActive] = useState<Active | null | undefined>(undefined)
  const [result, setResult] = useState<string | null>(null)
  const [len, setLen] = useState<Length>(DEFAULT_LENGTH)
  const [track, setTrack] = useState<string | null>(null)
  const [wager, setWager] = useState(false)
  const [guards, setGuards] = useState(false)
  const [cue, setCue] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [fg, setFg] = useState<Foreground | null>(null)
  const [strike, setStrike] = useState<number | null>(null)
  const [eyes, setEyes] = useState<{ live: boolean; state: string | null }>({ live: false, state: null })
  const ending = useRef(false)
  const strikeRef = useRef<number | null>(null)
  const emptyRef = useRef<number | null>(null)

  const trackId = track ?? todaysTrack(rotation, new Date())

  // ---- resume a session that was running when the page was left
  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (!raw) return setActive(null)
      let a: Active
      try { a = JSON.parse(raw) as Active } catch { void AsyncStorage.removeItem(STORAGE_KEY); return setActive(null) }
      const v = resumeVerdict(a, Date.now())
      if (v === 'running') { setActive(a); setNow(Date.now()); setFocusMode(true); return }
      setActive(null)
      void AsyncStorage.removeItem(STORAGE_KEY)
      void finish(a, v === 'done' ? 'done' : 'ended', 'the window was closed for over a minute.')
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- eyes: said once, from the snapshot, never guessed
  useEffect(() => {
    let live = true
    api<{ source: string | null; presence: { state: string } | null }>('/api/aankhen/snapshot')
      .then((s) => { if (live) setEyes({ live: s.source === 'hardware' && !!s.presence, state: s.presence?.state ?? null }) })
      .catch(() => {})
    return () => { live = false }
  }, [])

  const restoreRoom = () => {
    if (useGame.getState().g.settings.focusScene) void post('/api/limbs/light', { action: 'set', value: 100 }).catch(() => {})
  }

  /** One way out of every session: the held minutes are logged once, the wager is paid only on a full one. */
  async function finish(a: Active, kind: 'done' | 'ended', reason = 'you stopped it.') {
    if (ending.current) return
    ending.current = true
    void AsyncStorage.removeItem(STORAGE_KEY)
    setActive(null)
    setFocusMode(false)
    restoreRoom()
    const held = kind === 'done' ? a.durationS / 60 : elapsedS(a, a.pausedAt ?? Date.now()) / 60
    const e = kind === 'done' ? { counted: Math.round(held), text: '' } : endedLine(held, reason)
    let line = e.text
    if (e.counted > 0) {
      const r = await log({ minutes: e.counted, track: a.track, note: `Crucible: ${a.trackLabel}` })
      if (kind === 'done') line = r?.ok === false ? `Session complete: ${e.counted} min on ${a.trackLabel}. The log did not save: ${r.say}` : `Session complete: ${e.counted} min on ${a.trackLabel} logged.`
    } else if (kind === 'done') line = 'Session complete.'
    if (kind === 'done' && a.durationS === PURGATORY_S) {
      resolvePurgatory(3)
      line += ' Purgatory cleared.'
    } else if (kind === 'done' && a.wager) {
      const win = WIN[a.length as Length] ?? 0
      updateXP(win)
      line += ` +${win} XP.`
    }
    setResult(line)
    toast(line, 'info')
    optsRef.current.onFinished?.({ kind, line, heldMin: held, counted: e.counted, track: a.track, trackLabel: a.trackLabel, length: a.length, durationS: a.durationS })
    ending.current = false
  }

  function start(minutes: Length = len, tr: string | null = trackId) {
    if (!tr) return
    const trk = tracks.find((t) => t.id === tr)
    const p = purgatory
    const useWager = wager && !p
    if (useWager) {
      const short = wagerShortfall(xp, minutes)
      if (short) { toast(short, 'info'); return }
      updateXP(-WAGER[minutes])
    }
    const t = Date.now()
    const a: Active = {
      startedAt: t, durationS: p ? PURGATORY_S : minutes * 60, lastBeat: t, track: tr, trackLabel: trk?.label ?? tr, wager: useWager, guards, length: minutes,
      ...(cue.trim() ? { cue: cue.trim().slice(0, 80) } : {}),
    }
    ending.current = false
    strikeRef.current = null
    emptyRef.current = null
    setResult(null)
    setNow(t)
    setActive(a)
    setFocusMode(true)
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(a))
    if (useGame.getState().g.settings.focusScene) void post('/api/limbs/scene/focus').catch(() => {})
    optsRef.current.onStarted?.(a)
  }

  /** Hold the dots. The stored record carries the moment, so a reload finds the session still held. */
  function pause() {
    if (!active || active.pausedAt) return
    const a = { ...active, pausedAt: Date.now() }
    setActive(a)
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(a))
  }
  /** Take the pause out of the clock: the start moves forward by exactly the time held. */
  function resume() {
    if (!active?.pausedAt) return
    const t = Date.now()
    const { pausedAt, ...rest } = active
    const a: Active = { ...rest, startedAt: active.startedAt + (t - pausedAt), lastBeat: t }
    setActive(a)
    setNow(t)
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(a))
  }

  // a Crucible asked for by voice ("start a 50 minute focus"): it opens with today's track, since the voice names a game track, not a rotation one
  useEffect(() => {
    if (!pending || active !== null || !trackId) return
    const m = [...LENGTHS].reverse().find((x) => x <= pending.minutes) ?? LENGTHS[0]
    setLen(m)
    useGame.getState().clearFocus()
    start(m, trackId)
  }, [pending, active]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the clock while a session runs (a 1 s interval for the dial, one timeout per minute for the dots); it ends the session when the time is up
  const paused = !!active?.pausedAt
  useEffect(() => {
    if (!active || paused) return
    if (tick === 'second') {
      const id = window.setInterval(() => setNow(Date.now()), 1000)
      return () => window.clearInterval(id)
    }
    const wait = Math.max(50, Math.min(msToNextSessionMinute(active.startedAt, now), remainingS(active, now) * 1000 + 20))
    const id = window.setTimeout(() => setNow(Date.now()), wait)
    return () => window.clearTimeout(id)
  }, [active, paused, tick, now])
  const effNow = active?.pausedAt ?? now
  useEffect(() => {
    if (active && remainingS(active, effNow) <= 0) void finish(active, 'done')
  }) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- guards (opt-in): the heartbeat, the foreground, the room
  useEffect(() => {
    if (!active || !active.guards || paused) return
    const beat = window.setInterval(() => void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ...active, lastBeat: Date.now() })), BEAT_MS)
    const watch = window.setInterval(async () => {
      try {
        const f = await api<Foreground>('/api/germoney/focus')
        setFg(f)
        if (f.distraction) {
          strikeRef.current = strikeRef.current ?? Date.now()
          setStrike(strikeRef.current)
          if (Date.now() - strikeRef.current >= STRIKE_S * 1000) void finish(active, 'ended', `${f.distraction} was in front for ${STRIKE_S} seconds.`)
        } else { strikeRef.current = null; setStrike(null) }
      } catch { /* best effort */ }
      try {
        const snap = await api<{ source: string | null; presence: { state: string } | null }>('/api/aankhen/snapshot')
        const live = snap.source === 'hardware' && !!snap.presence
        emptyRef.current = live && snap.presence?.state === 'empty' ? (emptyRef.current ?? Date.now()) : null
        setEyes({ live, state: snap.presence?.state ?? null })
        if (emptyRef.current && Date.now() - emptyRef.current >= ROOM_EMPTY_S * 1000) void finish(active, 'ended', 'the room was empty for 5 minutes.')
      } catch { /* eyes optional */ }
    }, 3000)
    return () => { window.clearInterval(beat); window.clearInterval(watch) }
  }, [active, paused]) // eslint-disable-line react-hooks/exhaustive-deps

  const total = active?.durationS ?? (purgatory ? PURGATORY_S : len * 60)
  const left = active ? remainingS(active, effNow) : total
  const progress = active ? 1 - left / total : 0
  const strikeLeft = strike ? Math.max(0, STRIKE_S - (now - strike) / 1000) : null
  const startBlock = !trackId ? 'No rotation yet: add one in Setup > Rotation.' : wager && !purgatory ? wagerShortfall(xp, len) ?? undefined : undefined
  const eyesLine = eyes.live ? `eyes: live, room ${eyes.state}` : 'eyes: not live (no hardware)'

  return {
    // data
    rotation, planReady, tracks, trackId, active, result, len, track, wager, guards, cue, now: effNow, fg, strike, eyes, xp, purgatory,
    // derived
    total, left, progress, strikeLeft, startBlock, eyesLine, paused,
    // setters and actions
    setLen, setTrack, setWager, setGuards, setCue, start, finish, pause, resume,
  }
}
