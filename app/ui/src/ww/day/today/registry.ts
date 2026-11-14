// The two glob hosts of Today (UW7 contract table, A.L04 amendment). A later package adds ONE file and edits nothing here:
//
//   modes/<id>.mode.tsx         exports { id, label, Specimen, Margin? }   (as default or as `mode`)
//   callouts/<id>.callout.tsx   exports { id, order, Callout }             (as default or as `callout`)
//
// Files are read eagerly (each registration is a few bytes); a malformed file or a duplicate id is refused with a reason
// that a test reads, so a bad file never blanks the page.
import type { ComponentType } from 'react'

export interface ModeRegistration { id: string; label: string; Specimen: ComponentType; Margin?: ComponentType }
export interface CalloutRegistration { id: string; order: number; Callout: ComponentType }

export interface Collected<T> { list: T[]; errors: string[] }

const isComp = (x: unknown): boolean => typeof x === 'function' || (!!x && typeof x === 'object' && '$$typeof' in (x as object))

const pick = (mod: unknown, named: string): unknown => {
  const m = mod as Record<string, unknown> | undefined
  return m?.default ?? m?.[named]
}

export function collectModes(modules: Record<string, unknown>): Collected<ModeRegistration> {
  const list: ModeRegistration[] = []
  const errors: string[] = []
  for (const path of Object.keys(modules).sort()) {
    const r = pick(modules[path], 'mode') as Partial<ModeRegistration> | undefined
    if (!r || typeof r.id !== 'string' || typeof r.label !== 'string' || !isComp(r.Specimen) || (r.Margin !== undefined && !isComp(r.Margin))) {
      errors.push(`${path}: exports no mode registration`)
      continue
    }
    if (list.some((x) => x.id === r.id)) {
      errors.push(`${path}: mode ${r.id} is already registered`)
      continue
    }
    list.push(r as ModeRegistration)
  }
  // the day mode is the home: it comes first whatever the file names are
  list.sort((a, b) => (a.id === 'day' ? -1 : b.id === 'day' ? 1 : 0))
  return { list, errors }
}

export function collectCallouts(modules: Record<string, unknown>): Collected<CalloutRegistration> {
  const list: CalloutRegistration[] = []
  const errors: string[] = []
  for (const path of Object.keys(modules).sort()) {
    const r = pick(modules[path], 'callout') as Partial<CalloutRegistration> | undefined
    if (!r || typeof r.id !== 'string' || typeof r.order !== 'number' || !Number.isFinite(r.order) || !isComp(r.Callout)) {
      errors.push(`${path}: exports no callout registration`)
      continue
    }
    if (list.some((x) => x.id === r.id)) {
      errors.push(`${path}: callout ${r.id} is already registered`)
      continue
    }
    list.push(r as CalloutRegistration)
  }
  list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  return { list, errors }
}

/** At most five callouts stand in the margin (spec 21.5.1: four, then Hand-off); a sixth file is refused, not squeezed. */
export const MAX_CALLOUTS = 5

export const MODES = collectModes(import.meta.glob('./modes/*.mode.tsx', { eager: true }))
export const CALLOUTS = collectCallouts(import.meta.glob('./callouts/*.callout.tsx', { eager: true }))
