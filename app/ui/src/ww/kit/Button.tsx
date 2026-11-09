import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type MouseEvent, type ReactNode, type Ref } from 'react'
import { Lock } from 'lucide-react'
import { cx, tokenMs } from './util'

export type ControlSize = 'sm' | 'md' | 'lg'
export type ButtonTone = 'primary' | 'quiet' | 'danger'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** sm 36, md 40, lg 48 px visible (plan 5.4). */
  size?: ControlSize
  tone?: ButtonTone
  loading?: boolean
  /**
   * Disabled WITH a reason: the button stays focusable (aria-disabled, never the disabled attribute),
   * its text goes to --ink-disabled with a lock, and the reason is printed beside it. A refused press
   * does not shake; the reason flashes in --selected-bg for one --dur-state (5.7.6).
   */
  disabledReason?: string
  /** A neighbour closer than 44 px: the box itself is 44 px high, not only its hit area (5.4). */
  grouped?: boolean
  ref?: Ref<HTMLButtonElement>
  children: ReactNode
}

export function Button({ size = 'md', tone = 'quiet', loading, disabledReason, grouped, className, onClick, children, ...rest }: ButtonProps) {
  const reasonId = useId()
  const [flash, setFlash] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
  const blocked = !!disabledReason
  const handle = (e: MouseEvent<HTMLButtonElement>) => {
    if (blocked || loading) {
      e.preventDefault()
      if (blocked) {
        setFlash(true)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setFlash(false), tokenMs(wrap.current, '--dur-state', 160))
      }
      return
    }
    onClick?.(e)
  }
  const btn = (
    <button
      type="button"
      {...rest}
      className={cx('ww-btn', 'ww-tap', tone, className)}
      data-size={size}
      data-grouped={grouped ? 'true' : undefined}
      data-loading={loading ? 'true' : undefined}
      aria-disabled={blocked || undefined}
      aria-busy={loading || undefined}
      aria-describedby={blocked ? reasonId : rest['aria-describedby']}
      onClick={handle}
    >
      {blocked && <Lock size={14} aria-hidden="true" />}
      {children}
      {loading && <span className="ww-sr-only"> Working</span>}
    </button>
  )
  if (!blocked) return btn
  return (
    <span className="ww-btn-wrap" ref={wrap}>
      {btn}
      <span id={reasonId} className="ww-reason" data-flash={flash ? 'on' : undefined}>
        {disabledReason}
      </span>
    </span>
  )
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  /** Required by type: an icon-only control with no name is the failure this prevents. */
  label: string
  size?: ControlSize
  grouped?: boolean
  children: ReactNode
}

/** Hover is neutral, never fault red (a destructive icon still hovers neutral and confirms elsewhere). */
export function IconButton({ label, size = 'md', grouped, className, children, ...rest }: IconButtonProps) {
  return (
    <button type="button" title={label} {...rest} aria-label={label} className={cx('ww-btn', 'ww-iconbtn', 'ww-tap', className)} data-size={size} data-grouped={grouped ? 'true' : undefined}>
      {children}
    </button>
  )
}
