// The habit ribbon (spec 20.6.5, C04-15): a row of day cells that subdivide as more is logged, so a finer cell is a longer log. A cell
// with nothing logged is a neutral inset, never a gap in a chain. Read-only, static (no animation at all), deterministic from the log.
// The caption says what the cells are: "cells = what you logged; fewer is fine". Two forms read the same: the drawing and the sentence.
import { showsNumber, type LampState } from '../../../shared/lamp'
import type { RibbonCell } from './model'

const CELL = 14
const GAP = 2

export interface HabitRibbonProps {
  cells: readonly RibbonCell[]
  state: LampState
  /** The habit's name, for the accessible label. */
  name: string
}

export function HabitRibbon({ cells, state, name }: HabitRibbonProps) {
  const ready = showsNumber(state)
  const w = cells.length * (CELL + GAP) - GAP
  const total = cells.reduce((s, c) => s + c.count, 0)
  return (
    <figure className="lg-ribbon" data-lamp={state}>
      <svg viewBox={`0 0 ${w} ${CELL}`} className="lg-ribbon-svg" role="img" aria-label={ready ? `${name}: your own log over ${cells.length} days, ${total} logged` : `${name}: no log to draw, ${state}`} focusable="false">
        {cells.map((c, i) => {
          const x = i * (CELL + GAP)
          const g = ready ? c.grid : 0
          if (g === 0) return <rect key={c.date} className="lg-cell-none" x={x} y={0} width={CELL} height={CELL} rx={3} />
          const side = (CELL - 2) / g
          return (
            <g key={c.date} transform={`translate(${x + 1} 1)`}>
              {Array.from({ length: g * g }, (_, k) => (
                <rect key={k} className={k < c.tiles ? 'lg-tile-on' : 'lg-tile-off'} x={(k % g) * side + 0.5} y={Math.floor(k / g) * side + 0.5} width={Math.max(1, side - 1)} height={Math.max(1, side - 1)} rx={g === 1 ? 3 : 1} />
              ))}
            </g>
          )
        })}
      </svg>
      <figcaption>cells = what you logged; fewer is fine</figcaption>
    </figure>
  )
}
