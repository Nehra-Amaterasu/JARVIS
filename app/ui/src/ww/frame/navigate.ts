/**
 * The navigation handle other chunks call: `switchWorkspace('study', 'library')`, `jumpTo('study', 'library')`
 * (Tree's "Study this node": it leaves a Back chip), `goBack()`. Frame registers the real handler, which
 * captures the scroll position and runs the change inside the `switch` view transition. With no Frame
 * mounted (a unit test of one page) the calls still change the store, with no motion.
 */
import { useFrame } from './frameStore'
import { workspaceMemory } from './workspaceMemory'
import type { WsId } from './workspaces'

export interface Nav {
  switchTo: (ws: WsId, view?: string | null, opts?: { focusHeading?: boolean }) => Promise<void>
  jumpTo: (ws: WsId, view?: string | null) => Promise<void>
  back: () => Promise<void>
}

let handler: Nav | null = null
export function registerNav(h: Nav | null): void {
  handler = h
}

export const switchWorkspace: Nav['switchTo'] = (ws, view, opts) => {
  if (handler) return handler.switchTo(ws, view, opts)
  useFrame.getState().select(ws, view ?? null)
  return Promise.resolve()
}

export const jumpTo: Nav['jumpTo'] = (ws, view) => {
  if (handler) return handler.jumpTo(ws, view)
  const s = useFrame.getState()
  s.jump(ws, view ?? null, { ws: s.ws, view: s.view, scroll: workspaceMemory.scroll(s.ws) })
  return Promise.resolve()
}

export const goBack: Nav['back'] = () => {
  if (handler) return handler.back()
  useFrame.getState().returnBack()
  return Promise.resolve()
}
