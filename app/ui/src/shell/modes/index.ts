/**
 * Globbed palette modes (15.6 rule 2, A.N02 g). A package adds `shell/modes/<name>.mode.ts` exporting one
 * `ShellMode` (as `default` or as `mode`). When the palette query starts with a mode's prefix, that mode alone
 * answers, with the rest of the query; L02 (wave 7) adds the settings index on `:` this way (D-V2-12). No mode
 * is registered today, so the palette behaves exactly as before.
 */
import type { PaletteRow } from '../commands'

export interface ShellMode {
  id: string
  /** The characters that switch the palette into this mode, for example ':'. Never a letter or a digit. */
  prefix: string
  run(query: string): PaletteRow[]
}

export interface CollectedModes {
  list: readonly ShellMode[]
  errors: readonly string[]
}

const isMode = (x: unknown): x is ShellMode =>
  !!x && typeof x === 'object' && typeof (x as ShellMode).id === 'string' &&
  typeof (x as ShellMode).prefix === 'string' && typeof (x as ShellMode).run === 'function'

/** Validate the modules of `*.mode.ts`: a prefix must be non-empty, not alphanumeric (typing a word never
 *  switches mode) and unique; a longer prefix is tried first so ':' and '::' can coexist. */
export function collectModes(modules: Record<string, unknown>): CollectedModes {
  const list: ShellMode[] = []
  const errors: string[] = []
  for (const path of Object.keys(modules).sort()) {
    const mod = modules[path] as { default?: unknown; mode?: unknown } | undefined
    const m = isMode(mod?.default) ? mod!.default : isMode(mod?.mode) ? mod!.mode : null
    if (!m) {
      errors.push(`${path}: exports no ShellMode`)
      continue
    }
    if (!m.prefix || /[a-z0-9\s]/i.test(m.prefix)) {
      errors.push(`${path}: prefix "${m.prefix}" must be punctuation only`)
      continue
    }
    if (list.some((x) => x.prefix === m.prefix || x.id === m.id)) {
      errors.push(`${path}: mode ${m.id} or prefix "${m.prefix}" is taken`)
      continue
    }
    list.push(m)
  }
  list.sort((a, b) => b.prefix.length - a.prefix.length)
  return { list, errors }
}

export const MODES: CollectedModes = collectModes(import.meta.glob('./*.mode.ts', { eager: true }))

/** The mode a query opens, with the query after its prefix; null when the query is ordinary. */
export function modeOf(q: string, from: CollectedModes = MODES): { mode: ShellMode; rest: string } | null {
  for (const mode of from.list) if (q.startsWith(mode.prefix)) return { mode, rest: q.slice(mode.prefix.length).trim() }
  return null
}
