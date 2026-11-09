// Data display primitives: Row, Stat, Meter, Spark, StageStrip (plan 5.5).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Ticker } from '../../lib/motion'
import { isReducedMotion } from '../useReducedMotion'
import { ARRIVE_THRESHOLD } from '../design/motion/reveal'
import { Chip } from './Chip'
import { cx, tokenMs } from './util'

export type RowState = 'default' | 'done' | 'behind' | 'overdue'
const ROW_WORD: Record<Exclude<RowState, 'default'>, string> = { done: 'Done', behind: 'Behind', overdue: 'Overdue' }

export interface RowProps {
  lead?: ReactNode
  title: ReactNode
  meta?: ReactNode
  action?: ReactNode
  state?: RowState
  className?: string
}

/**
 * Replaces the deadline, contract, class, log and link rows. A state is a word on a chip, never only
 * a colour: behind is the sand dot, overdue the fault dot, done a check.
 */
export function Row({ lead, title, meta, action, state = 'default', className }: RowProps) {
  return (
    <div className={cx('ww-row', className)} data-state={state === 'default' ? undefined : state}>
      {lead && <div className="ww-row-lead">{lead}</div>}
      <div className="ww-row-main">
        <div className="ww-row-title">{title}</div>
        {meta && <div className="ww-row-meta">{meta}</div>}
      </div>
      {state !== 'default' && <Chip tone={state === 'behind' ? 'behind' : state === 'overdue' ? 'fault' : 'neutral'}>{state === 'done' ? `✓ ${ROW_WORD.done}` : ROW_WORD[state]}</Chip>}
      {action && <div className="ww-row-action">{action}</div>}
    </div>
  )
}

export interface StatProps {
  label: string
  /** null or undefined means "not measured": the tile says so instead of showing a made-up 0. */
  value: number | null | undefined
  unit?: string
  /** The single next step. Shown when the value is 0 (a zero with no way forward is a dead end). */
  next?: string
  fmt?: (n: number) => string
}

/** A number that changes: Ticker rolls it, and the tile takes a 160 ms --selected-bg highlight when it moves. */
export function Stat({ label, value, unit, next, fmt }: StatProps) {
  const measured = typeof value === 'number' && Number.isFinite(value)
  const [tick, setTick] = useState(false)
  const prev = useRef(value)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (prev.current === value) return
    const was = prev.current
    prev.current = value
    // the first measurement is not a change; neither is a jump under reduced motion
    if (was == null || !measured || isReducedMotion()) return
    setTick(true)
    const t = setTimeout(() => setTick(false), tokenMs(box.current, '--dur-state', 160))
    return () => clearTimeout(t)
  }, [value, measured])
  return (
    <div ref={box} className="ww-stat" data-tick={tick ? 'on' : undefined} data-measured={measured ? 'true' : 'false'}>
      <span className="ww-stat-label">{label}</span>
      {measured ? (
        <span className="ww-stat-value">
          <Ticker value={value} fmt={fmt} />
          {unit && <span className="ww-stat-unit">{unit}</span>}
        </span>
      ) : (
        <span className="ww-stat-value ww-stat-none">not measured yet</span>
      )}
      {measured && value === 0 && next && <span className="ww-stat-next">Next: {next}</span>}
    </div>
  )
}

export interface MeterProps {
  /** 0..1, or null for "not measured": no fill is drawn and nothing animates. */
  value: number | null
  /** Required: a bar with no name tells a screen reader nothing. */
  label: string
  className?: string
}

/**
 * `fill` (5.7.3 #8): a scaleX from the left, never an animated width, with a visible zero tick so an
 * empty bar still reads as a bar. On first mount it fills from 0 when it scrolls into view; after
 * that only the change animates. Under reduced motion it simply shows the value.
 */
export function Meter({ value, label, className }: MeterProps) {
  const known = value !== null && Number.isFinite(value)
  const clamped = known ? Math.min(1, Math.max(0, value)) : 0
  const ref = useRef<HTMLDivElement>(null)
  const [armed, setArmed] = useState(() => isReducedMotion() || typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (armed || !el) return
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        setArmed(true)
        io.disconnect()
      }
    }, { threshold: ARRIVE_THRESHOLD })
    io.observe(el)
    return () => io.disconnect()
  }, [armed])
  return (
    <div
      ref={ref}
      className={cx('ww-meter', className)}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={known ? clamped : undefined}
      aria-valuetext={known ? `${Math.round(clamped * 100)} percent` : 'not measured'}
      data-known={known ? 'true' : 'false'}
    >
      {known && <span className="ww-meter-fill ww-fill" style={{ ['--v' as string]: armed ? clamped : 0 }} />}
    </div>
  )
}

export interface SparkProps {
  points: number[]
  label: string
  className?: string
}

/** A trend with no axes. With no data it draws a dashed baseline and says "no history", not an empty box. */
export function Spark({ points, label, className }: SparkProps) {
  const W = 100
  const H = 24
  if (points.length < 2) {
    return (
      <span className={cx('ww-spark', className)} data-empty="true" role="img" aria-label={`${label}: no history`}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <line className="ww-spark-base" x1="0" y1={H - 1} x2={W} y2={H - 1} />
        </svg>
        <span className="ww-spark-note">no history</span>
      </span>
    )
  }
  const lo = Math.min(...points)
  const hi = Math.max(...points)
  const span = hi - lo || 1
  const d = points.map((p, i) => `${((i / (points.length - 1)) * W).toFixed(1)},${(H - 2 - ((p - lo) / span) * (H - 4)).toFixed(1)}`).join(' ')
  return (
    <span className={cx('ww-spark', className)} role="img" aria-label={`${label}: from ${points[0]} to ${points[points.length - 1]}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <polyline className="ww-spark-line" points={d} />
      </svg>
    </span>
  )
}

export type StageState = 'done' | 'current' | 'todo' | 'unknown'
export interface Stage {
  id: string
  label: string
  count?: number
  state: StageState
}
const STAGE_MARK: Record<StageState, string> = { done: '✓', current: '●', todo: '○', unknown: '?' }

/** Study > Papers only. An unknown stage says "not measured" and never draws progress. */
export function StageStrip({ stages, label }: { stages: Stage[]; label: string }) {
  return (
    <ol className="ww-stages" aria-label={label}>
      {stages.map((s) => (
        <li key={s.id} className="ww-stage" data-state={s.state} aria-current={s.state === 'current' ? 'step' : undefined}>
          <span className="ww-stage-mark" aria-hidden="true">
            {STAGE_MARK[s.state]}
          </span>
          <span className="ww-stage-label">{s.label}</span>
          <span className="ww-stage-count">{s.state === 'unknown' ? 'not measured' : s.count !== undefined ? s.count : ''}</span>
        </li>
      ))}
    </ol>
  )
}
