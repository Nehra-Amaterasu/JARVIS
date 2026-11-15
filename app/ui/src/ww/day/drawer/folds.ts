// The glob host of the day drawer (package L01): a later package adds ONE file `folds/<name>.fold.tsx` exporting a `DayFold`
// and the drawer shows it after its own three folds, never editing DayDrawer.tsx (the Classroom fold of AD09 is the first).
import type { ComponentType } from 'react'
import type { DayDetail } from '../ports'

export interface DayFoldProps {
  date: string
  /** The drawer's own read of the day, or null while it is not read (a fold says so rather than guessing). */
  detail: DayDetail | null
}

export interface DayFold {
  id: string
  title: string
  /** Lower first; the three folds of the drawer are 0, 1 and 2. */
  order: number
  Body: ComponentType<DayFoldProps>
}

const isFold = (x: unknown): x is DayFold =>
  !!x && typeof x === 'object' && typeof (x as DayFold).id === 'string' && typeof (x as DayFold).title === 'string' &&
  typeof (x as DayFold).order === 'number' && !!(x as DayFold).Body

/** Validate and order the modules of `folds/*.fold.tsx` (`fold` or `default` export); a file with no fold is skipped, a repeated id keeps the first by path. */
export function collectFolds(modules: Record<string, unknown>): DayFold[] {
  const out: DayFold[] = []
  for (const path of Object.keys(modules).sort()) {
    const m = modules[path] as { default?: unknown; fold?: unknown } | undefined
    const f = isFold(m?.fold) ? m!.fold : isFold(m?.default) ? m!.default : null
    if (f && !out.some((x) => x.id === f.id)) out.push(f)
  }
  return out.sort((a, b) => a.order - b.order)
}

export const FOLDS: DayFold[] = collectFolds(import.meta.glob('./folds/*.fold.tsx', { eager: true }))
