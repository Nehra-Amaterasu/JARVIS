/**
 * The palette mode `:` (D-V2-12, A.L02): type ":" and the palette lists every registered setting, filtered by the
 * words after it. Choosing a row goes to the view that holds that setting's Trim; the key is there, beside what it
 * tunes. There is no settings page. With no setting registered the one row says so instead of showing nothing.
 */
import { SETTINGS, searchSettings, valueText, type CollectedSettings } from '../../shared/trim'
import type { PaletteRow } from '../commands'
import { SECTIONS, type ProductId } from '../ids'
import type { ShellMode } from './index'

/** The product that owns a section id: a section id belongs to exactly one product in the table. */
const productOf = (section: string): ProductId | null => SECTIONS.find((s) => s.id === section)?.product ?? null

export function settingRows(query: string, from: CollectedSettings = SETTINGS): PaletteRow[] {
  if (!from.list.length)
    return [{ id: 'setting.none', group: 'Do', label: 'No settings yet', detail: 'each one sits beside the thing it tunes', absent: true }]
  const hits = searchSettings(query, from.list)
  if (!hits.length) return [{ id: 'setting.nomatch', group: 'Do', label: 'No setting matches', detail: query, absent: true }]
  return hits.map((d) => {
    const product = productOf(d.section)
    return {
      id: `setting.${d.id}`,
      group: 'Do' as const,
      label: d.label,
      detail: `${valueText(d)} · ${d.section} / ${d.view}`,
      go: product ? { product, section: d.section, view: d.view } : undefined,
      absent: product ? undefined : true,
    }
  })
}

export const mode: ShellMode = { id: 'settings', prefix: ':', run: (query) => settingRows(query) }
export default mode
