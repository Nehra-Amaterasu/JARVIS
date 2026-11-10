/**
 * The owner's no-scroll rule (9 Nov): a Setup view or an overlay must fit 1366x768 without scrolling, so a list
 * that can grow is shown a few rows at a time with Previous and Next, never as a long page. This is the one
 * pager every list uses (subjects, units, goals, class slots, deadlines, the date sheet's papers).
 *
 * Page sizes are chosen from measured heights at 1366x768 (e2e/overlays.spec.ts reports the leftover pixels), not
 * guessed: a row of five fields wraps to two lines at the centre pane's width, about 130 px.
 *
 * `usePaged` keeps the page in state and clamps it when the list shrinks, so removing the last row of the last
 * page lands on the new last page, not on an empty one. `jumpToLast` is for "Add": the new row is on the page you see.
 */
import { useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { IconButton } from '../kit'

export interface Paged {
  page: number
  pages: number
  from: number
  to: number
  total: number
  size: number
  go: (p: number) => void
  jumpToLast: (nextTotal: number) => void
  slice: <T>(items: T[]) => { item: T; index: number }[]
}

export function usePaged(total: number, size: number): Paged {
  const [raw, setRaw] = useState(0)
  const pages = Math.max(1, Math.ceil(total / size))
  const page = Math.min(raw, pages - 1)
  const from = total === 0 ? 0 : page * size + 1
  const to = Math.min(total, (page + 1) * size)
  return {
    page, pages, from, to, total, size,
    go: (p) => setRaw(Math.max(0, Math.min(pages - 1, p))),
    jumpToLast: (n) => setRaw(Math.max(0, Math.ceil(n / size) - 1)),
    slice: (items) => items.slice(page * size, (page + 1) * size).map((item, i) => ({ item, index: page * size + i })),
  }
}

/** "Subjects 1 to 2 of 5" with Previous and Next. `children` sit at the end of the same line (an Add button), so a toolbar costs one row. */
export function PagerBar({ p, noun, nounSingular, children }: { p: Paged; noun: string; nounSingular?: string; children?: ReactNode }) {
  if (p.pages <= 1) return children ? <div className="su-pager" data-pager="">{children}</div> : null
  const range = p.size === 1 ? `${nounSingular ?? noun} ${p.from} of ${p.total}` : `${noun} ${p.from} to ${p.to} of ${p.total}`
  return (
    <div className="su-pager" role="group" aria-label={`${noun} pages`} data-pager="">
      <IconButton label={`Previous ${noun}`} size="sm" aria-disabled={p.page === 0 || undefined} onClick={() => p.go(p.page - 1)}>
        <ChevronLeft size={16} aria-hidden="true" />
      </IconButton>
      <span className="su-pager-text" aria-live="polite">{range}</span>
      <IconButton label={`Next ${noun}`} size="sm" aria-disabled={p.page >= p.pages - 1 || undefined} onClick={() => p.go(p.page + 1)}>
        <ChevronRight size={16} aria-hidden="true" />
      </IconButton>
      {children}
    </div>
  )
}
