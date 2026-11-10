/**
 * Density follows the CONTAINER, not the viewport (plan 5.4): the Frame root's width, so the 76 px
 * app rail is already subtracted. 1366 px lands at about 1290 (compact), 1920 at 1844 (roomy).
 *
 *   < 1000   narrow    left column becomes the page, tabs move to the bottom
 *   < 1500   compact   left 248, proof is a 56 px rail
 *   < 1800   regular   left 280, proof pinned at 320
 *   >= 1800  roomy     left 320, proof pinned at 360
 */
import { useLayoutEffect, useState, type RefObject } from 'react'

export type Density = 'narrow' | 'compact' | 'regular' | 'roomy'
export type ProofMode = 'sheet' | 'rail' | 'pinned'

export const densityOf = (w: number): Density => (w < 1000 ? 'narrow' : w < 1500 ? 'compact' : w < 1800 ? 'regular' : 'roomy')
export const proofModeOf = (w: number): ProofMode => (w < 1000 ? 'sheet' : w < 1500 ? 'rail' : 'pinned')

/** Width of `ref`, kept current by one ResizeObserver; before layout (or without one) the window width. */
export function useContainerWidth(ref: RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1290 : window.innerWidth))
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const first = el.getBoundingClientRect().width
    if (first > 0) setW(first)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width
      if (typeof next === 'number' && next > 0) setW(Math.round(next))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}
