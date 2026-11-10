// The carcass in a real browser (chunk 5). Built in memory by e2e/carcass.spec.ts, never served by the app:
// every registry entry rendered through <Planned/> exactly as a page would, plus the Roadmap drawer.
import { createRoot } from 'react-dom/client'
import { OverlayHost } from './frame/OverlayHost'
import { closeOverlay, openOverlay } from './frame/overlayRegistry'
import { Planned } from './Planned'
import { PLANNED } from './plannedFeatures'
import './overlays/Roadmap'

function Lab() {
  return (
    <div className="ww" data-section="wellwisher" style={{ padding: 16, display: 'grid', gap: 12, maxWidth: 720 }}>
      <h1 className="ww-pin-title">Carcass</h1>
      {PLANNED.map((p) => (
        <Planned
          key={p.id}
          id={p.id}
          hint
          // the real first action of an E entry: any enabled button on a placeholder must be one of these
          action={p.action ? <button type="button" className="ww-btn ww-tap" data-real-action={p.id}>{p.action}</button> : undefined}
        />
      ))}
      <OverlayHost />
    </div>
  )
}

export const WWCarcass = {
  mount(el: HTMLElement) {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
    createRoot(el).render(<Lab />)
  },
  openRoadmap: () => void openOverlay('roadmap'),
  closeRoadmap: () => void closeOverlay(),
  count: PLANNED.length,
  coming: PLANNED.filter((p) => p.pattern === 'coming').length,
}

declare global {
  interface Window {
    WWCarcass?: typeof WWCarcass
  }
}
if (typeof window !== 'undefined') window.WWCarcass = WWCarcass
