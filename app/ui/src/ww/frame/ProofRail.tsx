import { BarChart3 } from 'lucide-react'
import { Drawer } from '../kit'
import { IconButton } from '../kit'
import { useFrame } from './frameStore'
import type { ProofMode } from './density'

/**
 * The Proof column (plan 3.1 R, 5.4): a 56 px rail below 1500 px that opens a 320 px panel over the
 * centre, pinned open from 1500 px, a full sheet below 1000 px. The panel's ten cards are chunk 9;
 * until then it is one honest line. It declares no primary action in any mode (3.3 rule 4: a pinned
 * panel owns none), which is why it holds no Button.
 */
export function ProofRail({ mode }: { mode: ProofMode }) {
  const open = useFrame((s) => s.proofOpen)
  const setOpen = useFrame((s) => s.setProof)
  const body = (
    <p className="ww-stub" data-proof="stub">
      Proof (rank, suggestions, stats, weekly review) is built in chunk 9. Nothing is measured here yet.
    </p>
  )
  if (mode === 'pinned') {
    return (
      <aside className="ww-right" aria-label="Proof" data-mode="pinned">
        <h2 className="ww-kicker">Proof</h2>
        {body}
      </aside>
    )
  }
  return (
    <aside className="ww-right" aria-label="Proof" data-mode={mode}>
      <IconButton label={open ? 'Close Proof' : 'Open Proof'} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        <BarChart3 size={18} aria-hidden="true" />
      </IconButton>
      <Drawer open={open} onClose={() => setOpen(false)} title="Proof" place={mode === 'sheet' ? 'bottom' : 'right'}>
        {body}
      </Drawer>
    </aside>
  )
}
