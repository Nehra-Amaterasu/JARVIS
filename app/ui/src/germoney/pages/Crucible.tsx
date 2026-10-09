/**
 * Mission → Crucible: the deep-work lockdown. Pick a length and a track, wager
 * XP, win it back multiplied. In Purgatory: 3 hours to unlock the system.
 *
 * The phone app had one length: 2 hours. A 2-hour minimum is exactly the kind of
 * barrier that stops a first session, so it starts at 25 minutes now; the wager
 * scales with the length so the long sessions still pay best.
 *
 * On the phone, "leaving the app" forfeited the session. On a laptop the work
 * happens in OTHER apps (VS Code, KiCad, a PDF), so JARVIS watches what actually
 * breaks focus instead:
 *   - DISTRACTION: a distraction (YouTube, Instagram, Valorant…) in the foreground
 *     for 20 s straight forfeits. The countdown is shown, so it is a warning first.
 *   - ROOM (only with the real ESP32 connected): the room empty for 5 minutes
 *     forfeits — you walked away. Simulated eyes never judge you.
 *   - ABANDON: the session survives switching tabs, but closing JARVIS mid-session
 *     (no heartbeat for over a minute) counts as walking out.
 *
 * Minutes held count toward the Floor and the boss of the month (by track), even
 * when a session fails — the work happened; only the wager is lost.
 */
import { Flame, ShieldAlert, XOctagon, Zap } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { api, post } from '../../lib/api'
import { useStore } from '../../lib/store'
import { TRACKS, type Track } from '../game/characters'
import { useGame } from '../game/store'
import AsyncStorage, { Alert } from '../platform'
import { usePlayerStore } from '../stores/player-store'
import { MissionHeader, useFx, useTick } from '../ui'

const KEY = '@silicon_crucible_active'
const STRIKE_S = 20
const ROOM_EMPTY_S = 300
const BEAT_MS = 15_000
const LENGTHS = [25, 50, 90, 120] as const
const WAGER: Record<number, number> = { 25: 10, 50: 20, 90: 40, 120: 50 }
const WIN: Record<number, number> = { 25: 40, 50: 80, 90: 140, 120: 150 }
const FOCUS_TRACKS: Track[] = ['silicon', 'deutsch', 'capital', 'paper', 'academy']

interface Active { mode: 'normal' | 'purgatory'; startedAt: number; durationS: number; lastBeat: number; track: Track; booster: boolean }
interface Focus { supported: boolean; title?: string; exe?: string; distraction?: string | null }

const fmt = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`
}

const announce = (text: string) => {
  if (useStore.getState().core?.running) void post('/api/core/speak', { text }).catch(() => {})
}

export function CruciblePage() {
  const player = usePlayerStore((s) => s.player)
  const updateXP = usePlayerStore((s) => s.updateXP)
  const resolvePurgatory = usePlayerStore((s) => s.resolvePurgatory)
  const game = useGame((s) => s.g)
  const pending = useGame((s) => s.pendingFocus)
  const setTab = useStore((s) => s.setTab)
  const fx = useFx()
  const purgatory = player.isPurgatoryActive
  const [active, setActive] = useState<Active | null | undefined>(undefined)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [focus, setFocus] = useState<Focus | null>(null)
  const [strikeSince, setStrikeSince] = useState<number | null>(null)
  const [room, setRoom] = useState<{ live: boolean; state: string | null; emptySince: number | null }>({ live: false, state: null, emptySince: null })
  const [len, setLen] = useState<number>(50)
  const [track, setTrack] = useState<Track>('silicon')
  const [useBoost, setUseBoost] = useState(false)
  const ending = useRef(false)
  // Timers live in refs: the decision to forfeit is made once, in the interval —
  // never inside a state updater, which React may run twice.
  const strikeRef = useRef<number | null>(null)
  const emptyRef = useRef<number | null>(null)
  useTick(1000)

  // Resume a session that was running when you switched tabs.
  useEffect(() => {
    void AsyncStorage.getItem(KEY).then((raw) => {
      if (!raw) return setActive(null)
      const a = { track: 'silicon', booster: false, ...JSON.parse(raw) } as Active
      if (Date.now() - a.lastBeat > 60_000) {
        void AsyncStorage.removeItem(KEY)
        setActive(null)
        fail('ABANDONED. JARVIS WAS CLOSED MID-SESSION.', a)
        return
      }
      setActive(a)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const heldMinutes = (a: Active) => Math.min(a.durationS, (Date.now() - a.startedAt) / 1000) / 60

  const restoreRoom = () => {
    if (useGame.getState().g.settings.focusScene) void post('/api/limbs/light', { action: 'set', value: 100 }).catch(() => {})
  }

  const fail = (reason: string, a: Active | null = active ?? null) => {
    if (ending.current) return
    ending.current = true
    void AsyncStorage.removeItem(KEY)
    setActive(null)
    setResult({ ok: false, text: reason })
    if (a) {
      const held = heldMinutes(a)
      if (held >= 10) useGame.getState().recordFocus(held, a.track, true)
    }
    restoreRoom()
    Alert.alert('CRUCIBLE FAILED', reason)
  }

  const complete = (a: Active) => {
    if (ending.current) return
    ending.current = true
    void AsyncStorage.removeItem(KEY)
    setActive(null)
    const minutes = a.durationS / 60
    useGame.getState().recordFocus(minutes, a.track, true)
    if (a.mode === 'purgatory') {
      resolvePurgatory(3)
      setResult({ ok: true, text: 'SYSTEM UNLOCKED. PURGATORY CLEARED.' })
      announce('Purgatory cleared. The system is yours again.')
    } else {
      const win = Math.round((WIN[minutes] ?? 80) * (a.booster ? 1.5 : 1))
      updateXP(win)
      fx.burst(`+${win} XP`, 'live')
      setResult({ ok: true, text: `+${win} XP SECURED.` })
      announce(`Crucible conquered. ${minutes} minutes on ${TRACKS[a.track].label}. Plus ${win} XP.`)
    }
    restoreRoom()
    Alert.alert('CRUCIBLE CONQUERED', 'You held the line.')
  }

  const start = (minutes = len, tr: Track = track) => {
    const mode = purgatory ? 'purgatory' : 'normal'
    const durationS = mode === 'purgatory' ? 3 * 3600 : minutes * 60
    let booster = false
    if (mode === 'normal') {
      const wager = WAGER[minutes] ?? 20
      if (player.xp < wager) {
        Alert.alert('INSUFFICIENT XP', `Complete a contract to earn the ${wager} XP wager.`)
        return
      }
      updateXP(-wager)
      booster = useBoost && useGame.getState().useBooster()
    }
    const a: Active = { mode, startedAt: Date.now(), durationS, lastBeat: Date.now(), track: tr, booster }
    ending.current = false
    strikeRef.current = null
    emptyRef.current = null
    setResult(null)
    setActive(a)
    void AsyncStorage.setItem(KEY, JSON.stringify(a))
    if (useGame.getState().g.settings.focusScene) void post('/api/limbs/scene/focus').catch(() => {})
    announce(mode === 'purgatory' ? 'Purgatory. Three hours. No exits.' : `Crucible engaged. ${minutes} minutes on ${TRACKS[tr].label}. I am watching the foreground.`)
  }

  // A Crucible requested by voice ("Jarvis, start a 50 minute focus on German").
  useEffect(() => {
    if (!pending || active !== null) return
    setLen(pending.minutes)
    setTrack(pending.track)
    useGame.getState().clearFocus()
    start(pending.minutes, pending.track)
  }, [pending, active]) // eslint-disable-line react-hooks/exhaustive-deps

  // Heartbeat, timer and guards while a session runs.
  const remaining = active ? Math.max(0, active.durationS - (Date.now() - active.startedAt) / 1000) : 0
  useEffect(() => {
    if (!active) return
    if (remaining <= 0) complete(active)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!active) return
    const beat = window.setInterval(() => {
      const a = { ...active, lastBeat: Date.now() }
      void AsyncStorage.setItem(KEY, JSON.stringify(a))
    }, BEAT_MS)
    const guard = window.setInterval(async () => {
      try {
        const f = await api<Focus>('/api/germoney/focus')
        setFocus(f)
        if (f.distraction) {
          strikeRef.current = strikeRef.current ?? Date.now()
          setStrikeSince(strikeRef.current)
          if (Date.now() - strikeRef.current >= STRIKE_S * 1000) fail(`FOCUS BROKEN: ${f.distraction} IN FRONT FOR ${STRIKE_S} SECONDS.`)
        } else {
          strikeRef.current = null
          setStrikeSince(null)
        }
      } catch { /* guard is best-effort */ }
      try {
        const snap = await api<{ source: string | null; presence: { state: string } | null }>('/api/aankhen/snapshot')
        const live = snap.source === 'hardware' && !!snap.presence
        const state = snap.presence?.state ?? null
        emptyRef.current = live && state === 'empty' ? (emptyRef.current ?? Date.now()) : null
        setRoom({ live, state, emptySince: emptyRef.current })
        if (emptyRef.current && Date.now() - emptyRef.current >= ROOM_EMPTY_S * 1000) {
          fail('YOU LEFT THE ROOM. AANKHEN SAW IT EMPTY FOR 5 MINUTES.')
        }
      } catch { /* eyes optional */ }
    }, 3000)
    return () => { window.clearInterval(beat); window.clearInterval(guard) }
  }, [active]) // eslint-disable-line react-hooks/exhaustive-deps

  if (active === undefined) return <div className="empty">…</div>
  const mode = active?.mode ?? (purgatory ? 'purgatory' : 'normal')
  const total = active?.durationS ?? (mode === 'purgatory' ? 3 * 3600 : len * 60)
  const progress = active ? 1 - remaining / total : 0
  const strikeLeft = strikeSince ? Math.max(0, STRIKE_S - (Date.now() - strikeSince) / 1000) : null

  return (
    <div className={`mission-page crucible ${mode} ${active ? 'running' : ''}`}>
      <MissionHeader n="M7" title="Crucible" sub={mode === 'purgatory' ? 'Purgatory mode: 3 hours. No exits.' : 'Pick a length and a track. Wager XP, win it back multiplied. No distractions.'} />
      <section className="card crucible-card">
        <CrucibleRing progress={progress} fault={mode === 'purgatory' || !!strikeSince} />
        <div className="crucible-center">
          <div className={`dot crucible-time ${active ? '' : 'idle'}`}>{fmt(active ? remaining : total)}</div>
          <div className="mono muted">{active ? `${Math.round(progress * 100)}% held · ${TRACKS[active.track].label}${active.booster ? ' · boosted' : ''}` : result ? result.text : 'not running'}</div>
        </div>
        {!active ? (
          <div className="crucible-actions">
            {result && <div className={`pill ${result.ok ? 'live' : 'fault'}`}><i className="led" />{result.ok ? 'Cleared' : 'Failed'}</div>}
            {mode === 'normal' && (
              <div className="crucible-setup">
                <div className="seg">{LENGTHS.map((m) => (
                  <button key={m} className={m === len ? 'on' : ''} onClick={() => setLen(m)}><b>{m}</b><span>min · wager {WAGER[m]} · win {WIN[m]}</span></button>
                ))}</div>
                <div className="seg tracks">{FOCUS_TRACKS.map((t) => (
                  <button key={t} className={t === track ? 'on' : ''} style={{ '--tint': TRACKS[t].tint } as CSSProperties} onClick={() => setTrack(t)}>{TRACKS[t].label}</button>
                ))}</div>
                {game.boosters > 0 && (
                  <label className="check"><input type="checkbox" checked={useBoost} onChange={(e) => setUseBoost(e.target.checked)} /><Zap size={13} />Use a booster (+50% XP) · {game.boosters} held</label>
                )}
              </div>
            )}
            <button className={`btn power ${mode === 'purgatory' ? 'danger' : 'primary'}`} onClick={() => start()}>
              <Flame size={16} />{mode === 'purgatory' ? 'Enter purgatory' : `Initiate ${len}-minute lockdown`}
            </button>
            {result?.ok && <button className="btn ghost" onClick={() => setTab('mission')}>Return to HQ</button>}
          </div>
        ) : (
          <div className="crucible-actions">
            {strikeLeft !== null ? (
              <div className="guard-alarm"><ShieldAlert size={16} />{focus?.distraction} in the foreground — close it: {Math.ceil(strikeLeft)} s</div>
            ) : (
              <div className="guard-ok mono">Guard: watching the foreground{focus?.supported === false ? ' (unsupported)' : ''}
                {room.live ? ` · room ${room.state}` : ' · eyes: not live'}</div>
            )}
            <button className="btn danger" onClick={() => fail('YOU ABORTED THE MISSION.')}><XOctagon size={15} />Abort (forfeit)</button>
          </div>
        )}
      </section>
      <p className="muted small crucible-note">Switching tabs is fine — the session keeps running. Distractions in front for {STRIKE_S} s,
        closing JARVIS, or (with the real sensors) leaving the room for 5 minutes forfeit it. 25+ minutes on Silicon (or 15 on Deutsch) ticks that rep of the Floor.</p>
    </div>
  )
}

function CrucibleRing({ progress, fault }: { progress: number; fault: boolean }) {
  const N = 120, R = 150, C = 170
  const lit = Math.round(progress * N)
  return (
    <svg className="crucible-ring" viewBox={`0 0 ${C * 2} ${C * 2}`} aria-hidden>
      {Array.from({ length: N }, (_, i) => {
        const a = -Math.PI / 2 + (i / N) * Math.PI * 2
        const long = i % 10 === 0
        const r0 = long ? R - 12 : R - 7
        return <line key={i} x1={C + Math.cos(a) * r0} y1={C + Math.sin(a) * r0} x2={C + Math.cos(a) * R} y2={C + Math.sin(a) * R}
          className={i < lit ? (fault ? 'on fault' : 'on') : ''} />
      })}
    </svg>
  )
}
