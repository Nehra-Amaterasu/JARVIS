/** Pure placement of the Trim popover: at most 320 x 360, always inside the viewport, above the key when below is short. */
export const POP_MAX_W = 320
export const POP_MAX_H = 360
export const POP_GAP = 8
export const POP_MARGIN = 8
/** A popover shorter than this cannot hold the control and Reset; it scrolls inside instead. */
export const POP_MIN_H = 120

export interface Box { left: number; top: number; right: number; bottom: number }
export interface PopPlace { left: number; top: number; width: number; maxHeight: number; side: 'below' | 'above' }

export function placePopover(a: Box, vw: number, vh: number): PopPlace {
  const width = Math.max(0, Math.min(POP_MAX_W, vw - 2 * POP_MARGIN))
  const left = Math.max(POP_MARGIN, Math.min(a.left, vw - POP_MARGIN - width))
  const below = vh - a.bottom - POP_GAP - POP_MARGIN
  const above = a.top - POP_GAP - POP_MARGIN
  // below by default; above only when below cannot hold the whole 360 and above has more room
  const side = below >= POP_MAX_H || below >= above ? 'below' : 'above'
  const room = side === 'below' ? below : above
  const maxHeight = Math.max(POP_MIN_H, Math.min(POP_MAX_H, room))
  const top = side === 'below' ? a.bottom + POP_GAP : Math.max(POP_MARGIN, a.top - POP_GAP - maxHeight)
  return { left, top, width, maxHeight, side }
}
