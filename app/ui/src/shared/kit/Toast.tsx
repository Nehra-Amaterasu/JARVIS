import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import { tokenMs } from './util'

export type ToastTone = 'neutral' | 'live' | 'fault'
export interface ToastItem {
  id: string
  tone?: ToastTone
  message: string
  /** An action gives Undo; the toast then stays a little longer. */
  action?: { label: string; onAction: () => void }
}

/** How long a toast stays: long enough to read a sentence, longer when it carries an Undo. */
export const TOAST_MS = { plain: 5000, action: 8000 }

export interface ToastProps extends Omit<ToastItem, 'id'> {
  onDismiss: () => void
}

/**
 * One toast. It leaves with the `leave` motion (fall 8 px, 180 ms) before it asks to be removed.
 * Colour is never the message: the tone is a dot and the sentence says what happened.
 */
export function Toast({ tone = 'neutral', message, action, onDismiss }: ToastProps) {
  const [leaving, setLeaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss
  useEffect(() => {
    const t = setTimeout(() => setLeaving(true), action ? TOAST_MS.action : TOAST_MS.plain)
    return () => clearTimeout(t)
  }, [action])
  useEffect(() => {
    if (!leaving) return
    const t = setTimeout(() => dismiss.current(), tokenMs(ref.current, '--dur-exit', 180))
    return () => clearTimeout(t)
  }, [leaving])
  return (
    <div ref={ref} className="ww-toast" data-tone={tone} data-leave={leaving ? 'out' : undefined}>
      <span className="ww-chip-dot" aria-hidden="true" />
      <span className="ww-toast-msg">{message}</span>
      {action && (
        <Button
          size="sm"
          onClick={() => {
            action.onAction()
            setLeaving(true)
          }}
        >
          {action.label}
        </Button>
      )}
    </div>
  )
}

/**
 * The stack. The live region is always mounted, so a toast added later is announced; `polite` never
 * interrupts what the person is typing. Bottom centre, above everything but nothing else (--z-toast).
 */
export function ToastStack({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  return createPortal(
    <div className="ww-portal ww-toasts" data-section="wellwisher" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((t) => (
        <Toast key={t.id} tone={t.tone} message={t.message} action={t.action} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>,
    document.body,
  )
}
