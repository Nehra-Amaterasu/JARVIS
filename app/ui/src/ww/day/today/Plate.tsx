// The callout plate of Today: a raised clay tablet with four corner ticks (the one idea taken from the technical-diagram
// references: the corners say "this is a measured region" without drawing a box around it). A quiet sans label, the lamp
// beside it, then the plate's own forms. No hairline outline: the edge is the clay's shadow.
import type { ReactNode } from 'react'
import { LAMP_SPECS, LampGlyph, type LampState } from '../../../shared/lamp'

/** The lamp and its word, always together (the lamp rule: no number without both). The word is the state's own LAMP_SPECS label,
 *  so this file holds no second spelling of it. */
export function LampWord({ state, size = 10, className }: { state: LampState; size?: number; className?: string }) {
  return (
    <span className={className ? `td-lampword ${className}` : 'td-lampword'} data-lamp={state}>
      <LampGlyph state={state} size={size} />
      <span className="td-lampword-w">{LAMP_SPECS[state].label}</span>
    </span>
  )
}

export interface TodayPlateProps {
  id: string
  label: string
  state: LampState
  /** Why the state is what it is, in a few words (read by a screen reader with the label). */
  reason: string
  children: ReactNode
  /** A key at the top right (Undo, Edit). */
  corner?: ReactNode
}

export function TodayPlate({ id, label, state, reason, children, corner }: TodayPlateProps) {
  return (
    <section className="td-plate" data-callout={id} data-lamp={state} aria-label={`${label}, ${state === 'live' ? reason : `${state}: ${reason}`}`}>
      <span className="td-corners" aria-hidden="true"><i /><i /><i /><i /></span>
      <header className="td-plate-head">
        <h3 className="td-plate-label">{label}</h3>
        <LampWord state={state} />
        <span className="td-plate-why">{reason}</span>
        {corner && <span className="td-plate-corner">{corner}</span>}
      </header>
      <div className="td-plate-body">{children}</div>
    </section>
  )
}

/** A number is drawn only for LIVE and SIMULATED; otherwise a hollow form that says why (the lamp rule). */
export function Num({ value, unit, state }: { value: number | null; unit?: string; state: LampState }) {
  const shown = (state === 'live' || state === 'simulated') && value !== null
  return (
    <span className="td-num" data-hollow={shown ? undefined : 'true'}>
      {shown ? value : '– –'}
      {unit && <small>{unit}</small>}
    </span>
  )
}
