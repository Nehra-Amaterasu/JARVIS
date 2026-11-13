// AsciiPlate, AsciiHeat, AsciiBar and AsciiPortrait (spec 20.4.2). Text only, in <pre> and grid cells.
// The data forms (heat, bar) take a REQUIRED reading: the lamp and its words always sit beside the glyphs, and
// every glyph has a text twin (a visually hidden list, or the percentage as text). Atmosphere is aria-hidden.
import type { CSSProperties, ReactNode } from 'react'
import { LAMP_SPECS, showsNumber, type LampState } from '../../lamp'
import { fnv1a32, mulberry32 } from '../sigil/hash'
import { ATMOSPHERE_MAX_BYTES, RAMPS, atmosphereProblems, freezeText, scatterText, type RampName } from './ramps'
import '../grammar.css'

export interface AsciiPlateProps {
  text: string
  /** The ramp the text was made with; freeze reads glyph levels from it. */
  ramp?: RampName
  /** atmosphere (default): 10 px, aria-hidden, decoration only. data: 12 px cells, read by assistive technology. */
  tier?: 'data' | 'atmosphere'
  /** static; frozen (WAITING: a 1-bit Bayer field of itself, never animated); scattered (FAULT: / \ x, then still) */
  state?: 'static' | 'frozen' | 'scattered'
  /** data tier only: the text equivalent of the plate. */
  label?: string
}

/** Cut text to the plate budget on a character boundary, never mid-line when a newline is close. */
function clip(text: string): { text: string; over: boolean } {
  const enc = new TextEncoder()
  if (enc.encode(text).length <= ATMOSPHERE_MAX_BYTES) return { text, over: false }
  let lo = 0, hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (enc.encode(text.slice(0, mid)).length <= ATMOSPHERE_MAX_BYTES) lo = mid
    else hi = mid - 1
  }
  const cut = text.slice(0, lo)
  const nl = cut.lastIndexOf('\n')
  return { text: nl > lo - 200 && nl > 0 ? cut.slice(0, nl) : cut, over: true }
}

export function AsciiPlate({ text, ramp = 'r10', tier = 'atmosphere', state = 'static', label }: AsciiPlateProps) {
  const { text: body, over } = clip(text)
  const shown = state === 'frozen' ? freezeText(body, ramp) : state === 'scattered' ? scatterText(body) : body
  const lint = tier === 'atmosphere' ? atmosphereProblems(text) : []
  const a11y = tier === 'atmosphere' ? { 'aria-hidden': true as const } : label ? { role: 'img', 'aria-label': label } : {}
  return (
    <pre
      className="g-ascii" data-grammar="ascii" data-tier={tier} data-state={state} data-ramp={ramp}
      data-over={over ? 'true' : undefined} data-lint={lint.length ? 'fail' : undefined} {...a11y}
    >
      {shown}
    </pre>
  )
}

/** Hollow when the state forbids a number (WAITING, PLANNED, FAULT): the glyphs would be invented data. */
const hollowOf = (state?: LampState) => state !== undefined && !showsNumber(state)

export interface AsciiHeatProps {
  /** One count per day cell (index 0 is day 1). NaN or a negative count is a gap: no data, drawn as a hatch. */
  cells: number[]
  ramp?: 'r5'
  /** Required: the lamp and words of the source (a <Reading>, a <Lamp>, or text with one). */
  reading: ReactNode
  /** The count that reaches the darkest glyph (default: this grid's own largest count, said in the caption). */
  max?: number
  /** The state of the reading; WAITING, PLANNED or FAULT draw the grid hollow with no glyphs. */
  state?: LampState
  /** Leading blank cells, so day 1 falls on its weekday. */
  offset?: number
  /** What is counted ("actions"), for the text twin. */
  unit?: string
  label?: string
}

/** At most one year and a week of cells: a heat grid is a month or a year, never unbounded. */
export const HEAT_MAX_CELLS = 371

export function heatLevel(c: number, top: number): number {
  if (!Number.isFinite(c) || c < 0) return -1
  if (c === 0) return 0
  // any positive count gets at least the first mark: one action is not "nothing"
  return Math.min(4, 1 + Math.floor((c / Math.max(top, 1e-9)) * 3.999))
}

export function AsciiHeat({ cells, ramp = 'r5', reading, max, state, offset = 0, unit = 'count', label = 'Heat grid' }: AsciiHeatProps) {
  const cs = cells.slice(0, HEAT_MAX_CELLS)
  const finite = cs.filter((c) => Number.isFinite(c) && c >= 0)
  const top = max !== undefined && max > 0 ? max : Math.max(1, ...finite)
  const hollow = hollowOf(state)
  const g = RAMPS[ramp]
  const lead = Math.max(0, Math.min(6, Math.floor(offset)))
  return (
    <figure className="g-heat" data-grammar="ascii" data-hollow={hollow ? 'true' : 'false'} aria-label={label} style={{ margin: 0 }}>
      <ol className="g-heat-grid" aria-hidden="true">
        {Array.from({ length: lead }, (_, i) => <li key={`b${i}`} className="g-heat-cell" data-blank="true" />)}
        {cs.map((c, i) => {
          const lv = hollow ? -2 : heatLevel(c, top)
          const glyph = lv === -2 ? '·' : lv === -1 ? '░' : g[lv] === ' ' ? ' ' : g[lv]
          return (
            <li key={i} className="g-heat-cell" data-level={lv} data-gap={lv < 0 ? 'true' : 'false'}>
              <span className="g-heat-day">{i + 1}</span>
              <span className="g-heat-glyph">{glyph}</span>
            </li>
          )
        })}
      </ol>
      <ul className="g-sr">
        {hollow
          ? <li>{`No values shown: ${LAMP_SPECS[state!].label}`}</li>
          : cs.map((c, i) => <li key={i}>{Number.isFinite(c) && c >= 0 ? `Day ${i + 1}: ${c} ${unit}` : `Day ${i + 1}: no data`}</li>)}
      </ul>
      <figcaption className="g-heat-cap">
        {reading}
        {!hollow && <span className="g-heat-scale"> {`scale ${g.slice(1).split('').join(' ')} up to ${top}${max === undefined ? ' (this grid’s largest)' : ''}`}</span>}
      </figcaption>
    </figure>
  )
}

const HEADS = { '>': '>', car: 'o=o>', chopper: '-o<' } as const

export interface AsciiBarProps {
  value: number
  max: number
  /** Cells inside the brackets (default 10). */
  width?: number
  /** The glyph at the head of the fill, chosen in a Trim; nothing is unlocked by progress. */
  head?: '>' | 'car' | 'chopper'
  /** Required: the lamp and words of the source. */
  reading: ReactNode
  state?: LampState
  label?: string
}

/** The track as text: `[#######---]`. Exported so the text twin and the tests share one definition. */
export function barTrack(ratio: number | null, width: number, head?: AsciiBarProps['head']): { fill: string; empty: string } {
  const w = Math.max(4, Math.min(60, Math.floor(width)))
  if (ratio === null) return { fill: '', empty: '-'.repeat(w) }
  const filled = Math.round(Math.max(0, Math.min(1, ratio)) * w)
  if (!head) return { fill: '#'.repeat(filled), empty: '-'.repeat(w - filled) }
  const h = HEADS[head]
  const len = Math.max(filled, h.length)
  return { fill: '#'.repeat(len - h.length) + h, empty: '-'.repeat(Math.max(0, w - len)) }
}

export function AsciiBar({ value, max, width = 10, head, reading, state, label = 'Progress' }: AsciiBarProps) {
  const ok = Number.isFinite(value) && Number.isFinite(max) && max > 0
  const hollow = hollowOf(state) || !ok
  const ratio = hollow ? null : value / max
  const { fill, empty } = barTrack(ratio, width, head)
  // the percentage is the real one, even past 100: the track is full but the text does not round it away
  const pct = ratio === null ? null : Math.round(Math.max(0, ratio) * 100)
  const a11y = pct === null
    ? { role: 'img', 'aria-label': `${label}: no value${state ? `, ${LAMP_SPECS[state].label}` : ''}` }
    : { role: 'meter', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': max, 'aria-valuenow': Math.max(0, Math.min(value, max)), 'aria-valuetext': `${pct} percent, ${value} of ${max}` }
  return (
    <div className="g-bar" data-grammar="ascii" data-hollow={hollow ? 'true' : 'false'}>
      <span {...a11y} className="g-bar-track" style={{ ['--g-w' as string]: width } as CSSProperties}>
        <span aria-hidden="true">[{fill}<span className="g-bar-empty">{empty}</span>]</span>
      </span>
      <span className="g-bar-pct" aria-hidden="true">{pct === null ? '—' : `${pct} %`}</span>
      <span className="g-bar-reading">{reading}</span>
    </div>
  )
}

// The portrait (C04-48 family: a ring of glyphs, no face). Why it is drawn, not scattered: the first sheet placed
// random heavy glyphs in a ring and laid the initials over them, and the jury read the blocks as noise with the
// letters lost inside. Now the plate is a shape with an outline and a shaded band, mirror-true, with a clear window
// of 7 x 3 cells (42 x 36 px) in the middle that nothing is drawn into, so the initials sit on the ground.
export const PORTRAIT_COLS = 21
export const PORTRAIT_ROWS = 11
/** The clear window: |dx| <= 3 cells, |dy| <= 1 row from the centre cell. */
export const PORTRAIT_WINDOW = { dx: 3, dy: 1 } as const
const PORTRAIT_SHAPES = ['circle', 'octagon', 'diamond'] as const
/** Three shading families, light to heavy: r10 middle-to-top, the caret ramp, and a hatch. */
const PORTRAIT_SHADES = ['-=+*#%@', '.:^AM', ':;=x%#'] as const
export interface PortraitPlan { shape: (typeof PORTRAIT_SHAPES)[number]; shade: string; tilt: number; ticks: boolean }

export function portraitPlan(initials: string): PortraitPlan {
  const rnd = mulberry32(fnv1a32(`portrait:${initials}`))
  const shape = PORTRAIT_SHAPES[Math.floor(rnd() * PORTRAIT_SHAPES.length)]
  const shade = PORTRAIT_SHADES[Math.floor(rnd() * PORTRAIT_SHADES.length)]
  // the light comes from one of 8 directions, so the band is heavy on one side as the reference rings are
  const tilt = Math.floor(rnd() * 8)
  const ticks = rnd() < 0.5
  return { shape, shade, tilt, ticks }
}

/**
 * The plate as text: 21 x 11 cells (the 6 x 12 px atmosphere cell: 126 x 132 px, a circle in pixels). The outline
 * is an edge pass (| - / \ by the outline's direction, + at the four compass points when the seed says so), a dotted
 * inner rim, and a band shaded by a light from `tilt`. Pure and deterministic, so it has golden bytes.
 */
export function portraitText(initials: string): string {
  const { shape, shade, tilt, ticks } = portraitPlan(initials)
  const cols = PORTRAIT_COLS, rows = PORTRAIT_ROWS
  const cx = (cols - 1) / 2, cy = (rows - 1) / 2
  // half a cell past the grid, so the top and bottom outline is a flat run of 7 to 9 cells, not a single point
  const RX = cx + 0.45, RY = cy + 0.45
  const dist = (x: number, y: number): number => {
    const nx = (x - cx) / RX, ny = (y - cy) / RY
    const ax = Math.abs(nx), ay = Math.abs(ny)
    if (shape === 'circle') return Math.hypot(nx, ny)
    if (shape === 'octagon') return Math.max(ax, ay, (ax + ay) * 0.74)
    return (ax + ay) * 0.9
  }
  const inner = shape === 'diamond' ? 0.6 : 0.52
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows && dist(x, y) <= 1
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const
  const lightA = (tilt * Math.PI) / 4
  const out: string[] = []
  for (let y = 0; y < rows; y++) {
    let ln = ''
    for (let x = 0; x < cols; x++) {
      const d = dist(x, y)
      const win = Math.abs(x - cx) <= PORTRAIT_WINDOW.dx && Math.abs(y - cy) <= PORTRAIT_WINDOW.dy
      if (d > 1 || win || d < inner) { ln += ' '; continue }
      if (N4.some(([dx, dy]) => !inside(x + dx, y + dy))) {
        if (ticks && (x === cx || y === cy)) { ln += '+'; continue }
        // the outline glyph follows the outline: the gradient of the distance, scaled to cells
        const gx = (dist(x + 0.5, y) - dist(x - 0.5, y)) * RX, gy = (dist(x, y + 0.5) - dist(x, y - 0.5)) * RY
        const ax = Math.abs(gx), ay = Math.abs(gy)
        ln += ax > 2.2 * ay ? '|' : ay > 2.2 * ax ? '-' : gx * gy > 0 ? '/' : '\\'
        continue
      }
      if (N4.some(([dx, dy]) => dist(x + dx, y + dy) < inner)) { ln += '.'; continue }
      const lit = 0.5 + 0.5 * Math.cos(Math.atan2((y - cy) / RY, (x - cx) / RX) - lightA)
      ln += shade[Math.min(shade.length - 1, Math.floor((0.15 + 0.85 * lit) * shade.length))]
    }
    out.push(ln.replace(/\s+$/, ''))
  }
  return out.join('\n')
}

export const cleanInitials = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || '?'

export interface AsciiPortraitProps {
  initials: string
}

/** A person, as a framed glyph plate around their initials: never a face (spec 19, 20.4.2). */
export function AsciiPortrait({ initials }: AsciiPortraitProps) {
  const ini = cleanInitials(initials)
  return (
    <figure className="g-portrait" data-grammar="ascii" data-shape={portraitPlan(ini).shape} role="img" aria-label={`Initials ${ini.split('').join(' ')}`}>
      <pre aria-hidden="true">{portraitText(ini)}</pre>
      <span className="g-initials" aria-hidden="true">{ini}</span>
    </figure>
  )
}
