// Component 11, the Signal Lamp (spec 6.6, 7.2): the one honesty component. Five shapes, one per
// reading state, so the state survives greyscale, forced colours and colour blindness; the word is
// always printed next to it. A reading widget (Readout, TelemetryRail, ProgressBar, Numerals) takes
// a required `state` and renders a value only for LIVE and SIMULATED; the rest show "--".
import type { CSSProperties } from 'react'
import { cx } from './util'

// One contract, one source: the states, words and shapes come from shared/lamp (B04), so the kit glyph and the
// contract lamp cannot drift apart; 2 implementations existed at merge and this file kept only its renderer.
import { LAMP_SPECS, LAMP_STATES, showsNumber, type LampState } from '../lamp/types'
import { PlannedGlyph } from '../lamp/PlannedGlyph'

export { LAMP_STATES }
export type { LampState }

const fromSpecs = <K extends 'label' | 'glyph'>(k: K) =>
  Object.fromEntries(LAMP_STATES.map((s) => [s, LAMP_SPECS[s][k]])) as Record<LampState, (typeof LAMP_SPECS)[LampState][K]>

/** The word printed beside the glyph (spec 6.6 table). */
export const LAMP_WORD: Record<LampState, string> = fromSpecs('label')

/** The glyph shape name, one per state; tests read this so a state cannot silently share a shape. */
export const LAMP_SHAPE = fromSpecs('glyph')

/** A state a reading may show its number under. WAITING, PLANNED and FAULT never show one. */
export const showsValue = showsNumber

/** The full text for assistive technology: "FAULT: relay did not answer". */
export function lampText(state: LampState, reason?: string): string {
  return reason ? `${LAMP_WORD[state]}: ${reason}` : LAMP_WORD[state]
}

/** The bare glyph, 12 px (16 in the title bar). Decorative: the text beside it is the information. */
export function LampGlyph({ state, size = 12 }: { state: LampState; size?: number }) {
  const s = { '--lamp-size': `${size}px` } as CSSProperties
  // PLANNED is the one shared drawing (shared/lamp/PlannedGlyph.tsx); the kit keeps its class, state and shape hooks
  if (state === 'planned') return <PlannedGlyph size={size} className="k-lamp-glyph" data-state={state} data-shape={LAMP_SHAPE[state]} style={s} />
  return (
    <svg className="k-lamp-glyph" data-state={state} data-shape={LAMP_SHAPE[state]} viewBox="0 0 12 12" width={size} height={size} style={s} aria-hidden="true" focusable="false">
      {state === 'live' && <circle cx="6" cy="6" r="5" className="k-fill" />}
      {state === 'waiting' && (
        <>
          <circle cx="6" cy="6" r="4.5" className="k-line" />
          <path d="M6 1.5 A4.5 4.5 0 0 0 6 10.5 Z" className="k-fill" />
        </>
      )}
      {state === 'simulated' && <path d="M6 0.8 L11.2 6 L6 11.2 L0.8 6 Z" className="k-fill" />}
      {state === 'fault' && <path d="M6 1 L11.2 10.6 L0.8 10.6 Z" className="k-fill" />}
    </svg>
  )
}

export interface LampProps {
  state: LampState
  /** Why: FAULT needs one; WAITING says "no report" when it cannot say more. */
  reason?: string
  /** Hide the printed word where the neighbouring text already carries it (a lamp in a Readout corner). */
  bare?: boolean
  size?: number
  className?: string
}

/** Glyph plus word. Read-only: a lamp is never a button; a group of lamps in the title bar is one tab stop of the shell. */
export function Lamp({ state, reason, bare, size = 12, className }: LampProps) {
  const text = lampText(state, reason)
  return (
    <span className={cx('k-lamp', className)} data-state={state} role="img" aria-label={text} title={reason ? text : undefined}>
      <LampGlyph state={state} size={size} />
      {!bare && (
        <span className="k-lamp-word" aria-hidden="true">
          {LAMP_WORD[state]}
        </span>
      )}
    </span>
  )
}
