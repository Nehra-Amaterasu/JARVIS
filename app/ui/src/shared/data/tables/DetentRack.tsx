// DetentRack (wave 6, D03, spec 20.5.2): the one select of the product, built as a rack. A 44 px trigger shows the value and
// an ASCII caret; it opens a recessed 320 px rack of 44 px rows, the current row carrying a disc and a group's rows a
// `├─ └─` gutter. It is a real listbox: focus stays on the listbox and `aria-activedescendant` names the active row, so a
// screen reader reads each row as the arrow keys land on it. Up, Down, Home, End, PageUp, PageDown, typeahead, Enter, Esc.
// The detent feel is a notch and a pawl that click onto the active row (a 90 ms transform), the rack unfolds in 120 ms,
// and under 900 px it is a bottom sheet. There is no native <select> anywhere in the product.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  firstEnabled, groupRuns, growBuffer, gutterGlyph, lastEnabled, stepBy, stepEnabled, typeahead, PAGE_STEP, type Opt,
} from './layout'
import { useNarrow } from './parts'
import './tables.css'

export type { Opt } from './layout'

export interface DetentRackProps {
  options: Opt[]
  value: string
  onChange: (v: string) => void
  /** Show group headings and the `├─ └─` gutter for options that carry a `group`. */
  grouped?: boolean
  /** The visible name of the control; without it the trigger is named "Choose". */
  label?: string
  placeholder?: string
  disabled?: boolean
  /** Disabled but explained: the trigger stays focusable and the reason is printed under it. */
  disabledReason?: string
  /** Force the popover or the sheet; `auto` follows the 900 px breakpoint. */
  layout?: 'auto' | 'popover' | 'sheet'
  /** Draw the open rack in the page flow instead of floating, with no scrim: for a form that keeps it open, and the gallery. */
  flow?: boolean
  defaultOpen?: boolean
}

export function DetentRack({
  options, value, onChange, grouped = false, label, placeholder = 'Choose', disabled, disabledReason, layout = 'auto', flow, defaultOpen = false,
}: DetentRackProps) {
  const uid = useId()
  const narrow = useNarrow()
  const sheet = layout === 'sheet' || (layout === 'auto' && narrow)
  const cur = options.findIndex((o) => o.value === value)
  const [open, setOpen] = useState(defaultOpen && !disabled)
  const [active, setActive] = useState(() => (cur >= 0 && !options[cur].disabled ? cur : firstEnabled(options)))
  const trigger = useRef<HTMLButtonElement>(null)
  const rack = useRef<HTMLDivElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const buf = useRef({ text: '', at: 0 })
  const inert = !!disabled || !!disabledReason
  const oid = (i: number) => `${uid}-o${i}`

  const openRack = (from?: number) => {
    if (inert || options.length === 0) return
    setActive(from ?? (cur >= 0 && !options[cur].disabled ? cur : firstEnabled(options)))
    setOpen(true)
  }
  const close = (refocus: boolean) => {
    setOpen(false)
    buf.current = { text: '', at: 0 }
    if (refocus) trigger.current?.focus()
  }
  const commit = (i: number) => {
    const o = options[i]
    if (!o || o.disabled) return
    if (o.value !== value) onChange(o.value)
    close(true)
  }

  // focus the listbox when it opens (not on a rack that starts open in the page flow: nobody asked for focus there)
  const startedOpen = useRef(defaultOpen)
  useEffect(() => {
    if (!open) return
    if (startedOpen.current) { startedOpen.current = false; return }
    rack.current?.focus({ preventScroll: true })
  }, [open])
  useEffect(() => {
    if (!open) return
    const el = typeof document !== 'undefined' ? document.getElementById(oid(active)) : null
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  }, [active, open]) // eslint-disable-line react-hooks/exhaustive-deps

  const type = (key: string, from: number): number => {
    const now = Date.now()
    const text = growBuffer(buf.current.text, buf.current.at, now, key)
    buf.current = { text, at: now }
    return typeahead(options, text, from)
  }
  const isChar = (e: KeyboardEvent) => e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey

  const onTriggerKey = (e: KeyboardEvent) => {
    if (inert) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openRack() }
    else if (isChar(e) && e.key !== ' ') { e.preventDefault(); openRack(type(e.key, cur >= 0 ? cur : -1)) }
  }

  const onRackKey = (e: KeyboardEvent) => {
    const k = e.key
    if (k === 'ArrowDown') { e.preventDefault(); setActive((a) => stepEnabled(options, a, 1)) }
    else if (k === 'ArrowUp') { e.preventDefault(); setActive((a) => stepEnabled(options, a, -1)) }
    else if (k === 'Home') { e.preventDefault(); setActive(firstEnabled(options)) }
    else if (k === 'End') { e.preventDefault(); setActive(lastEnabled(options)) }
    else if (k === 'PageDown') { e.preventDefault(); setActive((a) => stepBy(options, a, PAGE_STEP)) }
    else if (k === 'PageUp') { e.preventDefault(); setActive((a) => stepBy(options, a, -PAGE_STEP)) }
    else if (k === 'Enter' || (k === ' ' && buf.current.text === '')) { e.preventDefault(); commit(active) }
    else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true) }
    else if (k === 'Tab') {
      if (sheet && !flow) {
        e.preventDefault()
        ;(document.activeElement === cancel.current ? rack.current : cancel.current)?.focus()
      } else {
        // hand focus back to the trigger first, so the browser's Tab moves on from there and no focus is lost
        trigger.current?.focus()
        setOpen(false)
      }
    } else if (isChar(e)) { e.preventDefault(); setActive((a) => type(k, a)) }
  }

  const inside = (n: EventTarget | null) => n instanceof Node && !!(wrap.current?.contains(n) || panel.current?.contains(n))

  const runs = groupRuns(options, grouped)
  const optionRow = (o: Opt, i: number): ReactNode => {
    const glyph = gutterGlyph(options, i, grouped)
    const isActive = i === active
    return (
      <div
        key={o.value}
        id={oid(i)}
        role="option"
        className="d3r-opt"
        aria-selected={i === cur}
        aria-disabled={o.disabled || undefined}
        data-active={isActive || undefined}
        onClick={() => commit(i)}
        onPointerMove={() => !o.disabled && i !== active && setActive(i)}
      >
        <span className="d3r-gut" aria-hidden="true">{glyph || (isActive ? '▸' : '')}</span>
        <span className="d3r-disc" aria-hidden="true" />
        <span className="d3r-name">{o.label}</span>
        {o.shortcut ? <span className="d3r-short">{o.shortcut}</span> : <span />}
      </div>
    )
  }

  const listbox = (
    <div
      ref={rack}
      id={`${uid}-list`}
      className="d3r-rack"
      role="listbox"
      tabIndex={0}
      aria-label={label ?? 'Options'}
      aria-activedescendant={options.length ? oid(active) : undefined}
      onKeyDown={onRackKey}
      onBlur={(e) => { if (!inside(e.relatedTarget) && !(flow && defaultOpen)) close(false) }}
    >
      {runs.map((r, ri) => {
        const rows = options.slice(r.from, r.to + 1).map((o, k) => optionRow(o, r.from + k))
        return r.heading === null ? (
          rows
        ) : (
          <div key={ri} role="group" className="d3r-group" aria-labelledby={`${uid}-g${ri}`}>
            <div id={`${uid}-g${ri}`} className="d3r-head">{r.heading}</div>
            {rows}
          </div>
        )
      })}
    </div>
  )

  const shown = open && (
    sheet && !flow ? (
      typeof document === 'undefined' ? null : createPortal(
        <div className="d3r d3r-portal" data-component="DetentRack" data-form="sheet">
          <div className="d3r-scrim" aria-hidden="true" onClick={() => close(true)} />
          <div ref={panel} className="d3r-sheet" role="dialog" aria-label={label ?? 'Choose'}>
            <span className="d3r-handle" aria-hidden="true" />
            <h4 className="d3r-sheet-head">{label ?? 'Choose'}</h4>
            {listbox}
            <button ref={cancel} type="button" className="d3-key d3r-cancel" onClick={() => close(true)}>Cancel</button>
          </div>
        </div>,
        document.body,
      )
    ) : sheet ? (
      <div ref={panel} className="d3r-sheet" data-flow="" role="group" aria-label={label ?? 'Choose'}>
        <span className="d3r-handle" aria-hidden="true" />
        <h4 className="d3r-sheet-head">{label ?? 'Choose'}</h4>
        {listbox}
        <button ref={cancel} type="button" className="d3-key d3r-cancel" onClick={() => close(true)}>Cancel</button>
      </div>
    ) : listbox
  )

  return (
    <div ref={wrap} className="d3r" data-component="DetentRack" data-open={open || undefined} data-disabled={inert || undefined} data-flow={flow ? '' : undefined}>
      {label && <span id={`${uid}-l`} className="d3r-label">{label}</span>}
      <button
        ref={trigger}
        type="button"
        className="d3r-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${uid}-list` : undefined}
        aria-disabled={inert || undefined}
        aria-labelledby={label ? `${uid}-l ${uid}-v` : undefined}
        aria-label={label ? undefined : 'Choose'}
        aria-describedby={disabledReason ? `${uid}-why` : undefined}
        onClick={() => (open ? close(false) : openRack())}
        onKeyDown={onTriggerKey}
      >
        <span id={`${uid}-v`} className="d3r-val">{cur >= 0 ? options[cur].label : placeholder}</span>
        <span className="d3r-caret" aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>
      {disabledReason && <p id={`${uid}-why`} className="d3r-why">{disabledReason}</p>}
      {shown}
    </div>
  )
}
