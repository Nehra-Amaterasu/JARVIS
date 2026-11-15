// The glob host of the month (package L01): a later package adds ONE file `faces/<name>.face.tsx` exporting a `MonthFace` and the
// month shows it under its own reading panel, never editing Month.tsx (the Review face of DB05 is the first).
import type { ComponentType } from 'react'
import type { DayData } from '../../../shared/almanac'
import type { LampState } from '../../../shared/lamp'

export interface MonthFaceProps {
  month: string
  days: DayData[]
  state: LampState
}

export interface MonthFace {
  id: string
  title: string
  /** Lower first. */
  order: number
  Body: ComponentType<MonthFaceProps>
}

const isFace = (x: unknown): x is MonthFace =>
  !!x && typeof x === 'object' && typeof (x as MonthFace).id === 'string' && typeof (x as MonthFace).title === 'string' &&
  typeof (x as MonthFace).order === 'number' && !!(x as MonthFace).Body

/** Validate and order the modules of `faces/*.face.tsx` (`face` or `default` export); a file with no face is skipped, a repeated id keeps the first by path. */
export function collectFaces(modules: Record<string, unknown>): MonthFace[] {
  const out: MonthFace[] = []
  for (const path of Object.keys(modules).sort()) {
    const m = modules[path] as { default?: unknown; face?: unknown } | undefined
    const f = isFace(m?.face) ? m!.face : isFace(m?.default) ? m!.default : null
    if (f && !out.some((x) => x.id === f.id)) out.push(f)
  }
  return out.sort((a, b) => a.order - b.order)
}

export const FACES: MonthFace[] = collectFaces(import.meta.glob('./faces/*.face.tsx', { eager: true }))
