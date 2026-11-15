import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useEscStack } from './overlay'
import { cx, tokenMs } from './util'

export interface PopoverProps {
  open: boolean
  onClose: () => void
  /** The element it hangs from. Focus returns to it when the popover closes by Esc. */
  anchor: RefObject<HTMLElement | null>
  placement?: 'bottom' | 'top'
  /** Accessible name; a popover is a small dialog (Day shape, Log minutes). */
  label: string
  className?: string
  children?: ReactNode
}

/**
 * Opens in 160 ms (opacity + 8 px), closes in 120 ms, closes on Esc and on a press outside it.
 * It is placed once, when it opens, from the anchor's rectangle: there is no scroll or resize
 * listener (the scroll listener is lint-banned and a popover that follows a scrolling anchor is
 * a rAF loop that nothing needs), so a page that scrolls under an open popover closes it by the
 * outside press that scroll gestures produce, or the caller closes it.
 */
export function Popover({ open, onClose, anchor, placement = 'bottom', label, className, children }: PopoverProps) {
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)
  const [pos, setPos] = useState<CSSProperties>({})
  const box = useRef<HTMLDivElement>(null)
  const fixes = useRef(0)

  useLayoutEffect(() => {
    if (open) {
      fixes.current = 0
      setMounted(true)
      setClosing(false)
      const a = anchor.current?.getBoundingClientRect()
      if (a) setPos(placement === 'bottom' ? { insetBlockStart: a.bottom + 8, insetInlineStart: a.left } : { insetBlockEnd: window.innerHeight - a.top + 8, insetInlineStart: a.left })
    } else if (mounted) setClosing(true)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  // VIS1: placed from the anchor, then kept inside the viewport once its own size is known (the tree settings popover hung 52 px off the
  // right edge at 1366 px because its anchor sits at the right of the tool row). Horizontal and vertical offsets are read without
  // the entrance's translate, and the position only moves when it overflows, so this settles in one pass.
  useLayoutEffect(() => {
    const b = box.current
    if (!mounted || closing || !b || (b.offsetWidth === 0 && b.offsetHeight === 0)) return // not laid out (a test DOM): nothing to measure
    if (fixes.current >= 3) return // a layout that cannot be satisfied must not loop
    const m = 8
    const vw = document.documentElement.clientWidth
    const vh = window.innerHeight
    const left = Math.max(m, Math.min(b.offsetLeft, vw - m - b.offsetWidth))
    const top = Math.max(m, Math.min(b.offsetTop, vh - m - b.offsetHeight))
    if (Math.abs(left - b.offsetLeft) > 0.5 || Math.abs(top - b.offsetTop) > 0.5) {
      fixes.current += 1
      setPos({ insetInlineStart: left, insetBlockStart: top })
    }
  }, [mounted, closing, pos])
  useEffect(() => {
    if (!closing) return
    const t = setTimeout(() => {
      setMounted(false)
      setClosing(false)
    }, tokenMs(box.current, '--dur-popover-out', 120))
    return () => clearTimeout(t)
  }, [closing])

  useEscStack(open, () => {
    onClose()
    anchor.current?.focus({ preventScroll: true })
  })
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      const t = e.target as Node
      if (box.current?.contains(t) || anchor.current?.contains(t)) return
      onClose()
    }
    document.addEventListener('pointerdown', down)
    return () => document.removeEventListener('pointerdown', down)
  }, [open, onClose, anchor])

  if (!mounted) return null
  return createPortal(
    <div className="ww-portal" data-section="wellwisher">
      <div ref={box} className={cx('ww-popover', className)} data-state={closing ? 'closing' : 'open'} role="dialog" aria-label={label} style={pos}>
        {children}
      </div>
    </div>,
    document.body,
  )
}
