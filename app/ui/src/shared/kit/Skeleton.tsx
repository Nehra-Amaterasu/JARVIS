import { useEffect, useRef, useState } from 'react'
import { tokenMs } from './util'

/** The plan's 200 ms: a load that finishes inside it never shows a placeholder at all. */
export const SKELETON_DELAY_MS = 200

export interface SkeletonProps {
  lines?: number
  /** Set false when data has arrived; a skeleton that was shown leaves with a 100 ms opacity step. */
  loading?: boolean
}

/**
 * A loading placeholder, and a static one (plan 7, "the carcass as motion"): a block in --surface-2,
 * no keyframes, no shimmer, no pulse. It appears at its final state, only if data has not arrived
 * after 200 ms, and is removed with one opacity step (--dur-feedback). The line widths are fixed
 * fractions, so two renders of the same skeleton are the same pixels.
 */
export function Skeleton({ lines = 3, loading = true }: SkeletonProps) {
  const [shown, setShown] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!loading) return
    const t = setTimeout(() => setShown(true), SKELETON_DELAY_MS)
    return () => clearTimeout(t)
  }, [loading])
  useEffect(() => {
    if (loading || !shown) return
    setLeaving(true)
    const t = setTimeout(() => {
      setShown(false)
      setLeaving(false)
    }, tokenMs(ref.current, '--dur-feedback', 100))
    return () => clearTimeout(t)
  }, [loading, shown])
  if (!shown) return null
  return (
    <div ref={ref} className="ww-skeleton" data-skeleton="" data-state={leaving ? 'out' : undefined} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="ww-skeleton-line" style={{ inlineSize: i === lines - 1 && lines > 1 ? '60%' : '100%' }} />
      ))}
    </div>
  )
}
