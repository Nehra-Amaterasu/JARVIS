/**
 * What the Tree remembers per tree id (plan Obj 10.1, TREE-06): the view as the layout point at the centre
 * of the visible area plus the zoom, so it survives a different stage size, and the selected node.
 * The store is ww/frame/workspaceMemory (sessionStorage with an in-memory copy); this file is only the
 * string format, kept pure so the test can round-trip it.
 */
export interface Centre { x: number; y: number; k: number }

export const encodeView = (c: Centre): string => `${Math.round(c.x)},${Math.round(c.y)},${c.k.toFixed(3)}`

export function decodeView(s: string | undefined): Centre | null {
  if (!s) return null
  const [x, y, k] = s.split(',').map(Number)
  if (![x, y, k].every(Number.isFinite) || k <= 0) return null
  return { x, y, k }
}
