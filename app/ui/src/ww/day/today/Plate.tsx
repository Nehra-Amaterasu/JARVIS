// The callout plate of Today: a raised clay tablet with four corner ticks (the one idea taken from the technical-diagram
// references: the corners say "this is a measured region" without drawing a box around it). A quiet sans label, the lamp
// beside it, then the plate's own forms. No hairline outline: the edge is the clay's shadow.
import type { ReactNode } from 'react'
import { LampGlyph, type LampState } from '../../../shared/lamp'

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
        <LampGlyph state={state} size={10} />
        <h3 className="td-plate-label">{label}</h3>
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
