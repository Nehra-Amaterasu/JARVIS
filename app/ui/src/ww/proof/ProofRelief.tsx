// ProofRelief (spec 20.16.2): the embossed ring. One bar per measured statistic, its height the value within the stat's own
// window, a mono caption of n and the window on every bar, a lamp on every row; a statistic without a count is a dashed
// segment. The centre prints no total. Choosing a bar (a row of the twin list, or the bar itself) opens level 2: a Dumbbell
// of him against his own earlier self and a DotHistogram of the observations under it.
import { useId, useState } from 'react'
import { Dumbbell } from '../../shared/data/numbers'
import { DotHistogram } from '../../shared/data/series'
import { LampGlyph, type LampState } from '../../shared/lamp'
import { reliefBars, sectorPath, type Drill, type ProofStat } from './relief'
import './relief.css'

export interface ProofReliefProps {
  stats: ProofStat[]
  state: LampState
  /** Level 2 for a statistic; without it the bars are not choosable. */
  drill?: (id: string) => Drill | null
  /** The ring's box in px (default 300). */
  size?: number
  /** A statistic opened at first paint (the gallery shows level 2 this way). */
  initial?: string
}

const SHORT: Record<string, string> = { kept: 'kept', days: 'days', recall: 'recall', practice: 'match', papers: 'papers' }

export function ProofRelief({ stats, state, drill, size = 300, initial }: ProofReliefProps) {
  const [sel, setSel] = useState<string | null>(initial ?? null)
  const tid = useId()
  const c = size / 2
  const inner = Math.round(size * 0.26)
  const depth = Math.round(size * 0.17)
  const bars = reliefBars(stats, inner, depth)
  const capR = inner + depth + 18
  const level2 = sel && drill ? drill(sel) : null
  const chosen = stats.find((s) => s.id === sel)
  return (
    <div className="pr" data-component="proof-relief" data-lamp={state}>
      <div className="pr-top">
        <svg className="pr-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-labelledby={tid} focusable="false">
          <title id={tid}>{`Proof, ${stats.length} measures: ${stats.map((s) => `${s.label} ${s.caption}`).join('; ')}`}</title>
          {/* the embossed base: a raised annulus with its lit rim top left and its shade bottom right */}
          <circle className="pr-base-shade" cx={c + 2} cy={c + 2} r={inner + depth + 4} />
          <circle className="pr-base" cx={c} cy={c} r={inner + depth + 4} />
          <circle className="pr-base-lit" cx={c - 1} cy={c - 1} r={inner + depth + 3} />
          <circle className="pr-well" cx={c} cy={c} r={inner - 6} />
          {bars.map((b, i) => {
            const s = stats[i]
            const d = sectorPath(c, c, b.r0, b.r1, b.a0, b.a1)
            const cap = { x: c + capR * Math.cos(b.mid), y: c + capR * Math.sin(b.mid) }
            return (
              <g key={b.id} className="pr-bar" data-dashed={b.dashed ? 'true' : undefined} data-on={sel === b.id ? 'true' : undefined}
                onClick={drill && !b.dashed ? () => setSel((x) => (x === b.id ? null : b.id)) : undefined}>
                <path className="pr-slot" d={sectorPath(c, c, b.r0, inner + depth, b.a0, b.a1)} />
                <path className="pr-fill" d={d} />
                <text className="pr-cap" x={cap.x} y={cap.y} textAnchor="middle" dominantBaseline="middle">
                  {b.dashed ? SHORT[s.id] ?? s.id : `${SHORT[s.id] ?? s.id} ${s.n}`}
                </text>
              </g>
            )
          })}
          <text className="pr-centre" x={c} y={c - 6} textAnchor="middle">evidence</text>
          <text className="pr-centre-sub" x={c} y={c + 12} textAnchor="middle">no total</text>
        </svg>
        <ul className="pr-list" aria-label="Proof measures">
          {stats.map((s) => {
            const can = !!drill && s.n > 0 && (s.state === 'live' || s.state === 'simulated')
            return (
              <li key={s.id} data-lamp={s.state}>
                <button type="button" className="pr-row" aria-pressed={sel === s.id} disabled={!can}
                  aria-label={`${s.label}: ${s.caption}, ${s.state}${can ? '. Show what it stands on' : ''}`}
                  onClick={() => setSel((x) => (x === s.id ? null : s.id))}>
                  <LampGlyph state={s.state} size={10} />
                  <span className="pr-row-label">{s.label}</span>
                  <span className="pr-row-cap">{s.caption}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
      {chosen && level2 && (
        <div className="pr-drill" aria-label={`${chosen.label}, what it stands on`} role="group">
          {level2.rows.length > 0 && (
            <Dumbbell rows={level2.rows} scale={level2.scale} state={chosen.state} unit={level2.unit} earlierName="first week" nowName="last week" />
          )}
          <DotHistogram values={level2.values} state={level2.values.length ? chosen.state : 'waiting'} label={chosen.label} unit={level2.histUnit} noun={level2.noun}
            reason={level2.values.length ? undefined : 'no observations yet'} />
        </div>
      )}
    </div>
  )
}
