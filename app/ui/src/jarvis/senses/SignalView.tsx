// Senses, Signal (spec 20.9.3): what the Wi-Fi channel itself says, as an SVG-only spectrum (51 amplitude bars) and the
// motion score as a dial on a log scale with the trace of the last 30 s under it. The old spectrogram and ripples are
// dropped on purpose, so the view holds no canvas. A reading is a number only with a lamp that says LIVE or SIMULATED; with
// no frame it is "--" and the reason. The narration is a fixed template (model.narration) checked by the copy lint: it
// states a score and a threshold and never a guess about a person.
//
//   left 720                                  right 550
//   spectrum   51 bars, short                 motion band   the band meter against its threshold
//   dial       the one focal form + trace     text waterfall
//   narration  one plate, 44 px               ledger        sensors, then events, in one card
//                                             Go to Presence, 44 px (both columns end on the same line)
// The honesty sentence is the Senses frame's fixed slot under the view, not part of this file.
import { useState } from 'react'
import { Lamp, showsNumber, type LampReading } from '../../shared/lamp'
import { Zones, lookV3Enabled } from '../../shell/v3'
import { AsciiTrace, AsciiWaterfall, MotionDial, MotionTrace, Spectrum } from './forms'
import { KeyBtn, Panel, effectiveSource, useNarrow, type SensesViewProps } from './parts'
import { bandView, cursorText, narration, sensorLamp, sourceReading, vitalText } from './model'
import './senses.css'
import './senses-v3.css'

const reading = (state: LampReading['state'], reason: string): LampReading => ({ state, since: null, reason })

export function SignalView({ state, onGo }: SensesViewProps) {
  const narrow = useNarrow()
  const [cursor, setCursor] = useState<number | null>(null)
  const source = effectiveSource(state)
  const f = state.latest
  const src = sourceReading(source, state.online, state.status?.hub?.error ?? null)
  const nums = showsNumber(src.state)
  const md = f?.motion_detail
  const band = bandView(md?.human_band)
  const amps = state.frames[state.frames.length - 1]?.amps ?? []
  const sim = source === 'simulated'
  const mlamp = reading(src.state, src.reason)
  const sensors = Object.entries(state.status?.sensors ?? {})
  const link = state.status?.link
  const events = (f?.events ?? []).slice(-5).reverse()
  const m = f?.metrics
  const num = (v: number | null | undefined, d: number, unit: string) => (nums && v != null && Number.isFinite(v) ? `${v.toFixed(d)}${unit}` : '--')
  // the ledger is the hub's report of this source: with no source it is WAITING, whatever the last frame left behind
  const ledgerState: LampReading['state'] = source !== 'none' && (sensors.length || events.length) ? (sim ? 'simulated' : 'live') : 'waiting'

  const specEl = (
        <Panel tag="CSI" title="Spectrum" reading={src} aside={<span className="js-mono-dim">51 subcarriers</span>} className="js-p-spec">
          <Spectrum amps={amps} source={source} cursor={cursor} onCursor={setCursor} />
          <p className="js-readline" aria-live="polite">{cursor != null ? cursorText(state.frames, cursor) : nums ? `${num(f?.csi?.rate_hz, 0, ' Hz')} frame rate, ${f?.csi?.rssi != null ? `${f.csi.rssi} dBm` : '-- dBm'}, ${num(f ? f.csi.fill_ratio * 100 : null, 1, ' %')} gaps filled` : src.reason}</p>
        </Panel>
  )
  const scoreEl = (
        <Panel
          tag="MOT" title="Motion score" reading={mlamp} className="js-p-trace"
          aside={<span className="js-state-word" data-state={md?.state ?? 'none'}>{nums ? (md?.state ?? '--') : '--'}</span>}
        >
          <div className="js-big-row">
            <MotionDial
              score={md?.score ?? null} threshold={md?.threshold ?? null} source={source}
              hub={<><b className="js-big js-big-num" data-testid="motion-score">{num(md?.score, 1, 'x')}</b><span className="js-mono-dim">score</span></>}
            />
            <div className="js-dial-side">
              <span className="js-mono-dim js-thr">threshold {num(md?.threshold, 2, 'x')}</span>
              <AsciiTrace hist={state.hist} source={source} width={narrow ? 22 : 40} />
              <span className="js-mono-dim">log scale, 0.5x to 20x</span>
            </div>
          </div>
          <MotionTrace hist={state.hist} source={source} />
        </Panel>
  )
  const narrEl = <p className="js-narration" aria-live="polite"><span className="js-tag">[SEN]</span> {narration(f, source)}</p>
  const bandEl = (
        <Panel tag="MOT" title="Motion band" reading={mlamp}>
          <div className="js-band" data-source={source}>
            <div className="js-band-head"><span>0.4 to 4 Hz, walking speed</span><b>{nums && band ? band.text : '--'}</b></div>
            <div className="js-meter" role="meter" aria-label="Motion band energy against its threshold" aria-valuemin={0} aria-valuemax={100} aria-valuenow={nums && band ? Math.round(band.pct) : 0}>
              <i style={{ width: `${nums && band ? band.pct : 0}%` }} />
              {band && <b style={{ left: `${band.gatePct}%` }} aria-hidden="true" />}
            </div>
            <p className="js-readline">
              baseline {nums ? (md?.baseline ?? '--') : '--'}, breathing {nums && md?.breathing_bpm ? `${md.breathing_bpm.toFixed(1)} per min` : '--'}{' '}
              <span className="js-exp">Experimental</span>
            </p>
          </div>
        </Panel>
  )
  const waterEl = (
        <Panel tag="CSI" title="Text waterfall" reading={src} aside={<span className="js-mono-dim">newest at the bottom</span>} className="js-p-water">
          <AsciiWaterfall frames={state.frames} source={source} rows={6} />
        </Panel>
  )
  const ledgerEl = (
        <Panel
          tag="SEN" title="Sensors and events" className="js-p-ledger"
          reading={reading(ledgerState, ledgerState === 'waiting' ? (source === 'none' ? 'no source is running' : 'the hub has not reported') : 'reported by the hub, from the engine')}
        >
          <div className="js-ledger">
            <p className="js-eyebrow">Sensors</p>
            {sensors.length === 0 ? <p className="js-ledger-empty">Nothing reported yet. Start a source in Presence.</p> : (
              <ul className="js-rows">
                {sensors.map(([k, v]) => (
                  <li key={k}>
                    <Lamp reading={reading(sensorLamp(v.state), v.detail || v.state)} subject={k} />
                    <span className="js-row-name">{k}</span>
                    <small className="js-mono-dim">{v.detail}</small>
                  </li>
                ))}
              </ul>
            )}
            {link?.frames_ok !== undefined && (
              <p className="js-readline">{nums ? `${Math.round(link.frames_ok).toLocaleString()} frames, ${link.crc_errors ?? 0} rejected by CRC, ${vitalText((link.loss_ratio ?? 0) * 100, 1, '%')} lost` : '--'}</p>
            )}
            {m && (
              <>
                <p className="js-eyebrow">Simulation check <span className="js-chip-sim">SIMULATED</span></p>
                <p className="js-readline">{m.mean_error_m != null ? `${(m.mean_error_m * 100).toFixed(0)} cm tracking error now` : 'no pairs yet'}; {m.truth_n} true, {m.tracked_n} tracked. Generated truth, not measured.</p>
              </>
            )}
            <p className="js-eyebrow">Events</p>
            {events.length === 0 ? <p className="js-ledger-empty">No events yet.</p> : (
              <ol className="js-log">
                {events.map((e) => <li key={e.id}><span className="js-tag">[SEN]</span> {e.text}</li>)}
              </ol>
            )}
          </div>
        </Panel>
  )
  const goEl = (
        <div className="js-go">
          <KeyBtn primary={source === 'none'} onClick={() => onGo?.('presence')} disabledReason={onGo ? undefined : 'Not wired in a specimen'}>Go to Presence</KeyBtn>
        </div>
  )

  if (lookV3Enabled()) {
    // Under the v3 look: the channel as it arrives (spectrum, its text waterfall, the plain sentence), what it says about motion
    // (score, band), then the hub's own ledger of sensors and events. Go to Presence ends the ledger.
    const plane = src.state === 'fault' ? 'fault' : src.state === 'live' ? 'live' : src.state === 'simulated' ? 'simulated' : 'waiting'
    const lplane = ledgerState === 'live' ? 'live' : ledgerState === 'simulated' ? 'simulated' : 'waiting'
    return (
      <div className="js js-signal js-v3" data-narrow={narrow ? 'true' : undefined} data-source={source}>
        <Zones ratio={[1.7, 1.05, 1.05]}
          first={{ job: 'SPECTRUM', chip: sim ? <span className="js-chip-sim">SIMULATED</span> : undefined, children: <div className="js3-col">{specEl}{bandEl}{narrEl}</div> }}
          second={{ job: 'MOTION', peek: { name: 'Motion score', lamp: plane, note: mlamp.reason }, children: <div className="js3-col js3-scroll">{scoreEl}</div> }}
          third={{ job: 'LEDGER', peek: { name: 'Sensors and events', lamp: lplane, note: lplane === 'waiting' ? 'the hub has not reported' : 'reported by the hub' }, children: <div className="js3-col">{waterEl}{ledgerEl}{goEl}</div> }} />
      </div>
    )
  }

  return (
    <div className="js js-signal" data-narrow={narrow ? 'true' : undefined} data-source={source}>
      <section className="js-left js-left-wide" aria-label="Spectrum and motion score">
        {specEl}
        {scoreEl}
        {narrEl}
      </section>

      <section className="js-right js-right-wide" aria-label="Link and sensors">
        {bandEl}
        {waterEl}
        {ledgerEl}
        {goEl}
      </section>
    </div>
  )
}
