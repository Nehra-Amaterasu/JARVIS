// The counting of the Paper Desk (package Y01): "k of N" and its Wilson interval. Patterns here are counts, never forecasts:
// a topic "set in 4 of 6 papers" is a fact about papers on file, and the interval says how little 6 papers can pin down.

/** Fewer papers than this and no pattern is drawn: the figure is WAITING and says so. */
export const MIN_PAPERS = 3

export interface Interval {
  lo: number
  hi: number
}

/**
 * The Wilson score interval for k successes of n at 95 percent (z = 1.96). Chosen over the plain k/n +- 1.96 sqrt(p(1-p)/n)
 * because that one runs outside 0 to 1 and collapses to a point at k = 0 or k = n; with 6 papers a topic set in all 6 still
 * has a lower bound of 0.61, not 1.00, which is the honest width of 6 papers. n = 0 gives the whole range.
 */
export function wilson(k: number, n: number, z = 1.96): Interval {
  if (!(n > 0)) return { lo: 0, hi: 1 }
  const kk = Math.min(Math.max(k, 0), n)
  const p = kk / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const centre = (p + z2 / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) }
}

/** "4 of 6". The words, never a slash, so a screen reader and a printout read the same. */
export const countText = (k: number, n: number): string => `${k} of ${n}`

/** The interval in words, whole percent: "95% interval 30 to 90 percent". */
export function intervalText(k: number, n: number): string {
  const { lo, hi } = wilson(k, n)
  return `95% interval ${Math.round(lo * 100)} to ${Math.round(hi * 100)} percent`
}

export const TOO_FEW = 'too few papers to show a pattern'
export const ONE_PAPER = '1 paper: counts only, no pattern yet'

/** What the pattern column may say for N papers: a figure (3 or more), the ONE_PAPER line, or the too-few line. */
export function patternState(n: number): 'figure' | 'counts-only' | 'too-few' {
  if (n >= MIN_PAPERS) return 'figure'
  return n === 1 ? 'counts-only' : 'too-few'
}
