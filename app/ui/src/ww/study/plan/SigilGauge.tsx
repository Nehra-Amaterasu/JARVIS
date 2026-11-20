// SigilGauge (package Y03, spec 20.7.5): one unit as a 96 x 96 sigil inside an open arc. The sigil is a small growth drawing seeded by
// the unit id, so a unit's sigil never changes; the arc is the unit's mastery (0 to 270 degrees). A sigil's stroke count is never
// mastery: every unit gets the same number of strokes, so decoration cannot reward. Under MIN_N answers the arc is drawn as dashes and
// the label says "too few answers". The weakest unit is named in words by the caller, never coloured red.
import { useMemo } from 'react'
import { MIN_N, seeded } from './model'

export interface SigilGaugeProps {
  unitId: string
  /** 0 to 1; ignored (dashed) while n is under MIN_N. */
  proficiency: number
  n: number
  /** The printed name, e.g. "Unit 3". */
  label: string
  selected?: boolean
  onSelect?: () => void
  /** What a click does, said in the button's name, e.g. "opens Drill, the unit is not carried over". */
  action?: string
  /** Tab stop control for a roving group. */
  tabIndex?: number
}

const C = 48
const R = 41
const START = 135
const SWEEP = 270

const pt = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180
  return [C + r * Math.cos(a), C + r * Math.sin(a)] as const
}
const arc = (from: number, to: number, r: number) => {
  const [x0, y0] = pt(from, r)
  const [x1, y1] = pt(to, r)
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

/** The growth sigil: a stem and five seeded side branches, each branch forking once. Same unit id, same drawing. */
export function sigilPath(unitId: string): string {
  const rnd = seeded(unitId)
  const segs: string[] = []
  const fork = (x: number, y: number, ang: number, len: number, depth: number) => {
    const x1 = x + len * Math.cos(ang)
    const y1 = y + len * Math.sin(ang)
    segs.push(`M${x.toFixed(1)} ${y.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}`)
    if (depth > 0) {
      const spread = 0.45 + rnd() * 0.55
      fork(x1, y1, ang - spread, len * (0.55 + rnd() * 0.15), depth - 1)
      fork(x1, y1, ang + spread, len * (0.55 + rnd() * 0.15), depth - 1)
    }
  }
  const base = rnd() * Math.PI * 2
  for (let i = 0; i < 5; i++) fork(C, C, base + (i * Math.PI * 2) / 5 + (rnd() - 0.5) * 0.3, 9 + rnd() * 5, 1)
  return segs.join('')
}

export function SigilGauge({ unitId, proficiency, n, label, selected, onSelect, tabIndex, action }: SigilGaugeProps) {
  const d = useMemo(() => sigilPath(unitId), [unitId])
  const few = n < MIN_N
  const p = Math.min(1, Math.max(0, proficiency))
  const end = START + SWEEP * (few ? 1 : p)
  const word = few ? `${label}: too few answers, n = ${n}` : `${label}: arc ${Math.round(p * SWEEP)} of 270 degrees, n = ${n}`
  const body = (
    <>
      <svg className="y3-sg-svg" viewBox="0 0 96 96" width="96" height="96" role="img" aria-label={word}>
        <path className="y3-sg-groove" d={arc(START, START + SWEEP, R)} />
        {few ? <path className="y3-sg-arc" data-dashed="true" d={arc(START, end, R)} /> : p > 0.004 && <path className="y3-sg-arc" d={arc(START, end, R)} />}
        <path className="y3-sg-sigil" d={d} />
        <circle className="y3-sg-seed" cx={C} cy={C} r="2.6" />
      </svg>
      <span className="y3-sg-name">{label}</span>
      <span className="y3-sg-n">{few ? 'too few answers' : `n = ${n}`}</span>
    </>
  )
  return onSelect ? (
    <button type="button" className="y3-sg ww-tap" data-selected={selected ? 'true' : undefined} data-few={few ? 'true' : undefined} data-unit={unitId} tabIndex={tabIndex} aria-pressed={!!selected} aria-label={action ? `${word}. ${action}` : word} onClick={onSelect}>
      {body}
    </button>
  ) : (
    <span className="y3-sg" data-few={few ? 'true' : undefined} data-unit={unitId}>{body}</span>
  )
}
