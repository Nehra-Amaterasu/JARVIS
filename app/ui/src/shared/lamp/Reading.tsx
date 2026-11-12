// The one way a number reaches the screen (spec 6.6: "the data layer has no way to render a number without a state").
// `reading` is a required prop, so a call without one fails tsc; a value given with WAITING or PLANNED is not drawn
// at all (em dash), because a number from a source that has not reported would be an invented one.
import type { ReactNode } from 'react'
import { Lamp } from './Lamp'
import { LAMP_SPECS, showsNumber, sinceText, type LampReading } from './types'
import './lamp.css'

export interface ReadingProps {
  label: string
  /** The number, or null when there is none. Drawn only when the reading's state allows it. */
  value: number | null | undefined
  unit?: string
  fmt?: (n: number) => string
  /** Required: no reading renders without a state. */
  reading: LampReading
  now?: number
  className?: string
  children?: ReactNode
}

export function Reading({ label, value, unit, fmt, reading, now, className, children }: ReadingProps) {
  const has = typeof value === 'number' && Number.isFinite(value) && showsNumber(reading.state)
  const text = has ? (fmt ? fmt(value) : String(value)) : '—'
  return (
    <div className={`lamp-reading${className ? ` ${className}` : ''}`} role="group" aria-label={label} data-state={reading.state} data-has-value={has ? 'true' : 'false'}>
      <span className="lamp-reading-label">{label}</span>
      <output className="lamp-reading-value">
        {text}
        {has && unit && <span className="lamp-reading-unit">{unit}</span>}
      </output>
      <span className="lamp-reading-lamp">
        <Lamp reading={reading} now={now} />
      </span>
      <span className="lamp-reading-why">
        {reading.state === 'simulated' && !reading.reason ? `${LAMP_SPECS.simulated.means}.` : reading.reason}
        {reading.state === 'live' || reading.state === 'simulated' ? ` ${sinceText(reading, now)}` : ''}
      </span>
      {children}
    </div>
  )
}
