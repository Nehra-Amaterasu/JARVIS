// The Sound drawer (library, spoken words, music folder): a native <dialog> opened modal, so focus moves in, the rest is
// inert, Esc closes and Tab stays inside without a hand-rolled trap; focus goes back to whatever opened it. Opaque, 560 px
// at 1366 x 768 (the whole screen on a phone). A section opened from inside it (the tools list opens pronunciation or the
// library) changes the body in place: the head gains Back, the focus moves to the head's first key, and Esc still returns
// the focus to the key outside that opened the drawer. It carries its own few rules in sound.css because the kit Drawer is drawn by
// the Well Wisher sheet stylesheet, which a JARVIS-only page does not load. No transition, so there is nothing to reduce.
import { ArrowLeft } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import './sound.css'

export interface SoundDrawerProps {
  open: boolean
  onClose: () => void
  /** Back to the list this section was opened from; drawn only when given. */
  onBack?: () => void
  title: string
  /** The bracket tag before the title, e.g. "LIB". */
  tag: string
  children?: ReactNode
}

export function SoundDrawer({ open, onClose, onBack, title, tag, children }: SoundDrawerProps) {
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
  // a new section inside an open drawer: the focus moves to its head, so a keyboard reader lands on the new body's first key
  useEffect(() => {
    const d = ref.current
    if (open && d?.open) d.querySelector<HTMLElement>('[data-drawer-first]')?.focus()
  }, [open, title])
  return (
    <dialog
      ref={ref}
      className="sd-drawer"
      aria-labelledby={id}
      onCancel={(e) => { e.preventDefault(); onClose() }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="sd-drawer-in" data-scene="immersive">
        <header className="sd-drawer-head">
          {onBack && <button type="button" className="sd-key" data-drawer-first="" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />Back</button>}
          <h2 id={id}><span className="sd-tag">[{tag}]</span> {title}</h2>
          <button type="button" className="sd-key" data-drawer-first={onBack ? undefined : ''} onClick={onClose}>Close</button>
        </header>
        <div className="sd-drawer-body">{open ? children : null}</div>
      </div>
    </dialog>
  )
}
