// One dMAT task as the page draws it (plan 4.15): the figure sequence, the equations or the Latin square, then the answer options as
// a radio group. Moved out of the classic Dmat page without a change of markup, so both pages share it.
import type { DmatItem, Fig } from '../api'

const LETTER = 'ABCDEFGH'

export function Shape({ f }: { f: Fig }) {
  return (
    <svg className="ww-dmat-fig" viewBox={f.viewbox.join(' ')} role="img" aria-label={f.text}>
      {f.paths.map((d, i) => <path key={i} d={d} fill="currentColor" />)}
    </svg>
  )
}

export function Item({ it, value, onPick }: { it: DmatItem; value: number | null; onPick: (i: number) => void }) {
  return (
    <div className="ww-dmat-item" data-dmat-item={it.i}>
      <p className="ww-dmat-prompt">{it.prompt}</p>
      {it.kind === 'figure' && (
        <div className="ww-dmat-seq" aria-label="Sequence">
          {it.shown?.map((f, i) => <Shape key={i} f={f} />)}
          <span className="ww-dmat-q" aria-hidden="true">?</span>
        </div>
      )}
      {it.kind === 'equation' && (
        <ul className="ww-dmat-eqs" aria-label="Equations">
          {it.equations?.map((e, i) => <li key={i}><code>{e}</code></li>)}
        </ul>
      )}
      {it.kind === 'latin' && it.grid && (
        <table className="ww-dmat-grid" aria-label="Square">
          <tbody>
            {it.grid.map((row, r) => (
              <tr key={r}>
                {row.map((c, k) => {
                  const ask = typeof it.ask === 'object' && it.ask.row === r + 1 && it.ask.col === k + 1
                  return <td key={k} data-ask={ask ? 'true' : undefined}>{c ?? (ask ? '?' : '')}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="ww-dmat-opts" role="radiogroup" aria-label="Answer">
        {it.options.map((o, i) => (
          <button key={i} type="button" role="radio" aria-checked={value === i} className="ww-tap ww-dmat-opt" onClick={() => onPick(i)}>
            <span className="ww-dmat-letter">{LETTER[i]}</span>
            {'paths' in o ? <Shape f={o} /> : <span>{o.text}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
