// Pattern C: the dashed plate for a whole capability that has a home and no control to put in it (spec 12.4).
// Static, flat, one cue: the dashed outline, the dashed-ring glyph and the word PLANNED. It never carries a
// value, a toggle, a count, a skeleton, an accent or a motion. Pressing it opens the card; it is aria-disabled
// so it stays in the tab order and reads as "not working" (T7), exactly as the disabled pattern does.
import type { PlannedEntry } from './types'
import { fillLine } from './registry'
import { openPlanned } from './open'
import './planned.css'

/** Dashed ring for PLANNED, half disc for "built, not verified": two shapes, so the state is not carried by colour. */
export function PlannedGlyph({ unverified }: { unverified?: boolean }) {
  return (
    <svg className="pl-glyph" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      {unverified ? (
        <>
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 2a6 6 0 0 0 0 12z" fill="currentColor" />
        </>
      ) : (
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.4 2.2" />
      )}
    </svg>
  )
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
