// StippleStrip (package L01): minutes done as a row of up to 12 dots, one per 15 minutes, then a plus. It is a drawing of a
// quantity, so the caller draws it only when the source lamp is LIVE or SIMULATED (cellView returns null dots otherwise).
import { dotsFor } from './model'

export interface StippleStripProps {
  /** The minutes done; the dots and the plus follow from it. A cell passes the dots it already counted instead. */
  minutes?: number
  dots?: number
  more?: boolean
  /** Inside a cell that already says the figure in its name. */
  decorative?: boolean
  className?: string
}

export function StippleStrip({ minutes = 0, dots, more, decorative, className }: StippleStripProps) {
  const from = dots === undefined ? dotsFor(minutes) : { dots, more: !!more }
  return (
    <span
      className={className ? `alm-strip ${className}` : 'alm-strip'}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : `${Math.round(minutes)} minutes`}
      aria-hidden={decorative ? 'true' : undefined}
      data-dots={from.dots}
    >
      {Array.from({ length: from.dots }, (_, i) => <i key={i} />)}
      {from.more && <b>+</b>}
    </span>
  )
}
