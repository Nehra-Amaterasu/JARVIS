// What every part of Today reads: the model, the raw rows and the actions. A callout file (callouts/*.callout.tsx) and a
// mode file (modes/*.mode.tsx) take everything from here, so a later package adds a file and edits no L04 file.
import { createContext, useContext, type ReactNode } from 'react'
import type { TodayModel, TodayRaw } from './model'

export interface TodayActions {
  /** The one primary action: start a block (Focus / Start). */
  startBlock: () => void
  /** Add one to a counter (or take one back). */
  tapCount: (id: string, delta: 1 | -1) => void
  /** The counter the last tap touched, for Undo; null hides Undo. */
  lastCount: string | null
  /** Open the plan drawer (add to the day, classes, quests). */
  openPlan: () => void
  /** Go to a place of the shell, e.g. ('day', 'week'). */
  go: (section: string, view: string) => void
}

export interface TodayCtx {
  model: TodayModel
  raw: TodayRaw
  actions: TodayActions
}

const Ctx = createContext<TodayCtx | null>(null)

export function TodayProvider({ value, children }: { value: TodayCtx; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** The Today context; a callout drawn outside Today is a programming error, said loudly. */
export function useToday(): TodayCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useToday: drawn outside <TodayProvider>')
  return v
}

export const noop = () => {}

/** The specimen box a mode draws into (px), and whether the page is in its phone form. */
export interface SpecimenBox { w: number; h: number; phone: boolean }
const BoxCtx = createContext<SpecimenBox>({ w: 560, h: 552, phone: false })
export const SpecimenBoxProvider = BoxCtx.Provider
export const useSpecimenBox = (): SpecimenBox => useContext(BoxCtx)
