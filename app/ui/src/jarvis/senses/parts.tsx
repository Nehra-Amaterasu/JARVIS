// The few pieces the three Senses views share: the clay panel with its bracket tag, the choice group (a radiogroup of
// 44 px keys), the raised key, and the narrow-screen hook. Material is tokens by name; nothing here draws data.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
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

