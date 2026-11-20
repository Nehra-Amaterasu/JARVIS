// SyllabusLandscape (package Y03, spec 20.7.3): one plateau per unit on an isometric block. A plateau's height is the student's
// proficiency from marked answers; with fewer than MIN_N answers it is a flat slab with a dashed rim and the word "not measured".
// The footprint is the unit's share, and a small tree stands for each topic the student marked learned or solid. Hover or focus
// names the unit in the line under the drawing; arrow keys step around the block; Enter or a click chooses the unit.
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { isMeasured, unitLabel, type UnitReading } from './model'

export interface SyllabusLandscapeProps {
  units: readonly UnitReading[]
  selectedId?: string | null
  onSelect?: (unitId: string) => void
  /** Where the drawing comes from, in words, for the caption. */
  caption: string
}

const S = 40            // isometric scale, px per grid unit
const MAX_H = 54        // tallest plateau (proficiency 1)
const FLAT_H = 5        // the slab of an unmeasured unit
const COS = 0.866

// ground point (gx, gy) at height h on screen
const iso = (gx: number, gy: number, h: number) => [(gx - gy) * COS * S, (gx + gy) * 0.5 * S - h] as const
const poly = (pts: readonly (readonly [number, number])[]) => pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')

interface Placed { u: UnitReading; gx: number; gy: number; side: number; h: number; measured: boolean }

export function layout(units: readonly UnitReading[]): Placed[] {
  const cols = Math.max(1, Math.ceil(Math.sqrt(units.length)))
  const biggest = Math.max(0.0001, ...units.map((u) => u.share))
  return units.map((u, i) => {
    const side = 0.62 + 0.3 * (u.share / biggest)
    const measured = isMeasured(u)
    return { u, gx: (i % cols) + (1 - side) / 2, gy: Math.floor(i / cols) + (1 - side) / 2, side, h: measured ? 8 + (u.proficiency as number) * (MAX_H - 8) : FLAT_H, measured }
  })
}

export function SyllabusLandscape({ units, selectedId, onSelect, caption }: SyllabusLandscapeProps) {
  const [hot, setHot] = useState<string | null>(null)
  const [focus, setFocus] = useState(0)
  const refs = useRef<(SVGGElement | null)[]>([])
  const live = useId()
  const placed = useMemo(() => layout(units), [units])
  // fit the viewBox to what is drawn
  const box = useMemo(() => {
    if (!placed.length) return { x: -150, y: -10, w: 300, h: 130 }
    const xs: number[] = []
    const ys: number[] = []
    for (const p of placed) {
      for (const [gx, gy, h] of [[p.gx, p.gy, 0], [p.gx + p.side, p.gy, 0], [p.gx, p.gy + p.side, 0], [p.gx + p.side, p.gy + p.side, 0], [p.gx, p.gy, p.h + 16]] as const) {
        const [x, y] = iso(gx, gy, h)
        xs.push(x); ys.push(y)
      }
    }
    const x0 = Math.min(...xs) - 10
    const y0 = Math.min(...ys) - 10
    return { x: x0, y: y0, w: Math.max(...xs) + 10 - x0, h: Math.max(...ys) + 10 - y0 }
  }, [placed])
  // painter's order: back to front by grid row + column (whole cells, so the sort is stable and reading order stays the unit order)
  const order = useMemo(() => {
    const cols = Math.max(1, Math.ceil(Math.sqrt(placed.length)))
    return [...placed.keys()].sort((a, b) => ((a % cols) + Math.floor(a / cols)) - ((b % cols) + Math.floor(b / cols)))
  }, [placed])
  const named = placed.find((p) => p.u.id === (hot ?? selectedId))?.u ?? null

  const step = (e: KeyboardEvent, i: number) => {
    const last = placed.length - 1
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i === last ? 0 : i + 1) : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i === 0 ? last : i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1
    if (to < 0) return
    e.preventDefault()
    setFocus(to)
    refs.current[to]?.focus()
  }

  if (!placed.length) {
    return (
      <figure className="y3-land" data-component="syllabus-landscape" data-empty="true">
        <svg className="y3-land-svg" viewBox="-150 -10 300 130" role="img" aria-label="A flat slab: no syllabus units yet">
          <polygon className="y3-pl-top" points={poly([iso(0, 0, 0), iso(2, 0, 0), iso(2, 2, 0), iso(0, 2, 0)].map((p) => [p[0], p[1] + 40] as const))} data-measured="false" />
        </svg>
        <figcaption className="y3-land-cap"><span className="y3-ascii">No syllabus units yet. Add them in Subjects.</span></figcaption>
      </figure>
    )
  }
  return (
    <figure className="y3-land" data-component="syllabus-landscape">
      <svg className="y3-land-svg" viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} role="group" aria-label={`Syllabus landscape, ${placed.length} units. ${caption}`}>
        {order.map((i) => {
          const p = placed[i]
          const sel = selectedId === p.u.id
          const a = iso(p.gx, p.gy, p.h), b = iso(p.gx + p.side, p.gy, p.h), c = iso(p.gx + p.side, p.gy + p.side, p.h), d = iso(p.gx, p.gy + p.side, p.h)
          const b0 = iso(p.gx + p.side, p.gy, 0), c0 = iso(p.gx + p.side, p.gy + p.side, 0), d0 = iso(p.gx, p.gy + p.side, 0)
          const rnd = p.u.trees
          return (
            <g
              key={p.u.id}
              ref={(el) => { refs.current[i] = el }}
              className="y3-pl"
              data-unit={p.u.id}
              data-selected={sel ? 'true' : undefined}
              data-measured={p.measured ? 'true' : 'false'}
              role="button"
              tabIndex={i === focus ? 0 : -1}
              aria-pressed={sel}
              aria-label={`${unitLabel(p.u)}, ${Math.round(p.u.share * 100)} percent of the paper, ${p.measured ? `${Math.round((p.u.proficiency as number) * 100)} percent, n = ${p.u.n}` : 'not measured'}`}
              aria-describedby={live}
              onMouseEnter={() => setHot(p.u.id)}
              onMouseLeave={() => setHot(null)}
              onFocus={() => { setHot(p.u.id); setFocus(i) }}
              onBlur={() => setHot(null)}
              onClick={() => onSelect?.(p.u.id)}
              onKeyDown={(e) => { step(e, i); if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(p.u.id) } }}
            >
              <polygon className="y3-pl-left" points={poly([d, c, c0, d0])} />
              <polygon className="y3-pl-right" points={poly([c, b, b0, c0])} />
              <polygon className="y3-pl-top" points={poly([a, b, c, d])} />
              {!p.measured && <polygon className="y3-pl-rim" points={poly([a, b, c, d])} />}
              {Array.from({ length: Math.min(rnd, 6) }, (_, k) => {
                const fx = p.gx + p.side * (0.2 + 0.6 * (((k * 0.37) % 1)))
                const fy = p.gy + p.side * (0.2 + 0.6 * (((k * 0.61 + 0.13) % 1)))
                const [tx, ty] = iso(fx, fy, p.h)
                return <path key={k} className="y3-tree" d={`M${tx.toFixed(1)} ${ty.toFixed(1)}l-3 -2 3 -8 3 8z`} />
              })}
              <text className="y3-pl-num" x={iso(p.gx + p.side / 2, p.gy + p.side / 2, p.h)[0]} y={iso(p.gx + p.side / 2, p.gy + p.side / 2, p.h)[1] + (p.measured ? 14 : 4)} textAnchor="middle">U{p.u.num}</text>
            </g>
          )
        })}
      </svg>
      <figcaption className="y3-land-cap">
        <span id={live} role="status" className="y3-land-now">
          {named ? `${unitLabel(named)}: ${Math.round(named.share * 100)} percent of the paper, ${isMeasured(named) ? `n = ${named.n}` : 'not measured'}` : 'Hover or focus a unit to name it. Choose one to mark it below.'}
        </span>
        <span className="y3-land-src">{caption}</span>
      </figcaption>
    </figure>
  )
}
