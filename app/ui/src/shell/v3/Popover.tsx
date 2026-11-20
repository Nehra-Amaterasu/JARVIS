/**
 * The opaque popover of the top plate (design-language-v3.md 2.1: a popover is solid, it never blurs). One wrapper holds a
 * trigger and its panel so that Escape closes the panel from anywhere inside it and puts focus back on the trigger (3.5), a
 * press outside closes it, and tabbing out of it closes it.
 */
import { useEffect, useRef, type ReactNode, type RefObject } from 'react'

export interface PopoverProps {
  open: boolean
  onClose: () => void
  /** The key that opens it; focus returns here on Escape. */
  triggerRef: RefObject<HTMLElement | null>
  trigger: ReactNode
  /** The panel's accessible name. */
  label: string
  align?: 'left' | 'right'
  className?: string
  panelClassName?: string
  children: ReactNode
}

export function Popover({ open, onClose, triggerRef, trigger, label, align = 'right', className, panelClassName, children }: PopoverProps) {
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', down, true)
    return () => document.removeEventListener('pointerdown', down, true)
  }, [open, onClose])
  return (
    <div ref={wrap} className={`s3-pwrap${className ? ` ${className}` : ''}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.preventDefault()
          e.stopPropagation()
          onClose()
          triggerRef.current?.focus()
        }
      }}
      onBlur={(e) => {
        if (open && e.relatedTarget && !wrap.current?.contains(e.relatedTarget as Node)) onClose()
      }}>
      {trigger}
      {open && (
        <div className={`s3-pop${panelClassName ? ` ${panelClassName}` : ''}`} data-align={align} role="group" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  )
}
