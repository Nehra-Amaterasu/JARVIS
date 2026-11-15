// The Trail (spec 20.9.4, C04-36 bundle idea): the last 30 recalls of this session on a ruler. Each arc leaves its query tick and
// passes through the items that recall returned, in rank order, numbered 1 to n. The query the owner typed shows on hover and
// focus and in the text table under the ruler. It lives in memory for the session only: closing the app clears it, and it is
// never counted, so it cannot become a streak.
import { useState } from 'react'
import { STAGE_W, TRAIL_ITEMS, TRAIL_MAX, trailLayout, type Recall } from './model'

const BASE = 222

export function Trail({ recalls }: { recalls: readonly Recall[] }) {
  const arcs = trailLayout(recalls, STAGE_W - 40, BASE)
  const [on, setOn] = useState<number | null>(null)
  if (!recalls.length) {
    return (
      <div className="jm-empty" data-testid="trail-empty">
        <pre className="jm-ascii" aria-hidden="true">{'  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·\n ──┴──┴──┴──┴──┴──┴──┴──┴──┴──\n  recall nothing yet'}</pre>
        <span className="jm-hollow-word">NO RECALLS</span>
        <span className="jm-hollow-line">Ask your memory something. The last 30 recalls of this session appear here, never saved.</span>
      </div>
    )
  }
  return (
    <div className="jm-trail" data-testid="trail">
      <svg viewBox={`0 0 ${STAGE_W} 262`} className="jm-svg jm-trail-svg" role="img" aria-label={`Trail of the last ${recalls.length} recalls, each an arc through the items it returned`}>
        <line x1="20" y1={BASE} x2={STAGE_W - 20} y2={BASE} className="jm-ruler" />
        {Array.from({ length: TRAIL_MAX + 1 }, (_, i) => <line key={i} x1={20 + ((STAGE_W - 40) / TRAIL_MAX) * i} x2={20 + ((STAGE_W - 40) / TRAIL_MAX) * i} y1={BASE} y2={BASE + (i % 5 === 0 ? 10 : 5)} className="jm-ruler-tick" />)}
        {arcs.map((a) => (
          <g key={a.n} className="jm-arc" data-on={on === a.n ? 'true' : undefined} onMouseEnter={() => setOn(a.n)} onMouseLeave={() => setOn(null)}>
            {a.path && <path d={a.path} className="jm-arc-path" fill="none" />}
            <circle cx={a.x} cy={a.base} r={4} className="jm-arc-q" />
            {a.dots.map((d) => (
              <g key={d.rank}>
                <circle cx={d.x} cy={d.y} r={9} className="jm-arc-dot" />
                <text x={d.x} y={d.y + 4} textAnchor="middle" className="jm-arc-n">{d.rank}</text>
              </g>
            ))}
          </g>
        ))}
        <text x="20" y={BASE + 30} className="jm-guide-word">OLDER</text>
        <text x={STAGE_W - 20} y={BASE + 30} textAnchor="end" className="jm-guide-word">NEWER</text>
      </svg>
      <table className="jm-trail-table">
        <caption className="jm-sr">The recalls of this session, newest first</caption>
        <thead><tr><th scope="col">#</th><th scope="col">You asked</th><th scope="col">Returned</th></tr></thead>
        <tbody>
          {[...recalls].reverse().slice(0, 6).map((r) => (
            <tr key={r.n} data-on={on === r.n ? 'true' : undefined} onMouseEnter={() => setOn(r.n)} onMouseLeave={() => setOn(null)}>
              <td className="jm-mono">{r.n}</td><td className="jm-q">{r.q}</td><td className="jm-mono">{r.hits === 0 ? 'nothing' : `${r.hits} item${r.hits === 1 ? '' : 's'}${r.hits > TRAIL_ITEMS ? ` (first ${TRAIL_ITEMS} drawn)` : ''}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
