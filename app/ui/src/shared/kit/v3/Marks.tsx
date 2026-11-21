// The formed marks of design language v3 (spec 3.2, 4.2, section 5): the Sigil ring of the voice stage, and the Mark of each
// project (JARVIS a ring with eight short rays, Aankhen three signal arcs, Yadaash two linked loops, Well Wisher an ASCII
// bracket pair with a dot). All are drawn in the house line, 1.6 px, in currentColor.
import { useEffect, useId, useState, type ReactNode } from 'react'
import { arcPath, fraction, polar } from './Forms'
import { cx } from '../util'
import type { LampState } from '../../lamp/types'
import '../glass.css'

// ---------------------------------------------------------------------------------------------- Sigil

export interface SigilProps {
  /** Side in px (default 240). */
  size?: number
  /** True while the preview or the core runs: the mark ring turns, the tick ring counter-turns. */
  awake?: boolean
  /** Breathe while asleep (the one continuous motion of Core). Default: true when not awake. */
  breathe?: boolean
  /**
   * The mic level, 0 to 1, drawn as an arc on the ring's lower rim. Null or undefined: no level is known, so only the empty
   * track is drawn (MIC · NO LEVEL). A level is never invented.
   */
  level?: number | null
  /** The level is generated (a preview): the arc takes the simulated colour. The caller still prints the SIMULATED chip. */
  simulated?: boolean
  /**
   * The state of that level (the lamp contract: no number without a state). The arc is drawn only when the level is LIVE or
   * SIMULATED; a level passed with no state, or under any other state, draws the empty track. `simulated` alone still means
   * SIMULATED, for callers written before this prop.
   */
  state?: LampState
  label?: string
  className?: string
}

const RAYS = Array.from({ length: 8 }, (_, i) => i * 45)
const CORNERS = ['M8 24V8H24', 'M176 8H192V24', 'M192 176V192H176', 'M24 192H8V176'] as const
const MIC = { from: 45, to: 135, r: 70 } as const

export function Sigil({ size = 240, awake = false, breathe, level, simulated: simulatedProp, state, label = 'Voice ring', className }: SigilProps) {
  const known = state ?? (simulatedProp ? 'simulated' : undefined)
  const simulated = known === 'simulated'
  const gid = useId()
  const frac = known === 'live' || known === 'simulated' ? fraction(level, 1) : null
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setReady(true))
    return () => window.cancelAnimationFrame(id)
  }, [])
  const spec = polar(100, 100, 70, 225)
  const mic = arcPath(100, 100, MIC.r, MIC.from, MIC.to)
  return (
    <svg
      className={cx('v3-sigil', className)}
      viewBox="0 0 200 200"
      style={{ ['--v3-size' as string]: `${size}px` }}
      role="img"
      aria-label={`${label}, ${frac === null ? 'no mic level' : `mic level ${Math.round(frac * 100)} percent, ${simulated ? 'SIMULATED' : 'LIVE'}`}`}
      data-awake={awake ? 'true' : 'false'}
      data-breathe={(breathe ?? !awake) ? 'true' : 'false'}
      data-level={frac === null ? 'none' : simulated ? 'simulated' : 'live'}
    >
      <defs>
        <radialGradient id={gid} className="v3-spec">
          <stop offset="0" />
          <stop offset="1" />
        </radialGradient>
      </defs>
      {CORNERS.map((d) => (
        <path key={d} className="v3-mark-ring" d={d} strokeWidth={1.6} opacity={0.5} />
      ))}
      <g className="v3-spin2">
        <circle className="v3-ticks" cx={100} cy={100} r={92} strokeWidth={6} pathLength={72} strokeDasharray="0.2 0.8" />
      </g>
      <g className="v3-spin">
        <circle className="v3-mark-ring" cx={100} cy={100} r={70} strokeWidth={2.2} />
        {RAYS.map((a) => {
          const p = polar(100, 100, 78, a)
          const q = polar(100, 100, 86, a)
          return <line key={a} className="v3-mark-ring" x1={p.x} y1={p.y} x2={q.x} y2={q.y} strokeWidth={2.2} />
        })}
        <circle className="v3-mark-ring" cx={100} cy={100} r={48} strokeWidth={1.4} opacity={0.7} />
      </g>
      <path className="v3-mic-track" d={mic} strokeWidth={5} pathLength={100} />
      {frac !== null && <path className="v3-mic-val" d={mic} strokeWidth={5} pathLength={100} strokeDasharray={`${ready ? Math.round(frac * 1000) / 10 : 0} 100`} />}
      <circle cx={spec.x} cy={spec.y} r={11} fill={`url(#${gid})`} />
    </svg>
  )
}

// ---------------------------------------------------------------------------------------------- Mark

export type MarkKind = 'system' | 'jarvis' | 'aankhen' | 'yadaash' | 'wellwisher'

const GLYPH: Record<Exclude<MarkKind, 'wellwisher'>, ReactNode> = {
  // the brand row: four squares
  system: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </>
  ),
  // a sigil ring with eight short rays
  jarvis: (
    <>
      <circle cx="12" cy="12" r="5.2" />
      {RAYS.map((a) => {
        const p = polar(12, 12, 7.6, a)
        const q = polar(12, 12, 10.4, a)
        return <path key={a} d={`M${p.x.toFixed(2)} ${p.y.toFixed(2)}L${q.x.toFixed(2)} ${q.y.toFixed(2)}`} />
      })}
    </>
  ),
  // three signal arcs fanning from a point
  aankhen: (
    <>
      <circle cx="6" cy="12" r="1.2" />
      <path d={arcPath(6, 12, 5.5, -50, 50)} />
      <path d={arcPath(6, 12, 9.5, -50, 50)} />
      <path d={arcPath(6, 12, 13.5, -50, 50)} />
    </>
  ),
  // two linked loops
  yadaash: (
    <>
      <ellipse cx="8.6" cy="12" rx="5.6" ry="4.2" transform="rotate(-24 8.6 12)" />
      <ellipse cx="15.4" cy="12" rx="5.6" ry="4.2" transform="rotate(24 15.4 12)" />
    </>
  ),
}

export interface MarkProps {
  kind: MarkKind
  /** Side of the glyph in px (default 22). */
  size?: number
  /** Sit in the 36 px pressed disc of a spine tile. */
  disc?: boolean
  /** The disc of the open project is lit (neutral). */
  lit?: boolean
  /** Name it for assistive technology; omitted, the mark is decorative. */
  label?: string
  className?: string
}

/** The mark of a project. Well Wisher's is ASCII text, because its language is: [•]. */
export function Mark({ kind, size = 22, disc, lit, label, className }: MarkProps) {
  const a11y = label ? ({ role: 'img', 'aria-label': label } as const) : ({ 'aria-hidden': true } as const)
  const glyph =
    kind === 'wellwisher' ? (
      <span className="v3-mark-ascii" {...a11y} data-kind={kind}>
        {'[•]'}
      </span>
    ) : (
      <svg className="v3-mark" viewBox="0 0 24 24" style={{ ['--v3-size' as string]: `${size}px` }} focusable="false" data-kind={kind} {...a11y}>
        {GLYPH[kind]}
      </svg>
    )
  if (!disc) return <span className={cx('v3-mark-wrap', className)}>{glyph}</span>
  return (
    <span className={cx('v3-mark-disc', className)} data-lit={lit ? 'true' : undefined}>
      {glyph}
    </span>
  )
}
