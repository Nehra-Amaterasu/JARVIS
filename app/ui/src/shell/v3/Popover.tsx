/**
 * The opaque popover of the top plate (design-language-v3.md 2.1: a popover is solid, it never blurs). One wrapper holds a
 * trigger and its panel so that Escape closes the panel from anywhere inside it and puts focus back on the trigger (3.5), a
 * press outside closes it, and tabbing out of it closes it.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'

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

const ChooseCtx = createContext<((action?: () => void) => void) | null>(null)

/**
 * What a row of a popover calls when it is chosen: close the panel, put focus back on the trigger, THEN act. The row unmounts
 * with the panel, so without this focus falls to <body>, and an overlay the action opens would record <body> as its opener
 * and return focus to nothing on Escape.
 */
export function usePopoverChoose(): (action?: () => void) => void {
  const c = useContext(ChooseCtx)
  return c ?? ((a) => a?.())
}

export function Popover({ open, onClose, triggerRef, trigger, label, align = 'right', className, panelClassName, children }: PopoverProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const choose = useCallback((action?: () => void) => {
    onClose()
    triggerRef.current?.focus()
    action?.()
  }, [onClose, triggerRef])
  const chooseValue = useMemo(() => choose, [choose])
  // focus moves into the panel on open, to its first key (a keyboard user does not have to tab in); Escape and a choice bring it back
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])')?.focus()
  }, [open])
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
        <div ref={panel} className={`s3-pop${panelClassName ? ` ${panelClassName}` : ''}`} data-align={align} role="dialog" aria-label={label}>
          <ChooseCtx.Provider value={chooseValue}>{children}</ChooseCtx.Provider>
        </div>
      )}
    </div>
  )
}
