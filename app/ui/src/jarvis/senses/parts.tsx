// The few pieces the three Senses views share: the clay panel with its bracket tag, the choice group (a radiogroup of
// 44 px keys), the raised key, and the narrow-screen hook. Material is tokens by name; nothing here draws data.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Lamp, type LampReading } from '../../shared/lamp'
import { sourceOf, type Source } from './model'
import type { SensesState, SensesStore } from './store'

/** The phone layout begins below this width (the shell's own one-column break). */
export const PHONE_MAX = 899

export function useNarrow(): boolean {
  const q = `(max-width: ${PHONE_MAX}px)`
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q)?.matches)
  useEffect(() => {
    const mq = window.matchMedia?.(q)
    if (!mq) return
    const on = () => setNarrow(mq.matches)
    on()
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [q])
  return narrow
}

/** A clay panel: a bracket tag, a title, an optional lamp, an optional right-hand slot, then the body. */
export function Panel({ tag, title, reading, aside, className, children, id }: {
  tag: string; title: string; reading?: LampReading; aside?: ReactNode; className?: string; children: ReactNode; id?: string
}) {
  return (
    <section className={`js-panel${className ? ` ${className}` : ''}`} aria-label={title} id={id}>
      <header className="js-panel-head">
        <h2><span className="js-tag">[{tag}]</span> {title}</h2>
        {reading && <Lamp reading={reading} subject={title} />}
        {aside && <span className="js-panel-aside">{aside}</span>}
      </header>
      {children}
    </section>
  )
}

export interface ChoiceOption<T extends string> { id: T; label: string; title?: string }

/** A radiogroup of keys: arrows move and select, one tab stop, Home and End jump. The selected key is a wash plus ink. */
export function Choice<T extends string>({ options, value, onChange, label, className }: {
  options: ChoiceOption<T>[]; value: T | null; onChange: (id: T) => void; label: string; className?: string
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const at = Math.max(0, options.findIndex((o) => o.id === value))
  const onKey = (e: KeyboardEvent, i: number) => {
    const last = options.length - 1
    const n = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i === last ? 0 : i + 1) : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i === 0 ? last : i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1
    if (n < 0) return
    e.preventDefault()
    refs.current[n]?.focus()
    onChange(options[n].id)
  }
  return (
    <div className={`js-choice${className ? ` ${className}` : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={o.id} ref={(el) => { refs.current[i] = el }} type="button" role="radio" aria-checked={value === o.id}
          tabIndex={i === at ? 0 : -1} title={o.title} onClick={() => onChange(o.id)} onKeyDown={(e) => onKey(e, i)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function KeyBtn({ children, onClick, primary, disabledReason, title, pressed, className, ...rest }: {
  children: ReactNode; onClick: () => void; primary?: boolean; disabledReason?: string; title?: string; pressed?: boolean; className?: string
  'aria-keyshortcuts'?: string; 'aria-label'?: string; 'data-primary'?: string
}) {
  return (
    <button
      type="button" className={`js-key${primary ? ' js-primary' : ''}${className ? ` ${className}` : ''}`} data-primary={primary ? '' : undefined}
      aria-disabled={disabledReason ? true : undefined} aria-pressed={pressed} title={disabledReason ?? title}
      onClick={() => { if (!disabledReason) onClick() }} {...rest}
    >
      {children}
    </button>
  )
}

export const SensesSentence = ({ text }: { text: string }) => <p className="js-sentence" data-testid="senses-sentence">{text}</p>

/**
 * The Senses frame: the view above, and below it one fixed slot that holds the honesty sentence, the same words in the same
 * place on all three views (the sentence is physics, not a per-view note). The slot is 28 px; the view takes the rest.
 */
export function SensesFrame({ children, text }: { children: ReactNode; text: string }) {
  return (
    <div className="js-frame">
      <div className="js-frame-body">{children}</div>
      <SensesSentence text={text} />
    </div>
  )
}

export interface SelectOption { id: string; label: string }

/** The list never sits inside a clipping card: it is drawn on the page body at fixed coordinates taken from the trigger. */
interface ListBox { left: number; top: number; bottom: number | null; maxHeight: number; minWidth: number }
const LIST_MAX = 300
const EDGE = 12

/**
 * A closed clay well that opens an opaque list (replaces the native select, whose list is drawn by the system and cannot be
 * lifted or themed). One tab stop; Enter, Space or the arrows open it, the arrows and a first letter move, Enter picks, Escape
 * and Tab close. The list is portalled to the body (the cards around it clip their overflow) and flips up or down by the room
 * that is left, then scrolls inside that room. The label of the held value, or the placeholder, is the whole text: nothing is
 * cut. `up` prefers upwards for a control on the bottom edge. The kit's own Select replaces this when it ships (EL-SENSES).
 */
export function SensesSelect({ options, value, onChange, label, placeholder, disabled, disabledReason, lit, up, className }: {
  options: SelectOption[]; value: string; onChange: (id: string) => void; label: string; placeholder: string
  disabled?: boolean; disabledReason?: string; lit?: boolean; up?: boolean; className?: string
}) {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(0)
  const [box, setBox] = useState<ListBox | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const items = useRef<(HTMLLIElement | null)[]>([])
  const typed = useRef({ text: '', at: 0 })
  const listId = useId()
  const held = options.find((o) => o.id === value)
  const off = disabled || !!disabledReason
  const last = options.length - 1
  const close = (focus = true) => { setOpen(false); if (focus) trigger.current?.focus() }
  const show = () => { if (off || !options.length) return; setAt(Math.max(0, options.findIndex((o) => o.id === value))); setOpen(true) }
  // the options may shrink while the list is open (zones or sessions refresh): the cursor never points past the end
  useEffect(() => { if (open && at > last) setAt(Math.max(0, last)) }, [open, at, last])
  useEffect(() => { if (open && last < 0) setOpen(false) }, [open, last])
  const place = useCallback(() => {
    const r = trigger.current?.getBoundingClientRect()
    if (!r) return
    const vh = window.innerHeight || document.documentElement.clientHeight
    const vw = window.innerWidth || document.documentElement.clientWidth
    const want = Math.min(LIST_MAX, options.length * 44 + 12)
    const below = vh - r.bottom - 8 - EDGE
    const above = r.top - 8 - EDGE
    const goUp = up ? above >= Math.min(want, 132) || above > below : below < want && above > below
    const room = Math.max(88, goUp ? above : below)
    setBox({
      left: Math.max(EDGE, Math.min(r.left, vw - EDGE - Math.max(r.width, 160))), minWidth: r.width,
      top: goUp ? 0 : r.bottom + 8, bottom: goUp ? vh - r.top + 8 : null, maxHeight: Math.min(LIST_MAX, room),
    })
  }, [options.length, up])
  useLayoutEffect(() => {
    if (!open) { setBox(null); return }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open, place])
  useEffect(() => { if (open && box) items.current[at]?.focus() }, [open, at, box])
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      const t = e.target as Node
      if (root.current?.contains(t) || list.current?.contains(t)) return
      // focus was inside the list: it goes back to the trigger rather than to the page body
      const inside = list.current?.contains(document.activeElement)
      setOpen(false)
      if (inside) trigger.current?.focus()
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])
  // type-ahead: letters typed within a second extend a prefix; the cursor goes to the next label that starts with it
  const ahead = (key: string, from: number): number => {
    const now = Date.now()
    const t = typed.current
    t.text = now - t.at > 900 ? key : t.text + key
    t.at = now
    const q = t.text.toLowerCase()
    for (let k = 0; k <= last; k++) {
      const i = (from + (t.text.length === 1 ? 1 : 0) + k) % options.length
      if (options[i].label.toLowerCase().startsWith(q)) return i
    }
    return -1
  }
  const printable = (e: KeyboardEvent) => e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey
  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); show() }
    else if (e.key === 'Home' || e.key === 'End') { if (off) return; e.preventDefault(); const o = options[e.key === 'Home' ? 0 : last]; if (o) onChange(o.id) }
    else if (printable(e) && !off) {
      const i = ahead(e.key, Math.max(0, options.findIndex((o) => o.id === value)))
      if (i >= 0) { e.preventDefault(); onChange(options[i].id) }
    }
  }
  const onListKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt((i) => (i >= last ? 0 : i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => (i <= 0 ? last : i - 1)) }
    else if (e.key === 'Home') { e.preventDefault(); setAt(0) }
    else if (e.key === 'End') { e.preventDefault(); setAt(last) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'Tab') close(false)
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const o = options[at]; if (o) { onChange(o.id); close() } }
    else if (printable(e)) { const i = ahead(e.key, at); if (i >= 0) { e.preventDefault(); setAt(i) } }
  }
  const style: CSSProperties | undefined = box
    ? { left: box.left, minWidth: box.minWidth, maxHeight: box.maxHeight, ...(box.bottom != null ? { bottom: box.bottom } : { top: box.top }) }
    : undefined
  return (
    <div className={`js-sel${className ? ` ${className}` : ''}`} ref={root} data-open={open ? 'true' : undefined}>
      <button
        ref={trigger} type="button" className="js-select" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-label={label} aria-disabled={off ? true : undefined} data-on={lit ? 'true' : undefined} title={disabledReason}
        onClick={() => (open ? close() : show())} onKeyDown={onTriggerKey}
      >
        <span className="js-select-text">{held ? held.label : placeholder}</span>
        {disabledReason && <span className="js-sr">, {disabledReason}</span>}
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && createPortal(
        <ul ref={list} id={listId} className="js-select-list" role="listbox" aria-label={label} style={style} data-ready={box ? 'true' : undefined} onKeyDown={onListKey}>
          {options.map((o, i) => (
            <li
              key={o.id} ref={(el) => { items.current[i] = el }} role="option" tabIndex={i === at ? 0 : -1} aria-selected={o.id === value}
              onClick={() => { onChange(o.id); close() }} onPointerMove={() => setAt(i)}
            >
              {o.label}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  )
}

export interface SensesViewProps {
  state: SensesState
  store: SensesStore
  toast?: (m: string, tone?: 'live' | 'sim' | 'fault' | 'info') => void
  /** The shell's navigation to another Senses view (Teach). */
  onGo?: (view: 'presence' | 'signal' | 'teach') => void
  /** A fixture (gallery, jury bench): the 3D twin and the sockets are not drawn. */
  fixture?: boolean
}

const STALE_MS = 5000
/** The source of what is on screen: a closed socket or a silent one is no source, never the last one. */
export function effectiveSource(s: SensesState): Source {
  if (!s.online) return 'none'
  if (s.lastAt != null && s.now - s.lastAt > STALE_MS) return 'none'
  return sourceOf(s.latest?.source)
}

