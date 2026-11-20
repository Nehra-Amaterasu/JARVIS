// Drawn data forms of design language v3 (spec 4.1 rule 10, spec 6): the Dial (a ring) and the Gauge (a 270 degree arc with a
// needle). Both draw a reading ONLY when its state is LIVE or SIMULATED and a finite number came with it. Every other state
// is the designed WAITING pose: a dotted ghost track, a dash, the reason as text, and the state chip. Nothing is invented to
// fill the space, and a number always carries its lamp.
import { useEffect, useId, useState } from 'react'
import { LAMP_WORD, showsValue, type LampState } from '../Lamp'
import { Chip } from './Data'
import { Glint } from './Plate'
import { cx } from '../util'
import '../glass.css'

/** A point on a circle; degrees are SVG degrees (0 = right, growing clockwise because y points down). */
export function polar(cx0: number, cy0: number, r: number, deg: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180
  return { x: cx0 + r * Math.cos(a), y: cy0 + r * Math.sin(a) }
}

/** An SVG arc path from `from` to `to` degrees, clockwise. */
export function arcPath(cx0: number, cy0: number, r: number, from: number, to: number): string {
  const a = polar(cx0, cy0, r, from)
  const b = polar(cx0, cy0, r, to)
  const sweep = (((to - from) % 360) + 360) % 360 || 360
  const r2 = (n: number) => Math.round(n * 100) / 100
  return `M${r2(a.x)} ${r2(a.y)}A${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${r2(b.x)} ${r2(b.y)}`
}

/** The share of the scale a reading fills, 0 to 1. Null when it cannot be drawn (no number, no scale). */
export function fraction(value: number | null | undefined, max: number): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || !(max > 0)) return null
  return Math.min(1, Math.max(0, value / max))
}

/** True once the first paint is done, so an arc can sweep from empty to its reading. */
function useReady(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setReady(true))
    return () => window.cancelAnimationFrame(id)
  }, [])
  return ready
}

const fmt = (n: number, digits: number) => n.toFixed(digits)

export interface FormProps {
  /** What it measures, in capitals: GPU MEMORY, COUNT. */
  name: string
  state: LampState
  value?: number | null
  max: number
  unit?: string
  /** Decimals in the printed number. */
  digits?: number
  /** Why, as text. WAITING says what is awaited; a SIMULATED reading says it is generated. */
  reason?: string
  /** Cross the form with a glint once (the place changed). */
  glint?: string | number
  className?: string
}

// ---------------------------------------------------------------------------------------------- Dial

export interface DialProps extends FormProps {
  /** Side of the square it draws in, px. The numeral scales with it and never falls under 14 px. */
  size?: number
}

export function Dial({ name, state, value, max, unit, digits = 0, reason, glint, size = 96, className }: DialProps) {
  const ready = useReady()
  const frac = showsValue(state) ? fraction(value, max) : null
  const drawn = frac !== null
  const sw = Math.max(6, Math.round(size / 12))
  const r = size / 2 - sw
  const c = size / 2
  const dot = polar(c, c, r, 225)
  const gid = useId()
  const why = reason ?? (state === 'waiting' ? 'no report' : state === 'simulated' ? 'generated sample' : undefined)
  const label = drawn ? `${name}: ${fmt(value as number, digits)} of ${fmt(max, digits)}${unit ? ` ${unit}` : ''}, ${LAMP_WORD[state]}` : `${name}: no reading, ${LAMP_WORD[state]}${why ? `, ${why}` : ''}`
  return (
    <figure className={cx('v3-dial', className)} data-state={state} data-pose={drawn ? 'drawn' : 'waiting'}>
      <div className="v3-dial-face" style={{ ['--v3-size' as string]: `${size}px`, ['--v3-fs' as string]: `${Math.max(14, Math.round(size * 0.26))}px` }}>
        <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
          <defs>
            <radialGradient id={gid} className="v3-spec">
              <stop offset="0" />
              <stop offset="1" />
            </radialGradient>
          </defs>
          <circle className="v3-track" cx={c} cy={c} r={r} strokeWidth={sw} />
          {drawn && (
            <circle
              className="v3-arc"
              cx={c}
              cy={c}
              r={r}
              strokeWidth={sw}
              pathLength={100}
              strokeDasharray={`${ready ? Math.round((frac as number) * 1000) / 10 : 0} 100`}
              transform={`rotate(-90 ${c} ${c})`}
            />
          )}
          {drawn && <circle cx={dot.x} cy={dot.y} r={Math.max(6, Math.round(size * 0.11))} fill={`url(#${gid})`} />}
        </svg>
        <span className="v3-dial-num" aria-hidden="true">
          {drawn ? fmt(value as number, digits) : '–'}
          {drawn && unit && <small>{unit}</small>}
        </span>
        {glint !== undefined && <Glint on={glint} />}
      </div>
      <figcaption className="v3-dial-cap">
        <span className="v3-dial-name">{name}</span>
        <Chip state={state} />
        {why && <p className="v3-dial-why">{why}</p>}
      </figcaption>
    </figure>
  )
}

// ---------------------------------------------------------------------------------------------- Gauge

const G = { cx: 80, cy: 76, r: 60, from: 135, to: 405 } as const

export function Gauge({ name, state, value, max, unit, digits = 1, reason, glint, className }: FormProps) {
  const ready = useReady()
  const frac = showsValue(state) ? fraction(value, max) : null
  const drawn = frac !== null
  const gid = useId()
  const why = reason ?? (state === 'waiting' ? 'no report' : state === 'simulated' ? 'generated sample' : undefined)
  const path = arcPath(G.cx, G.cy, G.r, G.from, G.to)
  const ang = G.from + (ready && drawn ? (frac as number) : 0) * (G.to - G.from)
  const tip = polar(G.cx, G.cy, G.r - 8, ang)
  const spec = polar(G.cx, G.cy, G.r - 8, ang - 4)
  const label = drawn ? `${name}: ${fmt(value as number, digits)} of ${fmt(max, digits)}${unit ? ` ${unit}` : ''}, ${LAMP_WORD[state]}` : `${name}: no reading, ${LAMP_WORD[state]}${why ? `, ${why}` : ''}`
  return (
    <figure className={cx('v3-gauge', className)} data-state={state} data-pose={drawn ? 'drawn' : 'waiting'}>
      <div className="v3-gauge-face">
        <svg viewBox="0 0 160 132" role="img" aria-label={label}>
          <defs>
            <radialGradient id={gid} className="v3-spec">
              <stop offset="0" />
              <stop offset="1" />
            </radialGradient>
          </defs>
          <path className="v3-track" d={path} strokeWidth={8} pathLength={100} />
          {drawn && <path className="v3-arc" d={path} strokeWidth={8} pathLength={100} strokeDasharray={`${ready ? Math.round((frac as number) * 1000) / 10 : 0} 100`} />}
          {drawn && (
            <>
              <line className="v3-needle" x1={G.cx} y1={G.cy} x2={tip.x} y2={tip.y} strokeWidth={3} />
              <circle className="v3-hub" cx={G.cx} cy={G.cy} r={5} />
              <circle cx={spec.x} cy={spec.y} r={3} fill={`url(#${gid})`} />
            </>
          )}
        </svg>
        <span className="v3-gauge-num" aria-hidden="true">
          {drawn ? fmt(value as number, digits) : '–'}
          <small>{drawn ? `of ${fmt(max, digits)}${unit ? ` ${unit}` : ''}` : 'no reading'}</small>
        </span>
        {glint !== undefined && <Glint on={glint} />}
      </div>
      <figcaption className="v3-dial-cap">
        <span className="v3-dial-name">{name}</span>
        <Chip state={state} />
        {why && <p className="v3-dial-why">{why}</p>}
      </figcaption>
    </figure>
  )
}
