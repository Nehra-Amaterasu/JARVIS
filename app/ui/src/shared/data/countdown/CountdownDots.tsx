// CountdownDots (spec 21.5, package DB01): one 8 px dot per day to a date, 60 at most. A dot fills as a day is lived and
// never refills; nothing changes colour near the end, no bar runs toward zero, no wording says "only". Nothing moves.
// LIVE and SIMULATED draw the dots; WAITING, PLANNED and FAULT draw a dashed row and the reason, never a count.
import { Lamp, lampText, showsValue, type LampState } from '../../kit'
import { countdownText, dotModel, PER_ROW } from './layout'
import './countdown.css'

export interface CountdownDotsProps {
  /** Days left to the date (whole days). */
  daysLeft: number
  /** Days already lived since the span began; with `daysLeft` it sets how many dots there are. */
  lived?: number
  /** What the days count to, in plain words: "the first paper", "Unit 3 test". */
  to: string
  state: LampState
  reason?: string
  className?: string
}

export function CountdownDots({ daysLeft, lived = 0, to, state, reason, className }: CountdownDotsProps) {
  const draws = showsValue(state)
  const m = dotModel(daysLeft, lived)
  const why = draws ? null : lampText(state, reason ?? (state === 'waiting' ? 'no date on file' : undefined))
  const line = draws ? countdownText(daysLeft, to) : `${to}: no count, ${why}`
  const rows = Math.max(1, Math.ceil((draws ? m.total : PER_ROW) / PER_ROW))
  return (
    <figure className={`dg-cd${className ? ` ${className}` : ''}`} data-component="countdown-dots" data-grammar="ascii" data-state={state} data-form={draws ? 'dots' : 'hollow'} aria-label={line} role="group">
      {draws ? (
        <div className="dg-cd-grid" data-rows={rows} aria-hidden="true" data-filled={m.filled} data-total={m.total}>
          {Array.from({ length: m.total }, (_, i) => <span key={i} className="dg-cd-dot" data-lived={i < m.filled ? 'true' : 'false'} />)}
        </div>
      ) : (
        <div className="dg-cd-grid dg-cd-hollow" aria-hidden="true"><span className="dg-cd-dash" /></div>
      )}
      <figcaption className="dg-cd-cap" aria-hidden="true">
        <span className="dg-cd-line">{draws ? line : why}</span>
        {draws && m.hidden > 0 && <span className="dg-cd-more">{m.hidden} earlier days not drawn</span>}
        <span className="dg-cd-meta">
          <Lamp state={state} reason={reason} />
          {state === 'simulated' && draws && <span className="dg-stamp">SIMULATED</span>}
        </span>
      </figcaption>
    </figure>
  )
}
