import { useRef, type ReactNode } from 'react'
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
  children: ReactNode
  className?: string
}

/**
 * Replaces `chip`, `pill`, `life-chip` and `track-tag`. Without a handler it is a 24 px label; with
 * one it is a control, 36 px visible and 44 px real. The cycle states carry a glyph and a word, so
 * a state is never only a colour or a border weight. The tap motion (5.7.3 #4) is the CSS pop on
 * [data-cycle='pop'] plus the 160 ms colour cross-fade.
 */
export function Chip({ tone = 'neutral', selected, count, onClick, cycle, onCycle, grouped, children, className }: ChipProps) {
  const ref = useRef<HTMLButtonElement>(null)
  const interactive = !!(onClick || (cycle && onCycle))
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
  return (
    <button
      ref={ref}
      type="button"
      className={cx('ww-chip', 'ww-tap', className)}
      data-tone={tone}
      data-grouped={grouped ? 'true' : undefined}
      data-cycle-state={cycle}
      aria-pressed={cycle ? undefined : !!selected}
      onAnimationEnd={(e) => e.currentTarget.removeAttribute('data-cycle')}
      onClick={() => {
        if (cycle && onCycle) {
          pop()
          onCycle(NEXT[cycle])
        } else onClick?.()
      }}
    >
      {body}
    </button>
  )
}
