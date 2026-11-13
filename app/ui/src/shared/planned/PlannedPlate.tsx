// Pattern C: the dashed plate for a whole capability that has a home and no control to put in it (spec 12.4).
// Static, flat, one cue: the dashed outline, the dashed-ring glyph and the word PLANNED, inside a CSS corner-bracket
// frame (wave 5) so every placeholder is on the sigil theme without importing shared/grammar. It never carries a
// value, a toggle, a count, a skeleton, an accent or a motion. Pressing it opens the card; it is aria-disabled
// so it stays in the tab order and reads as "not working" (T7), exactly as the disabled pattern does.
import type { PlannedEntry } from './types'
import { PlannedGlyph as Ring } from '../lamp/PlannedGlyph'
import { LampGlyph } from '../lamp/Lamp'
import { fillLine } from './registry'
import { openPlanned } from './open'
import './planned.css'

/**
 * The plate's state glyph. PLANNED draws the one shared ring (shared/lamp/PlannedGlyph); "built, not verified" is a
 * WAITING lamp (D20), so it draws the WAITING lamp glyph, not a second planned shape. Kept under this name and with
 * the `unverified` prop because shared/art/BlankingPlate imports it from here; it no longer draws anything itself.
 */
export function PlannedGlyph({ unverified, size = 16 }: { unverified?: boolean; size?: number }) {
  if (!unverified) return <Ring size={size} className="pl-glyph" />
  return <LampGlyph state="waiting" size={size} className="pl-glyph" />
}

export interface PlannedPlateProps {
  entry: PlannedEntry
  fill?: readonly (string | number)[]
  onOpen?: (id: string) => void
}

export function PlannedPlate({ entry, fill, onOpen }: PlannedPlateProps) {
  const unverified = entry.state === 'unverified'
  const open = () => (onOpen ?? openPlanned)(entry.id)
  return (
    <div
      className="pl-plate"
      role="button"
      tabIndex={0}
      aria-disabled="true"
      aria-haspopup="dialog"
      aria-label={unverified ? `${entry.label}, built, not verified yet` : `${entry.label}, not built yet`}
      data-planned={entry.id}
      data-pattern="coming"
      data-planned-open=""
      data-state={unverified ? 'unverified' : 'planned'}
      onClick={open}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault()
          open()
        }
      }}
    >
      <span className="pl-tag">
        <PlannedGlyph unverified={unverified} />
        <span className="pl-word">{unverified ? 'BUILT, NOT VERIFIED' : 'PLANNED'}</span>
      </span>
      <span className="pl-label">{entry.label}</span>
      <span className="pl-line">{fillLine(entry.line, fill)}</span>
    </div>
  )
}
