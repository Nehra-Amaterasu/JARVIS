// Contour and Ridgeline Chart (spec 7.4 #25): up to 24 rows, each a 1.5 px path with hidden-line occlusion by
// painting every row's closed shape in the ground colour, back to front. Plain SVG, no canvas, no WebGL; the
// frame is at most 720 x 360 (spec 8.1) and a row is down-sampled to 160 points, so a long series costs O(n) once
// per data change. `state` is required: SIMULATED stamps the word inside the frame, WAITING is an empty frame.
// Tab reaches the chart, Up/Down change the active row, and the table lists every row.
import { useMemo, useState, type KeyboardEvent } from 'react'
import { ArtTable, Figure } from './frame'
import { MAX_ROWS, ridgePaths, type RidgeRow } from './geometry'
import type { ArtState } from './state'

export interface RidgeProps {
  rows: readonly RidgeRow[]
  state: ArtState
  /** Where the series comes from; the caption plate says it (spec: "caption plate states the source"). */
  source: string
  reason?: string
  width?: number
  height?: number
  unit?: string
}

export function Ridge({ rows, state, source, reason, width = 720, height = 360, unit = '' }: RidgeProps) {
  const w = Math.min(720, Math.max(120, width))
  const h = Math.min(360, Math.max(80, height))
  const reading = state === 'live' || state === 'simulated'
  const shape = useMemo(() => (reading ? ridgePaths(rows, w, h) : { rows: [], max: 0 }), [rows, w, h, reading])
  const [row, setRow] = useState(0)
  const n = shape.rows.length
  const at = Math.min(row, Math.max(0, n - 1))
  const onKey = (e: KeyboardEvent) => {
    if (n === 0) return
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      setRow(Math.min(n - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1))))
    }
  }
  const cur = shape.rows[at]
  return (
    <Figure component="ridge" state={state} caption={`Source: ${source}`} reason={reason}>
      <svg
        className="art-svg"
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
        role="group"
        tabIndex={0}
        aria-label={`Ridgeline chart, ${n} of at most ${MAX_ROWS} rows, ${state}. Up and Down arrows change the row.`}
        onKeyDown={onKey}
      >
        <rect className="art-recess" x={0} y={0} width={w} height={h} />
        {shape.rows.map((r, i) => (
          <g key={i} data-row={i} data-active={i === at || undefined}>
            <path className="art-ground" d={r.fill} />
            <path className={i === at ? 'art-ridge-line art-ridge-active' : 'art-ridge-line'} d={r.line} fill="none">
              <title>{`${r.label}: peak ${Math.round(r.peak * shape.max * 100) / 100}${unit}`}</title>
            </path>
          </g>
        ))}
        {state === 'simulated' ? (
          <text className="art-stamp" x={w - 12} y={22} textAnchor="end">SIMULATED</text>
        ) : null}
        {!reading ? (
          <text className="art-label" x={w / 2} y={h / 2} textAnchor="middle">{state === 'waiting' ? 'no report' : state}</text>
        ) : null}
      </svg>
      <p className="art-readout" aria-live="polite">
        {cur ? `${cur.label}: peak ${Math.round(cur.peak * shape.max * 100) / 100}${unit}` : 'No rows'}
      </p>
      <ArtTable
        caption={`Ridgeline rows (${source})`}
        head={['Row', `Peak${unit ? ` (${unit})` : ''}`]}
        rows={shape.rows.map((r) => [r.label, Math.round(r.peak * shape.max * 100) / 100])}
      />
    </Figure>
  )
}
