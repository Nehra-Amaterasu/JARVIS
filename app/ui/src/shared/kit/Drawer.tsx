import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { IconButton } from './Button'
import { focusables, lockBackground, trapTab, useEscStack } from './overlay'
import { cx, tokenMs } from './util'

export type DrawerPlace = 'right' | 'left' | 'bottom'

export interface DrawerProps {
  open: boolean
  onClose: () => void
  /** The heading. The header is flat and opaque: its title is text, and the body scrolls under it (5.6). */
  title: string
  /** Override the generated id of the heading, for a caller that cross-references it. */
  titleId?: string
  place?: DrawerPlace
  className?: string
  children?: ReactNode
}

type Phase = 'closed' | 'open' | 'closing'

/**
 * One drawer instead of three `role=dialog` copies (Settings drawer, Reader drawer, `tb-menu`).
 * Portal to <body>, focus moves in and returns to the opener, Tab is trapped, Esc closes the top
 * overlay only, the background is `inert`, and it leaves through a 200 ms exit before it parks as
 * `inert` + `visibility: hidden` (never only `pointer-events: none`). The scrim is 62 %.
 * Not built here: drag to dismiss (5.7.6); it is a pointer layer on top of this and has no owner yet.
 */
export function Drawer({ open, onClose, title, titleId, place = 'right', className, children }: DrawerProps) {
  const auto = useId()
  const hid = titleId ?? auto
  const [phase, setPhase] = useState<Phase>('closed')
  const [everOpened, setEverOpened] = useState(open)
  const portal = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)

  // open: remember who had focus, show; close: play the exit, then park
  useLayoutEffect(() => {
    if (open) {
      if (phase === 'closed') opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setEverOpened(true)
      setPhase('open')
    } else if (phase === 'open') setPhase('closing')
  }, [open]) // runs on `open` only: `phase` is read, and writing it here must not re-run this
  useEffect(() => {
    if (phase !== 'closing') return
    const t = setTimeout(() => {
      setPhase('closed')
      const back = opener.current
      opener.current = null
      if (back && document.contains(back)) back.focus({ preventScroll: true })
    }, tokenMs(panel.current, '--dur-sheet-out', 200))
    return () => clearTimeout(t)
  }, [phase])

  // while open: inert background, focus into the panel
  useEffect(() => {
    if (phase !== 'open' || !portal.current) return
    const release = lockBackground(portal.current)
    const first = panel.current ? focusables(panel.current).find((e) => e.dataset.drawerClose === undefined) ?? panel.current : null
    first?.focus({ preventScroll: true })
    return release
  }, [phase])
  useEscStack(phase === 'open', onClose)

  if (!everOpened) return null
  const shown = phase !== 'closed'
  return createPortal(
    <div ref={portal} className="ww-portal" data-section="wellwisher">
      <div className="ww-scrim" data-state={phase === 'open' ? 'open' : 'closed'} aria-hidden="true" onClick={onClose} />
      <div
        ref={panel}
        className={cx('ww-sheet', className)}
        data-place={place}
        data-state={phase}
        role="dialog"
        aria-modal="true"
        aria-labelledby={hid}
        tabIndex={-1}
        inert={shown ? undefined : true}
        onKeyDown={(e: KeyboardEvent) => panel.current && trapTab(e, panel.current)}
      >
        <header className="ww-sheet-head">
          <h2 id={hid} className="ww-sheet-title">
            {title}
          </h2>
          <IconButton label={`Close ${title}`} size="sm" data-drawer-close="" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </IconButton>
        </header>
        <div className="ww-sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

/** The narrow-screen form: a Drawer that rises from the bottom edge. */
export function Sheet(props: Omit<DrawerProps, 'place'>) {
  return <Drawer {...props} place="bottom" />
}
