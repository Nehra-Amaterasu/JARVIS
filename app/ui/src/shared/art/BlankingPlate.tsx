// Dashed Blanking Plate (spec 7.5 #38), the PLANNED home: a flush plate with a dashed 1 px edge, the dashed-ring
// glyph, the word PLANNED, one sentence of what it will do and one of what exists today, and a "What is coming"
// cue. It reads one entry of the shared registry (B02) and renders it; it is always planned, never gains a hover
// lift or a pressed state, and is a single focusable aria-disabled control (never `disabled`) whose Enter and
// Space open the overlay, so a placeholder can never be mistaken for a working control. The pattern-C plate of
// B02 (shared/planned/PlannedPlate) is the minimal form; this one adds the "works today" line and the cue.
import './art.css'
import { PlannedGlyph } from '../planned/PlannedPlate'
import { openPlanned } from '../planned/open'
import { fillLine } from '../planned/registry'
import type { PlannedEntry } from '../planned/types'

export interface BlankingPlateProps {
  entry: PlannedEntry
  fill?: readonly (string | number)[]
  onOpen?: (id: string) => void
}

export function BlankingPlate({ entry, fill, onOpen }: BlankingPlateProps) {
  const unverified = entry.state === 'unverified'
  const open = () => (onOpen ?? openPlanned)(entry.id)
  return (
    <div
      className="art-blank"
      data-component="blanking-plate"
      data-planned={entry.id}
      data-state={unverified ? 'unverified' : 'planned'}
      role="button"
      tabIndex={0}
      aria-disabled="true"
      aria-haspopup="dialog"
      aria-label={`${entry.label}, ${unverified ? 'built, not verified yet' : 'not built yet'}. What is coming.`}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      }}
    >
      <span className="art-blank-tag">
        <PlannedGlyph unverified={unverified} />
        <span className="art-mono">{unverified ? 'BUILT, NOT VERIFIED' : 'PLANNED'}</span>
      </span>
      <span className="art-blank-label">{entry.label}</span>
      <span className="art-blank-line">{fillLine(entry.line, fill)}</span>
      {entry.works_today ? <span className="art-blank-line">{`Today: ${entry.works_today}`}</span> : null}
      <span className="art-blank-cue art-mono">What is coming</span>
    </div>
  )
}
