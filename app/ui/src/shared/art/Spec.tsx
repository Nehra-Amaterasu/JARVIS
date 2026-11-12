// Dimension Sheet (spec 7.4 #27): spec rows with a dimension line (|<-- 54 mm -->|) between the part and its
// label, for the console.hardware plates. It is a static diagram plus a real table, in one: each row is a table
// row whose middle cell draws the line, so the drawing and the numbers cannot disagree. A part that is not fitted
// is drawn dashed with the words "not fitted" and no number (an absent part has no dimension to report).
import { Figure } from './frame'

export interface SpecRow {
  id: string
  label: string
  /** null = not fitted. */
  mm: number | null
  note?: string
}

export interface SpecProps {
  rows: readonly SpecRow[]
  caption: string
}

const LINE = 168

export function Spec({ rows, caption }: SpecProps) {
  const top = rows.reduce((m, r) => (r.mm !== null && r.mm > m ? r.mm : m), 0) || 1
  return (
    <Figure component="spec" caption={caption}>
      <table className="art-table art-spec" data-art-table="">
        <caption className="art-sr">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Part</th>
            <th scope="col">Dimension</th>
            <th scope="col">Size</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const fitted = r.mm !== null
            const len = fitted ? Math.max(12, (r.mm! / top) * (LINE - 8)) : LINE - 8
            return (
              <tr key={r.id} data-fitted={fitted}>
                <th scope="row">{r.label}{r.note ? <span className="art-list-meta"> {r.note}</span> : null}</th>
                <td>
                  <svg viewBox={`0 0 ${LINE} 20`} width={LINE} height={20} aria-hidden="true" focusable="false">
                    <g className={fitted ? 'art-dim' : 'art-dim art-dash'}>
                      <line x1={4} y1={10} x2={4 + len} y2={10} />
                      <line x1={4} y1={3} x2={4} y2={17} />
                      <line x1={4 + len} y1={3} x2={4 + len} y2={17} />
                      {fitted ? <path d={`M4 10l6-3M4 10l6 3M${4 + len} 10l-6-3M${4 + len} 10l-6 3`} /> : null}
                    </g>
                  </svg>
                </td>
                <td className="art-mono">{fitted ? `${r.mm} mm` : 'not fitted'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Figure>
  )
}
