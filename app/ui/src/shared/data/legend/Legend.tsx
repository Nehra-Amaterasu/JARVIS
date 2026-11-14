// Legend (spec 21.5, package DB02): the flip side of a specimen. `?` swaps the specimen for the list of its marks, and
// `?` or Esc swaps it back. The swap is instant (no flip animation exists to remove) and both faces stay in the document,
// so the list is always a text twin. Under reduced motion and forced colours the two faces stack instead of swapping: the
// static text list is the whole legend there, and the key is hidden because there is nothing left to toggle.
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { legendEntries, legendLine, type LegendGlyph, type SpecimenEntry } from './layout'
import './legend.css'

export interface LegendProps {
  /** The entries the specimen was drawn from. The legend lists exactly these. */
  entries: readonly SpecimenEntry[]
  /** The specimen face. */
  children: ReactNode
  /** Name of the whole card, for assistive technology: "Week review". */
  label: string
  /** Controlled flip; leave out for the component to keep it. */
  flipped?: boolean
  onFlip?: (flipped: boolean) => void
  className?: string
}

function Glyph({ kind }: { kind: LegendGlyph }) {
  return (
    <svg className="dg-lg-glyph" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false" data-glyph={kind}>
      {kind === 'disc' && <circle cx="10" cy="10" r="6" className="dg-lg-fill" />}
      {kind === 'ring' && <circle cx="10" cy="10" r="5.5" className="dg-lg-line" />}
      {kind === 'dashed-ring' && <circle cx="10" cy="10" r="5.5" className="dg-lg-line dg-lg-dash" />}
      {kind === 'hatch' && (
        <>
          <rect x="3" y="4" width="14" height="12" rx="2" className="dg-lg-line" />
          <path d="M6 16 11 4M10 16 15 4M3 12 7 4M14 16 17 10" className="dg-lg-line" />
        </>
      )}
      {kind === 'dots' && [5, 10, 15].flatMap((x) => [6, 14].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.6" className="dg-lg-fill" />))}
      {kind === 'bar' && <rect x="3" y="7" width="14" height="6" rx="2" className="dg-lg-fill" />}
      {kind === 'line' && <path d="M3 14 8 8 12 12 17 5" className="dg-lg-line" />}
      {kind === 'diamond' && <path d="M10 3.5 16.5 10 10 16.5 3.5 10Z" className="dg-lg-fill" />}
    </svg>
  )
}

export function Legend({ entries, children, label, flipped, onFlip, className }: LegendProps) {
  const [own, setOwn] = useState(false)
  const on = flipped ?? own
  const set = (v: boolean) => { if (flipped === undefined) setOwn(v); onFlip?.(v) }
  const rows = legendEntries(entries)
  const listId = useId()
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    const t = e.target as HTMLElement
    if (t.closest('input, textarea, select, [contenteditable="true"]')) return
    if (e.key === '?') { e.preventDefault(); set(!on) }
    else if (e.key === 'Escape' && on) { e.preventDefault(); set(false) }
  }
  return (
    <section className={`dg-lg${className ? ` ${className}` : ''}`} data-component="legend" data-flipped={on ? 'true' : 'false'} aria-label={label} onKeyDown={onKey}>
      <button type="button" className="dg-lg-key" aria-pressed={on} aria-controls={listId} aria-keyshortcuts="?" aria-label={on ? 'Back to the picture' : 'Legend: what each mark means'} onClick={() => set(!on)}>
        <span aria-hidden="true">?</span>
      </button>
      <div className="dg-lg-face" hidden={on}>{children}</div>
      <div className="dg-lg-back" id={listId} hidden={!on}>
        <h3 className="dg-lg-h">Legend</h3>
        {rows.length === 0 ? (
          <p className="dg-lg-empty">No marks to explain yet.</p>
        ) : (
          <ul className="dg-lg-list">
            {rows.map((e) => (
              <li key={e.id} className="dg-lg-item" data-entry={e.id} aria-label={legendLine(e)}>
                <Glyph kind={e.glyph} />
                <span className="dg-lg-name">{e.name}</span>
                <span className="dg-lg-meaning">{e.meaning}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
