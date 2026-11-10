import { Component, type ReactNode } from 'react'
import { BarChart3 } from 'lucide-react'
import { Drawer } from '../kit'
import { IconButton } from '../kit'
import { useFrame } from './frameStore'
import type { ProofMode } from './density'
import { ProofPanel } from '../proof'

/**
 * The Proof column (plan 3.1 R, 5.4): a 56 px rail below 1500 px that opens a 320 px panel over the
 * centre, pinned open from 1500 px, a full sheet below 1000 px. The panel's ten cards come from
 * ww/proof (chunk 9). It declares no primary action in any mode (3.3 rule 4: a pinned
 * panel owns none), which is why it holds no Button.
 */
export function ProofRail({ mode }: { mode: ProofMode }) {
  const open = useFrame((s) => s.proofOpen)
  const setOpen = useFrame((s) => s.setProof)
  const body = <ProofGuard><ProofPanel mode={mode} /></ProofGuard>
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

/**
 * A Proof read that comes back in a shape the panel does not expect must not take the frame down with it:
 * on 10 Nov a `{}` answer blanked the whole page at 1920 px, where the panel is pinned and always drawn.
 * The guard keeps the workspace on screen and says, in one line, that Proof could not be shown.
 */
class ProofGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed) {
      return (
        <p className="ww-stub" data-proof="failed" role="status">
          Proof could not be shown: one of its reads answered in an unexpected shape. The workspace is unaffected.
        </p>
      )
    }
    return this.props.children
  }
}
