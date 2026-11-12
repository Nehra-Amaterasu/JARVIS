import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { cx } from './util'

export interface SegmentedOption<T extends string = string> {
  id: T
  label: string
  /** Disabled WITH a reason: stays focusable, selects nothing, says why. */
  disabledReason?: string
}

export interface SegmentedProps<T extends string = string> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (id: T) => void
  /** view 40 px (a page's view switch), choice 44 px real (a form choice), compact 36 px visible with a 44 px hit area. */
  variant?: 'view' | 'choice' | 'compact'
  /** The group's accessible name. Required: a radio group with no name is announced as nothing. */
  label: string
  className?: string
}

/**
 * One segmented control instead of three `.seg` definitions, `life-kinds` and `ex-chips`.
 * A radio group: arrow keys move and select, one roving tab stop, Home and End jump. The selected
 * option is a wash plus ink, never the accent (the accent belongs to the single primary, 5.2).
 */
export function Segmented<T extends string = string>({ options, value, onChange, variant = 'view', label, className }: SegmentedProps<T>) {
  const noteId = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const [note, setNote] = useState<string | null>(null)
  const selectedIdx = Math.max(0, options.findIndex((o) => o.id === value))

  const choose = (i: number, focus: boolean) => {
    const o = options[i]
    if (focus) refs.current[i]?.focus()
    if (o.disabledReason) {
      setNote(`${o.label}: ${o.disabledReason}`)
      return
    }
    setNote(null)
    if (o.id !== value) onChange(o.id)
  }
  const onKey = (e: KeyboardEvent, i: number) => {
    const last = options.length - 1
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i === last ? 0 : i + 1) : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i === 0 ? last : i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1
    if (next < 0) return
    e.preventDefault()
    choose(next, true)
  }

  return (
    <span className="ww-seg-wrap">
      <span className={cx('ww-seg', className)} role="radiogroup" aria-label={label} data-variant={variant} aria-describedby={note ? noteId : undefined}>
        {options.map((o, i) => (
          <button
            key={o.id}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            className="ww-seg-opt ww-tap"
            aria-checked={o.id === value}
            aria-disabled={o.disabledReason ? true : undefined}
            tabIndex={i === selectedIdx ? 0 : -1}
            title={o.disabledReason ? `${o.label}: ${o.disabledReason}` : undefined}
            onClick={() => choose(i, false)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {o.label}
          </button>
        ))}
      </span>
      {note && (
        <span id={noteId} className="ww-reason" role="status">
          {note}
        </span>
      )}
    </span>
  )
}
