/**
 * Focus > Start (A.Y02, 20.7.8): choose a track and a length, optionally a cue, then Start. Left 640: the track Segmented, the
 * presets, the cue, the two opt-in switches (the wager and the guards, both off), the Pick for me strip and the one primary.
 * Right: the Length dial, a still ring of one dot per 5 minutes of the chosen length (a pure function of it) with the length as the hero numeral, a PLANNED lamp and the one primary under it. The wager and the guards are the classic page's rules (session.ts), unchanged: a
 * toggle here is the kit Switch, and a wager that the XP cannot cover is said before Start, not after.
 *
 * Pick for me shows the top item of the Next three with the three terms of its rule printed (RULE); it is dismissible and it
 * starts nothing by itself. With no bank behind the port there is no strip at all: nothing is invented.
 */
import { useEffect, useState } from 'react'
import { Banner, Button, Field, Lamp, PrimaryButton, Segmented, Skeleton, Switch } from '../../shared/kit'
import { lookV3Enabled, Zones } from '../../shell/v3'
import { usePlan } from '../../germoney/game/plan'
import { LengthDial } from './art'
import { FocusHead } from './FocusHead'
import { goFocus } from './nav'
import { activeFocusPort, type FocusPort, type PickItem } from './ports'
import { LENGTHS, STRIKE_S, WAGER, WIN, type Length } from './session'
import { useFocusViews } from './store'
import { useCrucibleEngine } from './useCrucibleEngine'
import { useNarrow } from './useNarrow'
import './adapters'
import './views/focus-views.css'
import './views/focus-v3.css'

export interface FocusStartPanelProps {
  tracks: { id: string; label: string }[]
  trackId: string | null
  onTrack: (id: string) => void
  len: Length
  onLen: (l: Length) => void
  cue: string
  onCue: (c: string) => void
  wager: boolean
  onWager: (b: boolean) => void
  guards: boolean
  onGuards: (b: boolean) => void
  purgatory?: boolean
  /** Why Start cannot be pressed (no rotation, or a wager the XP cannot cover); undefined when it can. */
  blocked?: string
  /** A session is already running: Start says so and offers the way back to it. */
  running?: { trackLabel: string } | null
  pick?: PickItem | null
  onDismissPick?: () => void
  onPractise?: () => void
  onStart: () => void
  onOpenSession?: () => void
  eyesLine: string
  /** The state the strip's reading is drawn in; fixtures are SIMULATED. */
  stamp?: 'simulated' | null
}

export function FocusStartPanel(p: FocusStartPanelProps) {
  return lookV3Enabled() ? <FocusStartPanelV3 {...p} /> : <FocusStartPanelClassic {...p} />
}

function FocusStartPanelClassic(p: FocusStartPanelProps) {
  // under 1100 px the big dial gives way to the small one beside Length; exactly one dial and one PLANNED lamp are in the tree
  const compact = useNarrow(1099)
  return (
    <section className="fv fs" aria-label="Start a focus block">
      <div className="fs-left">
        <FocusHead title="Start a block" />
        {p.running && (
          <Banner tone="info" action={<Button size="md" onClick={p.onOpenSession}>Open the session</Button>}>
            A block is running on {p.running.trackLabel}. Starting another needs this one to end first.
          </Banner>
        )}
        {p.purgatory && <Banner tone="sim">Purgatory is on: one session of 3 hours clears it. No wager.</Banner>}
        {p.tracks.length === 0 ? (
          <div className="fs-empty" role="status">
            <p className="fs-empty-title">No tracks yet</p>
            <p className="fs-sub">Tracks are built from your weekly rotation.</p>
            <p className="fs-sub"><Lamp state="waiting" reason="the rotation is empty; add it in Setup > Rotation" /></p>
          </div>
        ) : (
          <>
            <div className="fs-row fs-track">
              <p className="fs-label" id="fs-track">Track</p>
              <Segmented<string> label="Track" variant="choice" value={p.trackId ?? ''} onChange={p.onTrack} options={p.tracks.map((t) => ({ id: t.id, label: t.label }))} />
            </div>
            <div className="fs-row fs-len">
              <p className="fs-label fs-len-label">Length{compact && <span className="fs-len-lamp"><Lamp state="planned" reason="chosen, not started" /></span>}</p>
              <Segmented<string> label="Length in minutes" variant="choice" value={String(p.len)} onChange={(v) => p.onLen(Number(v) as Length)}
                options={LENGTHS.map((m) => ({ id: String(m), label: `${m} min` }))} />
              {compact && <div className="fs-len-mini" aria-hidden="true"><LengthDial len={p.len} size="mini"><span className="fv-dial-n">{p.len}</span></LengthDial></div>}
            </div>
            <div className="fs-row fs-cue">
              <Field label="Cue (optional)" value={p.cue} maxLength={80} placeholder="One line to read when you sit down" autoComplete="off" onChange={(e) => p.onCue(e.target.value)} />
            </div>
            <div className="fs-opts">
              <div className="fs-opt">
                <Switch label="Wager" checked={p.wager} onChange={p.onWager} />
                <p className="fs-sub">{p.wager ? `${WAGER[p.len]} XP now, ${WIN[p.len]} back if you hold it to the end.` : 'Off. The wager rises with the length.'}</p>
              </div>
              <div className="fs-opt">
                <Switch label="Guards" checked={p.guards} onChange={p.onGuards} />
                <p className="fs-sub">{p.guards ? `Ends after ${STRIKE_S} s of a distraction in front, or a closed window.` : 'Off. Nothing watches the foreground.'}</p>
              </div>
            </div>
          </>
        )}
        {p.pick && !p.running && (
          <div className="fs-pick" role="group" aria-label="Pick for me">
            <div className="fs-pick-body">
              <p className="fs-pick-title"><span className="fv-tag">RULE</span> {p.pick.title}</p>
              <p className="fs-sub">{p.pick.reason}</p>
              <p className="fs-terms" aria-label="The three terms of the rule">
                {p.pick.terms.map((t) => <span key={t.name}>{t.name} {Number.isInteger(t.value) ? t.value : t.value.toFixed(2)}</span>)}
              </p>
            </div>
            <div className="fs-pick-act">
              {p.onPractise && <Button size="md" onClick={p.onPractise}>Practise this</Button>}
              {p.onDismissPick && <Button size="md" onClick={p.onDismissPick}>Dismiss</Button>}
            </div>
          </div>
        )}
      </div>
      {!compact && (
        <div className="fs-right">
          <LengthDial len={p.len}>
            <span className="fv-num" data-testid="length-numeral">{p.len}</span>
            <span className="fv-num-unit">min</span>
          </LengthDial>
          <p className="fv-why fs-dial-why"><Lamp state="planned" reason="chosen, not started" /><span aria-hidden="true">A block of {p.len} min, not started.</span></p>
        </div>
      )}
      <div className="fs-go">
        <PrimaryButton claimId="focus-start" rank="workspace" size="lg" disabledReason={p.blocked ?? (p.running ? 'A block is already running.' : undefined)} onClick={p.onStart}>Start session</PrimaryButton>
        <p className="fs-foot">{p.eyesLine} · minutes go through the one log writer{p.stamp ? ' · SIMULATED' : ''}</p>
      </div>
    </section>
  )
}

/**
 * Start under the v3 look: three trays in the order the person acts. SET holds the block's track and cue with the one primary;
 * LENGTH holds the length choice and the dial it draws; RULES holds the two opt-in switches and Pick for me. Same props, same
 * words and same lamps as the classic form: only the grouping changed.
 */
function FocusStartPanelV3(p: FocusStartPanelProps) {
  const blockedWhy = p.blocked ?? (p.running ? 'A block is already running.' : undefined)
  return (
    <Zones
      ratio="default"
      first={{
        job: 'SET',
        flare: p.running ? 1 : 0,
        children: (
          <div className="fv fv3 fs3" aria-label="Start a focus block" role="region">
            {p.running && (
              <Banner tone="info" action={<Button size="md" onClick={p.onOpenSession}>Open the session</Button>}>
                A block is running on {p.running.trackLabel}. Starting another needs this one to end first.
              </Banner>
            )}
            {p.purgatory && <Banner tone="sim">Purgatory is on: one session of 3 hours clears it. No wager.</Banner>}
            {p.tracks.length === 0 ? (
              <div className="fs-empty" role="status">
                <p className="fs-empty-title">No tracks yet</p>
                <p className="fs-sub">Tracks are built from your weekly rotation.</p>
                <p className="fs-sub"><Lamp state="waiting" reason="the rotation is empty; add it in Setup > Rotation" /></p>
              </div>
            ) : (
              <>
                <div className="fs-row fs-track">
                  <p className="fs-label" id="fs-track">Track</p>
                  <Segmented<string> label="Track" variant="choice" value={p.trackId ?? ''} onChange={p.onTrack} options={p.tracks.map((t) => ({ id: t.id, label: t.label }))} />
                </div>
                <div className="fs-row fs-cue">
                  <Field label="Cue (optional)" value={p.cue} maxLength={80} placeholder="One line to read when you sit down" autoComplete="off" onChange={(e) => p.onCue(e.target.value)} />
                </div>
              </>
            )}
            <div className="fs-go fs3-go">
              <PrimaryButton claimId="focus-start" rank="workspace" size="lg" disabledReason={blockedWhy} onClick={p.onStart}>Start session</PrimaryButton>
              <p className="fs-foot">{p.eyesLine} · minutes go through the one log writer{p.stamp ? ' · SIMULATED' : ''}</p>
            </div>
          </div>
        ),
      }}
      second={{
        job: 'LENGTH',
        peek: { name: 'Length', lamp: 'planned', note: `${p.len} min, not started` },
        children: (
          <div className="fv fv3 fs3">
            {p.tracks.length > 0 && (
              <div className="fs-row fs-len">
                <Segmented<string> label="Length in minutes" variant="choice" value={String(p.len)} onChange={(v) => p.onLen(Number(v) as Length)}
                  options={LENGTHS.map((m) => ({ id: String(m), label: `${m} min` }))} />
              </div>
            )}
            <div className="fs3-dial">
              <LengthDial len={p.len}>
                <span className="fv-num" data-testid="length-numeral">{p.len}</span>
                <span className="fv-num-unit">min</span>
              </LengthDial>
            </div>
            <p className="fv-why fs-dial-why"><Lamp state="planned" reason="chosen, not started" /><span aria-hidden="true">A block of {p.len} min, not started.</span></p>
          </div>
        ),
      }}
      third={{
        job: 'RULES',
        peek: { name: 'Rules', lamp: 'waiting', note: p.pick && !p.running ? 'a pick is waiting' : 'wager and guards off' },
        children: (
          <div className="fv fv3 fs3">
            <div className="fs-opt">
              <Switch label="Wager" checked={p.wager} onChange={p.onWager} />
              <p className="fs-sub">{p.wager ? `${WAGER[p.len]} XP now, ${WIN[p.len]} back if you hold it to the end.` : 'Off. The wager rises with the length.'}</p>
            </div>
            <div className="fs-opt">
              <Switch label="Guards" checked={p.guards} onChange={p.onGuards} />
              <p className="fs-sub">{p.guards ? `Ends after ${STRIKE_S} s of a distraction in front, or a closed window.` : 'Off. Nothing watches the foreground.'}</p>
            </div>
            {p.pick && !p.running && (
              <div className="fs-pick" role="group" aria-label="Pick for me">
                <div className="fs-pick-body">
                  <p className="fs-pick-title"><span className="fv-tag">RULE</span> {p.pick.title}</p>
                  <p className="fs-sub">{p.pick.reason}</p>
                  <p className="fs-terms" aria-label="The three terms of the rule">
                    {p.pick.terms.map((t) => <span key={t.name}>{t.name} {Number.isInteger(t.value) ? t.value : t.value.toFixed(2)}</span>)}
                  </p>
                </div>
                <div className="fs-pick-act">
                  {p.onPractise && <Button size="md" onClick={p.onPractise}>Practise this</Button>}
                  {p.onDismissPick && <Button size="md" onClick={p.onDismissPick}>Dismiss</Button>}
                </div>
              </div>
            )}
          </div>
        ),
      }}
    />
  )
}

export interface FocusStartProps { port?: FocusPort }

/** The Start view: the engine of the classic Crucible behind the new form. Starting moves to the Session view. */
export function FocusStart({ port }: FocusStartProps) {
  const p = port ?? activeFocusPort()
  const eng = useCrucibleEngine({ tick: 'minute', onStarted: (a) => { useFocusViews.getState().clearParked(); useFocusViews.getState().setRunKind(a.kind ?? 'crucible'); goFocus('session') } })
  const [pick, setPick] = useState<PickItem | null>(null)
  const [dismissed, setDismissed] = useState(false)
  // the plan state holds the rotation; the frame asks for it on its mount, and the frame is not here under shell v2
  useEffect(() => { if (usePlan.getState().state === null) void usePlan.getState().refresh() }, [])
  useEffect(() => {
    let live = true
    void p.pick().then((x) => { if (live) setPick(x) })
    return () => { live = false }
  }, [p])
  if (eng.active === undefined || !eng.planReady) return <div className="fv fv-wait"><Skeleton /></div>
  const run = eng.active
  return (
    <FocusStartPanel
      tracks={eng.tracks}
      trackId={eng.trackId}
      onTrack={eng.setTrack}
      len={eng.len}
      onLen={eng.setLen}
      cue={eng.cue}
      onCue={eng.setCue}
      wager={eng.wager}
      onWager={eng.setWager}
      guards={eng.guards}
      onGuards={eng.setGuards}
      purgatory={eng.purgatory && !run}
      blocked={eng.startBlock}
      running={run ? { trackLabel: run.trackLabel } : null}
      pick={dismissed ? null : pick}
      onDismissPick={() => setDismissed(true)}
      onPractise={() => goFocus('drill')}
      onStart={() => eng.start()}
      onOpenSession={() => goFocus('session')}
      eyesLine={eng.eyesLine}
    />
  )
}

