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

  useLayoutEffect(() => {
    if (open) {
      setMounted(true)
      setClosing(false)
      const a = anchor.current?.getBoundingClientRect()
      if (a) setPos(placement === 'bottom' ? { insetBlockStart: a.bottom + 8, insetInlineStart: a.left } : { insetBlockEnd: window.innerHeight - a.top + 8, insetInlineStart: a.left })
    } else if (mounted) setClosing(true)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
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
