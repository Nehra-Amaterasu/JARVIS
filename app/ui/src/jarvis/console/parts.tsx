// The Console's own small parts (A.J05): the terminal row, the job row, the route plates, the VRAM dial, the ASCII ruler
// and the two-press key. Each is drawn from props only, so the gallery and the tests feed them fixtures. Honest by
// construction: a bar fills only to a reported fraction; a dial with no reading is a dashed ring with no number; a
// failure is the lamp's amber triangle with the word FAULT and its reason.
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { AsciiBar, Sigil } from '../../shared/grammar'
import { Lamp, LampGlyph, LAMP_SPECS, showsNumber, type LampReading } from '../../shared/lamp'
import { PlannedGlyph } from '../../shared/lamp/PlannedGlyph'
import type { PlannedEntry } from '../../shared/planned/types'
import { PLATE_WORD, gb, plateLine, plateSpoken, routePlates, validFraction, type ConsoleRowData, type GpuModel, type JobSpec } from './model'

/* ------------------------------------------------------------------ one terminal row */
/** `[HEA] can he hear "Hey Jarvis": yes   LIVE listening for the wake word`: the bracket tag, the line, the lamp and its reason. */
export function ConsoleRow({ row, now }: { row: ConsoleRowData; now?: number }) {
  const { tag, text, reading } = row
  // the reason is printed for a hollow or failed reading (the lamp shows only its word); a LIVE or SIMULATED line's own words carry it
  const why = reading.reason && !showsNumber(reading.state) ? reading.reason : null
  return (
    <li className="jx-row" data-tag={tag} data-state={reading.state}>
      <span className="jx-tag">[{tag}]</span>
      <span className="jx-row-text">{text}</span>
      {why && <span className="jx-row-why">{why}</span>}
      <span className="jx-row-lamp"><Lamp reading={reading} subject={tag} now={now} /></span>
    </li>
  )
}

/** A lamp with its reason printed beside it: the lamp itself shows only the state word, so a hollow form that stands alone
 *  (an empty list, a reading with no source) says why in plain text, not only in the tooltip. */
export function LampLine({ reading, subject }: { reading: LampReading; subject?: string }) {
  return (
    <span className="jx-lampline">
      <Lamp reading={reading} subject={subject} />
      {reading.reason && <span className="jx-lampline-why">{reading.reason}</span>}
    </span>
  )
}

/* ------------------------------------------------------------------ job row */
export interface JobRowProps {
  label: string
  /** 0..1. Only a reported fraction fills the bar; without one it is hollow and dashed. */
  fraction?: number
  state: JobSpec['state']
  tag?: 'SYS' | 'BRD'
  reason?: string
  /** The traveller at the head of the fill (a Trim choice); default the plain head. */
  head?: '>' | 'car' | 'chopper'
}

const jobReading = (state: JobSpec['state'], reason?: string): LampReading =>
  state === 'fault' ? { state: 'fault', since: null, reason: reason || 'no reason given' }
    : state === 'done' ? { state: 'live', since: null, reason: reason || 'finished' }
      : state === 'hollow' ? { state: 'waiting', since: null, reason: reason ? `${reason}, no progress reported` : 'no progress reported' }
        : { state: 'live', since: null, reason: reason || 'running' }

export function JobRow({ label, fraction, state, tag = 'SYS', reason, head = '>' }: JobRowProps) {
  const filled = validFraction(fraction) && (state === 'live' || state === 'done')
  const reading = jobReading(state, reason)
  return (
    <li className="jx-job" data-state={state} data-hollow={filled ? undefined : 'true'}>
      <span className="jx-tag">[{tag}]</span>
      <span className="jx-job-label">{label}</span>
      {state === 'fault' ? (
        <span className="jx-job-fault"><LampGlyph state="fault" size={12} /><span>{reason || 'no reason given'}</span></span>
      ) : (
        <AsciiBar
          value={filled ? (fraction as number) : NaN} max={1} width={12} head={filled && state === 'live' ? head : undefined}
          state={filled ? 'live' : 'waiting'} label={label} reading={<Lamp reading={reading} showLabel size={12} />}
        />
      )}
    </li>
  )
}

export function JobBoard({ jobs, empty }: { jobs: readonly JobSpec[]; empty?: string }) {
  if (!jobs.length) return <p className="jx-empty"><LampLine reading={{ state: 'waiting', since: null, reason: empty ?? 'nothing is running' }} subject="Jobs" /></p>
  return <ul className="jx-jobs" aria-label="Job board">{jobs.map((j) => <JobRow key={j.id} {...j} />)}</ul>
}

/* ------------------------------------------------------------------ route plates */
export interface RoutePlatesProps {
  registry: readonly PlannedEntry[]
  onOpen?: (id: string) => void
  max?: number
}

/** The planned registry as a route: plates joined by a dashed path. Passed is solid, built-not-verified half, planned dashed. */
export function RoutePlates({ registry, onOpen, max = 14 }: RoutePlatesProps) {
  const plates = routePlates(registry, max)
  const list = useRef<HTMLOListElement>(null)
  const onKeyDown = (e: KeyboardEvent<HTMLOListElement>) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return
    const items = [...(list.current?.querySelectorAll<HTMLElement>('[data-plate]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (i < 0) return
    e.preventDefault()
    const n = items.length
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : e.key === 'ArrowRight' ? (i + 1) % n : (i - 1 + n) % n
    items.forEach((el, j) => el.setAttribute('tabindex', j === next ? '0' : '-1'))
    items[next].focus()
  }
  return (
    <ol ref={list} className="jx-route" aria-label="Route: what is planned, passed and waiting" onKeyDown={onKeyDown}>
      {plates.map((p, i) => (
        <li key={p.id} className="jx-plate-li" data-state={p.state}>
          <button
            type="button" className="jx-plate" data-plate={p.id} data-state={p.state} tabIndex={i === 0 ? 0 : -1}
            aria-label={`${p.label}: ${PLATE_WORD[p.state]}. ${plateSpoken(p.line, p.state)} Needs: ${p.needs}`} onClick={() => onOpen?.(p.id)}
          >
            <span className="jx-plate-top">
              {p.state === 'planned' ? <PlannedGlyph width={12} height={12} /> : <LampGlyph state={p.state === 'passed' ? 'live' : 'waiting'} size={12} />}
              <span className="jx-plate-word">{PLATE_WORD[p.state]}</span>
            </span>
            <b className="jx-plate-name">{p.label}</b>
            <span className="jx-plate-line">{plateLine(p.line, p.state)}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}

/* ------------------------------------------------------------------ VRAM dial */
const DIAL = { c: 120, r: 92, a0: 135, sweep: 270 }
const rad = (deg: number) => ((deg - 90) * Math.PI) / 180
const pt = (r: number, deg: number) => ({ x: DIAL.c + r * Math.cos(rad(deg)), y: DIAL.c + r * Math.sin(rad(deg)) })
const arcPath = (r: number, d0: number, d1: number) => {
  const p = pt(r, d0)
  const q = pt(r, d1)
  return `M${p.x.toFixed(2)} ${p.y.toFixed(2)}A${r} ${r} 0 ${d1 - d0 > 180 ? 1 : 0} 1 ${q.x.toFixed(2)} ${q.y.toFixed(2)}`
}
const TICKS = (() => {
  let d = ''
  for (let i = 0; i <= 40; i++) {
    const deg = DIAL.a0 + (DIAL.sweep * i) / 40
    const major = i % 10 === 0
    const a = pt(DIAL.r + 11, deg)
    const b = pt(DIAL.r + (major ? 21 : 16), deg)
    d += `M${a.x.toFixed(2)} ${a.y.toFixed(2)}L${b.x.toFixed(2)} ${b.y.toFixed(2)}`
  }
  return d
})()

/** The GPU memory as a 270 degree arc (C02-12): the model part solid, the rest of the used part lighter, the unused part
 *  a track. With no reading it is a dashed ring, no number, and the reason under it. */
export function VramDial({ model }: { model: GpuModel }) {
  const hollow = model.fraction === null
  const end = (f: number) => DIAL.a0 + DIAL.sweep * Math.max(0, Math.min(1, f))
  const total = model.totalMb || 1
  const llmF = model.llmMb / total
  const usedF = model.fraction ?? 0
  const label = hollow
    ? `GPU memory: no reading, ${LAMP_SPECS[model.reading.state].label}, ${model.reading.reason}`
    : `GPU memory ${gb(model.usedMb)} of ${gb(model.totalMb)} GB used, ${Math.round(usedF * 100)} percent; models hold ${gb(model.llmMb)} GB`
  return (
    <div className="jx-dial" data-hollow={hollow ? 'true' : undefined} role="img" aria-label={label}>
      <svg viewBox="0 0 240 240" aria-hidden="true" focusable="false">
        <path className="jx-dial-ticks" d={TICKS} />
        <path className="jx-dial-track" d={arcPath(DIAL.r, DIAL.a0, DIAL.a0 + DIAL.sweep)} data-hollow={hollow ? 'true' : undefined} />
        {!hollow && usedF > 0.004 && <path className="jx-dial-used" d={arcPath(DIAL.r, DIAL.a0, end(usedF))} />}
        {!hollow && llmF > 0.004 && <path className="jx-dial-llm" d={arcPath(DIAL.r, DIAL.a0, end(llmF))} />}
        <circle className="jx-dial-disc" cx={DIAL.c} cy={DIAL.c} r="66" />
        <circle className="jx-dial-rim" cx={DIAL.c} cy={DIAL.c} r="66" />
      </svg>
      <div className="jx-dial-read">
        <b className="jx-dial-num">{hollow ? '--' : gb(model.usedMb)}</b>
        <span className="jx-dial-unit">{hollow ? 'GB, no reading' : `GB of ${gb(model.totalMb)}`}</span>
        <Lamp reading={model.reading} showLabel size={12} subject="GPU memory" />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ the ASCII ruler */
/** A ruler of the machine, a block that sweeps along it. Decorative: aria-hidden, never a reading. Reduced motion: the
 *  block rests at the left (core.css-style single media query in console.css). */
export function AsciiRuler({ cols = 40 }: { cols?: number }) {
  const body = Array.from({ length: cols }, (_, i) => (i % 10 === 0 ? '|' : i % 5 === 0 ? ':' : '.')).join('')
  return (
    <span className="jx-ruler" aria-hidden="true" style={{ ['--cols' as string]: cols }}>
      <span className="jx-ruler-body">{body}|</span>
      <span className="jx-ruler-head">{'▮'}</span>
    </span>
  )
}

/* ------------------------------------------------------------------ keys */
export interface KeyProps {
  label: string
  onPress: () => void
  icon?: ReactNode
  accent?: boolean
  /** Aria-disabled with the reason as its title and text: stays focusable so the reason is reachable. */
  disabledReason?: string
  busy?: boolean
  quiet?: boolean
  pressed?: boolean
  keys?: string
  id?: string
}

export function ConsoleKey({ label, onPress, icon, accent, disabledReason, busy, quiet, pressed, keys, id }: KeyProps) {
  return (
    <button
      id={id} type="button" className="jx-key" data-accent={accent ? 'true' : undefined} data-quiet={quiet ? 'true' : undefined}
      aria-disabled={disabledReason || busy ? true : undefined} aria-busy={busy || undefined} aria-pressed={pressed}
      aria-keyshortcuts={keys} title={disabledReason}
      onClick={() => { if (!disabledReason && !busy) onPress() }}
    >
      {icon && <span className="jx-key-icon" aria-hidden="true">{icon}</span>}
      <span>{label}</span>
    </button>
  )
}

/** A key that changes something: the first press arms it (the label says what the second press does), the second runs it.
 *  Esc or leaving the key disarms it. Never a timer: an armed key waits for the person. */
export function GuardKey({ label, armedLabel, onConfirm, ...rest }: Omit<KeyProps, 'onPress' | 'pressed'> & { armedLabel?: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  return (
    <span className="jx-guard" data-armed={armed ? 'true' : undefined} onBlur={() => setArmed(false)} onKeyDown={(e) => { if (e.key === 'Escape' && armed) { e.stopPropagation(); setArmed(false) } }}>
      <ConsoleKey
        {...rest}
        label={armed ? (armedLabel ?? `Press again: ${label}`) : label}
        onPress={() => { if (armed) { setArmed(false); onConfirm() } else setArmed(true) }}
      />
      <span className="jx-sr" role="status" aria-live="polite">{armed ? `${armedLabel ?? label}: press again to run it, Escape to cancel` : ''}</span>
    </span>
  )
}

/* ------------------------------------------------------------------ headings */
export function PartHead({ tag, title, seed, right, stamp }: { tag: string; title: string; seed: string; right?: ReactNode; stamp?: boolean }) {
  return (
    <header className="jx-head">
      <span className="jx-head-seal" aria-hidden="true"><Sigil seed={seed} size={16} /></span>
      <h2 className="jx-head-title"><span className="jx-tag">[{tag}]</span> {title}</h2>
      {stamp && <span className="jx-stamp" role="note">FIXTURE, SIMULATED</span>}
      {right && <span className="jx-head-right">{right}</span>}
    </header>
  )
}

/* ------------------------------------------------------------------ tabs */
export interface ConsoleTab { id: string; label: string; count?: number }

/** A tablist in the Console's own clay: a recessed channel, the selected tab raised and in full ink. One tab stop; Left,
 *  Right, Home and End move and select. Drawn here (not the kit's FolderTabs) because the kit's channel paints a shaded
 *  gradient that the charcoal wells' readable-text check reads as a light stop under the unselected labels. */
export function ConsoleTabs({ tabs, value, onChange, label, className }: { tabs: ConsoleTab[]; value: string; onChange: (id: string) => void; label: string; className?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const go = (i: number) => {
    const n = (i + tabs.length) % tabs.length
    refs.current[n]?.focus()
    onChange(tabs[n].id)
  }
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null
    if (to === null) return
    e.preventDefault()
    go(to)
  }
  return (
    <div className={`jx-tabs${className ? ` ${className}` : ''}`} role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.id} ref={(el) => { refs.current[i] = el }} type="button" role="tab" className="jx-tab" aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1} onClick={() => onChange(t.id)} onKeyDown={(e) => onKeyDown(e, i)}
        >
          {t.label}{t.count !== undefined && <span className="jx-tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export { showsNumber }
