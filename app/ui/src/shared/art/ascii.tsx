// ASCII Sweep Loader and ASCII Empty State (spec 7.5 #32, #35).
//
// The sweep is the only animated piece of Family D. It appears after a 160 ms delay (a read that finishes sooner
// never flashes a loader), runs a stepped 100 ms frame for at most 5 s (the spec's "no loop longer than 5 s
// without Pause": a loader just settles on its static frame), stops when the tab is hidden or the region is off
// screen, and is the static mid-density frame in Calm and forced colours. The verb is the only live content; it is
// text ("reading memory"), never a percent counter. aria-busy marks the region; the art is aria-hidden.
import { useEffect, useRef, useState } from 'react'
import './art.css'
import { sweepFrame, sweepStatic, ASCII_ART, type EmptyVariant } from './geometry'
import { useBoundedLoop, useCalm } from './hooks'

export const SWEEP_DELAY_MS = 160
export const SWEEP_FRAME_MS = 100
export const SWEEP_MAX_MS = 5000

export interface AsciiSweepProps {
  /** What is being read: "reading memory". */
  verb: string
  rows?: number
  cols?: number
  /** False = the work finished; the region renders nothing. */
  active?: boolean
}

export function AsciiSweep({ verb, rows = 4, cols = 12, active = true }: AsciiSweepProps) {
  const calm = useCalm()
  const [shown, setShown] = useState(false)
  const [step, setStep] = useState(0)
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!active) {
      setShown(false)
      setStep(0)
      return
    }
    const t = setTimeout(() => setShown(true), SWEEP_DELAY_MS)
    return () => clearTimeout(t)
  }, [active])
  useBoundedLoop(active && shown && !calm, SWEEP_FRAME_MS, SWEEP_MAX_MS, setStep, ref)
  if (!active) return null
  const settled = calm || step * SWEEP_FRAME_MS >= SWEEP_MAX_MS
  const frame = shown ? (settled ? sweepStatic(cols, rows) : sweepFrame(cols, rows, step)) : null
  return (
    <div ref={ref} className="art-sweep" data-component="ascii-sweep" data-form={settled ? 'static' : 'moving'} aria-busy="true">
      {frame ? (
        <pre className="art-ascii" aria-hidden="true">
          {frame.join('\n')}
        </pre>
      ) : null}
      <span className="art-verb art-mono">{verb}</span>
    </div>
  )
}

export interface AsciiEmptyStateProps {
  variant: EmptyVariant
  message: string
  action?: { label: string; onAction: () => void }
}

export function AsciiEmptyState({ variant, message, action }: AsciiEmptyStateProps) {
  return (
    <section className="art-empty" data-component="ascii-empty-state" data-variant={variant} aria-label={message}>
      <pre className="art-ascii" aria-hidden="true">
        {ASCII_ART[variant].join('\n')}
      </pre>
      <p className="art-empty-msg">{message}</p>
      {action ? (
        <button type="button" className="art-btn" onClick={action.onAction}>
          {action.label}
        </button>
      ) : null}
    </section>
  )
}
