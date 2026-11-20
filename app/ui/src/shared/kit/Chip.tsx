import { useId, useRef, type ReactNode } from 'react'
import { cx } from './util'

export type ChipTone = 'neutral' | 'live' | 'sim' | 'fault' | 'behind'
/** A topic's three states, in cycle order. */
export type CycleState = 'todo' | 'learned' | 'solid'

const NEXT: Record<CycleState, CycleState> = { todo: 'learned', learned: 'solid', solid: 'todo' }
const MARK: Record<CycleState, string> = { todo: '○', learned: '◐', solid: '●' }
const WORD: Record<CycleState, string> = { todo: 'to do', learned: 'learned', solid: 'solid' }

export interface ChipProps {
  /** Provenance tones are a dot beside the words, never colour alone. */
  tone?: ChipTone
  selected?: boolean
  count?: number
  /** Makes the chip a toggle button (aria-pressed). */
  onClick?: () => void
  /** A topic chip: to do, learned, solid. Tapping asks for the next state; the caller stores it. */
  cycle?: CycleState
  onCycle?: (next: CycleState) => void
  /** A neighbour closer than 44 px: 44 px high for real. */
  grouped?: boolean
  /** Disabled WITH a reason, as a Button: the chip stays focusable (aria-disabled), a press does nothing, and the reason is printed beside it. */
  disabledReason?: string
  children: ReactNode
  className?: string
}

/**
 * Replaces `chip`, `pill`, `life-chip` and `track-tag`. Without a handler it is a 24 px label; with
 * one it is a control, 36 px visible and 44 px real. The cycle states carry a glyph and a word, so
 * a state is never only a colour or a border weight. The tap motion (5.7.3 #4) is the CSS pop on
 * [data-cycle='pop'] plus the 160 ms colour cross-fade. Poses: rest, hover, pressed, focus, selected (aria-pressed or a cycle
 * state), disabled with a reason. A chip never waits, so it has no loading pose.
 */
export function Chip({ tone = 'neutral', selected, count, onClick, cycle, onCycle, grouped, disabledReason, children, className }: ChipProps) {
  const ref = useRef<HTMLButtonElement>(null)
  const reasonId = useId()
  const blocked = !!disabledReason
  // a chip that is blocked is a control that says no, even before a handler is wired: it must not look enabled
  const interactive = blocked || !!(onClick || (cycle && onCycle))
  const body = (
    <>
      {tone !== 'neutral' && <span className="ww-chip-dot" aria-hidden="true" />}
      {cycle && (
        <span className="ww-chip-mark" aria-hidden="true">
          {MARK[cycle]}
        </span>
      )}
      <span>{children}</span>
      {cycle && <span className="ww-sr-only">, {WORD[cycle]}</span>}
      {count !== undefined && <span className="ww-chip-count">{count}</span>}
    </>
  )
  if (!interactive) {
    return (
      <span className={cx('ww-chip', className)} data-tone={tone} data-cycle-state={cycle} aria-current={selected ? 'true' : undefined}>
        {body}
      </span>
    )
  }
  const pop = () => {
    const el = ref.current
    if (!el) return
    el.removeAttribute('data-cycle')
    void el.offsetWidth // restart the one-shot animation when tapped twice quickly
    el.setAttribute('data-cycle', 'pop')
  }
  const chip = (
    <button
      ref={ref}
      type="button"
      className={cx('ww-chip', 'ww-tap', className)}
      data-tone={tone}
      data-grouped={grouped ? 'true' : undefined}
      data-cycle-state={cycle}
      aria-pressed={cycle ? undefined : !!selected}
      aria-disabled={blocked || undefined}
      aria-describedby={blocked ? reasonId : undefined}
      onAnimationEnd={(e) => e.currentTarget.removeAttribute('data-cycle')}
      onClick={() => {
        if (blocked) return
        if (cycle && onCycle) {
          pop()
          onCycle(NEXT[cycle])
        } else onClick?.()
      }}
    >
      {body}
    </button>
  )
  // one stable wrapper for every control chip: a chip that becomes blocked keeps its button (and its focus) and only gains the reason beside it
  return (
    <span className="ww-btn-wrap">
      {chip}
      {blocked && (
        <span id={reasonId} className="ww-reason">
          {disabledReason}
        </span>
      )}
    </span>
  )
}
