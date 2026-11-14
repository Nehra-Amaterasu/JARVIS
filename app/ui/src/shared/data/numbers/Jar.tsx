// The Jar (spec 20.5.2, package D01): one recessed well per user-set category. The fill is the student's own spending
// against their own plan, halftone dots up to the planned notch (a disc on the wall). Past the notch the fill is
// hatched and one line of text says how far: `120 over`. No red, no warning wording, no alarm: the hatch and the words
// carry it, so it reads in greyscale and in forced colours. Empty is an empty well and "nothing in it yet".
// LIVE and SIMULATED draw the fill and the figures; other states draw a dashed empty well, a dashed notch and the reason.
import { useId } from 'react'
import { Lamp, lampText, showsValue, type LampState } from '../../kit'
import { fmt, jarGeometry, jarLine } from './layout'
import './numbers.css'

export interface JarProps {
  /** With a plan: the amount in the same unit as `plan`. Without one: a share, 0 to 1, of the well. */
  level: number
  plan?: number
  label: string
  state: LampState
  unit?: string
  reason?: string
  className?: string
}

// the well, in SVG units (the svg scales to its box)
const W = 84
const H = 164
const WELL_X = 16
const WELL_W = 52
const WELL_TOP = 20
const WELL_BOT = 152
const WELL_H = WELL_BOT - WELL_TOP

export function Jar({ level, plan, label, state, unit, reason, className }: JarProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const draws = showsValue(state)
  const g = jarGeometry(level, plan)
  const yOf = (share: number) => WELL_BOT - share * WELL_H
  const top = yOf(g.fill)
  const notchY = g.notch === null ? null : yOf(g.notch)
  const why = !draws ? lampText(state, reason ?? (state === 'waiting' ? 'no report' : undefined)) : null
  const line = draws ? jarLine(g, unit) : ''
  const figure =
    !draws ? '--' : plan !== undefined && g.notch !== null ? `${fmt(Math.max(0, level))} of ${fmt(plan)}${unit ? ` ${unit}` : ''}` : `${Math.round(g.fill * 100)} percent full`
  const spoken = draws ? `${label}: ${figure}${line ? `, ${line}` : ''}` : `${label}: no value, ${why}`
  const underBottom = g.mode === 'over' && notchY !== null ? notchY : top
  return (
    <figure
      className={`d1-jar${className ? ` ${className}` : ''}`}
      data-component="jar"
      data-grammar="ascii"
      data-state={state}
      data-mode={draws ? g.mode : 'hollow'}
      data-form={draws ? 'fill' : 'hollow'}
      aria-label={spoken}
      role="group"
    >
      <span className="d1-lamp"><Lamp state={state} reason={reason} bare /></span>
      <div className="d1-jar-stage">
      <svg className="d1-jar-svg" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
        <defs>
          <pattern id={`${uid}dots`} width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.1" className="d1-jar-dot" /></pattern>
          <pattern id={`${uid}hatch`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" className="d1-jar-hatch" /></pattern>
          <clipPath id={`${uid}clip`}><rect x={WELL_X} y={WELL_TOP} width={WELL_W} height={WELL_H} rx="3" /></clipPath>
        </defs>
        <rect x={WELL_X} y={WELL_TOP} width={WELL_W} height={WELL_H} rx="3" className="d1-jar-well" data-hollow={draws ? undefined : 'true'} />
        {/* the scale, quarters of the well */}
        {[0.25, 0.5, 0.75].map((q) => <line key={q} x1="8" x2={WELL_X - 3} y1={yOf(q)} y2={yOf(q)} className="d1-jar-tick" />)}
        {draws && g.mode !== 'empty' && (
          <g clipPath={`url(#${uid}clip)`}>
            <rect x={WELL_X} y={underBottom} width={WELL_W} height={WELL_BOT - underBottom} className="d1-jar-under" />
            <rect x={WELL_X} y={underBottom} width={WELL_W} height={WELL_BOT - underBottom} fill={`url(#${uid}dots)`} />
            {g.mode === 'over' && notchY !== null && (
              <>
                <rect x={WELL_X} y={top} width={WELL_W} height={notchY - top} className="d1-jar-over" />
                <rect x={WELL_X} y={top} width={WELL_W} height={notchY - top} fill={`url(#${uid}hatch)`} />
              </>
            )}
            <line x1={WELL_X} x2={WELL_X + WELL_W} y1={top} y2={top} className="d1-jar-surface" />
          </g>
        )}
        {/* the planned notch: a dashed line across the well and a disc on the wall */}
        {(notchY !== null || !draws) && (
          <g>
            <line x1={WELL_X - 4} x2={WELL_X + WELL_W + 4} y1={notchY ?? yOf(0.72)} y2={notchY ?? yOf(0.72)} className="d1-jar-notch" />
            <circle cx={WELL_X + WELL_W} cy={notchY ?? yOf(0.72)} r="5" className="d1-jar-disc" data-hollow={draws ? undefined : 'true'} />
          </g>
        )}
        <rect x={WELL_X - 3} y={WELL_TOP - 6} width={WELL_W + 6} height="6" rx="2" className="d1-jar-rim" />
      </svg>
      </div>
      <figcaption className="d1-jar-cap" aria-hidden="true">
        <span className="d1-jar-label">{label}</span>
        <span className="d1-jar-figure">{figure}</span>
        <span className="d1-jar-line">{draws ? line : why}</span>
        {state === 'simulated' && draws && <span className="d1-stamp">SIMULATED</span>}
      </figcaption>
    </figure>
  )
}
