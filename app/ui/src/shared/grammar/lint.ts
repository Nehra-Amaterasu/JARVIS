// The grammar-use lint (spec A.G02 accept line, D-V2-6): every element that renders a grammar carries
// data-grammar ('sigil', 'ascii', 'terminal', space-separated when it uses two), and every data-view must use at
// least two of the three. In wave 5 this is REPORTED; it is enforced from wave 7, when the sections land.

export const GRAMMARS = ['sigil', 'ascii', 'terminal'] as const
export type Grammar = (typeof GRAMMARS)[number]

export interface GrammarUse {
  view: string
  grammars: Grammar[]
  ok: boolean
}

export function grammarReport(root: ParentNode): GrammarUse[] {
  const out: GrammarUse[] = []
  for (const v of root.querySelectorAll<HTMLElement>('[data-view]')) {
    const found = new Set<Grammar>()
    for (const el of v.querySelectorAll<HTMLElement>('[data-grammar]')) {
      for (const g of (el.getAttribute('data-grammar') ?? '').split(/\s+/)) if ((GRAMMARS as readonly string[]).includes(g)) found.add(g as Grammar)
    }
    const grammars = GRAMMARS.filter((g) => found.has(g))
    out.push({ view: v.getAttribute('data-view') ?? '', grammars, ok: grammars.length >= 2 })
  }
  return out
}
