// The Core drawers (Anatomy, Earlier): 560 x 652 at 1366 x 768, a native <dialog> opened modal, so focus moves in, the
// background is inert, Esc closes and Tab stays inside without a hand-rolled trap. Focus goes back to whatever opened it.
// The kit Drawer is drawn by the Well Wisher sheet stylesheet, which a JARVIS-only page does not load; this one carries
// its own few rules in core.css. No transition: the drawer appears and leaves in one frame (nothing to reduce).
import { useEffect, useId, useRef, type ReactNode } from 'react'
import './core.css'

export interface CoreDrawerProps {
  open: boolean
  onClose: () => void
  title: string
  /** The bracket tag before the title, e.g. "SYS". */
  tag: string
  children?: ReactNode
}

export function CoreDrawer({ open, onClose, title, tag, children }: CoreDrawerProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const id = useId()
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      if (typeof d.showModal === 'function') d.showModal()
      else d.setAttribute('open', '')
      d.querySelector<HTMLElement>('[data-drawer-first]')?.focus()
    } else if (!open && d.open) {
      if (typeof d.close === 'function') d.close()
      else d.removeAttribute('open')
      const back = opener.current
      opener.current = null
      if (back && document.contains(back)) back.focus()
    }
  }, [open])
  return (
    <dialog
      ref={ref} className="jc-drawer" aria-labelledby={id}
      onCancel={(e) => { e.preventDefault(); onClose() }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="jc-drawer-in" data-scene="immersive">
        <header className="jc-drawer-head">
          <h2 id={id}><span className="jc-tag">[{tag}]</span> {title}</h2>
          <button type="button" className="jc-key" data-drawer-first="" onClick={onClose}>Close</button>
        </header>
        <div className="jc-drawer-body">{open ? children : null}</div>
      </div>
    </dialog>
  )
}
