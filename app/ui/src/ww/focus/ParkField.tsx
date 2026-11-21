/**
 * ParkField (A.Y02, 20.7.8): the outlet for an unsolicited thought. `P` (in the Crucible) or `x` (in the Drill) opens one 44 px
 * single-line field in the controls region; Enter files the thought and gives the focus back to what had it; Escape closes it
 * without filing. The application says nothing about attention. What happens to the text is the caller's: it goes to Parking
 * through the port, and the caller says in words whether it was kept beyond this page.
 */
import { useEffect, useRef, useState } from 'react'

export interface ParkFieldProps {
  open: boolean
  /** Called with the trimmed text; an empty line files nothing and keeps the field open. */
  onFile: (text: string) => void
  onClose: () => void
  /** Where the focus goes back to after Enter or Escape (the key that opened it, or the timer). */
  returnTo?: () => HTMLElement | null
  label?: string
  className?: string
}

export function ParkField({ open, onFile, onClose, returnTo, label = 'Park a thought', className }: ParkFieldProps) {
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) input.current?.focus({ preventScroll: true })
    else setText('')
  }, [open])
  if (!open) return null
  const back = () => returnTo?.()?.focus()
  return (
    <form
      className={`pk${className ? ` ${className}` : ''}`}
      role="search"
      aria-label={label}
      onSubmit={(e) => {
        e.preventDefault()
        const t = text.trim()
        if (!t) return
        onFile(t)
        setText('')
        onClose()
        back()
      }}
    >
      <input
        ref={input}
        className="pk-in"
        type="text"
        value={text}
        maxLength={140}
        placeholder="A stray thought, then Enter"
        aria-label={label}
        autoComplete="off"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            setText('')
            onClose()
            back()
          }
        }}
      />
      <span className="pk-hint" aria-hidden="true">Enter files it. Esc closes.</span>
    </form>
  )
}
