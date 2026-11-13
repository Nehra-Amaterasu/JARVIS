// The Dumbbell (spec 20.5.2, package D01): two values on one rail, a ring for the student's earlier self and a disc for
// now, joined by a 1 px bar, with the difference as a mono number. A column of rails shares one ruler and is sorted by
// the size of the gap. It compares a student with their own earlier self and nothing else: there is no field for another
// person's value, and the wording is "earlier" and "now", never a rank. LIVE and SIMULATED draw rails; the other
// states draw the hollow form (dashed empty rails and the reason). A real table sits beside the drawing for screen readers.
import { Lamp, lampText, showsValue, type LampState } from '../../kit'
import { dumbbellLayout, fmt, gapText, rulerValues, type DumbbellRow } from './layout'
import './numbers.css'

export interface DumbbellProps {
  rows: { label: string; before: number; after: number }[]
  scale: [number, number]
  state: LampState
  /** What the numbers count ("check-ins"); named in the heading and the table. */
  unit?: string
  /** The two moments being compared, as words ("last month", "this month"). */
  earlierName?: string
  nowName?: string
  reason?: string
  className?: string
}

const RULER_TICKS = 5

export function Dumbbell({ rows, scale, state, unit, earlierName = 'earlier', nowName = 'now', reason, className }: DumbbellProps) {
  const draws = showsValue(state)
  const placed = draws ? dumbbellLayout(rows as DumbbellRow[], scale) : []
  const ticks = rulerValues(scale, RULER_TICKS)
  const hollowRows = !draws ? (rows.length ? rows.slice(0, 6) : [{ label: '', before: 0, after: 0 }, { label: '', before: 0, after: 0 }, { label: '', before: 0, after: 0 }]) : []
  const empty = draws && placed.length === 0
  const why = !draws ? lampText(state, reason ?? (state === 'waiting' ? 'no report' : undefined)) : empty ? 'no rows yet' : null
  return (
    <section
      className={`d1-db${className ? ` ${className}` : ''}`}
      data-component="dumbbell"
      data-grammar="ascii"
      data-state={state}
      data-form={draws && !empty ? 'rails' : 'hollow'}
      aria-label={`Against your earlier self${unit ? `, ${unit}` : ''}`}
    >
      <header className="d1-db-head">
        <span className="d1-db-title">AGAINST YOUR EARLIER SELF</span>
        <span className="d1-db-key" aria-hidden="true">
          <i className="d1-ring" /> {earlierName} <i className="d1-disc" /> {nowName}
        </span>
        <span className="d1-lamp"><Lamp state={state} reason={reason} bare /></span>
      </header>

      <div className="d1-db-grid" style={{ ['--d1-period' as string]: `${100 / (RULER_TICKS - 1)}%` }} aria-hidden="true">
        <div className="d1-db-ruler">
          {ticks.map((t, i) => (
            <span key={i} className="d1-db-tick" style={{ left: `${(i / (RULER_TICKS - 1)) * 100}%` }} data-end={i === 0 ? 'lo' : i === RULER_TICKS - 1 ? 'hi' : undefined}>
              {i % 2 === 0 ? fmt(t) : ''}
            </span>
          ))}
        </div>
        {placed.map((r, i) => (
          <div className="d1-db-rail" key={`${r.label}-${i}`} data-dir={r.gap > 0 ? 'up' : r.gap < 0 ? 'down' : 'flat'}>
            <span className="d1-db-label">{r.label}</span>
            <span className="d1-db-track">
              <i className="d1-db-bar" style={{ left: `${r.barLeft}%`, width: `${r.barWidth}%` }} />
              <i className="d1-ring d1-db-mark" data-off={r.beforeOff ? 'true' : undefined} style={{ left: `${r.beforePct}%` }} />
              <i className="d1-disc d1-db-mark" data-off={r.afterOff ? 'true' : undefined} style={{ left: `${r.afterPct}%` }} />
            </span>
            <span className="d1-db-gap">{gapText(r.gap)}</span>
          </div>
        ))}
        {hollowRows.map((r, i) => (
          <div className="d1-db-rail" data-hollow="true" key={i}>
            <span className="d1-db-label">{r.label || '--'}</span>
            <span className="d1-db-track" />
            <span className="d1-db-gap">--</span>
          </div>
        ))}
        {empty && <div className="d1-db-rail" data-hollow="true"><span className="d1-db-label">--</span><span className="d1-db-track" /><span className="d1-db-gap">--</span></div>}
      </div>

      {why && <p className="d1-why">{why}</p>}
      {state === 'simulated' && draws && <p className="d1-stamp d1-db-stamp">SIMULATED</p>}

      {draws && placed.length > 0 && (
        <table className="d1-sr">
          <caption>Each row compared with the same person earlier, sorted by the size of the change</caption>
          <thead><tr><th scope="col">Item</th><th scope="col">{earlierName}</th><th scope="col">{nowName}</th><th scope="col">Change</th></tr></thead>
          <tbody>
            {placed.map((r, i) => (
              <tr key={`${r.label}-${i}`}><th scope="row">{r.label}</th><td>{fmt(r.before)}</td><td>{fmt(r.after)}</td><td>{gapText(r.gap)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
