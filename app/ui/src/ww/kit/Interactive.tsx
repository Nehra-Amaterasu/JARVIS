// Motion-bearing interaction primitives: HoldButton (hold), PinHeader (pin), CursorLabel (companion).
import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Lock } from 'lucide-react'
import { createHold, type Hold } from '../design/motion/hold'
import { isLowMotion } from '../design/motion/governor'
import { isReducedMotion } from '../useReducedMotion'
import { Button } from './Button'
import { cx } from './util'

export interface HoldButtonProps {
  label: string
  /** Runs when the 400 ms hold completes, or when the plain Confirm is accepted. */
  onConfirm: () => void
  /** Why it cannot be done now. Printed beside it, like a disabled Button; nothing can start. */
  reason?: string
  size?: 'sm' | 'md' | 'lg'
  /** The text the pointer companion shows over it. */
  cursor?: string
  className?: string
}

/**
 * `hold` (5.7.3 #10) for destructive or costly actions only. Pointer down fills a bar on the control's
 * own ring (scaleX, linear, 400 ms); letting go early reverses it in 120 ms and nothing happens; at
 * 400 ms the action runs. Enter and Space, and reduced motion, never hold: they open a plain Confirm,
 * so the hold is never the only way to do anything. No requestAnimationFrame: one timer.
 */
export function HoldButton({ label, onConfirm, reason, size = 'md', cursor, className }: HoldButtonProps) {
  const ref = useRef<HTMLButtonElement>(null)
  const hold = useRef<Hold | null>(null)
  const confirm = useRef(onConfirm)
  confirm.current = onConfirm
  const [asking, setAsking] = useState(false)
  const hintId = useId()
  const blocked = !!reason

  useEffect(() => {
    if (!ref.current) return
    const h = createHold({ el: ref.current, onConfirm: () => confirm.current(), onNeedConfirm: () => setAsking(true), reduced: isReducedMotion })
    hold.current = h
    return () => {
      h.dispose()
      hold.current = null
    }
  }, [])

  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    if (!blocked) hold.current?.key()
  }
  const stop = () => hold.current?.release()
  return (
    <span className="ww-hold-wrap">
      <button
        ref={ref}
        type="button"
        className={cx('ww-btn', 'ww-hold', 'ww-tap', 'danger', className)}
        data-size={size}
        data-cursor={cursor ?? (blocked ? undefined : `Hold to ${label.toLowerCase()}`)}
        aria-disabled={blocked || undefined}
        aria-describedby={blocked ? undefined : hintId}
        onPointerDown={(e) => {
          if (blocked || e.button !== 0) return
          hold.current?.start()
        }}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onKeyDown={key}
        onClick={(e) => e.preventDefault()}
      >
        {blocked && <Lock size={14} aria-hidden="true" />}
        <span>{label}</span>
        <span className="ww-hold-fill" aria-hidden="true" />
      </button>
      {blocked ? (
        <span className="ww-reason">{reason}</span>
      ) : (
        <span id={hintId} className="ww-sr-only">
          Press and hold to {label.toLowerCase()}. Press Enter to confirm with a dialog instead.
        </span>
      )}
      {asking && (
        <span className="ww-hold-confirm" role="alertdialog" aria-label={`Confirm: ${label}`}>
          <span>{label}: are you sure?</span>
          <Button
            size="sm"
            tone="danger"
            grouped
            onClick={() => {
              setAsking(false)
              confirm.current()
            }}
          >
            Confirm
          </Button>
          <Button
            size="sm"
            grouped
            autoFocus
            onClick={() => {
              setAsking(false)
              ref.current?.focus()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setAsking(false)
                ref.current?.focus()
              }
            }}
          >
            Cancel
          </Button>
        </span>
      )}
    </span>
  )
}

const supportsScrollTimeline = () => typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('animation-timeline: scroll()')

export interface PinHeaderProps {
  title: string
  level?: 1 | 2
  /** Controls at the right of the head. */
  children?: ReactNode
  className?: string
}

/**
 * `pin` (5.7.3 #11): a sticky head at a fixed 56 px (it never shrinks). Where the engine has scroll
 * timelines the title scales 1 to 0.92 and the hairline fades in over the first 96 px, in CSS alone
 * (motion.css). Elsewhere a one-shot IntersectionObserver on a 1 px sentinel sets data-stuck, so the
 * hairline appears without any scrubbing. No scroll listener, no parallax (WCAG 2.3.3).
 */
export function PinHeader({ title, level = 2, children, className }: PinHeaderProps) {
  const sentinel = useRef<HTMLDivElement>(null)
  const rule = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const s = sentinel.current
    const r = rule.current
    if (!s || !r || supportsScrollTimeline() || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((es) => {
      const e = es[es.length - 1]
      if (e) r.setAttribute('data-stuck', e.isIntersecting ? 'false' : 'true')
    })
    io.observe(s)
    return () => io.disconnect()
  }, [])
  const H = level === 1 ? 'h1' : 'h2'
  return (
    <>
      <div ref={sentinel} className="ww-pin-sentinel" aria-hidden="true" />
      <header className={cx('ww-pin', className)}>
        <H className="ww-pin-title">{title}</H>
        {children && <div className="ww-pin-actions">{children}</div>}
        <div ref={rule} className="ww-pin-rule" aria-hidden="true" />
      </header>
    </>
  )
}

/** True when a pointer companion may exist: a fine hovering pointer, full motion, and the governor not low. */
function companionAllowed(): boolean {
  if (typeof matchMedia !== 'function') return false
  return matchMedia('(hover: hover) and (pointer: fine)').matches && !isReducedMotion() && !isLowMotion()
}
function subscribeCompanion(onChange: () => void): () => void {
  const mq = typeof matchMedia === 'function' ? [matchMedia('(hover: hover) and (pointer: fine)'), matchMedia('(prefers-reduced-motion: reduce)')] : []
  mq.forEach((q) => q.addEventListener?.('change', onChange))
  const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(onChange) : null
  mo?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion', 'data-motion-load'] })
  return () => {
    mq.forEach((q) => q.removeEventListener?.('change', onChange))
    mo?.disconnect()
  }
}

/**
 * The pointer companion (5.7.6 "Cursor"): a label at most 24 px tall that follows the pointer 16 px
 * right and down over any `data-cursor` target (Tree nodes, drag handles, hold buttons). The native
 * pointer is never hidden. One pointermove handler, coalesced to one rAF, and rAF only while the
 * pointer moves: an idle page costs 0 callbacks. Absent on touch, under calm or reduced motion, and
 * when the governor says low.
 */
export function CursorLabel() {
  const allowed = useSyncExternalStore(subscribeCompanion, companionAllowed, () => false)
  const el = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!allowed) return
    let x = 0
    let y = 0
    let target: EventTarget | null = null
    let raf = 0
    let shown = ''
    const frame = () => {
      raf = 0
      const label = el.current
      if (!label) return
      const host = target instanceof Element ? target.closest<HTMLElement>('[data-cursor]') : null
      const text = host?.dataset.cursor ?? ''
      if (text !== shown) {
        shown = text
        label.textContent = text
        label.setAttribute('data-visible', text ? 'true' : 'false')
      }
      if (text) label.style.transform = `translate3d(${x + 16}px, ${y + 16}px, 0)`
    }
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      x = e.clientX
      y = e.clientY
      target = e.target
      if (!raf) raf = requestAnimationFrame(frame)
    }
    const leave = (e: MouseEvent) => {
      if (e.relatedTarget) return
      target = null
      if (!raf) raf = requestAnimationFrame(frame)
    }
    document.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('mouseout', leave)
    return () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('mouseout', leave)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [allowed])
  if (!allowed) return null
  return createPortal(<div ref={el} className="ww-portal ww-cursor-label" data-visible="false" aria-hidden="true" />, document.body)
}
