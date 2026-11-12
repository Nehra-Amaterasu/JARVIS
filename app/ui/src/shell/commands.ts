/**
 * The palette's rows (spec 4.2.4): Go (sections and views), Do (verbs), Ask (free text through a port).
 * Built here as plain data so a test can prove the rule "no hint without a binding": a row's `hint` is
 * only ever the text of the binding it names (keymap.ts), never a literal.
 */
import { PRODUCT_LABEL, VIEW_LABEL, sectionsOf, type Place, type ProductId } from './ids'
import { hintFor, slotBindingOf } from './keymap'

export type PaletteGroup = 'Go' | 'Do' | 'Ask'

export interface PaletteRow {
  id: string
  group: PaletteGroup
  label: string
  /** Words after the label that are not a key (what the verb does). */
  detail?: string
  /** The binding this row's hint comes from. */
  bindingId?: string
  /** A planned registry id: the row shows the PLANNED lamp and opens "What is coming", never runs. */
  planned?: string
  /** A dashed, inert row (a port is absent); `planned` may still open the roadmap. */
  absent?: boolean
  go?: Place
  run?: () => void | Promise<unknown>
}

/** A verb a product contributes (JARVIS: wake, sleep, room switches). Passed in by the composition root. */
export interface Verb {
  id: string
  label: string
  detail?: string
  /** Shown only when this returns true (wake only while asleep, and so on). */
  when?: () => boolean
  run: () => Promise<unknown>
}

export function hintOf(row: PaletteRow): string | undefined {
  return row.bindingId ? hintFor(row.bindingId) : undefined
}

/** Go rows: the current product's sections first (they carry Ctrl+n), its views, then the other product. */
export function goRows(products: readonly ProductId[], current: ProductId): PaletteRow[] {
  const order = [current, ...products.filter((p) => p !== current)]
  const rows: PaletteRow[] = []
  for (const product of order) {
    for (const s of sectionsOf(product)) {
      rows.push({
        id: `go.${s.id}`,
        group: 'Go',
        label: products.length > 1 ? `${PRODUCT_LABEL[product]}: ${s.label}` : s.label,
        // Ctrl+n opens section n of the CURRENT product, so only those rows may show it.
        bindingId: product === current ? slotBindingOf(product, s.id) : undefined,
        go: { product, section: s.id, view: s.id === 'day' ? 'today' : s.views[0] },
      })
      if (s.views.length > 1)
        for (const v of s.views)
          rows.push({ id: `go.${s.id}.${v}`, group: 'Go', label: `${s.label} / ${VIEW_LABEL[v] ?? v}`, go: { product, section: s.id, view: v } })
    }
  }
  return rows
}

/** Shell rows with a real binding. */
export function shellRows(products: readonly ProductId[]): PaletteRow[] {
  const rows: PaletteRow[] = [
    { id: 'shell.resume', group: 'Go', label: 'Resume where I was', bindingId: 'resume' },
    { id: 'shell.shortcuts', group: 'Go', label: 'Keyboard shortcuts', bindingId: 'shortcuts' },
  ]
  if (products.length > 1) rows.unshift({ id: 'shell.swap', group: 'Go', label: 'Swap product', bindingId: 'product.swap' })
  return rows
}

/** Case-insensitive filter over group, label and detail; the order of `rows` is kept. */
export function filterRows(rows: readonly PaletteRow[], q: string): PaletteRow[] {
  const term = q.trim().toLowerCase()
  if (!term) return [...rows]
  return rows.filter((r) => `${r.group} ${r.label} ${r.detail ?? ''}`.toLowerCase().includes(term))
}

/** The list is paged at 7 rows (7 x 44 + the 56 px field = 364 px, spec 4.2.4), so it never scrolls. */
export const PAGE_ROWS = 7

export function pageOf(index: number): number {
  return Math.floor(Math.max(0, index) / PAGE_ROWS)
}
