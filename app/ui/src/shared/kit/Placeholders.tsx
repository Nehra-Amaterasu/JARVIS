// The carcass primitives (plan 7): ComingCard, LockChip, CoachMark. All of them are STATIC.
import { useEffect, useRef, useState } from 'react'
import { Lock } from 'lucide-react'
import { Button } from './Button'
import { useArrive } from './Reveal'
import { cx, session } from './util'

export interface ComingCardProps {
  /** The registry id (chunk 5 resolves it to the entry; the card takes the entry's fields). */
  featureId: string
  label: string
  /** The one line shown: 15 to 140 characters, says what is missing and why. */
  line: string
  when?: string
  /** Position among its siblings, for the one `arrive` it is allowed. */
  index?: number
  className?: string
}

/**
 * Pattern C. A placeholder is not a feature, so it never wears the accent, never lifts, never animates
 * after it arrives, and holds no enabled button. The dashed outline in --line-ui is the only cue that
 * it is not live, which is why it must clear 3:1 (css-lint.test.ts checks the token).
 */
export function ComingCard({ featureId, label, line, when, index, className }: ComingCardProps) {
  const reveal = useArrive<HTMLElement>(index ?? 0)
  return (
    <section ref={index === undefined ? undefined : reveal} className={cx('ww-coming', className)} data-coming={featureId} aria-label={`${label}, not built yet`}>
      <span className="ww-kicker">{label}</span>
      <p className="ww-coming-line">{line}</p>
      {when && <p className="ww-coming-when">When: {when}</p>}
    </section>
  )
}

/** Ids announced since this page loaded: the fallback when sessionStorage is blocked. */
const announced = new Set<string>()
export const clearLockMemory = () => announced.clear()
const lockKey = (id: string) => `ww.lock.${id}`

export interface LockChipProps {
  id: string
  /** Why it is locked, in the person's words ("Needs one marked paper"). */
  reason: string
}

/**
 * A locked section announces itself ONCE per session: the first time it shows, it plays one `arrive`
 * and writes one polite live line, "Locked: <reason>". Every later show is silent, so a dashboard of
 * locked cards is not a wall of announcements. A refused press elsewhere does not shake anything.
 */
export function LockChip({ id, reason }: LockChipProps) {
  const first = useRef(!announced.has(id) && session.get(lockKey(id)) === null)
  const [line, setLine] = useState('')
  useEffect(() => {
    if (!first.current) return
    announced.add(id)
    session.set(lockKey(id), '1')
    // the region exists empty on first paint; filling it afterwards is what a screen reader announces
    setLine(`Locked: ${reason}`)
  }, [id, reason])
  return (
    <span className="ww-lockchip" data-lock={id} data-arrive={first.current ? 'in' : undefined}>
      <Lock size={14} aria-hidden="true" />
      <span>Locked: {reason}</span>
      <span className="ww-sr-only" role="status" aria-live="polite">
        {line}
      </span>
    </span>
  )
}

const coachKey = (id: string) => `ww.coach.${id}`
const dismissed = new Set<string>()
export const clearCoachMemory = () => dismissed.clear()
const wasDismissed = (id: string): boolean => {
  if (dismissed.has(id)) return true
  try {
    return localStorage.getItem(coachKey(id)) !== null
  } catch {
    return false
  }
}

export interface CoachMarkProps {
  id: string
  text: string
  onDismiss?: () => void
}

/** Shown once per id, dismissed in one tap, and never back: not this session (the Set) and not the next (localStorage, try/catch). */
export function CoachMark({ id, text, onDismiss }: CoachMarkProps) {
  const [gone, setGone] = useState(() => wasDismissed(id))
  if (gone) return null
  return (
    <aside className="ww-coach" role="note" data-coach={id}>
      <span className="ww-coach-text">{text}</span>
      <Button
        size="sm"
        grouped
        onClick={() => {
          dismissed.add(id)
          try {
            localStorage.setItem(coachKey(id), '1')
          } catch {
            /* blocked: the Set still holds it for this session */
          }
          setGone(true)
          onDismiss?.()
        }}
      >
        Got it
      </Button>
    </aside>
  )
}
