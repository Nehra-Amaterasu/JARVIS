import { useState } from 'react'
import { Drawer } from '../kit'
import { closeOverlay, overlayDef, registeredOverlay, useOverlay, type OverlayId } from './overlayRegistry'

/**
 * Draws the one open overlay. Until a chunk registers the real one, a stub says what it is and which
 * chunk builds it; the stub is plain text (no button, no fill), so it never claims the primary.
 * The Drawer owns Esc, the focus trap, focus return and the inert background (kit/Drawer.tsx).
 */
export function OverlayHost() {
  const open = useOverlay((s) => s.open)
  const props = useOverlay((s) => s.props)
  // keep the last id while the drawer plays its exit, so the content does not vanish mid-slide
  const [last, setLast] = useState<OverlayId | null>(null)
  if (open && open !== last) setLast(open)
  const id = open ?? last
  if (!id) return null
  const def = overlayDef(id)
  const Real = registeredOverlay(id)
  return (
    <Drawer open={open !== null} onClose={closeOverlay} title={def.title} className="ww-overlay" >
      {Real ? (
        <Real {...props} />
      ) : (
        <p className="ww-stub" data-overlay-stub={id}>
          {def.n} {def.title} is not built yet. It arrives in chunk {def.chunk}; nothing is saved or shown here until then.
        </p>
      )}
    </Drawer>
  )
}
