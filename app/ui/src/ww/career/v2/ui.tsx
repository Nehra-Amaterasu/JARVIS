// The small parts the five Career views share (T02): the page frame with its ASCII ruler, the plate, the stamped readout, a form
// of "one width measurement" and the key handler. Nothing here reads a store.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Button, Field, Readout } from '../../../shared/kit'
import { LampWord } from '../../left/LampWord'
import type { LampState } from '../../../shared/lamp'
import { Zones, lookV3Enabled, type ZoneRatio } from '../../../shell/v3'
import { cellRead, stampText, type Cell, type CellRead } from './store'
import './t2.css'
import './t2-views.css'
import './t2-v3.css'

export const PHONE_BELOW = 760

/** True on a page drawn from invented rows (the gallery): every LIVE lamp and cell then says SIMULATED instead, once and everywhere. */
const Sim = createContext(false)
export const useSim = (): boolean => useContext(Sim)
const cx = (...a: (string | false | null | undefined)[]): string => a.filter(Boolean).join(' ')

/** The width of the element, from its offset size (CSS px of the box itself, so a zoomed gallery frame does not change the form). */
export function useWidth<T extends HTMLElement>(fixed?: number): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null)
  const [w, setW] = useState(fixed ?? 1302)
  useEffect(() => {
    if (fixed) { setW(fixed); return }
    const el = ref.current
    if (!el) return
    const read = () => { const v = el.offsetWidth; if (v > 0) setW((o) => (o === v ? o : v)) }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fixed])
  return [ref, w]
}

/** Single-letter keys of a view (N, C, P). Ignored while typing, with a modifier, or inside a dialog. */
export function useKeys(map: Record<string, () => void>, enabled = true): void {
  const ref = useRef(map)
  ref.current = map
  useEffect(() => {
    if (!enabled) return
    const on = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target instanceof Element ? (e.target as HTMLElement) : null
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable || t.closest('[role="dialog"]'))) return
      const fn = ref.current[e.key.toLowerCase()]
      if (fn) { e.preventDefault(); fn() }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [enabled])
}

export interface FrameProps {
  /** The ASCII ruler's word, in capitals ("RUNWAY"). */
  ruler: string
  title: string
  /** One line under the title: the source and its state, in words. */
  sub: ReactNode
  /** The keys at the right of the head; the view's one accent key goes last. */
  keys?: ReactNode
  /** The viewport form the page decided. */
  form: 'desk' | 'phone'
  state: LampState
  children: ReactNode
  /** Drawers and overlays that belong to the page. */
  extra?: ReactNode
  rootRef?: RefObject<HTMLDivElement | null>
  view: string
  simulated?: boolean
  /** Under the v3 look: the view's three trays (job words in caps, the content of each). Without it, or with the look off, `children` is drawn as today. */
  v3?: { ratio?: ZoneRatio; trays: readonly [V3Tray, V3Tray, V3Tray] }
}
export interface V3Tray { job: string; node: ReactNode; peek?: { name?: string; lamp?: 'live' | 'waiting' | 'simulated' | 'planned' | 'fault'; note?: string } }

export function Frame({ ruler, title, sub, keys, form, state, children, extra, rootRef, view, simulated, v3 }: FrameProps) {
  if (v3 && lookV3Enabled()) {
    const [a, b, c] = v3.trays
    const st = simulated && state === 'live' ? 'simulated' : state
    return (
      <Sim.Provider value={!!simulated}>
        <div className="t2 t2-v3" ref={rootRef} data-form={form} data-view={view} data-state={st} data-simulated={simulated ? 'true' : undefined}>
          <Zones
            ratio={v3.ratio}
            first={{ job: a.job, peek: a.peek, children: (
              <>
                <div className="t2-v3-head">
                  <p className="t2-sub">{sub}</p>
                  {keys && <div className="t2-keys">{keys}</div>}
                </div>
                {a.node}
              </>
            ) }}
            second={{ job: b.job, peek: b.peek, children: b.node }}
            third={{ job: c.job, peek: c.peek, children: c.node }}
          />
          {extra}
        </div>
      </Sim.Provider>
    )
  }
  return (
    <Sim.Provider value={!!simulated}>
    <div className="t2" ref={rootRef} data-form={form} data-view={view} data-state={simulated && state === 'live' ? 'simulated' : state} data-simulated={simulated ? 'true' : undefined}>
      <header className="t2-head">
        <div className="t2-title">
          <p className="t2-ruler" aria-hidden="true">{`+-- ${ruler} ${'-'.repeat(60)}`}</p>
          <h1>{title}</h1>
          <p className="t2-sub">{sub}</p>
        </div>
        {keys && <div className="t2-keys">{keys}</div>}
      </header>
      <div className="t2-body">{children}</div>
      {extra}
    </div>
    </Sim.Provider>
  )
}

export interface PlateProps {
  id: string
  label: string
  state: LampState
  reason: string
  children: ReactNode
  corner?: ReactNode
  className?: string
  /** A hollow plate (WAITING, PLANNED) is sunk into the ground, not raised. */
  hollow?: boolean
}

/** A raised clay plate: an ASCII bracket label, the lamp word, the reason in a few words. The edge is the clay's shadow, never a line. */
export function Plate({ id, label, state: given, reason, children, corner, className, hollow }: PlateProps) {
  const state: LampState = useSim() && given === 'live' ? 'simulated' : given
  return (
    <section className={cx('t2-plate', className)} data-plate={id} data-lamp={state} data-hollow={hollow || state === 'planned' || state === 'waiting' ? 'true' : undefined} aria-label={`${label}, ${state === 'live' ? reason : `${state}: ${reason}`}`}>
      <header className="t2-plate-head">
        <h2 className="t2-plate-label"><span aria-hidden="true">[ </span>{label}<span aria-hidden="true"> ]</span></h2>
        <LampWord state={state} />
        <span className="t2-plate-why">{reason}</span>
        {corner && <span className="t2-plate-corner">{corner}</span>}
      </header>
      <div className="t2-plate-body">{children}</div>
    </section>
  )
}

export interface StampedProps {
  label: string
  read: CellRead
  /** How the confirmed value is written. */
  fmt?: (v: string) => string
  /** The WAITING reason; "unconfirmed" unless the cell has a better one. */
  why?: string
  className?: string
}

/**
 * A date or fee cell: the kit Readout, LIVE only with the value AND the day it was checked (cellRead), otherwise WAITING with its
 * reason. A LIVE cell prints its state word and its stamp under the value, so no figure is ever drawn without both.
 */
export function Stamped({ label, read, fmt, why = 'unconfirmed', className }: StampedProps) {
  const live = read.state === 'live'
  const sim = useSim() && live
  const state: LampState = sim ? 'simulated' : read.state
  return (
    <div className={cx('t2-stamped', className)} data-state={state} data-stamped={live ? 'true' : undefined}>
      <Readout className="t2-cell" label={label} state={state} value={live ? (fmt ? fmt(read.value) : read.value) : null} reason={live ? undefined : why} />
      {live && read.on && <span className="t2-stamp">{sim ? 'SIMULATED' : 'LIVE'} {stampText(read.on)}</span>}
    </div>
  )
}

/** The stamped cell for a key of the local store. */
export function StampedKey({ cells, k, ...rest }: Omit<StampedProps, 'read'> & { cells: Record<string, Cell>; k: string }) {
  return <Stamped {...rest} read={cellRead(cells, k)} />
}

/** The lamp state of a page: LIVE once its store answered, WAITING before. */
export const stateOf = (loaded: boolean): LampState => (loaded ? 'live' : 'waiting')

export interface ConfirmFormProps {
  /** What is being confirmed, in words ("Tuition per semester"). */
  label: string
  /** What the bank or the old list says, quoted as unconfirmed text; null when it says nothing. */
  bank?: string | null
  read: CellRead
  /** Today, as a day key; the day field starts here. */
  today: string
  kind?: 'text' | 'number' | 'date'
  hint?: string
  onSave: (value: string, on: string) => void
  onClear: () => void
}

/**
 * The one way a cell becomes LIVE: the student types the value as the page says it and the day they checked it. Nothing is
 * filled in for them and no page is fetched; the stamp is theirs.
 */
export function ConfirmForm({ label, bank, read, today, kind = 'text', hint, onSave, onClear }: ConfirmFormProps) {
  const [value, setValue] = useState(read.state === 'live' ? read.value : '')
  const [on, setOn] = useState(read.on ?? today)
  return (
    <div className="t2-form t2-confirm" data-confirm="">
      <Stamped label={label} read={read} />
      {bank && <p className="t2-quiet">The list says: {bank}. That is unconfirmed until you check it on the page.</p>}
      <Field label={`${label}, as the page says`} kind={kind} value={value} onChange={(e) => setValue(e.target.value)} hint={hint} />
      <Field label="Day you checked it" kind="date" value={on} onChange={(e) => setOn(e.target.value)} />
      <Button size="lg" tone="primary" disabledReason={value.trim() && on ? undefined : 'Type the value and the day'} onClick={() => onSave(value.trim(), on)}>Confirm from the page</Button>
      {read.state === 'live' && <Button size="md" onClick={onClear}>Take the stamp off</Button>}
    </div>
  )
}

export interface ChoiceProps<T extends string> {
  label: string
  value: T
  onChange: (v: T) => void
  options: { id: T; label: string }[]
}

/**
 * A small radio group of raised keys: the chosen one is pressed in (a sunk key), never the accent fill, so a view keeps its one
 * accent. Arrow keys move and choose, one tab stop, like the kit's Segmented.
 */
export function Choice<T extends string>({ label, value, onChange, options }: ChoiceProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const at = Math.max(0, options.findIndex((o) => o.id === value))
  const move = (i: number) => { const j = (i + options.length) % options.length; onChange(options[j].id); refs.current[j]?.focus() }
  return (
    <div className="t2-choice" role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={o.id} type="button" role="radio" aria-checked={o.id === value} tabIndex={i === at ? 0 : -1} ref={(el) => { refs.current[i] = el }}
          onClick={() => onChange(o.id)}
          onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i + 1) } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i - 1) } }}
        >{o.label}</button>
      ))}
    </div>
  )
}
