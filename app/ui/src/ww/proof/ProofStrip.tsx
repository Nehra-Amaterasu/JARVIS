// The Proof rail under shell v2 (D-V3-31, spec 20.16.2 "the rail shows one gauge"): a 64 px recessed channel holding the
// relief in miniature, five embossed pins standing in one slot, each as tall as its statistic and dashed where there is no
// count, each with its count under it. One key opens the drawer: the full relief with its drill-down, and every one of the
// ten classic Proof cards behind one fold (nothing the old panel showed lost its home).
import { BarChart3 } from 'lucide-react'
import { useMemo } from 'react'
import { Drawer, Fold } from '../kit'
import { LampGlyph, type LampState } from '../../shared/lamp'
import { useFrame } from '../frame/frameStore'
import { ProofPanel } from './ProofPanel'
import { ProofRelief } from './ProofRelief'
import { useProofData, type ProofData } from './proofData'
import { drillOf, proofStats, type ProofStat } from './relief'
import './relief.css'

export function overallState(stats: ProofStat[]): LampState {
  if (stats.some((s) => s.state === 'fault')) return 'fault'
  if (stats.some((s) => s.state === 'simulated')) return 'simulated'
  if (stats.some((s) => s.state === 'live')) return 'live'
  return 'waiting'
}

/** The pins and the open key, drawn from given stats (the gallery passes fixtures). */
export function ProofPins({ stats, open, onOpen }: { stats: ProofStat[]; open: boolean; onOpen: () => void }) {
  const st = overallState(stats)
  return (
    <div className="ps" data-component="proof-strip" data-lamp={st}>
      <span className="ps-corners" aria-hidden="true"><i /><i /><i /><i /></span>
      <button type="button" className="ps-open" aria-expanded={open} aria-haspopup="dialog" aria-label={`Open Proof: ${stats.map((s) => `${s.label} ${s.caption}`).join('; ')}`} onClick={onOpen}>
        <BarChart3 size={18} aria-hidden="true" />
      </button>
      <span className="ps-word">Proof</span>
      <ol className="ps-pins" aria-hidden="true">
        {stats.map((s) => {
          const drawn = s.n > 0 && (s.state === 'live' || s.state === 'simulated')
          return (
            <li key={s.id} data-dashed={drawn ? undefined : 'true'}>
              <span className="ps-slot"><span className="ps-fill" style={{ width: `${drawn ? Math.max(6, Math.round(s.value * 100)) : 100}%` }} /></span>
              <span className="ps-n">{drawn ? s.n : '–'}</span>
            </li>
          )
        })}
      </ol>
      <span className="ps-lamp"><LampGlyph state={st} size={10} /></span>
    </div>
  )
}

/** The Proof drawer's body: the relief with its drill-down, then the ten classic cards behind one fold. */
export function ProofBody({ data, stats }: { data: ProofData; stats: ProofStat[] }) {
  return (
    <div className="ps-body">
      <ProofRelief stats={stats} state={overallState(stats)} drill={(id) => drillOf(id, data)} />
      <Fold title="Every proof card">
        <ProofPanel mode="sheet" />
      </Fold>
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
