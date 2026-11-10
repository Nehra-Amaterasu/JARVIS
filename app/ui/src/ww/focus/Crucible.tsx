/**
 * Focus > Crucible (plan 4.8, F1): pick a track and a length, then Start. The dial is the only light on the
 * page (Focus has no hue, ink is its accent, 5.7.5). Nothing counts down until a session starts.
 *
 * The wager and the guards are opt-in and off. Starting collapses the left column and the proof rail to a
 * 48 px timer rail (data-focus on the frame, styled in focus.css); Esc restores them without ending the
 * session. Ending it early is a press-and-hold (`hold`), because it is the costly action. Minutes go through
 * the plan's one log writer (usePlan.log), so they reach Recent and tick the Floor when the event returns.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, post } from '../../lib/api'
import { useStore } from '../../lib/store'
import { usePlan } from '../../germoney/game/plan'
import { useGame } from '../../germoney/game/store'
import AsyncStorage from '../../germoney/platform'
import { usePlayerStore } from '../../germoney/stores/player-store'
import { useFrame } from '../frame/frameStore'
import { Banner, Card, Chip, EmptyState, HoldButton, PrimaryButton, Segmented, Skeleton } from '../kit'
import {
  BEAT_MS, DEFAULT_LENGTH, LENGTHS, ROOM_EMPTY_S, STORAGE_KEY, STRIKE_S, WIN, WAGER,
  elapsedS, endedLine, fmt, remainingS, resumeVerdict, todaysTrack, tracksFromRotation, wagerShortfall,
  type Active, type Length,
} from './session'

interface Foreground { supported: boolean; title?: string; exe?: string; distraction?: string | null }
const N = 120   // ticks on the dial
const PURGATORY_S = 3 * 3600

function Dial({ progress }: { progress: number }) {
  const R = 150
  const C = 170
  const lit = Math.round(progress * N)
  return (
    <svg className="ww-dial" viewBox={`0 0 ${C * 2} ${C * 2}`} aria-hidden="true">
      {Array.from({ length: N }, (_, i) => {
        const a = -Math.PI / 2 + (i / N) * Math.PI * 2
        const r0 = i % 10 === 0 ? R - 12 : R - 7
        return <line key={i} x1={C + Math.cos(a) * r0} y1={C + Math.sin(a) * r0} x2={C + Math.cos(a) * R} y2={C + Math.sin(a) * R} className={i < lit ? 'on' : ''} />
      })}
    </svg>
  )
}

export function WwCrucible() {
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
  const focusMode = useFrame((s) => s.focus)

  const tracks = tracksFromRotation(rotation)
  const [active, setActive] = useState<Active | null | undefined>(undefined)
  const [result, setResult] = useState<string | null>(null)
  const [len, setLen] = useState<Length>(DEFAULT_LENGTH)
  const [track, setTrack] = useState<string | null>(null)
  const [wager, setWager] = useState(false)
  const [guards, setGuards] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [fg, setFg] = useState<Foreground | null>(null)
  const [strike, setStrike] = useState<number | null>(null)
  const [eyes, setEyes] = useState<{ live: boolean; state: string | null }>({ live: false, state: null })
  const [rail, setRail] = useState<Element | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const ending = useRef(false)
  const strikeRef = useRef<number | null>(null)
  const emptyRef = useRef<number | null>(null)

  const trackId = track ?? todaysTrack(rotation, new Date())

  // ---- the frame: find the left column (for the timer rail) and mark the frame while a session runs
  useEffect(() => {
    const frame = root.current?.closest('.ww-frame') ?? null
    setRail(frame?.querySelector('.ww-left') ?? null)
    if (!frame) return
    if (focusMode && active) frame.setAttribute('data-focus', 'on')
    else frame.removeAttribute('data-focus')
    return () => frame.removeAttribute('data-focus')
  }, [focusMode, active])

  // ---- resume a session that was running when the page was left
  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (!raw) return setActive(null)
      let a: Active
      try { a = JSON.parse(raw) as Active } catch { void AsyncStorage.removeItem(STORAGE_KEY); return setActive(null) }
      const v = resumeVerdict(a, Date.now())
      if (v === 'running') { setActive(a); setFocusMode(true); return }
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
    const held = kind === 'done' ? a.durationS / 60 : elapsedS(a, Date.now()) / 60
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
    const a: Active = { startedAt: t, durationS: p ? PURGATORY_S : minutes * 60, lastBeat: t, track: tr, trackLabel: trk?.label ?? tr, wager: useWager, guards, length: minutes }
    ending.current = false
    strikeRef.current = null
    emptyRef.current = null
    setResult(null)
    setNow(t)
    setActive(a)
    setFocusMode(true)
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(a))
    if (useGame.getState().g.settings.focusScene) void post('/api/limbs/scene/focus').catch(() => {})
  }

  // a Crucible asked for by voice ("start a 50 minute focus"): it opens with today's track, since the voice names a game track, not a rotation one
  useEffect(() => {
    if (!pending || active !== null || !trackId) return
    const m = [...LENGTHS].reverse().find((x) => x <= pending.minutes) ?? LENGTHS[0]
    setLen(m)
    useGame.getState().clearFocus()
    start(m, trackId)
  }, [pending, active]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- one clock while a session runs; it ends the session when the time is up
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [active])
  useEffect(() => {
    if (active && remainingS(active, now) <= 0) void finish(active, 'done')
  }) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- guards (opt-in): the heartbeat, the foreground, the room
  useEffect(() => {
    if (!active || !active.guards) return
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
  }, [active]) // eslint-disable-line react-hooks/exhaustive-deps

  if (active === undefined || !planReady) return <div ref={root} className="ww-focus-fill"><Skeleton /></div>

  const total = active?.durationS ?? (purgatory ? PURGATORY_S : len * 60)
  const left = active ? remainingS(active, now) : total
  const progress = active ? 1 - left / total : 0
  const strikeLeft = strike ? Math.max(0, STRIKE_S - (now - strike) / 1000) : null
  const startBlock = !trackId ? 'No rotation yet: add one in Setup > Rotation.' : wager && !purgatory ? wagerShortfall(xp, len) ?? undefined : undefined
  const eyesLine = eyes.live ? `eyes: live, room ${eyes.state}` : 'eyes: not live (no hardware)'

  return (
    <div ref={root} className="ww-crucible" data-running={active ? 'true' : 'false'}>
      {purgatory && !active && <Banner tone="sim">Purgatory is on: one session of 3 hours clears it. No wager.</Banner>}
      <Card data-card="focus-crucible" title="Crucible" kicker="Focus" tone="quiet">
        {!active && (
          <div className="ww-crucible-setup">
            {tracks.length === 0 ? (
              <EmptyState title="No tracks yet" body="Tracks are built from your weekly rotation." reason="The rotation is empty. Add it in Setup > Rotation." />
            ) : (
              <>
                <div className="ww-crucible-row">
                  <span className="ww-kicker">Track</span>
                  <Segmented<string> label="Track" variant="choice" value={trackId ?? ''} onChange={setTrack} options={tracks.map((t) => ({ id: t.id, label: t.label }))} />
                  <span className="ww-crucible-note">built from your rotation</span>
                </div>
                <div className="ww-crucible-row">
                  <span className="ww-kicker">Length</span>
                  <Segmented<string> label="Length in minutes" variant="choice" value={String(len)} onChange={(v) => setLen(Number(v) as Length)} options={LENGTHS.map((m) => ({ id: String(m), label: `${m} min` }))} />
                  <span className="ww-crucible-note">25 minutes is the least</span>
                </div>
                <div className="ww-crucible-row">
                  <span className="ww-kicker">Options</span>
                  <Chip selected={wager} onClick={() => setWager(!wager)}>{`Wager ${wager ? 'on' : 'off'}`}</Chip>
                  <Chip selected={guards} onClick={() => setGuards(!guards)}>{`Guards ${guards ? 'on' : 'off'}`}</Chip>
                  <span className="ww-crucible-note">
                    {wager ? `${WAGER[len]} XP now, ${WIN[len]} back if you hold it to the end. ` : 'The wager rises with the length. '}
                    {guards ? `Ends after ${STRIKE_S} s of a distraction in front, or a closed window.` : 'Off: nothing watches the foreground.'}
                  </span>
                </div>
              </>
            )}
          </div>
        )}
        <div className="ww-dial-wrap">
          <Dial progress={progress} />
          {active ? (
            <div className="ww-dial-centre">
              <div className="ww-dial-time" role="timer" aria-label="Time left">{fmt(left)}</div>
              <div className="ww-dial-sub">{Math.round(progress * 100)}% held · {active.trackLabel}{active.wager ? ' · wager on' : ''}</div>
            </div>
          ) : (
            <div className="ww-dial-centre">
              <div className="ww-dial-sub">{result ?? 'No session running.'}</div>
            </div>
          )}
        </div>
        {!active ? (
          <div className="ww-crucible-go">
            <PrimaryButton claimId="focus-start" rank="workspace" size="lg" disabledReason={startBlock} onClick={() => start()}>Start session</PrimaryButton>
          </div>
        ) : (
          <div className="ww-crucible-go">
            {strikeLeft !== null && <Banner tone="sim">{fg?.distraction} is in front. Close it in {Math.ceil(strikeLeft)} s or the session ends.</Banner>}
            <HoldButton label="End session" size="md" onConfirm={() => void finish(active, 'ended')} />
          </div>
        )}
        <p className="ww-crucible-foot">
          {eyesLine} · guards: {active ? (active.guards ? 'heartbeat, 20 s distraction' : 'off') : guards ? 'heartbeat, 20 s distraction' : 'off'}
          {fg?.supported === false && active?.guards ? ' (foreground not supported here)' : ''}
          <br />
          Minutes go through the one log writer, so they reach Recent.
        </p>
      </Card>
      {rail && active && focusMode && createPortal(<div className="ww-focus-rail" role="timer" aria-label="Time left">{fmt(left)}</div>, rail)}
    </div>
  )
}
