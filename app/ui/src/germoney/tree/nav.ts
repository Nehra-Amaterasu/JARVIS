/**
 * Spatial arrow-key navigation over a laid-out tree. A row on the canvas is one tier,
 * so Left/Right walk along the same row (the nearest node that way), and Up/Down jump
 * to the nearest row above/below and pick the node closest in x. That matches what the
 * eye expects; a pure "nearest in a cone" search skips rows when they are offset.
 */
import type { Layout } from '../game/tree'

export type Dir = 'up' | 'down' | 'left' | 'right'
export const KEY_DIR: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }

export function spatialNeighbour(layout: Layout, fromId: string, dir: Dir): string | null {
  const from = layout.byId[fromId]
  if (!from) return layout.nodes[0]?.id ?? null
  if (dir === 'left' || dir === 'right') {
    let best: { id: string; d: number } | null = null
    for (const p of layout.nodes) {
      if (p.id === fromId || p.y !== from.y) continue
      const d = dir === 'right' ? p.x - from.x : from.x - p.x
      if (d > 0 && (!best || d < best.d)) best = { id: p.id, d }
    }
    return best?.id ?? null
  }
  // Up is a higher tier, drawn at a smaller y.
  const rows = [...new Set(layout.nodes.map((p) => p.y))].filter((y) => (dir === 'up' ? y < from.y : y > from.y))
  if (!rows.length) return null
  const row = dir === 'up' ? Math.max(...rows) : Math.min(...rows)
  let best: { id: string; d: number } | null = null
  for (const p of layout.nodes) {
    if (p.y !== row) continue
    const d = Math.abs(p.x - from.x)
    if (!best || d < best.d || (d === best.d && p.x < (layout.byId[best.id]?.x ?? 0))) best = { id: p.id, d }
  }
  return best?.id ?? null
}
