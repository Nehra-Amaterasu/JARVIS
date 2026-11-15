// Recall results (parity M01): the real conversation, both sides, dated, with the matched words marked, and the facts with
// their distance; or the plain sentence that nothing matched. Never a paraphrase. JARVIS's own past replies are shown with
// their source and the word unverified, because they were stored back into memory and some of them were wrong.
import { useMemo } from 'react'
import { fmtN, highlightParts, queryTerms } from './model'
import type { SearchRes } from './types'

function Marked({ text, terms }: { text: string; terms: string[] }) {
  return <>{highlightParts(text, terms).map((p, i) => (p.hit ? <mark key={i}>{p.t}</mark> : <span key={i}>{p.t}</span>))}</>
}

export function Results({ res, searching, error, suggest = [], onSuggest }: { res: SearchRes | null; searching: boolean; error: string | null; suggest?: readonly string[]; onSuggest?: (q: string) => void }) {
  const terms = useMemo(() => (res ? queryTerms(res.query) : []), [res])
  if (error) return <div className="jm-empty" role="alert"><span className="jm-hollow-word">FAULT</span><span className="jm-hollow-line">Recall did not answer: {error}</span></div>
  if (searching) return <div className="jm-empty" role="status"><span className="jm-hollow-word">RECALLING</span><span className="jm-hollow-line">Reading the store.</span></div>
  if (!res) return <div className="jm-empty" data-testid="results-empty"><span className="jm-hollow-word">NO RECALL YET</span><span className="jm-hollow-line">Ask above. Results show here with the words that matched.</span>{onSuggest && <span className="jm-suggest" aria-label="Try">{suggest.map((x) => <button key={x} type="button" className="jm-chip" onClick={() => onSuggest(x)}>{x}</button>)}</span>}</div>
  return (
    <div className="jm-results" data-testid="results">
      <p className="jm-results-head jm-mono">
        {res.excerpts.length} moment{res.excerpts.length === 1 ? '' : 's'} · {res.facts.length} fact{res.facts.length === 1 ? '' : 's'} · {fmtN(res.took_ms)} ms
      </p>
      {res.excerpts_error && <p className="jm-note">The archive part did not answer: {res.excerpts_error}</p>}
      {res.excerpts.length === 0 && res.facts.length === 0 && <p className="jm-note">Nothing in the archive matched closely enough. Memory says so instead of guessing.</p>}
      {res.excerpts.map((ex, i) => (
        <section key={i} className="jm-ex" aria-label={`Moment ${i + 1}`}>
          <header><span className="jm-mono">{String(i + 1).padStart(2, '0')}</span> <span className="jm-who">{ex.who}</span> <span className="jm-mono jm-dim">{ex.date}</span></header>
          <ul>
            {ex.messages.map((m, j) => (
              <li key={j} data-me={m.me ? 'true' : undefined}>{!m.me && <b>{m.speaker}</b>}<Marked text={m.text} terms={terms} /></li>
            ))}
          </ul>
        </section>
      ))}
      {res.facts.length > 0 && (
        <section className="jm-facts" aria-label="Facts in memory">
          <h3 className="jm-h">Facts in memory</h3>
          <ul>
            {res.facts.map((f, i) => {
              const rel = f.distance === null ? 0 : Math.max(0, 1 - f.distance / 0.6)
              return (
                <li key={i}>
                  <span className="jm-fact-n jm-mono">{i + 1}</span>
                  <span className="jm-fact-t">{f.text}
                    <small className="jm-dim"> {f.source}{f.source?.startsWith('voice_interaction') && <em className="jm-warn"> · JARVIS’s own words, unverified</em>}</small>
                  </span>
                  <span className="jm-rel jm-mono" title="distance in the store, lower is closer">{f.distance === null ? 'no reading' : f.distance.toFixed(2)}<i style={{ width: `${Math.round(rel * 100)}%` }} /></span>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
