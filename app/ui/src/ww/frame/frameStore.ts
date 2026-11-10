/**
 * The frame's own state: which workspace is open, which view, whether the Proof panel is open, focus
 * mode, the Back target, the season pill and the dirty marks. It is NOT lib/store.ts's `tab`: that file
 * belongs to the app-wide overhaul, and setting `tab` would also run Shell's 560 ms page transition on
 * `.main`, which would fight the 600 ms workspace switch (plan 5.7.4 #1). The app's tab stays on the
 * Well Wisher entry the whole time; the workspace is this store.
 *
 * Plain state changes only. The motion, the scroll capture and the focus move belong to Frame, which
 * wraps these in `runSwitch` (design/motion/transition.ts); see navigate.ts.
 */
import { create } from 'zustand'
import { session } from '../kit/util'
import { readSeasonMode, writeSeasonMode, type SeasonMode } from './season'
import { isWsId, type WsId } from './workspaces'

/** Where a Back chip returns to. */
export interface Scene {
  ws: WsId
  view: string | null
  scroll: number
}

interface FrameState {
  ws: WsId
  view: string | null
  /** True once something other than the season default chose the workspace (a click, a deep link, a restored session). */
  chosen: boolean
  proofOpen: boolean
  focus: boolean
  back: Scene | null
  seasonMode: SeasonMode
  dirty: Partial<Record<WsId, boolean>>

  select: (ws: WsId, view?: string | null) => void
  jump: (ws: WsId, view: string | null, from: Scene) => void
  returnBack: () => Scene | null
  dismissBack: () => void
  setDefault: (ws: WsId) => void
  setProof: (open: boolean) => void
  setFocus: (on: boolean) => void
  setSeasonMode: (m: SeasonMode) => void
  setDirty: (ws: WsId, dirty: boolean) => void
}

const WS_KEY = 'ww.frame.ws'
const rememberWs = (ws: WsId) => session.set(WS_KEY, ws)
export function restoredWs(): WsId | null {
  const v = session.get(WS_KEY)
  return isWsId(v) ? v : null
}

export const useFrame = create<FrameState>((set, get) => ({
  ws: 'life',
  view: null,
  chosen: false,
  proofOpen: false,
  focus: false,
  back: null,
  seasonMode: readSeasonMode(),
  dirty: {},

  // any ordinary navigation ends a Back offer ("goes away on the next navigation")
  select: (ws, view = null) => {
    rememberWs(ws)
    set({ ws, view, chosen: true, back: null, focus: false })
  },
  jump: (ws, view, from) => {
    rememberWs(ws)
    set({ ws, view, chosen: true, back: from, focus: false })
  },
  returnBack: () => {
    const b = get().back
    if (!b) return null
    rememberWs(b.ws)
    set({ ws: b.ws, view: b.view, back: null, focus: false })
    return b
  },
  dismissBack: () => set({ back: null }),
  setDefault: (ws) => set({ ws, view: null }),
  setProof: (proofOpen) => set({ proofOpen }),
  setFocus: (focus) => set({ focus }),
  setSeasonMode: (seasonMode) => {
    writeSeasonMode(seasonMode)
    set({ seasonMode })
  },
  setDirty: (ws, d) => {
    if (!!get().dirty[ws] === d) return
    set({ dirty: { ...get().dirty, [ws]: d } })
  },
}))

/** Tests only. */
export function resetFrameStore(): void {
  session.set(WS_KEY, '')
  useFrame.setState({ ws: 'life', view: null, chosen: false, proofOpen: false, focus: false, back: null, seasonMode: 'auto', dirty: {} })
}
