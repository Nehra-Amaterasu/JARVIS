// Dither Plate (spec 7.5 #34): a 1-bit ordered-dither (Bayer 4x4) picture for a placeholder, onboarding art or a
// pairing card. It is derived from a closed-form idea (geometry.ideaField), never pasted, and is drawn as one
// run-length SVG path, not a raster: a 64 x 40 plate is about 3 KB of path text, far under the 200 KB per route
// cap of Strand 6. Generation is one pass over w x h cells (at most 256 x 256 = 65 536 cheap steps) and is
// memoised per (kind, w, h), so it runs once. Decorative only: aria-hidden, and any real content sits beside it
// as text. Forced colours draw the ink in CanvasText.
import { useMemo } from 'react'
import './art.css'
import { ditherRuns, ideaField, type IdeaKind } from './geometry'

export interface DitherProps {
  kind: IdeaKind
  /** Cell grid, 1 to 256. */
  cols?: number
  rows?: number
  /** CSS pixels per cell. */
  scale?: number
}

export function Dither({ kind, cols = 64, rows = 40, scale = 4 }: DitherProps) {
  const { path } = useMemo(() => ditherRuns(cols, rows, ideaField(kind)), [kind, cols, rows])
  return (
    <svg
      className="art-dither"
      data-component="dither"
      data-kind={kind}
      viewBox={`0 0 ${cols} ${rows}`}
      width={cols * scale}
      height={rows * scale}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} fill="currentColor" />
    </svg>
  )
}
