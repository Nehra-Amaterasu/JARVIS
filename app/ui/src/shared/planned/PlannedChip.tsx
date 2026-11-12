// The PLANNED chip of a view (spec 12.4): the word PLANNED and a count of registry rows homed here ("3 here" is
// a fact about the registry, not a measurement). It sits in the 44 px view-switch row and opens the overlay
// scrolled to the view's first entry. The four loop views carry no chip at all (R5), so it renders nothing there.
import { LOOP_VIEWS } from './homes'
import { openPlanned } from './open'
import type { Registry } from './types'
import { PlannedGlyph } from './PlannedPlate'
import './planned.css'

export interface PlannedChipProps {
  registry: Registry
  /** A view id of spec 3.2, or 'phone'. */
  home: string
  onOpen?: (id: string) => void
}

export function PlannedChip({ registry, home, onOpen }: PlannedChipProps) {
  const here = registry.forHome(home)
  if (here.length === 0 || LOOP_VIEWS.includes(home)) return null
  const open = () => (onOpen ?? openPlanned)(here[0].id)
  return (
    <button
      type="button"
      className="pl-chip"
      aria-disabled="true"
      aria-haspopup="dialog"
      aria-label={`${here.length} planned here, not built yet`}
      data-planned-chip={home}
      data-planned-open=""
      onClick={open}
    >
      <PlannedGlyph />
      <span className="pl-word">PLANNED</span>
      <span className="pl-count">{here.length} here</span>
    </button>
  )
}
