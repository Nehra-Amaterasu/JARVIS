import { createContext, useContext, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { cx } from './util'

interface OrderCtx {
  register: (el: HTMLElement) => () => void
}
const Ctx = createContext<OrderCtx | null>(null)

/** The ids of `[data-section]` elements under `root`, in document order: the order the contract tests compare to the plan. */
export function sectionOrder(root: ParentNode): string[] {
  return [...root.querySelectorAll<HTMLElement>('[data-section]')].map((e) => e.dataset.section!)
}

/**
 * Collects the sections mounted below it and reports their ids in DOCUMENT order whenever one mounts
 * or unmounts. Registration order alone would be wrong for a section that mounts later (a card
 * that appears after load), so the list is re-sorted with compareDocumentPosition each time.
 */
export function SectionOrder({ onOrder, children }: { onOrder: (ids: string[]) => void; children: ReactNode }) {
  const els = useRef(new Set<HTMLElement>())
  const cb = useRef(onOrder)
  cb.current = onOrder
  const ctx = useMemo<OrderCtx>(() => {
    const notify = () => {
      const sorted = [...els.current].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
      cb.current(sorted.map((e) => e.dataset.section!))
    }
    return {
      register(el) {
        els.current.add(el)
        notify()
        return () => {
          els.current.delete(el)
          notify()
        }
      },
    }
  }, [])
  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>
}

export interface SectionProps {
  /** The stable section id from the plan (3.3), e.g. "L1" or "S3". Makes placement testable. */
  id: string
  /** The one line that says what this section is for; read by the contract tests and by screen readers. */
  hint: string
  /**
   * This section holds the page's primary action. It marks the section (`data-has-primary`); the single
   * `data-primary` fill itself is granted to one control by PrimaryOwner, so the whole tree still
   * carries exactly one `data-primary`.
   */
  primary?: boolean
  as?: 'section' | 'div' | 'aside' | 'nav'
  'aria-label'?: string
  'aria-labelledby'?: string
  className?: string
  children?: ReactNode
}

export function Section({ id, hint, primary, as: Tag = 'section', className, children, ...aria }: SectionProps) {
  const ref = useRef<HTMLElement>(null)
  const order = useContext(Ctx)
  useLayoutEffect(() => (ref.current && order ? order.register(ref.current) : undefined), [order])
  return (
    <Tag ref={ref as never} className={cx('ww-section', className)} data-section={id} data-hint={hint} data-has-primary={primary ? 'true' : undefined} {...aria}>
      {children}
    </Tag>
  )
}
