// Senses, Signal (spec 20.9.3): what the Wi-Fi channel itself says, as an SVG-only spectrum (51 amplitude bars) and the
// motion score on a log scale. The old spectrogram and ripples are dropped on purpose, so the view holds no canvas. A
// reading is a number only with a lamp that says LIVE or SIMULATED; with no frame it is "--" and the reason.
// The narration is a fixed template (model.narration) checked by the copy lint: it states a score and a threshold and
// never a guess about a person.
import { useState } from 'react'
import { Lamp, showsNumber, type LampReading } from '../../shared/lamp'
import { AsciiTrace, AsciiWaterfall, MotionTrace, Spectrum } from './forms'
import { Panel, SensesSentence, effectiveSource, useNarrow, type SensesViewProps } from './parts'
import { SENSES_SENTENCE, bandView, cursorText, narration, sensorLamp, sourceReading, vitalText } from './model'
import './senses.css'

const reading = (state: LampReading['state'], reason: string): LampReading => ({ state, since: null, reason })

export function SignalView({ state }: SensesViewProps) {
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

  return (
    <div className="js js-signal" data-narrow={narrow ? 'true' : undefined} data-source={source}>
      <section className="js-left js-left-wide" aria-label="Spectrum and motion score">
        <Panel tag="CSI" title="Spectrum" reading={src} aside={<span className="js-mono-dim">51 subcarriers</span>} className="js-p-spec">
          <Spectrum amps={amps} source={source} cursor={cursor} onCursor={setCursor} />
          <p className="js-readline" aria-live="polite">{cursor != null ? cursorText(state.frames, cursor) : nums ? `${num(f?.csi?.rate_hz, 0, ' Hz')} frame rate, ${f?.csi?.rssi != null ? `${f.csi.rssi} dBm` : '-- dBm'}, ${num(f ? f.csi.fill_ratio * 100 : null, 1, ' %')} gaps filled` : src.reason}</p>
        </Panel>
        <Panel
          tag="MOT" title="Motion score" reading={mlamp} className="js-p-trace"
          aside={<span className="js-state-word" data-state={md?.state ?? 'none'}>{nums ? (md?.state ?? '--') : '--'}</span>}
        >
          <div className="js-big-row">
            <b className="js-big js-big-num" data-testid="motion-score">{num(md?.score, 1, 'x')}</b>
            <span className="js-mono-dim">threshold {num(md?.threshold, 2, 'x')}</span>
            <AsciiTrace hist={state.hist} source={source} width={40} />
          </div>
          <MotionTrace hist={state.hist} source={source} />
        </Panel>
        <p className="js-narration" aria-live="polite"><span className="js-tag">[SEN]</span> {narration(f, source)}</p>
      </section>

      <section className="js-right js-right-wide" aria-label="Link and sensors">
        <Panel tag="SEN" title="Sensors" reading={reading(sensors.length ? (sim ? 'simulated' : 'live') : 'waiting', sensors.length ? 'reported by the hub' : 'the hub has not reported')}>
          {sensors.length === 0 && <p className="js-note">Nothing reported yet. Start a source in Presence.</p>}
          <ul className="js-rows">
            {sensors.map(([k, v]) => (
              <li key={k}>
                <Lamp reading={reading(sensorLamp(v.state), v.detail || v.state)} subject={k} />
                <span className="js-row-name">{k}</span>
                <small className="js-mono-dim">{v.detail}</small>
              </li>
            ))}
          </ul>
          {link?.frames_ok !== undefined && (
            <p className="js-readline">{nums ? `${Math.round(link.frames_ok).toLocaleString()} frames, ${link.crc_errors ?? 0} rejected by CRC, ${vitalText((link.loss_ratio ?? 0) * 100, 1, '%')} lost` : '--'}</p>
          )}
        </Panel>

        <Panel tag="MOT" title="Motion band" reading={mlamp}>
          <div className="js-band" data-source={source}>
            <div className="js-band-head"><span>0.4 to 4 Hz, walking speed</span><b>{nums && band ? band.text : '--'}</b></div>
            <div className="js-meter" role="meter" aria-label="Motion band energy against its threshold" aria-valuemin={0} aria-valuemax={100} aria-valuenow={nums && band ? Math.round(band.pct) : 0}>
              <i style={{ width: `${nums && band ? band.pct : 0}%` }} />
              {band && <b style={{ left: `${band.gatePct}%` }} aria-hidden="true" />}
            </div>
            <p className="js-readline">
              baseline {md?.baseline ?? '--'}, breathing {nums && md?.breathing_bpm ? `${md.breathing_bpm.toFixed(1)} per min` : '--'}{' '}
              <span className="js-exp">Experimental</span>
            </p>
          </div>
        </Panel>

        {m && (
          <Panel tag="SIM" title="Simulation check" reading={reading('simulated', 'generated truth, not measured')}>
            <p className="js-readline">{m.mean_error_m != null ? `${(m.mean_error_m * 100).toFixed(0)} cm tracking error now` : 'no pairs yet'}; {m.truth_n} true, {m.tracked_n} tracked</p>
          </Panel>
        )}

        <Panel tag="CSI" title="Text waterfall" reading={src} aside={<span className="js-mono-dim">newest at the bottom</span>} className="js-p-water">
          <AsciiWaterfall frames={state.frames} source={source} />
        </Panel>

        <Panel tag="SEN" title="Events" reading={reading(events.length ? (sim ? 'simulated' : 'live') : 'waiting', events.length ? 'from the engine' : 'none yet')} className="js-p-events">
          {events.length === 0 ? <p className="js-note">No events yet.</p> : (
            <ol className="js-log">
              {events.map((e) => <li key={e.id}><span className="js-tag">[SEN]</span> {e.text}</li>)}
            </ol>
          )}
        </Panel>
        <SensesSentence text={SENSES_SENTENCE} />
      </section>
    </div>
  )
}
