// The crop handles of the Review Desk as pure functions (package Y01, spec 21.3.2 S2): four 44 px corner handles per question
// box, and Shift+arrow moves an edge 4 px. A corner owns two edges (its horizontal one and its vertical one); an arrow moves the
// edge it points along. The box never gets smaller than 24 page units either way and never leaves the page.
export type Box = readonly [x: number, y: number, w: number, h: number]
export type Corner = 'tl' | 'tr' | 'bl' | 'br'
export type ArrowKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'

export const MIN_BOX = 24
/** One Shift+arrow step, in screen px. */
export const EDGE_STEP_PX = 4

/** Move one edge of a box. `step` is in page units (the screen step divided by the page scale). */
export function moveEdge(box: Box, corner: Corner, key: ArrowKey, step: number, page: { w: number; h: number }): Box {
  let [x, y, w, h] = box
  const left = corner === 'tl' || corner === 'bl'
  const top = corner === 'tl' || corner === 'tr'
  const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0
  const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0
  if (dx) {
    if (left) { const nx = Math.min(Math.max(0, x + dx), x + w - MIN_BOX); w += x - nx; x = nx }
    else w = Math.min(Math.max(MIN_BOX, w + dx), page.w - x)
  }
  if (dy) {
    if (top) { const ny = Math.min(Math.max(0, y + dy), y + h - MIN_BOX); h += y - ny; y = ny }
    else h = Math.min(Math.max(MIN_BOX, h + dy), page.h - y)
  }
  return [x, y, w, h]
}

/** Drag a corner by (dx, dy) page units: the same two edges, moved together. */
export function dragCorner(box: Box, corner: Corner, dx: number, dy: number, page: { w: number; h: number }): Box {
  let b = box
  if (dx) b = moveEdge(b, corner, dx < 0 ? 'ArrowLeft' : 'ArrowRight', Math.abs(dx), page)
  if (dy) b = moveEdge(b, corner, dy < 0 ? 'ArrowUp' : 'ArrowDown', Math.abs(dy), page)
  return b
}
