// Annotated Callout (spec 7.4 #26): a 1 px leader from a point to a plate with a mono label and one value.
// At most 6 per view, and the plates never overlap: placePlates stacks them in two columns by construction.
// Planned callouts are dashed; a fault callout carries a triangle. Each plate is a tab stop and focusing it
// highlights its target point. No picture of a body is ever drawn (the spec refuses the anatomy references).
import { useMemo, useState, type ReactNode } from 'react'
import { ArtTable, Figure, clip } from './frame'
import { MAX_CALLOUTS, placePlates } from './geometry'

export interface CalloutPoint {
  id: string
  x: number
  y: number
  label: string
  value: string
  status?: 'normal' | 'planned' | 'fault'
}

export interface CalloutProps {
  points: readonly CalloutPoint[]
  width?: number
  height?: number
  caption: string
  /** The layer drawn behind the points (a floor plan, a wall box). Decorative; the table carries the meaning. */
  backdrop?: ReactNode
}

const PW = 140
const PH = 40

export function Callout({ points, width = 560, height = 300, caption, backdrop }: CalloutProps) {
  const list = useMemo(() => points.slice(0, MAX_CALLOUTS), [points])
  const placed = useMemo(() => placePlates(list, width, height, PW, PH), [list, width, height])
  const byId = useMemo(() => new Map(list.map((p) => [p.id, p])), [list])
  const [on, setOn] = useState<string | null>(null)
  return (
    <Figure component="callout" caption={caption}>
      <svg className="art-svg" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="group" aria-label={`Callouts, ${list.length} of at most ${MAX_CALLOUTS}. ${caption}`}>
        <g aria-hidden="true">{backdrop}</g>
        {placed.map((pl) => {
          const p = byId.get(pl.id)!
          const status = p.status ?? 'normal'
          const hot = on === pl.id
          return (
            <g key={pl.id} className="art-callout" data-callout={pl.id} data-status={status} data-hot={hot || undefined}>
              <line className="art-leader" x1={pl.ax} y1={pl.ay} x2={pl.x} y2={pl.y} strokeDasharray={status === 'planned' ? '3 3' : undefined} />
              <circle className={hot ? 'art-solid' : 'art-stroke'} cx={pl.x} cy={pl.y} r={hot ? 6 : 4} />
              <g
                className="art-plate-g"
                role="group"
                tabIndex={0}
                aria-label={`${p.label}, ${p.value}${status === 'normal' ? '' : `, ${status}`}`}
                onFocus={() => setOn(pl.id)}
                onBlur={() => setOn((cur) => (cur === pl.id ? null : cur))}
              >
                <rect className="art-plate-rect" x={pl.px} y={pl.py} width={PW} height={PH} strokeDasharray={status === 'planned' ? '3 3' : undefined} />
                <text className="art-label" x={pl.px + 8} y={pl.py + 15}>{clip(p.label, 17)}</text>
                <text className="art-num-small" x={pl.px + 8} y={pl.py + 32}>{clip(p.value, 17)}</text>
                {status === 'fault' ? <path className="art-stroke" d={`M${pl.px + PW - 18} ${pl.py + 26}l6-11 6 11z`} /> : null}
              </g>
            </g>
          )
        })}
      </svg>
      <ArtTable caption={`${caption} (callouts)`} head={['Point', 'Value', 'Status']} rows={list.map((p) => [p.label, p.value, p.status ?? 'normal'])} />
    </Figure>
  )
}
