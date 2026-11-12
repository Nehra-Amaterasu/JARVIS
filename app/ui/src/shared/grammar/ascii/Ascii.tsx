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

/** Heavy glyphs for the ring, light ones for its soft edge (the C04-48 ring of letters, no face). */
const HEAVY = 'MWNHDB8%#@&$OSY'
const LIGHT = ':;+=-/\\|.'

/** The ring as text, from the initials hash: 17 x 9 cells, hollow centre. Pure, so it has golden bytes. */
export function portraitText(initials: string): string {
  const rnd = mulberry32(fnv1a32(`portrait:${initials}`))
  const cols = 17, rows = 9
  const cx = (cols - 1) / 2, cy = (rows - 1) / 2
  const tilt = rnd() * Math.PI * 2
  const out: string[] = []
  for (let y = 0; y < rows; y++) {
    let ln = ''
    for (let x = 0; x < cols; x++) {
      const dx = (x - cx) / (cols / 2), dy = (y - cy) / (rows / 2)
      const d = Math.hypot(dx, dy)
      const a = Math.atan2(dy, dx)
      // the ring is heavier on one side (a light from `tilt`), as the reference rings are
      const lit = 0.5 + 0.5 * Math.cos(a - tilt)
      const r = rnd()
      if (d > 1.04 || d < 0.5) ln += ' '
      else if (d > 0.6 && d < 0.95 && r < 0.62 + 0.38 * lit) ln += HEAVY[Math.floor(rnd() * HEAVY.length)]
      else ln += r < 0.45 + 0.4 * lit ? LIGHT[Math.floor(rnd() * LIGHT.length)] : ' '
    }
    out.push(ln.replace(/\s+$/, ''))
  }
  return out.join('\n')
}

export const cleanInitials = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || '?'

export interface AsciiPortraitProps {
  initials: string
}

/** A person, as a ring of heavy glyphs around their initials: never a face (spec 19, 20.4.2). */
export function AsciiPortrait({ initials }: AsciiPortraitProps) {
  const ini = cleanInitials(initials)
  return (
    <figure className="g-portrait" data-grammar="ascii" role="img" aria-label={`Initials ${ini.split('').join(' ')}`}>
      <pre aria-hidden="true">{portraitText(ini)}</pre>
      <span className="g-initials" aria-hidden="true">{ini}</span>
    </figure>
  )
}
