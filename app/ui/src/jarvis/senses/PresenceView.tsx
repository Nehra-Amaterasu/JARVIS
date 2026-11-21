// Senses, Presence (spec 20.9.3, A.J03). One canvas, no document scroll at 1366 x 768: the JARVIS content box is 1286 x 624
// (the 652 the shell leaves, less the Senses frame's 28 px sentence slot).
//
//   left 720                                              right 550
//   controls 48   source, scenarios, pause, 3D, settings  presence core 292   the gauge, its words, the evidence
//   terrain 372   the 680 x 340 canvas, or the 3D twin    motion tape 300      seven days, or the isometric floor plan
//   link row 112  LinkCube vitals, the 51-dot matrix
//   prediction 56 Predicting: the place it names, then two pairs: Right and No, I'm at; the fan note and its rocker
//
// The terrain is the only canvas; pressing 3D unmounts it and mounts the twin in the same box, so the view never holds two.
// Keys (focus inside the view, not in a field): P pauses reading in this window, M swaps the tape and the floor plan,
// 3 swaps the terrain and the twin, Escape lets a frozen frame go. Under 900 px it is one column that scrolls inside itself.
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArtSlot } from '../../art/ArtSlot'
import { fanView, predictionWording, correct, setFan } from '../../lib/teachTrain'
import { readBelief, shownZones, topZone, TELL_P, type BeliefZone } from '../../lib/belief'
import { Rocker, Switch } from '../../shared/kit/Hardware'
import { Lamp, showsNumber, type LampReading } from '../../shared/lamp'
import { CoreDrawer } from '../core/CoreDrawer'
import { Zones, lookV3Enabled } from '../../shell/v3'
import { DEFAULT_LAYERS, LAYERS } from '../../twin/layers'
import type { BeliefSummary, Framing, Layer } from '../../twin/SpatialTwin'
import { AsciiTrace, ChannelMatrix, LinkCube, ProbabilityArc } from './forms'
import { FloorPlan } from './FloorPlan'
import { MotionTape } from './MotionTape'
import { SignalTerrain } from './SignalTerrain'
import { Choice, KeyBtn, Panel, SensesSelect, effectiveSource, useNarrow, type SensesViewProps } from './parts'
import {
  bandOf, cursorText, linkVitals, scenarioWord, sourceReading, teachRings,
  type Frame, type Source,
} from './model'
import type { SensesState, SensesStore } from './store'
import './senses.css'
import './senses-v3.css'

const TwinStage = lazy(() => import('./TwinStage'))

/* ------------------------------------------------------------------ controls */
function Controls({ state, store, source, toast, stage, setStage, onSettings, fixture }: {
  state: SensesState; store: SensesStore; source: Source; toast?: SensesViewProps['toast']; stage: 'terrain' | 'twin'
  setStage: (s: 'terrain' | 'twin') => void; onSettings: () => void; fixture?: boolean
}) {
  const hub = state.status?.hub
  const run = async (body: Record<string, unknown>) => {
    if (fixture) return toast?.('A specimen does not start a source.', 'info')
    try { await store.start(body) } catch (e) { toast?.((e as Error).message, 'fault') }
  }
  const scen = hub?.scenarios ?? ['evening', 'walk', 'still', 'empty']
  const mode = hub?.running ? hub.mode : null
  return (
    <div className="js-controls" role="group" aria-label="Source and view">
      <KeyBtn primary={!hub?.running} className="js-start" pressed={mode === 'hardware' ? true : undefined} onClick={() => void run({ mode: 'hardware' })} title="Read frames from the ESP32 board">
        {mode === 'hardware' ? 'ESP32' : 'Start ESP32'}
      </KeyBtn>
      <SensesSelect
        className="js-scen" label="Simulated scenario" placeholder="Simulate..." value={mode === 'simulation' ? (hub?.scenario ?? '') : ''} lit={mode === 'simulation'}
        options={scen.map((id) => ({ id, label: scenarioWord(id) }))} onChange={(id) => { if (id) void run({ mode: 'simulation', scenario: id }) }}
      />
      <span className="js-ctl-pair">
        <span className="js-ctl-label" aria-hidden="true">Sensing</span>
        <Rocker on={!state.paused} onChange={(on) => store.setPaused(!on)} label="Sensing" />
      </span>
      <KeyBtn pressed={stage === 'twin'} onClick={() => setStage(stage === 'twin' ? 'terrain' : 'twin')} disabledReason={fixture ? 'The 3D twin is not drawn in a specimen' : undefined} aria-keyshortcuts="3" title="Swap the terrain for the 3D twin">
        3D
      </KeyBtn>
      <KeyBtn onClick={onSettings} className="js-key-icon" aria-label="Twin settings" title="Twin settings: camera, framing, heat and layers">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2 4h8M12 4h2M2 8h2M6 8h8M2 12h6M10 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" /><circle cx="11" cy="4" r="1.6" fill="currentColor" /><circle cx="5" cy="8" r="1.6" fill="currentColor" /><circle cx="9" cy="12" r="1.6" fill="currentColor" /></svg>
      </KeyBtn>
      <span className="js-sr" aria-live="polite">{source === 'none' ? 'No frames' : source === 'simulated' ? 'Simulated frames' : 'Live frames'}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ the prediction strip */
function PredictionStrip({ state, source, toast }: { state: SensesState; source: Source; toast?: SensesViewProps['toast'] }) {
  const [busy, setBusy] = useState(false)
  const f = state.latest
  const status = state.train?.status ?? 'predicting'
  const b = readBelief(f?.belief ?? state.status?.belief)
  const top = b?.state === 'empty' ? null : topZone(b)
  const shown = b?.state === 'empty' ? { id: 'out_of_room', name: 'no motion seen' } : top && top.p >= TELL_P ? { id: top.id, name: top.name } : null
  const fan = fanView((f?.motion_detail as { fan?: unknown } | undefined)?.fan)
  const live = source === 'live'
  const send = async (zone: string, confirmed: boolean) => {
    setBusy(true)
    try {
      const r = await correct(zone, confirmed)
      toast?.(confirmed ? `Kept: the last ${Math.round(r.seconds)} s are ${r.name}` : `Corrected: the last ${Math.round(r.seconds)} s are ${r.name}`, 'live')
    } catch (e) { toast?.((e as Error).message, 'fault') } finally { setBusy(false) }
  }
  const flip = async (on: boolean) => {
    try {
      const r = await setFan(on)
      if (!r.ok) toast?.(r.error ?? 'The relay board did not switch the fan', 'fault')
    } catch (e) { toast?.((e as Error).message, 'fault') }
  }
  const reading: LampReading = source === 'none' ? { state: 'waiting', since: null, reason: 'no frames' } : { state: source === 'live' ? 'live' : 'simulated', since: null, reason: status === 'answering' ? 'model answers' : 'a prediction, not an answer' }
  return (
    <div className="js-pred" role="group" aria-label="Predicting">
      <div className="js-pred-state">
        <Lamp reading={reading} showLabel={false} subject="Prediction" />
        <span className="js-pred-text" data-answering={status === 'answering' ? 'true' : undefined}>
          {predictionWording(status, source === 'none' ? null : shown?.name ?? (b ? "can't tell" : null))}
        </span>
      </div>
      <div className="js-pair js-tray" role="group" aria-label="Corrections">
        <KeyBtn onClick={() => shown && void send(shown.id, true)} disabledReason={!live ? 'Needs frames from the board' : !shown || busy ? 'Nothing to confirm yet' : undefined} aria-label="Right" title="Right: label the last 10 s as this place">Right</KeyBtn>
        <SensesSelect
          label="No, I'm at..." placeholder="No, I'm at..." value="" up disabledReason={!live ? 'Needs frames from the board' : busy ? 'Saving...' : !state.zones.length ? 'No zone map yet' : undefined}
          options={state.zones.map((z) => ({ id: z.id, label: z.name }))} onChange={(z) => { if (z) void send(z, false) }}
        />
      </div>
      <div className="js-pair js-tray js-pred-fanbox" role="group" aria-label="Fan control">
        <span className="js-pred-fan" title="What the engine reports; the switch drives the fan through the relay board">{fan.text.replace(/^Fan:\s*/i, '')}</span>
        <span className="js-ctl-label" aria-hidden="true">Fan</span>
        <Rocker on={fan.on === true} onChange={(on) => void flip(on)} label="Fan" />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ the presence core */
function PresenceCore({ state, source, onGo }: { state: SensesState; source: Source; onGo?: SensesViewProps['onGo'] }) {
  const f = state.latest
  const p = source === 'none' ? null : f?.presence?.p ?? null
  const band = bandOf(p)
  const trusted = state.train?.status === 'answering' && source !== 'none'
  const rings = teachRings(state.readiness)
  const drill = rings.find((r) => r.id === 'drill')
  const md = f?.motion_detail
  const turning = source !== 'none' && !state.paused && md?.score != null && md.threshold != null && md.score >= md.threshold
  const orbit = turning ? Math.max(2.5, Math.min(14, 14 / Math.max(1, (md!.score as number) / (md!.threshold as number)))) : null
  const ev = f?.presence?.evidence ?? {}
  const rows: { id: string; name: string; v: number; max: number; against: boolean }[] = [
    { id: 'wifi', name: 'Motion evidence', v: Math.abs(ev.wifi ?? 0), max: 1, against: false },
    { id: 'quiet', name: 'Quiet evidence', v: Math.abs(ev.absence ?? 0), max: 0.15, against: true },
  ]
  const reading = sourceReading(source, state.online, state.status?.hub?.error ?? null)
  return (
    <Panel tag="SEN" title="Presence core" reading={reading} className="js-core" aside={source === 'simulated' ? <span className="js-chip-sim">SIMULATED</span> : undefined}>
      <div className="js-core-body" data-source={source}>
        <div className="js-art" aria-hidden="true"><ArtSlot id="art.senses.spindle" fit="contain" ratio={1} /></div>
        <ProbabilityArc band={band} p={p} trusted={trusted} source={source} orbitS={orbit} drillDays={state.readiness?.drill_days ?? null} gateDays={drill?.of} />
        <div className="js-core-text">
          <ArcWords band={band} p={p} trusted={trusted} drillDays={state.readiness?.drill_days ?? null} gateDays={drill?.of} source={source} />
          <ul className="js-evidence" aria-label="Evidence right now">
            {rows.map((r) => (
              <li key={r.id}>
                <span>{r.name}</span>
                <span className="js-ev-bar" data-against={r.against ? 'true' : undefined} data-source={source}><i style={{ width: `${source === 'none' ? 0 : Math.min(100, (r.v / r.max) * 100)}%` }} /></span>
              </li>
            ))}
          </ul>
          <p className="js-zones-line">{state.readiness?.zones_trusted ? 'Zones are trusted: the drill and the held-out check passed.' : 'Zones are not trusted yet: a place is named only after the drill.'}</p>
          {onGo && <KeyBtn onClick={() => onGo('teach')} className="js-key-sm">Teach it my room</KeyBtn>}
        </div>
      </div>
    </Panel>
  )
}

function ArcWords({ band, p, trusted, drillDays, gateDays, source }: { band: ReturnType<typeof bandOf>; p: number | null; trusted: boolean; drillDays: number | null; gateDays?: number; source: Source }) {
  const gate = gateDays ?? 7
  if (!band || source === 'none') return <div className="js-arc-words"><b className="js-big" data-word="none">NO SIGNAL</b><span className="js-prov">no frames, so no estimate</span></div>
  if (!trusted) {
    return (
      <div className="js-arc-words">
        <b className="js-big" data-word="predicting">PREDICTING</b>
        <span className="js-prov">signal estimate, {drillDays == null ? 'drill days not read' : `${drillDays} of ${gate} drill days`}</span>
      </div>
    )
  }
  const showNum = showsNumber(source === 'live' ? 'live' : 'simulated')
  return (
    <div className="js-arc-words">
      <b className="js-big" data-word="band">{showNum && p != null ? `${Math.round(p * 100)} %` : band.toUpperCase()}</b>
      <span className="js-prov">model estimate, held-out day passed</span>
    </div>
  )
}

/* ------------------------------------------------------------------ the view */
const PRESENCE_KEYS = new Set(['p', 'm', '3'])

export function PresenceView({ state, store, toast, onGo, fixture }: SensesViewProps) {
  const root = useRef<HTMLDivElement>(null)
  const narrow = useNarrow()
  const [stage, setStage] = useState<'terrain' | 'twin'>('terrain')
  const [side, setSide] = useState<'tape' | 'plan'>('plan')
  const [cursor, setCursor] = useState<number | null>(null)
  const [frozen, setFrozen] = useState<Frame[] | null>(null)
  const [settings, setSettings] = useState(false)
  const [camera, setCamera] = useState<'3d' | 'plan'>('3d')
  const [framing, setFraming] = useState<Framing>('room')
  const [heat, setHeat] = useState<'live' | 'learned'>('live')
  const [layers, setLayers] = useState<Record<Layer, boolean>>({ ...DEFAULT_LAYERS, truth: false })
  const [resetKey, setResetKey] = useState(0)
  const [est, setEst] = useState<BeliefSummary | null>(null)

  const source = effectiveSource(state)
  const frames = frozen ?? state.frames
  const reading = sourceReading(source, state.online, state.status?.hub?.error ?? null)
  const belief = readBelief(state.latest?.belief ?? state.status?.belief)
  const zones: BeliefZone[] = useMemo(() => shownZones(belief), [belief])
  const trustedZones = state.readiness?.zones_trusted === true
  const hasHouse = !!state.room?.house && (state.room.house.areas.length > 0 || state.room.house.fixtures.length > 0)
  const tape = source === 'simulated' ? store.tapeSim : store.tapeLive
  const week = useMemo(() => tape.week(state.now || Date.now()), [tape, state.tapeRev, state.now, source]) // eslint-disable-line react-hooks/exhaustive-deps
  const vitals = linkVitals(state.latest, state.status?.link, state.lastAt, state.now)
  const amps = frames[frames.length - 1]?.amps ?? []

  const freeze = useCallback(() => setFrozen((f) => (f ? null : state.frames)), [state.frames])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFrozen(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const onRootKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return
    const t = e.target as HTMLElement
    if (!root.current?.contains(t) || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.closest('[role="listbox"], [role="combobox"]') || t.isContentEditable) return
    const k = e.key.toLowerCase()
    if (!PRESENCE_KEYS.has(k)) return
    e.preventDefault()
    if (k === 'p') store.setPaused(!state.paused)
    else if (k === 'm') setSide((s) => (s === 'tape' ? 'plan' : 'tape'))
    else if (!fixture) setStage((s) => (s === 'twin' ? 'terrain' : 'twin'))
  }
  const switchHeat = (h: 'live' | 'learned') => { setHeat(h); store.askHeat(h) }

  const controlsEl = <Controls state={state} store={store} source={source} toast={toast} stage={stage} setStage={setStage} onSettings={() => setSettings(true)} fixture={fixture} />
  const wellEl = (
        <div className="js-well" data-scene="immersive">
          <div className="js-stage">
            {stage === 'terrain' ? (
              <SignalTerrain frames={frames} source={source} paused={state.paused} cursor={cursor} onCursor={setCursor} frozen={!!frozen} onFreeze={freeze} />
            ) : (
              <div className="js-twin">
                <Suspense fallback={<p className="js-twin-note" role="status">Loading the 3D twin...</p>}>
                  <TwinStage store={store} room={state.room} camera={camera} framing={framing} layers={layers} resetKey={resetKey} onEstimate={setEst} />
                </Suspense>
                {est && layers.estimate && <p className="js-est" role="note">{est.label}: dots are probability, not a person.</p>}
              </div>
            )}
            {stage === 'terrain' && <span className="js-ruler" aria-hidden="true">1 {"|''''".repeat(10)}| <i>{'<>'}</i> 51</span>}
            <span className="js-hud" data-c="tl" aria-hidden="true">{stage === 'terrain' ? 'SIGNAL TERRAIN' : 'SPATIAL TWIN'}</span>
            {stage === 'terrain' && <span className="js-hud" data-c="tr" aria-hidden="true">51 SUBCARRIERS x 24 FRAMES</span>}
          </div>
          <div className="js-foot">
            <span className="js-foot-tag">MOTION</span>
            <AsciiTrace hist={state.hist} source={source} />
            <span className="js-foot-read" aria-live="polite">{cursor != null && stage === 'terrain' ? cursorText(frames, cursor) : reading.reason}</span>
          </div>
        </div>
  )
  const linkEl = (
        <div className="js-linkrow">
          <LinkCube source={source} vitals={vitals} reading={reading} />
          <div className="js-chan">
            <div className="js-chan-head"><span className="js-tag">[CSI]</span> Channel, 51 subcarriers</div>
            <ChannelMatrix amps={amps} source={source} cursor={cursor} />
          </div>
        </div>
  )
  const predEl = <PredictionStrip state={state} source={source} toast={toast} />
  const coreEl = <PresenceCore state={state} source={source} onGo={onGo} />
  const sideEl = (
        <Panel
          tag="SEN" title={side === 'tape' ? 'Motion tape' : 'Floor plan'} className="js-side"
          reading={{ state: source === 'live' ? 'live' : source === 'simulated' ? 'simulated' : 'waiting', since: null, reason: side === 'tape' ? 'seen by this window only' : 'the layout in room.json' }}
          aside={<Choice label="Form" value={side} onChange={setSide} options={[{ id: 'plan', label: 'Plan' }, { id: 'tape', label: 'Tape' }]} className="js-choice-sm" />}
        >
          {side === 'tape'
            ? <MotionTape week={week} source={source} />
            : (
              <div className="js-plan-box2">
                <FloorPlan room={state.room} source={source} zones={zones} trusted={trustedZones} />
                <p className="js-tape-caption">Rings are zones, not positions.{state.room?.measured ? '' : ' The layout is estimated, not measured.'}</p>
              </div>
            )}
        </Panel>
  )
  const drawerEl = (
      <CoreDrawer open={settings} onClose={() => setSettings(false)} title="Twin settings" tag="SEN">
        <div className="js-settings">
          <p className="js-note">These apply to the 3D twin. Press 3D to see it; the terrain stays the default.</p>
          <div className="js-set-row"><span>Camera</span><Choice label="Camera" value={camera} onChange={setCamera} options={[{ id: '3d', label: '3D' }, { id: 'plan', label: 'Plan' }]} /></div>
          {hasHouse && <div className="js-set-row"><span>Framing</span><Choice label="Framing" value={framing} onChange={setFraming} options={[{ id: 'room', label: 'My room' }, { id: 'house', label: 'Whole house' }]} /></div>}
          <div className="js-set-row"><span>Heat</span><Choice label="Heat layer" value={heat} onChange={switchHeat} options={[{ id: 'live', label: 'Live' }, { id: 'learned', label: 'Learned' }]} /></div>
          <div className="js-set-row"><span>Camera position</span><KeyBtn onClick={() => setResetKey((k) => k + 1)}>Reset camera</KeyBtn></div>
          <ul className="js-layers" aria-label="Layers">
            {LAYERS.filter((l) => l.id !== 'house' || hasHouse).map((l) => (
              <li key={l.id}>
                <Switch checked={layers[l.id]} onChange={(on) => setLayers((s) => ({ ...s, [l.id]: on }))} label={l.id === 'truth' ? 'Simulation truth markers' : l.label} />
              </li>
            ))}
          </ul>
        </div>
      </CoreDrawer>
  )

  if (lookV3Enabled()) {
    // Under the v3 look the same pieces sit in three trays: start the source and watch the signal (the act and its object, with
    // the one-tap corrections under it), the reading the model makes of it, then the room it is read against (plan or tape, the
    // link and its 51 subcarriers). Nothing is added: a simulated source is still stamped SIMULATED wherever it is drawn.
    const plane = source === 'live' ? 'live' : source === 'simulated' ? 'simulated' : 'waiting'
    return (
      <div className="js js-presence js-v3" ref={root} data-narrow={narrow ? 'true' : undefined} data-stage={stage} data-source={source} onKeyDown={onRootKey}>
        <Zones ratio={[1.85, 1, 1.05]}
          first={{ job: 'SENSE', chip: source === 'simulated' ? <span className="js-chip-sim">SIMULATED</span> : undefined, children: <div className="js3-col js3-sense">{controlsEl}{wellEl}{predEl}</div> }}
          second={{ job: 'READING', peek: { name: 'Presence reading', lamp: reading.state === 'fault' ? 'fault' : plane, note: reading.reason }, children: <div className="js3-col">{coreEl}</div> }}
          third={{ job: 'ROOM', peek: { name: side === 'tape' ? 'Motion tape' : 'Floor plan, link', lamp: plane, note: side === 'tape' ? 'seen by this window only' : 'the layout in room.json' }, children: <div className="js3-col js3-scroll">{sideEl}{linkEl}</div> }} />
        {drawerEl}
      </div>
    )
  }

  return (
    <div className="js js-presence" ref={root} data-narrow={narrow ? 'true' : undefined} data-stage={stage} data-source={source} onKeyDown={onRootKey}>
      <section className="js-left" aria-label="Signal">
        {controlsEl}
        {wellEl}
        {linkEl}
        {predEl}
      </section>

      <section className="js-right" aria-label="Presence">
        {coreEl}
        {sideEl}
      </section>

      {drawerEl}
    </div>
  )
}
