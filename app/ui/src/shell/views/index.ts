/**
 * Globbed view registrations (15.6 rule 2, A.N02 g). A section package adds ONE file here,
 * `shell/views/<name>.view.ts`, exporting one `ViewRegistration` (as `default` or as `view`), and never edits
 * `hosts.ts`, `ShellV2.tsx` or `ids.ts`. The canvas resolves a place in this order:
 *
 *   1. a registration for the view id (this folder)          the section's own page, loaded lazily
 *   2. the legacy host of hosts.ts                              today's page, the frame, the event log
 *   3. nothing                                                  the PLANNED "not built" plate, never borrowed content
 *
 * The registration object is tiny and eager (an id, a product and a loader); the page behind `load` is a lazy
 * chunk, so a registration costs about 100 bytes until its view is opened.
 */
import type { ComponentType } from 'react'
import { sectionById, type ProductId } from '../ids'

export interface ViewRegistration {
  /** A view id of the table, `<section>.<view>` (shell/ids.ts). */
  id: string
  product: ProductId
  load: () => Promise<{ default: ComponentType }>
}

export interface CollectedViews {
  byId: ReadonlyMap<string, ViewRegistration>
  /** Files that were refused, with the reason (a test fails on any). */
  errors: readonly string[]
}

const isReg = (x: unknown): x is ViewRegistration =>
  !!x && typeof x === 'object' && typeof (x as ViewRegistration).id === 'string' &&
  typeof (x as ViewRegistration).product === 'string' && typeof (x as ViewRegistration).load === 'function'

/**
 * Validate and index the modules of `*.view.ts`. Refused: a file with no registration, an id outside the table,
 * a product that is not the section's, and a second file for an id already taken (the first file by path wins,
 * so the result never depends on load order).
 */
export function collectViews(modules: Record<string, unknown>): CollectedViews {
  const byId = new Map<string, ViewRegistration>()
  const errors: string[] = []
  for (const path of Object.keys(modules).sort()) {
    const mod = modules[path] as { default?: unknown; view?: unknown } | undefined
    const reg = isReg(mod?.default) ? mod!.default : isReg(mod?.view) ? mod!.view : null
    if (!reg) {
      errors.push(`${path}: exports no ViewRegistration`)
      continue
    }
    const [sec, v] = reg.id.split('.')
    const def = sectionById(sec)
    if (!def || !def.views.includes(v)) {
      errors.push(`${path}: ${reg.id} is not a view of the id table`)
      continue
    }
    if (def.product !== reg.product) {
      errors.push(`${path}: ${reg.id} belongs to ${def.product}, not ${reg.product}`)
      continue
    }
    if (byId.has(reg.id)) {
      errors.push(`${path}: ${reg.id} is already registered`)
      continue
    }
    byId.set(reg.id, reg)
  }
  return { byId, errors }
}

export const VIEWS: CollectedViews = collectViews(import.meta.glob('./*.view.ts', { eager: true }))

let extra: Map<string, ViewRegistration> | null = null

/** The registration for a view id, or undefined (the canvas then falls back to hosts.ts). */
export function registeredView(id: string): ViewRegistration | undefined {
  return extra?.get(id) ?? VIEWS.byId.get(id)
}

/** Tests only: register views as if their files existed (null clears). */
export function setViewsForTests(regs: ViewRegistration[] | null): void {
  extra = regs ? new Map(regs.map((r) => [r.id, r])) : null
}
