// The character art of the design reset (28 Nov, docs/design/design-reset-1128.md): the signature of the System. A small set of
// dot-matrix figures, drawn on a grid of round dots the way an instrument's display is, used DELIBERATELY for three jobs only:
//   - a project's own mark (DotMark): how the four are told apart beside their names, with no colour needed;
//   - a state figure (StateFigure): the five lamp shapes as a larger figure, for an empty pose or a state headline;
//   - an empty pose (EmptyPose): the figure, a title and the reason, where a "terminal box" with a dashed outline used to be.
// Two more read real values and draw nothing they were not given: DotLevel (a level as lit dots) and DotRing (a ring of dots
// that lights a level and breathes only while something is live).
//
// HONEST BY CONSTRUCTION. A figure is drawn from a STATE the caller passes (the lamp contract); a level or a count is lit only
// when that state is LIVE or SIMULATED and the value is a finite number. Nothing here invents a number, a level or a motion:
// the one loop of a figure (LIVE breathes, WAITING sweeps one dot round its ring) is the state itself, and reduced motion and
// the calm setting stop it (art.css). Every figure is decorative (aria-hidden) unless it is given a `title`; the words beside
// it carry the information.
import { useId, type CSSProperties, type ReactNode } from 'react'
import { LAMP_SPECS, showsNumber, type LampState } from '../../lamp/types'
import { cx } from '../util'
import './art.css'

/** A bitmap row: '#' a lit dot, '+' a half-lit dot, '.' an unlit dot (the faint grid), ' ' no dot at all. */
export type DotRows = readonly string[]

export interface DotGlyphProps {
  rows: DotRows
  /** The pitch of one dot cell in px (default 4: a 7 x 7 mark is 28 px). */
  pitch?: number
  /** Accessible name; without one the glyph is decorative. */
  title?: string
  className?: string
  /** Extra data attributes for a state hook (data-state, data-kind). */
  data?: Record<string, string>
}

/** The renderer: one svg, one circle per cell. The lit dots draw in currentColor; the grid dots are the same ink, faint. */
export function DotGlyph({ rows, pitch = 4, title, className, data }: DotGlyphProps) {
  const h = rows.length
  const w = Math.max(0, ...rows.map((r) => r.length))
  const tid = useId()
  const dots: ReactNode[] = []
  let n = 0
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = row[x]
      if (c === ' ') continue
      const cls = c === '#' ? 'v3-dot v3-dot-on' : c === '+' ? 'v3-dot v3-dot-half' : 'v3-dot v3-dot-off'
      // --i orders the lit dots, so a state's loop can travel through them (WAITING) instead of blinking all at once
      const style = c === '#' ? ({ ['--i' as string]: n++ } as CSSProperties) : undefined
      dots.push(<circle key={`${x}-${y}`} className={cls} cx={x * 4 + 2} cy={y * 4 + 2} r={1.45} style={style} />)
    }
  })
  const dataAttrs = Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v]))
  return (
    <svg className={cx('v3-dotglyph', className)} viewBox={`0 0 ${w * 4} ${h * 4}`} width={w * pitch} height={h * pitch} fill="currentColor"
      role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-labelledby={title ? tid : undefined} focusable="false" {...dataAttrs}>
      {title && <title id={tid}>{title}</title>}
      {dots}
    </svg>
  )
}

// ---------------------------------------------------------------------------------------------- the project marks

export type DotMarkKind = 'system' | 'jarvis' | 'aankhen' | 'yadaash' | 'wellwisher'

/** Hand-set 7 x 7 (9 x 7 for the voice) bitmaps. Each is one idea the owner already gave the project:
 *  JARVIS the voice (five bars of a level, highest in the middle), AANKHEN sensing by radio (three arcs from a source: signals,
 *  never an eye or a lens, the project has no camera), YADAASH memory (three rows of stored bits), WELL WISHER his day (the sun
 *  on the horizon), and the SYSTEM (the four squares of the brand, in dots). */
export const DOT_MARKS: Record<DotMarkKind, DotRows> = {
  system: [
    '##.##',
    '##.##',
    '.....',
    '##.##',
    '##.##',
  ],
  jarvis: [
    '....#....',
    '..#.#.#..',
    '..#.#.#..',
    '#.#.#.#.#',
    '..#.#.#..',
    '..#.#.#..',
    '....#....',
  ],
  aankhen: [
    '###....',
    '...#...',
    '##..#..',
    '..#..#.',
    '#..#.#.',
    '.#.#..#',
    '#.#.#.#',
  ],
  yadaash: [
    '###.#.#',
    '.......',
    '#.###.#',
    '.......',
    '#.#.###',
    '.......',
    '##.#.##',
  ],
  wellwisher: [
    '...#...',
    '.#...#.',
    '...#...',
    '#.###.#',
    '.#####.',
    '.......',
    '#######',
  ],
}

export interface DotMarkProps {
  kind: DotMarkKind
  /** Pitch per dot in px (default 3: a 7 x 7 mark is 21 px, the spine's icon box). */
  pitch?: number
  title?: string
  className?: string
}

export function DotMark({ kind, pitch = 3, title, className }: DotMarkProps) {
  return <DotGlyph rows={DOT_MARKS[kind]} pitch={pitch} title={title} className={cx('v3-dotmark', className)} data={{ kind }} />
}

// ---------------------------------------------------------------------------------------------- the state figures

/** A 9 x 9 dot figure of each lamp shape, computed from the same geometry as the lamp glyph (a disc, a half disc, a diamond,
 *  a dashed ring, a triangle with its bar), so the figure and the lamp can never disagree. Exported for the test. */
export function stateRows(state: LampState): string[] {
  const N = 9
  const c = 4
  const rows: string[] = []
  for (let y = 0; y < N; y++) {
    let row = ''
    for (let x = 0; x < N; x++) {
      const dx = x - c
      const dy = y - c
      const d = Math.hypot(dx, dy)
      const ring = d > 3.2 && d < 4.4
      let ch = '.'
      if (state === 'live') ch = d < 4.4 ? '#' : '.'
      else if (state === 'waiting') ch = ring || (d < 4.4 && dx < 0) ? '#' : '.'
      else if (state === 'simulated') ch = Math.abs(dx) + Math.abs(dy) === 4 || (dx === 0 && dy === 0) ? '#' : '.'
      else if (state === 'planned') ch = ring && (x + y) % 2 === 0 ? '#' : '.'
      else {
        // fault: a triangle point up, rows 1..8, with the bar and the dot cut out of it in the middle column
        const top = 1
        const inTri = y >= top && Math.abs(dx) <= (y - top) / 1.75
        const bar = dx === 0 && (y >= 3 && y <= 5)
        const dot = dx === 0 && y === 7
        ch = inTri ? (bar || dot ? '.' : '#') : '.'
      }
      row += ch
    }
    rows.push(row)
  }
  return rows
}

export interface StateFigureProps {
  state: LampState
  /** Pitch per dot in px (default 6: a 54 px figure). */
  pitch?: number
  /** Accessible name; default decorative (the state word beside it is the information). */
  title?: string
  className?: string
}

/** The state as a figure. Colour follows the reset: FAULT its own red, LIVE the accent, the other three in ink. */
export function StateFigure({ state, pitch = 6, title, className }: StateFigureProps) {
  return <DotGlyph rows={stateRows(state)} pitch={pitch} title={title} className={cx('v3-statefig', className)} data={{ state }} />
}

// ---------------------------------------------------------------------------------------------- the empty pose

export interface EmptyPoseProps {
  /** The state of the thing that is empty: the figure and the word come from it. */
  state: LampState
  /** What is empty, as a person would say it ("No follow-ups"). */
  title: string
  /** Why, in words (the lamp's reason): "nothing dated for today", "the board has not reported". */
  reason: string
  /** One key that fills it, if there is one. */
  action?: ReactNode
  /** Smaller figure and type for a narrow tray. */
  compact?: boolean
  className?: string
}

/** An empty pose: the figure, the title, the state word and the reason. It replaces the dashed "terminal box". */
export function EmptyPose({ state, title, reason, action, compact, className }: EmptyPoseProps) {
  return (
    <div className={cx('v3-empty', className)} data-state={state} data-compact={compact ? 'true' : undefined} role="status">
      <StateFigure state={state} pitch={compact ? 4 : 6} />
      <div className="v3-empty-words">
        <p className="v3-empty-title">{title}</p>
        <p className="v3-empty-reason">
          <span className="v3-empty-word">{LAMP_SPECS[state].label}</span> {reason}
        </p>
      </div>
      {action && <div className="v3-empty-act">{action}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- the readers of real values

export interface DotLevelProps {
  /** The value, or null when there is none. */
  value: number | null | undefined
  /** The full scale. */
  max: number
  /** The state of the value: dots are lit only under LIVE or SIMULATED. */
  state: LampState
  /** Dots in the row (default 16). */
  cells?: number
  /** The accessible name ("Mic level"). */
  label: string
}

/** How many dots a value lights, or null when it must not light any. Exported for the test. */
export function litCount(value: number | null | undefined, max: number, state: LampState, cells: number): number | null {
  if (!showsNumber(state) || typeof value !== 'number' || !Number.isFinite(value) || !(max > 0)) return null
  return Math.max(0, Math.min(cells, Math.round((value / max) * cells)))
}

/** A level as a row of dots. With no value, or a state that cannot show one, every dot stays unlit and the name says why. */
export function DotLevel({ value, max, state, cells = 16, label }: DotLevelProps) {
  const lit = litCount(value, max, state, cells)
  const row = Array.from({ length: cells }, (_, i) => (lit != null && i < lit ? '#' : '.')).join('')
  const name = lit == null ? `${label}: ${LAMP_SPECS[state].label}, no level` : `${label}: ${lit} of ${cells}${state === 'simulated' ? ', simulated' : ''}`
  return (
    <span className="v3-dotlevel" data-state={state} data-lit={lit ?? undefined} role="img" aria-label={name}>
      <DotGlyph rows={[row]} pitch={6} />
    </span>
  )
}

export interface DotRingProps {
  state: LampState
  /** 0 to 1, drawn as lit dots round the ring from the top; only under LIVE or SIMULATED. */
  level?: number | null
  /** Dots round the ring (default 36). */
  count?: number
  /** Side in px (default 220). */
  size?: number
  title?: string
  className?: string
}

/** The ring of a centre piece in dots: the faint ring is always drawn; a level lights dots clockwise from the top. It never
 *  turns (a turning ring would move the level it shows); while LIVE its lit dots breathe (art.css), in every other state and
 *  under reduced motion it stands still. */
export function DotRing({ state, level, count = 36, size = 220, title, className }: DotRingProps) {
  const lit = litCount(level, 1, state, count)
  const tid = useId()
  const r = 46
  const dots = Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2 - Math.PI / 2
    const on = lit != null && i < lit
    return <circle key={i} className={on ? 'v3-dot v3-dot-on' : 'v3-dot v3-dot-off'} cx={50 + r * Math.cos(a)} cy={50 + r * Math.sin(a)} r={1.9} />
  })
  return (
    <svg className={cx('v3-dotring', className)} data-state={state} data-lit={lit ?? undefined} viewBox="0 0 100 100" width={size} height={size} fill="currentColor"
      role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-labelledby={title ? tid : undefined} focusable="false">
      {title && <title id={tid}>{title}</title>}
      <g className="v3-dotring-dots">{dots}</g>
    </svg>
  )
}
