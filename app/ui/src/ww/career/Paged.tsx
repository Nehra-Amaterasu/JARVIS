// The pager: the plan's answer to "no page scroll" (owner rule, 10 Nov). A list sits in a box that is
// as tall as the canvas lets it be; the box shows as many fixed-height rows as fit, and Previous / Next
// reach the rest. Nothing here scrolls and nothing is hidden: "6 to 10 of 23" always says where you are.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { IconButton } from '../kit'
import { paginate, rowsThatFit } from './model'

/**
 * How many rows fit in the list box. The row height is the CSS variable `--cr-row` on the box (so the
 * number is in one place, the stylesheet); `fallback` is used where there is no layout engine (happy-dom)
 * and for the first paint, before the box has been measured.
 */
export function useFit(fallback: number) {
  const [size, setSize] = useState(fallback)
  const box = useRef<HTMLDivElement | null>(null)
  const measure = useCallback(() => {
    const el = box.current
    if (!el || typeof getComputedStyle !== 'function') return
    const row = parseFloat(getComputedStyle(el).getPropertyValue('--cr-row'))
    setSize(rowsThatFit(el.clientHeight, row, fallback))
  }, [fallback])
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      box.current = el
      if (el) measure()
    },
    [measure],
  )
  useLayoutEffect(measure, [measure])
  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure])
  return { size, ref }
}

export interface PagedProps<T> {
  items: readonly T[]
  rowKey: (item: T) => string
  row: (item: T) => ReactNode
  /** Rows per page where nothing can be measured. */
  fallback?: number
  /** The list's accessible name; the pager's buttons are named from it. */
  label: string
  /** Said in words when there is nothing to list. */
  empty: ReactNode
}

export function Paged<T>({ items, rowKey, row, fallback = 6, label, empty }: PagedProps<T>) {
  const { size, ref } = useFit(fallback)
  const [page, setPage] = useState(0)
  const p = paginate(items, page, size)
  // a shorter list or a taller window can leave the page past the end; follow it back
  useEffect(() => {
    if (p.page !== page) setPage(p.page)
  }, [p.page, page])
  return (
    <>
      <div className="cr-list" ref={ref} role="list" aria-label={label}>
        {items.length === 0 ? <div className="cr-empty">{empty}</div> : p.rows.map((it) => <div role="listitem" className="cr-item" key={rowKey(it)}>{row(it)}</div>)}
      </div>
      {/* the slot keeps its height when there is one page: a pager that appears would shrink the box, change the row count and could flip the page count back */}
      <div className="cr-pager-slot">
        {p.pages > 1 && (
        <nav className="cr-pager" aria-label={`${label}, pages`} data-pager="">
          <IconButton label={`Previous ${label}`} size="sm" grouped disabled={p.page === 0} aria-disabled={p.page === 0} onClick={() => p.page > 0 && setPage(p.page - 1)}>
            <ChevronLeft size={16} aria-hidden="true" />
          </IconButton>
          <span className="cr-pager-text" role="status" aria-live="polite" data-pager-text="">
            {p.from} to {p.to} of {p.total}
          </span>
          <IconButton label={`Next ${label}`} size="sm" grouped disabled={p.page >= p.pages - 1} aria-disabled={p.page >= p.pages - 1} onClick={() => p.page < p.pages - 1 && setPage(p.page + 1)}>
            <ChevronRight size={16} aria-hidden="true" />
          </IconButton>
        </nav>
        )}
      </div>
    </>
  )
}
