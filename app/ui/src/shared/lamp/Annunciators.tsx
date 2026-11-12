// Title-bar annunciators (spec 5.x title bar): one 16 px lamp per capability, the word collapsing to the tooltip
// below 1280 px. Presentational only; B05 mounts it and feeds it from the store hooks (useCapability).
import { Lamp } from './Lamp'
import { WAITING_DEFAULT, type LampReading } from './types'
import './lamp.css'

export interface Annunciator { id: string; label: string }

/** The four JARVIS lamps and the two Well Wisher ones, in title-bar order. Each label is a neutral NAME, never a claim:
 *  "Phone paired" beside a WAITING lamp read as a fact the lamp denied (jury, 13 Nov), so the state lives in the lamp. */
export const JARVIS_ANNUNCIATORS: readonly Annunciator[] = [
  { id: 'voice', label: 'Voice' },
  { id: 'room', label: 'Room link' },
  { id: 'senses', label: 'Senses' },
  { id: 'memory', label: 'Memory' },
]
export const WW_ANNUNCIATORS: readonly Annunciator[] = [
  { id: 'phone', label: 'Phone' },
  { id: 'quiet', label: 'Quiet' },
]

export interface AnnunciatorsProps {
  items: readonly Annunciator[]
  /** A reading per id; a missing id is WAITING "no report", never LIVE. */
  readings: Readonly<Record<string, LampReading | undefined>>
  /** Hide the words (the narrow bar); the name stays in the tooltip and the accessible name. */
  compact?: boolean
  now?: number
}

export function Annunciators({ items, readings, compact, now }: AnnunciatorsProps) {
  return (
    <ul className="lamp-bar" aria-label="Status lamps" data-compact={compact ? 'true' : undefined}>
      {items.map((it) => (
        <li key={it.id} className="lamp-bar-item" data-annunciator={it.id}>
          <Lamp reading={readings[it.id] ?? WAITING_DEFAULT} size={16} showLabel={false} subject={it.label} now={now} />
          {!compact && <span className="lamp-bar-name">{it.label}</span>}
        </li>
      ))}
    </ul>
  )
}
