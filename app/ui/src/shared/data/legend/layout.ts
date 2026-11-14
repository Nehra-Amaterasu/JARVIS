// Legend, the pure part (spec 21.5, package DB02). The legend is not written by hand: it is derived from the same
// entries the specimen is drawn from, so a mark added to a specimen appears in its legend and a mark taken out leaves it.
// One entry = one kind of mark on the specimen. The order is the specimen's order.
export type LegendGlyph = 'disc' | 'ring' | 'dashed-ring' | 'hatch' | 'dots' | 'bar' | 'line' | 'diamond'

export const LEGEND_GLYPHS: readonly LegendGlyph[] = ['disc', 'ring', 'dashed-ring', 'hatch', 'dots', 'bar', 'line', 'diamond']

/** What a specimen is drawn from: each kind of mark it uses, once. */
export interface SpecimenEntry {
  id: string
  /** Short name of the mark: "tip disc". */
  name: string
  /** One sentence on what it means: "practised in the last 7 days". */
  meaning: string
  glyph: LegendGlyph
}

/** The legend's rows from a specimen's entries: the same ids in the same order; a repeated id is listed once. */
export function legendEntries(entries: readonly SpecimenEntry[]): SpecimenEntry[] {
  const seen = new Set<string>()
  const out: SpecimenEntry[] = []
  for (const e of entries) {
    if (seen.has(e.id)) continue
    seen.add(e.id)
    out.push(e)
  }
  return out
}

/** The text twin: one line per mark, "name: meaning". It is what the static list prints and what is read aloud. */
export function legendLine(e: SpecimenEntry): string {
  return `${e.name}: ${e.meaning}`
}
