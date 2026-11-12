// Dot Column Timer (spec 7.4 #28): columns of 30 dots, columns = ceil(planned minutes / 30) and at most 5; one
// solid disc per elapsed minute, the rest rings; the next-to-fill dot is a ring with a 2 px edge, a half disc when
// paused. The last column is partial when the plan is not a multiple of 30. Nothing flashes, nothing is announced:
// role="timer" is deliberately not used (it would announce), the minute count is plain text at aria-live="off" and
// the parent re-renders it once a minute. An early end leaves the filled dots standing; nothing dies.
import { useMemo } from 'react'
import { Figure } from './frame'
import { MAX_TIMER_DOTS, timerLayout } from './geometry'
import type { ArtState } from './state'

export interface DotTimerProps {
  plannedMin: number
  /** Whole minutes elapsed; the caller ticks it once a minute, so the component owns no timer and no loop. */
  elapsedMin: number
  paused?: boolean
  ended?: boolean
  /** No session running: a small row of five rings. */
  resting?: boolean
  /** A timer is a clock reading: it says whether the clock is live. */
  state: ArtState
  compact?: boolean
  caption?: string
}

export function DotTimer({ plannedMin, elapsedMin, paused = false, ended = false, resting = false, state, compact = false, caption = 'Session length in minutes' }: DotTimerProps) {
  const pitch = compact ? 9 : 12
  const r = compact ? 3 : 4
  const lay = useMemo(() => timerLayout(plannedMin, elapsedMin, paused), [plannedMin, elapsedMin, paused])
  const colW = pitch + 14
  const w = Math.max(1, lay.columns) * colW
  const h = (resting ? 1 : Math.min(30, lay.total)) * pitch + 4
  const text = resting
    ? 'No session running'
    : `${lay.filled} of ${Math.round(Math.min(plannedMin, 1e6))} minutes${paused ? ', paused' : ''}${ended ? ', ended early' : ''}`
  return (
    <Figure component="dot-timer" state={state} caption={caption}>
      {resting ? (
        <svg className="art-svg" viewBox={`0 0 ${5 * pitch + 4} ${pitch + 4}`} width={5 * pitch + 4} height={pitch + 4} aria-hidden="true" focusable="false">
          {[0, 1, 2, 3, 4].map((i) => (
            <circle key={i} className="art-stroke" cx={pitch / 2 + 2 + i * pitch} cy={pitch / 2 + 2} r={r} />
          ))}
        </svg>
      ) : (
        <svg className="art-svg" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true" focusable="false" data-columns={lay.columns}>
          {lay.dots.map((d, i) => {
            const cx = d.col * colW + pitch / 2 + 2
            const cy = d.row * pitch + pitch / 2 + 2
            return d.kind === 'filled' ? (
              <circle key={i} className="art-solid" data-dot="filled" cx={cx} cy={cy} r={r} />
            ) : d.kind === 'half' ? (
              <g key={i} data-dot="half">
                <circle className="art-stroke" cx={cx} cy={cy} r={r} />
                <path className="art-solid" d={`M${cx} ${cy - r}a${r} ${r} 0 0 0 0 ${2 * r}z`} />
              </g>
            ) : (
              <circle key={i} className={d.kind === 'next' ? 'art-stroke art-next' : 'art-stroke art-dim-ring'} data-dot={d.kind} cx={cx} cy={cy} r={r} />
            )
          })}
        </svg>
      )}
      <p className="art-readout art-mono" aria-live="off" data-timer-text="">{text}</p>
      {lay.capped ? <p className="art-readout">{`Showing the first ${MAX_TIMER_DOTS} minutes of ${Math.round(plannedMin)}.`}</p> : null}
    </Figure>
  )
}
