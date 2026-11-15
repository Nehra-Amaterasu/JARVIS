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
import { useFrame } from '../frame/frameStore'
import { Banner, Card, Chip, EmptyState, HoldButton, PrimaryButton, Segmented, Skeleton } from '../kit'
import { LENGTHS, STRIKE_S, WIN, WAGER, fmt, type Length } from './session'
import { useCrucibleEngine } from './useCrucibleEngine'

// The state, the effects, start and finish moved to useCrucibleEngine.ts (Y02) unchanged; this file keeps the page.
const N = 120   // ticks on the dial

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
  const focusMode = useFrame((s) => s.focus)
  const {
    planReady, tracks, trackId, active, result, len, wager, guards, fg, purgatory,
    left, progress, strikeLeft, startBlock, eyesLine,
    setLen, setTrack, setWager, setGuards, start, finish,
  } = useCrucibleEngine()
  const [rail, setRail] = useState<Element | null>(null)
  const root = useRef<HTMLDivElement>(null)

  // ---- the frame: find the left column (for the timer rail) and mark the frame while a session runs
  useEffect(() => {
    const frame = root.current?.closest('.ww-frame') ?? null
    setRail(frame?.querySelector('.ww-left') ?? null)
    if (!frame) return
    if (focusMode && active) frame.setAttribute('data-focus', 'on')
    else frame.removeAttribute('data-focus')
    return () => frame.removeAttribute('data-focus')
  }, [focusMode, active])

  if (active === undefined || !planReady) return <div ref={root} className="ww-focus-fill"><Skeleton /></div>

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
