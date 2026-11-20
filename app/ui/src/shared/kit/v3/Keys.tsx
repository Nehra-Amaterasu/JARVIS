// The keys of design language v3 (spec 2.4, 2.5, 5): a soft clay Key with its poses, the ONE accent variant, the LockedKey
// (sunk, aria-disabled, its reason printed beside it), the keycap, and the counter row with its +1 key.
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cx, tokenMs } from '../util'
import '../glass.css'

/** A pose painted still by [data-demo] (the gallery, a screenshot). Real pointer and keyboard answer the same rules. */
export type KeyPose = 'rest' | 'hover' | 'pressed' | 'focus'

export interface KeyProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> {
  /** The one warm fill of a view. Never use two in one view; a key pressed into its working state turns neutral (lit). */
  accent?: boolean
  /** The neutral lit state: ON, selected, a mode in use. Never the accent. A 6 px dot goes with it. */
  lit?: boolean
  /** True: the key is a toggle and carries aria-pressed (the lit state is its on state). */
  toggle?: boolean
  size?: 'md' | 'big' | 'icon'
  /** Key caps drawn inside the label as pressed-in wells (CTRL, SHIFT, SPACE). */
  caps?: readonly string[]
  /** Hold a pose still. */
  pose?: KeyPose
  /** Work in progress: the key keeps its place and says so; a press does nothing until it clears. */
  busy?: boolean
  className?: string
  children?: ReactNode
}

export function PressKey({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cx('v3-cap', className)}>{children}</kbd>
}

/** A soft clay key: 44 px minimum on both sides, rest, hover (lifts 1 px), pressed (sinks), focus (3 px gap, 2 px ring). */
export function Key({ accent, lit, toggle, size = 'md', caps, pose, busy, className, children, type = 'button', onClick, ...rest }: KeyProps) {
  return (
    <button
      {...rest}
      type={type}
      className={cx('v3-key', className)}
      data-accent={accent ? 'true' : undefined}
      data-lit={lit ? 'true' : undefined}
      data-size={size === 'md' ? undefined : size}
      data-demo={pose && pose !== 'rest' ? pose : undefined}
      data-busy={busy ? 'true' : undefined}
      aria-pressed={toggle ? !!lit : undefined}
      aria-busy={busy ? true : undefined}
      onClick={busy ? undefined : onClick}
    >
      {children}
      {caps?.map((c) => (
        <PressKey key={c}>{c}</PressKey>
      ))}
    </button>
  )
}

// ---------------------------------------------------------------------------------------------- LockedKey

function LockGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" data-glyph="lock">
      <rect x="3.2" y="7" width="9.6" height="6.6" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.4 7V5.2a2.6 2.6 0 0 1 5.2 0V7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export interface LockedKeyProps {
  children: ReactNode
  /** Why it cannot run, as a sentence without the prefix: "needs the steward to answer first." It is printed as "Locked: ...". */
  reason: string
  size?: 'md' | 'big'
  className?: string
  /** Hold the pose still (it does not change: hover and press are the same picture). */
  pose?: KeyPose
}

/**
 * An action that cannot run now. Sunk shallow (no raise, no press), its label in the locked ink (at least 4.5 to 1), a 16 px
 * lock before it, and the reason as real text under it. It is aria-disabled and stays focusable so the reason is reachable;
 * a press does nothing. "Press" means ON elsewhere in this language, so it is never used for a blocked key.
 */
export function LockedKey({ children, reason, size = 'md', className, pose }: LockedKeyProps) {
  const why = useId()
  return (
    <span className={cx('v3-locked', className)}>
      <button
        type="button"
        className="v3-key"
        data-kind="locked"
        data-size={size === 'md' ? undefined : size}
        data-demo={pose && pose !== 'rest' ? pose : undefined}
        aria-disabled="true"
        aria-describedby={why}
        onClick={(e) => e.preventDefault()}
      >
        <LockGlyph />
        {children}
      </button>
      <span className="v3-locked-why" id={why}>{`Locked: ${reason}`}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------------------------- Counter

export interface CounterProps {
  name: string
  /** Null while its source is WAITING: the dial then shows a dash, never a made-up zero. */
  count: number | null
  onTap: () => void
  /** The state line under the name. Default: "no taps yet" at a real zero, "N so far today" after. */
  line?: string
  className?: string
}

/**
 * A frequent act looks like an act (rule 4.1.11): a pressed dial with the count, the name with its state line, and a raised +1
 * key (52 by 44). A tap sinks the key for a beat and the new digit rolls in from above. A real zero shows "0" and "no taps yet".
 */
export function Counter({ name, count, onTap, line, className }: CounterProps) {
  const [tapped, setTapped] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const sub = line ?? (count === null ? 'waiting for its source' : count === 0 ? 'no taps yet' : `${count} so far today`)
  const tap = () => {
    const ms = tokenMs(ref.current, '--d-roll', 160)
    if (ms > 0) {
      setTapped(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setTapped(false), ms)
    }
    onTap()
  }
  return (
    <div className={cx('v3-counter', className)}>
      <span className="v3-counter-dial" aria-hidden="true">
        <span className="v3-roll" key={count ?? 'none'}>
          {count === null ? '–' : count}
        </span>
      </span>
      <span className="v3-counter-name">
        <b>{name}</b>
        <small>{sub}</small>
      </span>
      <button ref={ref} type="button" className="v3-key" data-tapped={tapped ? 'true' : undefined} aria-label={`+1 ${name}`} onClick={tap}>
        +1
      </button>
    </div>
  )
}
