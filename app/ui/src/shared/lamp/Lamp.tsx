// The lamp (spec 6.6, kit component 11): five shapes so the state is readable in greyscale, plus the word.
// Colour is only a third cue: every glyph draws with currentColor and the state token is set on the wrapper.
import { PlannedGlyph } from './PlannedGlyph'
import { LAMP_SPECS, lampName, type LampReading, type LampState } from './types'
import './lamp.css'

/** Glyph geometry on a 16 x 16 box; exported so the greyscale test compares shapes, not colours. */
export function LampGlyph({ state }: { state: LampState }) {
  // PLANNED is the one shared drawing (PlannedGlyph.tsx), so this lamp, the kit lamp and the planned plate cannot drift
  if (state === 'planned') return <PlannedGlyph className="lamp-glyph" width="1em" height="1em" />
  return (
    <svg className="lamp-glyph" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false" data-glyph={LAMP_SPECS[state].glyph}>
      {state === 'live' && <circle cx="8" cy="8" r="6" fill="currentColor" />}
      {state === 'waiting' && (
        <>
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 2a6 6 0 0 0 0 12z" fill="currentColor" />
        </>
      )}
      {state === 'simulated' && <path d="M8 1.5 14.5 8 8 14.5 1.5 8z" fill="currentColor" />}
      {state === 'fault' && <path d="M8 1.8 14.6 13.6H1.4z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />}
    </svg>
  )
}

export interface LampProps {
  reading: LampReading
  /** 12 px in views and rows, 16 px in the title bar (--lamp-size). */
  size?: 12 | 16
  /** Show the state word beside the glyph. Off for the narrow title bar, where the name stays in the tooltip. */
  showLabel?: boolean
  /** A name for the thing the lamp reports on ("Voice"); it leads the accessible name. */
  subject?: string
  /** Fixed clock for tests. */
  now?: number
}

export function Lamp({ reading, size = 12, showLabel = true, subject, now }: LampProps) {
  const spec = LAMP_SPECS[reading.state]
  const name = lampName(reading, now)
  const full = subject ? `${subject}: ${name}` : name
  return (
    <span
      className="lamp"
      role="img"
      aria-label={full}
      title={full}
      data-lamp={reading.state}
      data-size={size}
      style={{ ['--lamp-ink' as string]: `var(${spec.token})` }}
    >
      <LampGlyph state={reading.state} />
      {showLabel && <span className="lamp-word" aria-hidden="true">{spec.label}</span>}
    </span>
  )
}
