// A small radio group with roving focus (one tab stop; Left and Right, Up and Down, Home and End move and select), used by
// the group filter, the theme switch and the state switch. It is a real role="radiogroup", so a screen reader announces the
// count and the checked one, and the visible text is the accessible name.
import { useRef, type KeyboardEvent } from 'react'

export interface RadioOption { id: string; label: string; count?: number; title?: string }

export function Radios({ label, value, options, onChange, className }: { label: string; value: string; options: RadioOption[]; onChange(id: string): void; className?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const at = Math.max(0, options.findIndex((o) => o.id === value))
  const move = (to: number) => {
    const i = (to + options.length) % options.length
    onChange(options[i].id)
    refs.current[i]?.focus()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(at + 1) }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(at - 1) }
    else if (e.key === 'Home') { e.preventDefault(); move(0) }
    else if (e.key === 'End') { e.preventDefault(); move(options.length - 1) }
  }
  return (
    <div className={`gl-radios${className ? ` ${className}` : ''}`} role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {options.map((o, i) => (
        <button
          key={o.id}
          ref={(el) => { refs.current[i] = el }}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          tabIndex={i === at ? 0 : -1}
          title={o.title}
          className="gl-radio"
          onClick={() => onChange(o.id)}
        >
          <span className="gl-radio-text">{o.label}</span>
          {o.count !== undefined && <span className="gl-radio-count">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}
