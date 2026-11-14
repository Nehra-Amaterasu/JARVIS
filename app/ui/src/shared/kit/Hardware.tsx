// Family A, tactile hardware (spec 7.2): Knob, Switch, Rocker, Key, TickSlider, Plate.
// Every control follows the 7.1 state grammar: default, hover and pressed are CSS; disabled-with-a-reason,
// loading, error and planned are data attributes set here, so a test (and forced colours) can read them.
// A planned control is aria-disabled, never `disabled`, and a press calls onPlanned (it opens "What is coming").
import { useId, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { LampGlyph, type LampState } from './Lamp'
import { cx } from './util'

/** The two forms every control has beyond its working state (7.1). */
export interface StateForms {
  /** Not built: dashed outline, aria-disabled, the press opens the explanation instead of acting. */
  planned?: boolean
  onPlanned?: () => void
  /** A failed action: 2 px fault edge, triangle and this reason. */
  error?: string
  /** Disabled but explained: stays focusable (aria-disabled) so the reason is reachable. */
  disabledReason?: string
}

const inert = (p: StateForms) => !!p.planned || !!p.disabledReason

function ErrorLine({ id, text }: { id: string; text?: string }) {
  if (!text) return null
  return (
    <span id={id} className="k-err">
      <LampGlyph state="fault" size={12} /> {text}
    </span>
  )
}

/** The attributes common to every control root. */
function stateAttrs(p: StateForms, errId: string) {
  return {
    'data-state': p.planned ? 'planned' : p.error ? 'error' : p.disabledReason ? 'disabled' : undefined,
    'aria-disabled': inert(p) ? true : undefined,
    'aria-describedby': p.error ? errId : undefined,
    'aria-invalid': p.error ? true : undefined,
  } as const
}

// ---------------------------------------------------------------------------------------------- Switch

export interface SwitchProps extends StateForms {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  /** Board-backed switches: the cyan "confirmed" lamp shows only after the board has reported. */
  confirmed?: boolean
  className?: string
}

/** Component 2, the Capsule Switch: a 56 x 32 track, role=switch, Space toggles, Enter does not (switch convention). */
export function Switch({ checked, onChange, label, confirmed, className, ...forms }: SwitchProps) {
  const errId = useId()
  const act = () => {
    if (forms.planned) return forms.onPlanned?.()
    if (forms.disabledReason) return
    onChange(!checked)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === ' ') {
      e.preventDefault()
      act()
    } else if (e.key === 'Enter') e.preventDefault()
  }
  return (
    <span className={cx('k-switch-wrap', className)}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className="k-switch"
        data-on={checked ? 'true' : 'false'}
        {...stateAttrs(forms, errId)}
        onClick={act}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => e.key === ' ' && e.preventDefault()}
      >
        <span className="k-switch-word" aria-hidden="true">
          {checked ? 'ON' : 'OFF'}
        </span>
        <span className="k-switch-thumb" aria-hidden="true" />
        <span className="k-vh">{label}</span>
      </button>
      <span className="k-switch-label">{label}</span>
      {confirmed && (
        <span className="k-confirmed" title="confirmed by board">
          <LampGlyph state="live" size={12} /> <span className="k-vh">confirmed by board</span>
        </span>
      )}
      {forms.disabledReason && <span className="k-reason">{forms.disabledReason}</span>}
      <ErrorLine id={errId} text={forms.error} />
    </span>
  )
}

// ---------------------------------------------------------------------------------------------- Rocker

export interface RockerProps extends StateForms {
  on: boolean
  onChange: (next: boolean) => void
  label: string
  className?: string
}

/** Component 3, the Rocker: a two-item radiogroup, I (ON) left and O (OFF) right; Left and Right move, Space toggles. */
export function Rocker({ on, onChange, label, className, ...forms }: RockerProps) {
  const errId = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const set = (next: boolean) => {
    if (forms.planned) return forms.onPlanned?.()
    if (forms.disabledReason) return
    onChange(next)
    refs.current[next ? 0 : 1]?.focus()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      set(true)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      set(false)
    } else if (e.key === ' ') {
      e.preventDefault()
      set(!on)
    }
  }
  return (
    <span className={cx('k-rocker', className)} role="radiogroup" aria-label={label} {...stateAttrs(forms, errId)} onKeyDown={onKeyDown}>
      {[true, false].map((v, i) => (
        <button
          key={String(v)}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="radio"
          aria-checked={on === v}
          tabIndex={on === v ? 0 : -1}
          className="k-rocker-half"
          data-active={on === v ? 'true' : 'false'}
          onClick={() => set(v)}
        >
          <span aria-hidden="true">{v ? 'I' : 'O'}</span> {v ? 'ON' : 'OFF'}
        </button>
      ))}
      <ErrorLine id={errId} text={forms.error} />
    </span>
  )
}

// ---------------------------------------------------------------------------------------------- Key

export interface KeyProps extends StateForms {
  label: string
  icon?: ReactNode
  /** Shows the label under the icon (mono). */
  caption?: boolean
  /** Present = a toggle (aria-pressed) with an indicator disc top-right. */
  pressed?: boolean
  onPress: () => void
  loading?: boolean
  className?: string
}

/** Component 4, the raised 56 px clay Key. A button, or a toggle button when `pressed` is given. */
export function Key({ label, icon, caption, pressed, onPress, loading, className, ...forms }: KeyProps) {
  const errId = useId()
  const act = () => {
    if (forms.planned) return forms.onPlanned?.()
    if (forms.disabledReason || loading) return
    onPress()
  }
  return (
    <button
      type="button"
      className={cx('k-key', className)}
      aria-label={caption ? undefined : label}
      aria-pressed={pressed}
      aria-busy={loading || undefined}
      {...stateAttrs(forms, errId)}
      data-toggled={pressed === undefined ? undefined : pressed ? 'true' : 'false'}
      onClick={act}
    >
      <span className="k-key-icon" aria-hidden="true">
        {icon}
      </span>
      {caption && <span className="k-key-cap">{loading ? 'saving' : label}</span>}
      {pressed !== undefined && <span className="k-key-ind" aria-hidden="true" />}
      <ErrorLine id={errId} text={forms.error} />
    </button>
  )
}

// ---------------------------------------------------------------------------------------------- TickSlider

export interface TickSliderProps extends StateForms {
  value: number
  onChange: (v: number) => void
  label: string
  min?: number
  max?: number
  step?: number
  unit?: string
  /** A paired number field: the fine control and the text equivalent. */
  withNumber?: boolean
  className?: string
}

/** Component 8, the Tick Slider: a native range input (arrows, Home and End are the browser's) with a tick row and a value readout. --k-frac (0 to 1) lets the stylesheet fill the recessed track up to the thumb. */
export function TickSlider({ value, onChange, label, min = 0, max = 100, step = 1, unit, withNumber, className, ...forms }: TickSliderProps) {
  const errId = useId()
  const id = useId()
  const frozen = inert(forms)
  const ticks = Array.from({ length: 11 }, (_, i) => i)
  const apply = (raw: string) => {
    if (frozen) return forms.planned ? forms.onPlanned?.() : undefined
    const n = Number(raw)
    if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)))
  }
  return (
    <span className={cx('k-slider', className)} {...stateAttrs(forms, errId)}>
      <label htmlFor={id} className="k-slider-label">
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--k-frac': max === min ? 0 : (Math.min(max, Math.max(min, value)) - min) / (max - min) } as CSSProperties}
        aria-disabled={frozen || undefined}
        aria-valuetext={`${value}${unit ? ' ' + unit : ''}`}
        onChange={(e) => apply(e.currentTarget.value)}
      />
      <span className="k-ticks" aria-hidden="true">
        {ticks.map((t) => (
          <i key={t} data-major={t % 5 === 0 ? 'true' : undefined} />
        ))}
      </span>
      <output className="k-slider-value" htmlFor={id}>
        {value}
        {unit && <small> {unit}</small>}
      </output>
      {withNumber && (
        <input className="k-slider-num" type="number" aria-label={`${label}, exact value`} min={min} max={max} step={step} value={value} aria-disabled={frozen || undefined} onChange={(e) => apply(e.currentTarget.value)} />
      )}
      {forms.disabledReason && <span className="k-reason">{forms.disabledReason}</span>}
      <ErrorLine id={errId} text={forms.error} />
    </span>
  )
}

// ---------------------------------------------------------------------------------------------- Knob

export interface KnobProps extends StateForms {
  value: number
  onChange: (v: number) => void
  label: string
  min?: number
  max?: number
  step?: number
  size?: 'hero' | 'compact'
  unit?: string
  className?: string
}

/** The accent run of the knob, from the minimum (-135 degrees from the top) to the value, on a 32 radius between the cap
 * (r 28) and the tick ring (r 36 to 45), as the orange arc of C02-46's dials. */
function knobArc(frac: number) {
  const R = 32
  const pt = (deg: number) => {
    const a = (deg * Math.PI) / 180
    return `${(Math.sin(a) * R).toFixed(2)} ${(-Math.cos(a) * R).toFixed(2)}`
  }
  const end = -135 + 270 * Math.min(1, frac)
  return `M ${pt(-135)} A ${R} ${R} 0 ${end + 135 > 180 ? 1 : 0} 1 ${pt(end)}`
}

/**
 * Component 1, the Knob: role=slider with the keys of a slider (arrows step, PageUp and PageDown ten steps, Home and
 * End the ends, Shift a fine step). Never the only way to set a value: the number field of the Setup sheet is its text
 * equivalent. 24 ticks on a 270 degree arc, every 5th major.
 */
export function Knob({ value, onChange, label, min = 0, max = 100, step = 1, size = 'hero', unit, className, ...forms }: KnobProps) {
  const errId = useId()
  const frozen = inert(forms)
  const set = (v: number) => {
    if (forms.planned) return forms.onPlanned?.()
    if (frozen) return
    onChange(Math.min(max, Math.max(min, v)))
  }
  const onKeyDown = (e: KeyboardEvent) => {
    const fine = e.shiftKey ? step / 10 : step
    const map: Record<string, number | undefined> = {
      ArrowUp: value + fine,
      ArrowRight: value + fine,
      ArrowDown: value - fine,
      ArrowLeft: value - fine,
      PageUp: value + step * 10,
      PageDown: value - step * 10,
      Home: min,
      End: max,
    }
    const next = map[e.key]
    if (next === undefined) return
    e.preventDefault()
    set(next)
  }
  const frac = max === min ? 0 : (value - min) / (max - min)
  const angle = -135 + 270 * frac
  const TICKS = 24
  const text = `${value}${unit ? ' ' + unit : ''}`
  return (
    <span className={cx('k-knob-wrap', className)} data-size={size}>
      <span
        className="k-knob"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={text}
        data-at={value <= min ? 'min' : value >= max ? 'max' : undefined}
        {...stateAttrs(forms, errId)}
        onKeyDown={onKeyDown}
      >
        <svg viewBox="-50 -50 100 100" aria-hidden="true" focusable="false" className="k-knob-svg">
          {Array.from({ length: TICKS }, (_, i) => {
            const a = ((-135 + (270 * i) / (TICKS - 1) - 90) * Math.PI) / 180
            const major = i % 5 === 0
            const r1 = major ? 36 : 39
            return <line key={i} className="k-tick" data-major={major ? 'true' : undefined} x1={Math.cos(a) * r1} y1={Math.sin(a) * r1} x2={Math.cos(a) * 45} y2={Math.sin(a) * 45} />
          })}
          <circle className="k-knob-cap" r="28" />
          {!forms.planned && frac > 0 && <path className="k-knob-arc" d={knobArc(frac)} />}
          {!forms.planned && <line className="k-knob-notch" x1="0" y1="-8" x2="0" y2="-24" transform={`rotate(${angle})`} />}
        </svg>
      </span>
      <output className="k-knob-value">{text}</output>
      <ErrorLine id={errId} text={forms.error} />
    </span>
  )
}

// ---------------------------------------------------------------------------------------------- Plate

export interface PlateProps {
  children: ReactNode
  /** Serial or section text on a second mono line. */
  serial?: string
  /** A decorative 1D barcode of plain bars; hidden from assistive technology. */
  barcode?: boolean
  /** A status plate carries a lamp. */
  state?: LampState
  /** Not built: dashed. */
  planned?: boolean
  /** A link plate behaves as a link. */
  href?: string
  className?: string
}

/** Component 10, the Chamfered Label Plate: 12 px mono caps on a 10 px chamfered plate; a rectangle with a real border in forced colours. */
export function Plate({ children, serial, barcode, state, planned, href, className }: PlateProps) {
  const body = (
    <>
      {state && <LampGlyph state={state} size={12} />}
      <span className="k-plate-text">{children}</span>
      {serial && <span className="k-plate-serial">{serial}</span>}
      {barcode && (
        <span className="k-barcode" aria-hidden="true">
          {Array.from({ length: 18 }, (_, i) => (
            <i key={i} data-w={(i * 7) % 3} />
          ))}
        </span>
      )}
    </>
  )
  const props = { className: cx('k-plate', className), 'data-state': planned ? 'planned' : undefined }
  return href ? (
    <a {...props} href={href}>
      {body}
    </a>
  ) : (
    <span {...props}>{body}</span>
  )
}
