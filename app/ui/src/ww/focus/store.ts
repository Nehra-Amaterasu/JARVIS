/**
 * What the three Crucible views hand to each other and nothing more: the block that just ended (for Rest), the thoughts parked in
 * this block and which kind of track runs. Held in memory only; a closed application starts clean, and the session itself is the
 * stored record the engine already keeps (STORAGE_KEY).
 */
import { create } from 'zustand'

export interface LastBlock {
  at: number
  kind: 'done' | 'ended'
  line: string
  heldMin: number
  counted: number
  length: number
  trackLabel: string
  parked: number
}

interface FocusViews {
  last: LastBlock | null
  /** Thoughts filed during the running block. */
  parked: string[]
  runKind: string
  setLast: (l: LastBlock | null) => void
  addParked: (t: string) => void
  clearParked: () => void
  setRunKind: (k: string) => void
}

export const useFocusViews = create<FocusViews>((set) => ({
  last: null,
  parked: [],
  runKind: 'crucible',
  setLast: (last) => set({ last }),
  addParked: (t) => set((s) => ({ parked: [...s.parked, t] })),
  clearParked: () => set({ parked: [] }),
  setRunKind: (runKind) => set({ runKind }),
}))
