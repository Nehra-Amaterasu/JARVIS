/**
 * One setting, as a `*.settings.ts` file declares it (spec 20.6.6, A.L02). The owner wants no settings page: a
 * setting lives where its variable is used, behind a Trim key, and this record is what the palette index (`:`)
 * and the audit read. The first six fields are the contract; the rest are optional and additive.
 */
export type SettingDef = {
  /** Unique and stable: `<section>.<thing>`, never renamed (a legacy id resolves to it through ALIASES). */
  id: string
  /** The words on the key's name, the popover heading and the palette row. */
  label: string
  /** The section id the variable is used in (shell/ids), so the palette row can go there. */
  section: string
  /** The view of that section that mounts the Trim. */
  view: string
  /** The value now. Read on every open of the popover: never cached here. */
  read(): unknown
  /** Put the value back to the default. */
  reset(): void
  /** How the value reads as words, for example a minutes suffix. Default: String(). */
  format?: (v: unknown) => string
  /** The default as words, shown beside the value. Absent: the popover prints no default line. */
  defaultText?: string
  /** True when the value is the default; Reset is then inert and says so. Absent: Reset is always live. */
  isDefault?: () => boolean
  /** Hardware and brain settings keep their confirm step: Reset takes two presses (the second is labelled). */
  risk?: 'hardware' | 'brain'
}

/** Words the popover prints for a value. A thrown read is shown as a plain unreadable state, never a crash. */
export function valueText(def: SettingDef): string {
  try {
    const v = def.read()
    if (def.format) return def.format(v)
    if (v === null || v === undefined || v === '') return 'not set'
    if (typeof v === 'boolean') return v ? 'on' : 'off'
    return String(v)
  } catch {
    return 'unreadable'
  }
}
