// The Proof rail under shell v2 (D-V3-31, spec 20.16.2 "the rail shows one gauge"): a 64 px recessed channel holding the
// relief in miniature, five embossed pins standing in one slot, each as tall as its statistic and dashed where there is no
// count, each with its count under it. One key opens the drawer: the full relief with its drill-down, and every one of the
// ten classic Proof cards behind one fold (nothing the old panel showed lost its home).
import { BarChart3 } from 'lucide-react'
import { useMemo } from 'react'
import { Drawer } from '../kit'
import type { LampState } from '../../shared/lamp'
import { LampWord } from '../left/LampWord'
import { useFrame } from '../frame/frameStore'
import { ProofPanel } from './ProofPanel'
import { ProofRelief } from './ProofRelief'
import { useProofData, type ProofData } from './proofData'
import { drillOf, proofStats, reliefBars, sectorPath, type ProofStat } from './relief'
import './relief.css'

export function overallState(stats: ProofStat[]): LampState {
  if (stats.some((s) => s.state === 'fault')) return 'fault'
  if (stats.some((s) => s.state === 'simulated')) return 'simulated'
  if (stats.some((s) => s.state === 'live')) return 'live'
  return 'waiting'
}

/** The figures the rail names, in the ring's order; the ring itself draws all five measures. */
export const RAIL_FIGURES = 3
const SHORT: Record<string, string> = { kept: 'Kept', days: 'Days', recall: 'Recall', practice: 'Matched', papers: 'Papers' }
/** Why a figure is hollow, in a few words that fit the 80 px figure (the longer caption stays in the drawer). */
const WHY: Record<string, string> = { planned: 'not built yet', waiting: 'not read yet', fault: 'could not read' }

/** The relief in miniature: the five embossed bars of ProofRelief on a 64 px ring, no figures on it (they stand under it) and no
 *  total in the centre. Decoration of the figures below, so a screen reader reads the figures, not the picture twice. */
export function ProofRing({ stats, size = 64 }: { stats: ProofStat[]; size?: number }) {
  const c = size / 2
  const inner = Math.round(size * 0.22)
  const depth = Math.round(size * 0.2)
  const bars = reliefBars(stats, inner, depth)
  return (
    <svg className="ps-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
      <circle className="pr-base-shade" cx={c + 1} cy={c + 1} r={inner + depth + 3} />
      <circle className="pr-base" cx={c} cy={c} r={inner + depth + 3} />
      <circle className="pr-base-lit" cx={c - 0.5} cy={c - 0.5} r={inner + depth + 2.5} />
      <circle className="pr-well" cx={c} cy={c} r={inner - 3} />
      {bars.map((b) => (
        <g key={b.id} className="pr-bar" data-dashed={b.dashed ? 'true' : undefined}>
          <path className="pr-slot" d={sectorPath(c, c, b.r0, inner + depth, b.a0, b.a1)} />
          <path className="pr-fill" d={sectorPath(c, c, b.r0, b.r1, b.a0, b.a1)} />
        </g>
      ))}
    </svg>
  )
}

/** The Proof rail as one instrument of the left rail's weight: the open key, the small relief ring, and three figures as forms (a
 *  slot, its count, its window) each with its own lamp and word; a figure without a count is dashed and says why. No total, no
 *  score. Drawn from given stats (the gallery passes fixtures). */
export function ProofPins({ stats, open, onOpen }: { stats: ProofStat[]; open: boolean; onOpen: () => void }) {
  const st = overallState(stats)
  return (
    <div className="ps" data-component="proof-strip" data-lamp={st}>
      <span className="ps-corners" aria-hidden="true"><i /><i /><i /><i /></span>
      <span className="ps-head">
        <button type="button" className="ps-open" aria-expanded={open} aria-haspopup="dialog" aria-label={`Open Proof: ${stats.map((s) => `${s.label} ${s.caption}, ${s.state}`).join('; ')}`} onClick={onOpen}>
          <BarChart3 size={18} aria-hidden="true" />
        </button>
        <span className="ps-word">Proof</span>
      </span>
      <ProofRing stats={stats} />
      <ol className="ps-figs" aria-hidden="true">
        {stats.slice(0, RAIL_FIGURES).map((s) => {
          const drawn = s.n > 0 && (s.state === 'live' || s.state === 'simulated')
          const [count, window] = s.caption.split(' \u00b7 ')
          return (
            <li key={s.id} data-dashed={drawn ? undefined : 'true'} data-lamp={s.state}>
              <span className="ps-label">{SHORT[s.id] ?? s.label}{drawn && window ? <small>{window}</small> : null}</span>
              <span className="ps-slot"><span className="ps-fill" style={{ width: `${drawn ? Math.max(6, Math.round(s.value * 100)) : 100}%` }} /></span>
              <span className="ps-n">{drawn ? count : '\u2013 \u2013'}</span>
              <LampWord state={s.state} />
              {!drawn && <span className="ps-why">{WHY[s.state] ?? count}</span>}
            </li>
          )
        })}
      </ol>
      <p className="ps-foot">Evidence of the plan, no total</p>
    </div>
  )
}

/** The Proof drawer's body: the relief with its drill-down, then Rank, Next steps and Stats as plain sections, the other seven cards behind one closed fold. */
export function ProofBody({ data, stats }: { data: ProofData; stats: ProofStat[] }) {
  return (
    <div className="ps-body">
      <ProofRelief stats={stats} state={overallState(stats)} drill={(id) => drillOf(id, data)} />
      <ProofPanel mode="sheet" tidy />
    </div>
  )
}

/** The connected rail: reads Proof once on mount (the same five reads as the panel) and opens the drawer. */
export function ProofStrip() {
  const { data } = useProofData()
  const stats = useMemo(() => proofStats(data), [data])
  const open = useFrame((s) => s.proofOpen)
  const setOpen = useFrame((s) => s.setProof)
  return (
    <>
      <ProofPins stats={stats} open={open} onOpen={() => setOpen(true)} />
      <Drawer open={open} onClose={() => setOpen(false)} title="Proof" place="right" className="ps-drawer">
        <ProofBody data={data} stats={stats} />
      </Drawer>
    </>
  )
}
