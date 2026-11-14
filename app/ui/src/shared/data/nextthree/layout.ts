// NextThree, the pure part (spec 21.5 rule 7): the list is arithmetic first, so this file only shows what it was given.
// At most three rows, never padded: two items draw two rows, none draws the hollow form.
import type { LampState } from '../../kit'

export const MAX_ROWS = 3

export interface NextItem {
  id: string
  /** One short action: "Redo Unit 3 questions 4 to 9". */
  title: string
  /** One line saying why this one: "your lowest first-try share, 9 attempts". */
  reason: string
  state: LampState
  /** The arithmetic behind the rank, printed in mono on focus: { weak: 0.42, due: 1 }. */
  scores?: Record<string, number>
}

export function visibleRows(items: readonly NextItem[]): NextItem[] {
  return items.slice(0, MAX_ROWS)
}

/** "weak 0.42 / due 1.00": the same numbers in the same order as given. */
export function scoreText(scores: Record<string, number> | undefined): string {
  if (!scores) return ''
  return Object.entries(scores).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' / ')
}
