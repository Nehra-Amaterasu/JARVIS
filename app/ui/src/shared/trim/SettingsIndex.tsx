/**
 * SettingsIndex (spec 20.6.6): the list of every registered setting, grouped by the section it is used in, with a
 * filter. It is the body of the palette mode `:` (shell/modes/settings.mode.ts turns the same groups into rows) and
 * also draws itself as a component for the gallery. It owns no values: it names a setting and where its Trim is.
 */
import { useId, useState } from 'react'
import './trim.css'
import { SETTINGS, searchSettings } from './registry'
import { valueText, type SettingDef } from './types'

export const EMPTY_INDEX_LINE = 'No settings are registered yet. Each one will sit beside the thing it tunes, behind a slider key.'

export interface SettingGroup { section: string; items: SettingDef[] }

/** The matches grouped by section, in the registry's order (section, view, label). Pure. */
export function groupSettings(defs: readonly SettingDef[]): SettingGroup[] {
  const out: SettingGroup[] = []
  for (const d of defs) {
    const g = out[out.length - 1]
    if (g && g.section === d.section) g.items.push(d)
    else out.push({ section: d.section, items: [d] })
  }
  return out
}

export interface SettingsIndexProps {
  /** Default: the globbed registry. */
  defs?: readonly SettingDef[]
  /** Called when a row is chosen: the shell goes to its section and view. */
  onGo?: (def: SettingDef) => void
  initialQuery?: string
}

export function SettingsIndex({ defs = SETTINGS.list, onGo, initialQuery = '' }: SettingsIndexProps) {
  const [q, setQ] = useState(initialQuery)
  const id = useId()
  const hits = searchSettings(q, defs)
  const groups = groupSettings(hits)
  return (
    <div className="tr-index" data-testid="settings-index">
      <label className="tr-index-field" htmlFor={`${id}-q`}>
        <span>Find a setting</span>
        <input id={`${id}-q`} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="density, chime, drift" autoComplete="off" spellCheck={false} />
      </label>
      {!defs.length && <p className="tr-index-empty">{EMPTY_INDEX_LINE}</p>}
      {defs.length > 0 && !hits.length && <p className="tr-index-empty">Nothing matches that. Try one word of the setting or its section.</p>}
      {groups.map((g) => (
        <section key={g.section} aria-label={g.section}>
          <h3>{g.section}</h3>
          <ul>
            {g.items.map((d) => (
              <li key={d.id}>
                <button type="button" className="tr-index-row" onClick={() => onGo?.(d)} data-setting={d.id}>
                  <span>{d.label}</span>
                  <span className="tr-now">{valueText(d)}</span>
                  <span className="tr-where">{d.section} / {d.view}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
