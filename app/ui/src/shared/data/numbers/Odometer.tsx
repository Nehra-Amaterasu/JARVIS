// The Odometer (spec 20.5.2, package D01): the hero number of the product. Mechanical digit wheels in a recessed clay
// well, the digit drawn as the pixel numeral of the references (C01-05, C02-34). A wheel rolls only when its value
// changes and only while it is on screen and motion is allowed; otherwise it jumps, with the same final picture.
// LIVE and SIMULATED draw digits. Anything else draws the hollow form: four dashed wells holding "-- --" and the reason,
// never a stale or invented figure. No timer, no animation frame: the roll is one CSS transition on `transform`.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Lamp, lampText, showsValue, type LampState } from '../../kit'
import { useReducedMotion } from '../../motion/useReducedMotion'
import { COMPACT_H, DASH_PATH, HERO_H, MIN_CELLS, SLOT_H, SLOT_W, STRIP_HEIGHT, STRIP_PATH, cellCount, deltaText, digitsOf, groupDigits, leadingZeros, overflows } from './layout'
import './numbers.css'

export interface OdometerProps {
  value: number
  unit: string
  state: LampState
  size?: 'hero' | 'compact'
  /** Why a hollow form is hollow ("no report"); WAITING falls back to "no report". */
  reason?: string
  /** The change since a stated moment, drawn as ASCII beside the unit: `+3 since 09:00`. Needs `since`. */
  delta?: number
  since?: string
  /** Focusable only when it opens something (the series drawer): Enter or Space calls it. */
  onOpen?: () => void
  /** The lamp sits top right at 12 px; a number inside a card that already carries one (the ledger total) turns it off. */
  lamp?: boolean
  className?: string
}

/** True while the element is on screen and the tab is visible. Without IntersectionObserver (tests, old engines) it assumes yes. */
function useOnScreen(ref: React.RefObject<Element | null>): boolean {
  const [on, setOn] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    let seen = true
    const sync = () => setOn(seen && (typeof document === 'undefined' || document.visibilityState !== 'hidden'))
    const io = new IntersectionObserver((es) => { seen = es[es.length - 1]?.isIntersecting ?? true; sync() })
    io.observe(el)
    document.addEventListener('visibilitychange', sync)
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', sync) }
  }, [ref])
  return on
}

function Wheel({ digit, lead }: { digit: number; lead: boolean }) {
  return (
    <span className="d1-well" data-lead={lead ? 'true' : undefined} aria-hidden="true">
      <svg className="d1-strip" style={{ ['--d' as string]: digit }} viewBox={`0 0 ${SLOT_W} ${STRIP_HEIGHT}`} preserveAspectRatio="xMidYMin meet" focusable="false">
        <path d={STRIP_PATH} />
      </svg>
    </span>
  )
}

export function Odometer({ value, unit, state, size = 'hero', reason, delta, since, onOpen, lamp = true, className }: OdometerProps) {
  const root = useRef<HTMLElement | null>(null)
  const onScreen = useOnScreen(root)
  const calm = useReducedMotion()
  const draws = showsValue(state) && Number.isFinite(value) && value >= 0
  const cells = Math.max(MIN_CELLS, cellCount(draws ? value : null))
  const digits = draws ? digitsOf(value, cells) : null
  const lead = digits ? leadingZeros(digits) : 0
  const capped = draws && overflows(value, cells)
  const why = !draws ? lampText(state, reason ?? (state === 'waiting' ? 'no report' : undefined)) : null
  const spoken = draws ? `${capped ? 'more than ' : ''}${groupDigits(value)}${unit ? ` ${unit}` : ''}` : `${unit ? `${unit}: ` : ''}no value, ${why}`
  const dt = draws && delta !== undefined && since ? deltaText(delta, since) : ''
  const h = size === 'hero' ? HERO_H : COMPACT_H
  const interactive = !!onOpen
  const Tag = interactive ? 'button' : 'div'
  const keys = (e: KeyboardEvent) => { if (interactive && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen?.() } }

  return (
    <Tag
      ref={root as never}
      {...(interactive ? { type: 'button', onClick: onOpen, onKeyDown: keys } : { role: 'group' })}
      aria-label={interactive ? `${spoken}. Open the series` : spoken}
      className={`d1-odo${className ? ` ${className}` : ''}`}
      data-component="odometer"
      data-grammar="ascii"
      data-state={state}
      data-size={size}
      data-form={draws ? 'digits' : 'hollow'}
      data-roll={onScreen && !calm ? 'on' : 'off'}
      style={{ ['--d1-h' as string]: `${h}px`, ['--d1-cells' as string]: cells }}
    >
      {lamp && <span className="d1-lamp"><Lamp state={state} reason={reason} bare /></span>}
      <span className="d1-rule" aria-hidden="true" />
      <span className="d1-wells" aria-hidden="true">
        {digits
          ? digits.map((d, i) => <Wheel key={cells - i} digit={d} lead={i < lead} />)
          : Array.from({ length: cells }, (_, i) => (
              <span className="d1-well" data-hollow="true" key={i}>
                {i < 2 || i >= cells - 2 ? (
                  <svg className="d1-dash" viewBox={`0 0 ${SLOT_W} ${SLOT_H}`} focusable="false"><path d={DASH_PATH} /></svg>
                ) : null}
              </span>
            ))}
      </span>
      <span className="d1-foot">
        <span className="d1-unit">{draws ? unit : why}</span>
        {state === 'simulated' && draws && <span className="d1-stamp">SIMULATED</span>}
        {dt && <span className="d1-delta">{dt}</span>}
        {capped && <span className="d1-delta">rack full</span>}
      </span>
    </Tag>
  )
}
