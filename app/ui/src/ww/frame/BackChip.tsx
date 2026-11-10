import { ArrowLeft, X } from 'lucide-react'
import { useFrame } from './frameStore'
import { goBack } from './navigate'
import { wsLabel } from './workspaces'

/**
 * "Back to Tree" after a cross-workspace jump (plan 5.7.4 #5). There is NO timer: the chip is the only
 * route back, so it must not expire (WCAG 2.2.1). It goes away when used, dismissed, or on the next
 * navigation (frameStore.select clears it). Alt+Left and Esc do the same as a click; Frame binds them.
 * Flat: no glass at all by default (5.6 allows a rim only, measured later).
 */
export function BackChip() {
  const back = useFrame((s) => s.back)
  const dismiss = useFrame((s) => s.dismissBack)
  if (!back) return null
  const name = wsLabel(back.ws)
  return (
    <div className="ww-back" role="group" aria-label="Return">
      <button type="button" className="ww-back-go ww-tap" onClick={() => void goBack()} aria-keyshortcuts="Alt+ArrowLeft">
        <ArrowLeft size={16} aria-hidden="true" />
        <span>Back to {name}</span>
      </button>
      <button type="button" className="ww-back-x ww-tap" onClick={dismiss} aria-label="Dismiss Back chip">
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  )
}
