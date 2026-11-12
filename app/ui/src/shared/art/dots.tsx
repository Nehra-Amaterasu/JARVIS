// Stipple Ring and Dot-Matrix Meter (spec 7.5 #33, #36). Both are read-only, both draw "filled" as a disc and
// "remaining" as a ring (the same shape rule as the dot timer), and both take a required `state`, so no number is
// drawn without saying whether it is live. WAITING draws every dot as a ring and prints "--"; SIMULATED stamps
// the diamond and the word. Static: no animation at all, so Calm and forced colours see the same picture.
import { useMemo } from 'react'
import { Figure } from './frame'
import { METER_COLS, METER_ROWS, MAX_STIPPLE, meterDots, stippleDots } from './geometry'
import { StateMark, STATE_WORD, type ArtState } from './state'

const reading = (s: ArtState) => s === 'live' || s === 'simulated'

export interface StippleRingProps {
  /** 0..1 share filled; ignored unless the state is a reading. */
  frac: number
  /** The centre value as text ("62 %"). */
  value: string
  state: ArtState
  /** Dot count, 12 to 120. */
  count?: number
  size?: number
  caption: string
  reason?: string
}

export function StippleRing({ frac, value, state, count = 60, size = 160, caption, reason }: StippleRingProps) {
  const c = size / 2
  const dots = useMemo(() => stippleDots(reading(state) ? frac : 0, Math.min(count, MAX_STIPPLE), c, c, c - 10), [frac, count, c, state])
  return (
    <Figure component="stipple-ring" state={state} caption={caption} reason={reason}>
      <svg className="art-svg" viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`${caption}: ${reading(state) ? value : 'no reading'}, ${STATE_WORD[state].toLowerCase()}`}>
        {dots.map((d, i) => (d.on ? <circle key={i} className="art-solid" cx={d.x} cy={d.y} r={2.6} /> : <circle key={i} className="art-stroke art-dim-ring" cx={d.x} cy={d.y} r={2.4} />))}
        <text className="art-num" x={c} y={c} textAnchor="middle" dominantBaseline="middle">{reading(state) ? value : '--'}</text>
      </svg>
    </Figure>
  )
}

export interface DotMatrixMeterProps {
  /** null = no signal at all. */
  level: number | null
  min: number
  max: number
  unit?: string
  state: ArtState
  caption: string
  reason?: string
}

const PITCH = 12

export function DotMatrixMeter({ level, min, max, unit = '', state, caption, reason }: DotMatrixMeterProps) {
  const live = reading(state) && level !== null
  const m = useMemo(() => meterDots(live ? level : null, min, max), [live, level, min, max])
  const w = METER_COLS * PITCH
  const h = METER_ROWS * PITCH
  return (
    <Figure component="dot-matrix-meter" state={state} caption={caption} reason={reason}>
      <div className="art-meter">
        <svg
          className="art-svg"
          viewBox={`0 0 ${w} ${h}`}
          width={w}
          height={h}
          role="meter"
          aria-label={caption}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={live ? level! : undefined}
          aria-valuetext={live ? `${level}${unit}` : 'no reading'}
        >
          {m.dots.map((d, i) =>
            d.on ? (
              <circle key={i} className="art-solid" data-on="" cx={d.col * PITCH + PITCH / 2} cy={d.row * PITCH + PITCH / 2} r={4} />
            ) : (
              <circle key={i} className="art-stroke art-dim-ring" cx={d.col * PITCH + PITCH / 2} cy={d.row * PITCH + PITCH / 2} r={3.6} />
            ),
          )}
        </svg>
        <p className="art-readout art-mono" data-meter-text="">
          {state === 'simulated' ? <StateMark state="simulated" /> : null}
          <span>{live ? `${level}${unit}` : '--'}</span>
          <span className="art-list-meta">{` ${min} to ${max}${unit}`}</span>
        </p>
      </div>
    </Figure>
  )
}
