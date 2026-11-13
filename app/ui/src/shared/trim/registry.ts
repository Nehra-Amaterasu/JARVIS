/**
 * The settings registry (spec 20.6.6). A package adds `<anything>.settings.ts` exporting one SettingDef (as `default`
 * or `setting`) or an array of them as `settings`; nothing else is edited. Like shell/modes, the collector is a pure
 * function over a module map so a test can feed it fixtures, and the glob below feeds it the real files.
 */
import type { SettingDef } from './types'

export interface CollectedSettings {
  list: readonly SettingDef[]
  errors: readonly string[]
}

const isDef = (x: unknown): x is SettingDef => {
  const d = x as Partial<SettingDef> | null
  return (
    !!d && typeof d === 'object' && typeof d.id === 'string' && !!d.id && typeof d.label === 'string' && typeof d.section === 'string' &&
    typeof d.view === 'string' && typeof d.read === 'function' && typeof d.reset === 'function'
  )
}

/** Validate the modules of `*.settings.ts`: every def complete and every id unique. A bad one is reported, not thrown. */
export function collectSettings(modules: Record<string, unknown>): CollectedSettings {
  const list: SettingDef[] = []
  const errors: string[] = []
  for (const path of Object.keys(modules).sort()) {
    const mod = modules[path] as { default?: unknown; setting?: unknown; settings?: unknown } | undefined
    const raw = [mod?.default, mod?.setting, mod?.settings].flatMap((x) => (Array.isArray(x) ? x : x === undefined ? [] : [x]))
    if (!raw.length) {
      errors.push(`${path}: exports no SettingDef`)
      continue
    }
    for (const d of raw) {
      if (!isDef(d)) {
        errors.push(`${path}: a setting is missing id, label, section, view, read or reset`)
        continue
      }
      if (list.some((x) => x.id === d.id)) {
        errors.push(`${path}: setting id ${d.id} is taken`)
        continue
      }
      list.push(d)
    }
  }
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  list.sort((a, b) => cmp(a.section, b.section) || cmp(a.view, b.view) || cmp(a.label, b.label))
  return { list, errors }
}

// Fixtures under __tests__ are for the tests only and must not reach the product, so the glob leaves them out.
export const SETTINGS: CollectedSettings = collectSettings(
  import.meta.glob(['../../**/*.settings.ts', '!../../**/__tests__/**'], { eager: true }),
)

/**
 * Legacy `settings.*` ids to the id of the setting that now holds them. Empty until E13 moves the old settings page
 * into Trims; a test proves every entry resolves to a registered setting once there are any.
 */
export const ALIASES: Readonly<Record<string, string>> = {}

/** The setting a (possibly legacy) id names, or null. */
export function resolveSetting(id: string, from: CollectedSettings = SETTINGS, aliases: Readonly<Record<string, string>> = ALIASES): SettingDef | null {
  const real = Object.prototype.hasOwnProperty.call(aliases, id) ? aliases[id] : id
  return from.list.find((d) => d.id === real) ?? null
}

/** Aliases that point nowhere: empty is the only passing answer. */
export function danglingAliases(from: CollectedSettings = SETTINGS, aliases: Readonly<Record<string, string>> = ALIASES): string[] {
  return Object.keys(aliases).filter((a) => !from.list.some((d) => d.id === aliases[a]))
}

export interface TrimAudit {
  /** Registered, but no Trim is mounted for it: the setting has no home. */
  unmounted: string[]
  /** A Trim is mounted for an id the registry does not know: a form field outside the registry. */
  unregistered: string[]
}

/** The two-way check the spec asks for: no orphan entry and no unregistered field. */
export function auditTrims(defs: readonly SettingDef[], mounted: Iterable<string>): TrimAudit {
  const have = new Set(mounted)
  const known = new Set(defs.map((d) => d.id))
  return {
    unmounted: defs.filter((d) => !have.has(d.id)).map((d) => d.id),
    unregistered: [...have].filter((id) => !known.has(id)).sort(),
  }
}

/** Case-insensitive match on label, id, section and view; every word of the query must hit (so "drift dens" finds it). */
export function searchSettings(query: string, defs: readonly SettingDef[] = SETTINGS.list): SettingDef[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return [...defs]
  return defs.filter((d) => {
    const hay = `${d.label} ${d.id} ${d.section} ${d.view}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}
