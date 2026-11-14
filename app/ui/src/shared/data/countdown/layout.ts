// CountdownDots, the pure part (spec 21.5): how many dots, how many are filled, and the one sentence that says it.
// A dot per day, at most 60 (60 x 8 px dots in three rows of 20 is the widest the Ahead callout allows). Past 60 days
// the row shows the last 60 and says how many earlier days it leaves out, so the dots always equal real days.
export const MAX_DOTS = 60
export const PER_ROW = 20

export interface DotModel {
  /** Dots drawn, 0 to 60. */
  total: number
  /** Dots filled: days already lived inside the window. Only ever grows as `lived` grows, so a dot never refills. */
  filled: number
  /** Days that fall before the first dot (when the span is longer than 60 days). */
  hidden: number
}

const whole = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0)

export function dotModel(daysLeft: number, lived = 0): DotModel {
  const left = whole(daysLeft)
  const done = whole(lived)
  const span = left + done
  const total = Math.min(MAX_DOTS, span)
  const hidden = span - total
  // the window is the final `total` days, so the filled dots are the days lived that fall inside it
  const filled = Math.max(0, total - left)
  return { total, filled, hidden }
}

/** The text twin and the printed line. A plain count, never urgency wording, the same words on day 60 and day 2. */
export function countdownText(daysLeft: number, to: string): string {
  const n = whole(daysLeft)
  if (n === 0) return `${to} is today`
  return `${n} ${n === 1 ? 'day' : 'days'} to ${to}`
}
