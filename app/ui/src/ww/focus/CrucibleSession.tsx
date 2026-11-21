/**
 * The Crucible, session screen (A.Y02, 20.7.8): the dot field (one dot per elapsed minute, the shared DotTimer), a readout in mono
 * ("32 min · track"), the controls (Pause, Park, End) and one 24 px terminal strip under them. The engine is the one the classic page
 * runs (useCrucibleEngine); this file is the new face of it. The clock is one timeout per minute, so the dots step on the minute and
 * nothing wakes between; while paused nothing is armed at all.
 *
 * Calm recovery: Pause holds the dots; an early end keeps every filled dot and defaults to the logged minutes (the Rest view says
 * how many counted and that under 10 minutes counts nothing); a window closed for over a minute ends the session with the held
 * minutes. The strip names a state, never a countdown, so it changes only when something happens.
 */
import { useEffect, useRef, useState } from 'react'
import { DotTimer } from '../../shared/art'
import { Banner, Button, Lamp, Skeleton } from '../../shared/kit'
import { lookV3Enabled, Zones } from '../../shell/v3'
import { FocusHead, WhyLine } from './FocusHead'
import { HoldButton } from '../../shared/kit/Interactive'
import { RestingDial, TickRing } from './art'
import { goFocus } from './nav'
import { ParkField } from './ParkField'
import { activeFocusPort, type FocusPort } from './ports'
import { elapsedS } from './session'
import { useFocusViews } from './store'
import { useCrucibleEngine } from './useCrucibleEngine'
import './adapters'
import './views/focus-views.css'
import './views/focus-v3.css'

export interface CruciblePanelProps {
  plannedMin: number
  elapsedMin: number
  paused: boolean
  trackLabel: string
  cue?: string
  guards: boolean
  wager: boolean
  /** Thoughts filed in this block, newest last, each with where it went. */
  parked: { text: string; stored: boolean }[]
  /** The line of a guard that is counting (a distraction in front), else null. */
  strikeLine?: string | null
  onPause: () => void
  onResume: () => void
  onEnd: () => void
  onFile: (text: string) => void
  /** The Park field starts open (the gallery shows it so); a real session opens it with P. */
  parkOpen?: boolean
}

/** The strip under the controls. Built from the block's settings and its filed thoughts only, so it changes when one of them does. */
export const stripFor = (p: Pick<CruciblePanelProps, 'plannedMin' | 'paused' | 'guards'> & { parked: number }) =>
  `> block ${p.plannedMin} min | ${p.paused ? 'held | ' : ''}parked ${p.parked} | guards ${p.guards ? 'on' : 'off'}`

export function CruciblePanel(p: CruciblePanelProps) {
  const v3 = lookV3Enabled()
  const [parkOpen, setParkOpen] = useState(!!p.parkOpen)
  const timer = useRef<HTMLDivElement>(null)
  const parkKey = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName)) return
      if (e.key === 'p' || e.key === 'P') { e.preventDefault(); setParkOpen(true) }
      else if (e.key === ' ') { e.preventDefault(); if (p.paused) p.onResume(); else p.onPause() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (v3) {
    const held = p.paused
    return (
      <Zones
        ratio="default"
        first={{
          job: 'TIMER',
          flare: p.elapsedMin > 0 ? 1 : 0,
          children: (
            <section className="fv fv3 cr3" aria-label="Crucible session" data-paused={held ? 'true' : 'false'}>
              <div className="cr-field cr3-field" ref={timer} tabIndex={-1}>
                <DotTimer plannedMin={p.plannedMin} elapsedMin={p.elapsedMin} paused={p.paused} state="live" caption="Minutes held" />
              </div>
              <p className="cr-readout" data-testid="readout"><span className="fv-num">{p.elapsedMin}</span> min <span className="cr-dot" aria-hidden="true">·</span> {p.trackLabel}</p>
              <div className="cr-controls" role="group" aria-label="Session controls">
                {p.paused ? <Button size="md" onClick={p.onResume}>Resume (Space)</Button> : <Button size="md" onClick={p.onPause}>Pause (Space)</Button>}
                <Button ref={parkKey} size="md" onClick={() => setParkOpen(true)}>Park a thought (P)</Button>
                <HoldButton label="End session" size="md" onConfirm={p.onEnd} /><span className="fs-sub cr-hold-hint">Hold to end. The filled dots stay.</span>
              </div>
              <ParkField open={parkOpen} onClose={() => setParkOpen(false)} onFile={p.onFile} returnTo={() => timer.current} />
            </section>
          ),
        }}
        second={{
          job: 'BLOCK',
          peek: { name: 'Block', lamp: 'live', note: held ? 'held' : 'running' },
          children: (
            <div className="fv fv3 cr3">
              <p className="fv-title">{held ? 'Session held' : 'Session running'}</p>
              <p className="cr-ofline">of {p.plannedMin} min{held ? ', held' : ''}{p.cue ? ` · ${p.cue}` : ''}{p.wager ? ' · wager on' : ''}</p>
              <WhyLine><Lamp state="live" reason="this block's clock, one tick a minute" /><span aria-hidden="true">This block's clock.</span></WhyLine>
              {p.strikeLine && <Banner tone="sim">{p.strikeLine}</Banner>}
              <p className="fv-strip" aria-live="off">{stripFor({ plannedMin: p.plannedMin, paused: p.paused, guards: p.guards, parked: p.parked.length })}</p>
            </div>
          ),
        }}
        third={{
          job: 'PARKED',
          peek: { name: 'Parked', lamp: 'live', note: p.parked.length ? `${p.parked.length} filed in this block` : 'nothing parked yet' },
          children: (
            <div className="fv fv3 cr3">
              {p.parked.length > 0 ? (
                <ul className="cr-parked" aria-label="Parked in this block">
                  {p.parked.slice(-4).map((x, i) => <li key={`${i}-${x.text}`}>{x.text}<span className="dr-park-where">{x.stored ? 'in Parking' : 'this page only'}</span></li>)}
                </ul>
              ) : (
                <p className="fr-line">Nothing parked in this block. A stray thought goes here when you press P.</p>
              )}
            </div>
          ),
        }}
      />
    )
  }
  return (
    <section className="fv cr" aria-label="Crucible session" data-paused={p.paused ? 'true' : 'false'}>
      <div className="cr-field" ref={timer} tabIndex={-1}>
        <DotTimer plannedMin={p.plannedMin} elapsedMin={p.elapsedMin} paused={p.paused} state="live" caption="Minutes held" />
      </div>
      <div className="cr-main">
        <FocusHead title={p.paused ? 'Session held' : 'Session running'} />
        <div className="cr-read">
          <TickRing />
          <p className="cr-readout" data-testid="readout"><span className="fv-num">{p.elapsedMin}</span> min <span className="cr-dot" aria-hidden="true">·</span> {p.trackLabel}</p>
          <p className="cr-ofline">of {p.plannedMin} min{p.paused ? ', held' : ''}{p.cue ? ` · ${p.cue}` : ''}{p.wager ? ' · wager on' : ''}</p>
          <WhyLine><Lamp state="live" reason="this block's clock, one tick a minute" /><span aria-hidden="true">This block's clock.</span></WhyLine>
        </div>
        {p.strikeLine && <Banner tone="sim">{p.strikeLine}</Banner>}
        <div className="cr-controls" role="group" aria-label="Session controls">
          {p.paused ? <Button size="lg" onClick={p.onResume}>Resume (Space)</Button> : <Button size="lg" onClick={p.onPause}>Pause (Space)</Button>}
          <Button ref={parkKey} size="lg" onClick={() => setParkOpen(true)}>Park a thought (P)</Button>
          <HoldButton label="End session" size="md" onConfirm={p.onEnd} /><span className="fs-sub cr-hold-hint">Hold to end. The filled dots stay.</span>
        </div>
        <ParkField open={parkOpen} onClose={() => setParkOpen(false)} onFile={p.onFile} returnTo={() => timer.current} />
        {p.parked.length > 0 && (
          <ul className="cr-parked" aria-label="Parked in this block">
            {p.parked.slice(-2).map((x, i) => <li key={`${i}-${x.text}`}>{x.text}<span className="dr-park-where">{x.stored ? 'in Parking' : 'this page only'}</span></li>)}
          </ul>
        )}
        <p className="fv-strip" aria-live="off">{stripFor({ plannedMin: p.plannedMin, paused: p.paused, guards: p.guards, parked: p.parked.length })}</p>
      </div>
    </section>
  )
}

/** No block running: the resting dial and its WAITING lamp on the left, the title, one sentence, Go to Start and the capture line on the right. */
export function CrucibleIdlePanel({ onStart }: { onStart: () => void }) {
  if (lookV3Enabled()) {
    return (
      <Zones
        ratio="default"
        first={{
          job: 'TIMER',
          children: (
            <section className="fv fv3 cr3" aria-label="Crucible session">
              <div className="cr-field cr-field-idle cr3-field">
                <RestingDial />
                <WhyLine className="cr-field-why"><Lamp state="waiting" reason="no block started" /><span aria-hidden="true">No block started.</span></WhyLine>
              </div>
              <p className="fv-title" data-testid="readout">No session running</p>
              <div className="cr-controls"><Button size="lg" onClick={onStart}>Go to Start</Button></div>
            </section>
          ),
        }}
        second={{
          job: 'BLOCK',
          peek: { name: 'Block', lamp: 'waiting', note: 'no block started' },
          children: (
            <div className="fv fv3 cr3">
              <p className="cr-ofline">Nothing counts down. Start a block when you are ready.</p>
              <p className="fv-strip" aria-live="off">{'> no block'}</p>
            </div>
          ),
        }}
        third={{
          job: 'PARKED',
          peek: { name: 'Parked', lamp: 'waiting', note: 'no block started' },
          children: <div className="fv fv3 cr3"><p className="fr-line">Thoughts parked during a block are filed here and in Parking.</p></div>,
        }}
      />
    )
  }
  return (
    <section className="fv cr cr-idle" aria-label="Crucible session">
      <div className="cr-field cr-field-idle">
        <RestingDial />
        <WhyLine className="cr-field-why"><Lamp state="waiting" reason="no block started" /><span aria-hidden="true">No block started.</span></WhyLine>
      </div>
      <div className="cr-main cr-main-idle">
        <FocusHead title="No session running" testId="readout" />
        <p className="cr-ofline">Nothing counts down. Start a block when you are ready.</p>
        <div className="cr-controls"><Button size="lg" onClick={onStart}>Go to Start</Button></div>
        <p className="fv-strip" aria-live="off">{'> no block'}</p>
      </div>
    </section>
  )
}

export interface CrucibleProps {
  /** Called once when the block ends, for either reason; the Session view moves to Rest. */
  onEnd?: () => void
  port?: FocusPort
}

/** The Session track of the Crucible: the engine, the Park outlet, and the panel. Registered as the first track (tracks/crucible.track.tsx). */
export function Crucible({ onEnd, port }: CrucibleProps) {
  const out = port ?? activeFocusPort()
  const parked = useFocusViews((s) => s.parked)
  const [kept, setKept] = useState<boolean[]>([])
  const eng = useCrucibleEngine({
    tick: 'minute',
    onFinished: (f) => {
      useFocusViews.getState().setLast({
        at: Date.now(), kind: f.kind, line: f.line, heldMin: f.heldMin, counted: f.counted, length: f.length, trackLabel: f.trackLabel,
        parked: useFocusViews.getState().parked.length,
      })
      onEnd?.()
    },
  })
  const a = eng.active
  if (a === undefined) return <div className="fv fv-wait"><Skeleton /></div>
  if (a === null) {
    return (
      <CrucibleIdlePanel onStart={() => goFocus('start')} />
    )
  }
  const elapsed = Math.floor(elapsedS(a, eng.now) / 60)
  return (
    <CruciblePanel
      plannedMin={Math.round(a.durationS / 60)}
      elapsedMin={elapsed}
      paused={eng.paused}
      trackLabel={a.trackLabel}
      cue={a.cue}
      guards={a.guards}
      wager={a.wager}
      parked={parked.map((text, i) => ({ text, stored: kept[i] ?? false }))}
      strikeLine={eng.strikeLeft !== null ? `${eng.fg?.distraction ?? 'A distraction'} is in front. Close it in ${Math.ceil(eng.strikeLeft)} s or the session ends.` : null}
      onPause={eng.pause}
      onResume={eng.resume}
      onEnd={() => void eng.finish(a, 'ended')}
      onFile={(text) => {
        const i = useFocusViews.getState().parked.length
        useFocusViews.getState().addParked(text)
        void out.park(text).then((r) => setKept((k) => { const n = [...k]; n[i] = r.stored; return n }))
      }}
    />
  )
}
