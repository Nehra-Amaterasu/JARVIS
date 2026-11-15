// StrataBands (spec 20.9.4): months as horizontal bands 40 px tall, ordered-dither fill whose density is the items stored that
// month (equal counts are equal ink), and a tick row for this session's recalls. A click on a band lists its items as plain
// text on the right: the text is stored text, so it is never inside the picture. A quiet month is an empty dashed band, not a
// missing one, so a gap in what JARVIS holds is visible. The numbers are counts of the laid-out nodes, said so in the foot.
import { useMemo, useState } from 'react'
import { ditherCells, groupLetter, groupOf, groupWord, monthLabel, parseTime, ymOf, type Strata } from './model'
import type { GalaxyNode } from './types'

const COLS = 92
const ROWS = 7
const CELL = 3.4

function Dither({ density }: { density: number }) {
  const cells = useMemo(() => ditherCells(density, COLS, ROWS), [density])
  const d = useMemo(() => cells.map(([c, r]) => `M${(c * CELL).toFixed(1)} ${(r * CELL).toFixed(1)}h${CELL - 0.8}v${CELL - 0.8}h-${CELL - 0.8}z`).join(''), [cells])
  return (
    <svg className="jm-dither" viewBox={`0 0 ${COLS * CELL} ${ROWS * CELL}`} width={COLS * CELL} height={ROWS * CELL} aria-hidden="true" focusable="false" shapeRendering="crispEdges">
      {density <= 0 ? <rect x="0.5" y="0.5" width={COLS * CELL - 1} height={ROWS * CELL - 1} className="jm-dither-empty" fill="none" /> : <path d={d} />}
    </svg>
  )
}

export interface StrataBandsProps {
  strata: Strata
  nodes: readonly GalaxyNode[]
  /** Recalls of this session, drawn as ticks on the newest band. */
  recalls?: number
  /** Why there is nothing to draw (the loader's words). */
  emptyReason?: string
}

export function StrataBands({ strata, nodes, recalls = 0, emptyReason }: StrataBandsProps) {
  const [ym, setYm] = useState<string | null>(null)
  const picked = ym ?? strata.bands.find((b) => b.count > 0)?.ym ?? null
  const items = useMemo(() => (picked ? nodes.filter((n) => { const t = parseTime(n.time); return t !== null && ymOf(t) === picked }).slice(0, 40) : []), [nodes, picked])
  if (!strata.bands.length) {
    return <div className="jm-empty" data-testid="strata-empty"><span className="jm-hollow-word">NO DATES</span><span className="jm-hollow-line">{emptyReason ?? 'No stored item carries a date, so there are no months to draw.'}</span></div>
  }
  const nowYm = strata.bands[0].ym
  return (
    <div className="jm-strata" data-testid="strata">
      <ol className="jm-bands" aria-label="Months, newest first">
        {strata.bands.map((b) => (
          <li key={b.ym}>
            <button type="button" className="jm-band" aria-pressed={picked === b.ym} onClick={() => setYm(b.ym)} data-empty={b.count === 0 ? 'true' : undefined}
              aria-label={`${monthLabel(b.ym)}: ${b.count} items`}>
              <span className="jm-band-ym">{monthLabel(b.ym)}</span>
              <Dither density={b.count / strata.max} />
              <span className="jm-band-n">{b.count.toLocaleString('en-IN')}</span>
              {b.ym === nowYm && recalls > 0 && (
                <span className="jm-ticks" aria-label={`${recalls} recalls this session`}>
                  {Array.from({ length: Math.min(recalls, 30) }, (_, i) => <i key={i} />)}
                </span>
              )}
            </button>
          </li>
        ))}
      </ol>
      <section className="jm-band-items" aria-label={picked ? `Items of ${monthLabel(picked)}` : 'Items'}>
        <h3 className="jm-h">{picked ? monthLabel(picked) : 'No month'}</h3>
        {items.length === 0 ? <p className="jm-muted">Nothing laid out for this month.</p> : (
          <ul>
            {items.map((n) => (
              <li key={n.id}><span className="jm-tag">[{groupLetter(groupOf(n))}]</span> <span className="jm-src">{groupWord(groupOf(n))}</span> <span className="jm-txt">{n.label}</span></li>
            ))}
          </ul>
        )}
        <p className="jm-foot">{strata.total.toLocaleString('en-IN')} dated items in {strata.bands.length} months{strata.undated ? ` · ${strata.undated.toLocaleString('en-IN')} undated, not drawn` : ''}. Ink is density, not importance.</p>
      </section>
    </div>
  )
}
