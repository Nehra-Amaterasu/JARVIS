import { useEffect, useRef, type ElementType, type ReactNode } from 'react'
import { ARRIVE_CAP_SCROLL, ARRIVE_THRESHOLD, staggerSlot } from '../motion/reveal'
import { isReducedMotion } from '../motion/useReducedMotion'

/**
 * `arrive` (plan 5.7.3 #1) for one element: a one-shot IntersectionObserver that sets
 * data-arrive="in" the first time 25 % of the element is on screen, then lets go of it.
 *
 * Why one observer per element and not observeArrive(): a card knows its own position in its group
 * (`index`), so the stagger slot is stable however the observer batches entries. Items past `cap`
 * share the last slot, which bounds the stagger at 40 ms x cap (120 ms at a switch, 240 ms in a
 * scrolled group). Under reduced motion nothing is observed and the element simply shows its final
 * state (rule 7: the end state is the default state).
 */
export function useArrive<T extends HTMLElement>(index = 0, cap = ARRIVE_CAP_SCROLL) {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined' || isReducedMotion()) return
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        el.style.setProperty('--i', String(staggerSlot(index, cap)))
        el.setAttribute('data-arrive', 'in')
        io.disconnect()
        el.addEventListener('animationend', () => el.style.removeProperty('--i'), { once: true })
      },
      { threshold: ARRIVE_THRESHOLD },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [index, cap])
  return ref
}

export interface RevealProps {
  /** Position in its group: 0, 1, 2 ... (the page title counts as one at a workspace switch). */
  index?: number
  /** 3 at a workspace switch, 6 (default) for a group revealed by scrolling. */
  cap?: number
  as?: ElementType
  className?: string
  children: ReactNode
}

/** Replaces the ad hoc `.rise` and `.pop`. Nothing below the fold animates; nothing animates twice. */
export function Reveal({ index = 0, cap, as: Tag = 'div', className, children }: RevealProps) {
  const ref = useArrive<HTMLElement>(index, cap)
  return (
    <Tag ref={ref} className={className}>
      {children}
    </Tag>
  )
}
