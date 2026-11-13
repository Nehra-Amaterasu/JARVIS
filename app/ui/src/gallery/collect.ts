// The gallery collector (wave 5 contract): every file `gallery/entries/*.tsx` default-exports an array of entries, and
// `collectEntries()` returns them all, so a later package adds one file and edits nothing else.
import { GROUPS, type GalleryEntry, type GalleryEntryX } from './types'

type EntryModule = { default?: GalleryEntryX[] }

// Entries that draw one product's own code live in a product folder and are loaded lazily, so the other product's build
// leaves them out. An eager glob inside the condition was not dropped (measured 13 Nov: the Well Wisher only build still
// held 10 JARVIS modules); a lazy one is, the same way pageLoaders.ts gates its page loaders. The test is written in
// place because Vite folds `import.meta.env.X !== 'literal'` only where it stands (shared/product.ts says why).
const modules: Record<string, EntryModule> = { ...import.meta.glob<EntryModule>('./entries/*.tsx', { eager: true }) }
const PRODUCT_LOADERS: Record<string, () => Promise<EntryModule>> =
  import.meta.env.VITE_PRODUCT !== 'ww' ? import.meta.glob<EntryModule>('./entries/jarvis/*.tsx') : {}

let productLoad: Promise<number> | null = null

/**
 * Load the entries of this build's own product (today: the JARVIS voice component) and add them to the collection.
 * Resolves with how many files were added; safe to call more than once. `collectEntries()` returns the shared entries
 * until this has resolved, and all of them after.
 */
export function loadProductEntries(): Promise<number> {
  productLoad ??= Promise.all(
    Object.keys(PRODUCT_LOADERS).sort().map(async (file) => {
      modules[file] = await PRODUCT_LOADERS[file]()
    }),
  ).then((done) => {
    if (done.length) cached = null
    return done.length
  })
  return productLoad
}

let cached: GalleryEntryX[] | null = null

/** Every entry, ordered by group (index order), then by file name and position inside the file (the file's own order). */
export function collectEntries(): GalleryEntry[] {
  if (cached) return cached
  const rank = new Map(GROUPS.map((g, i) => [g.id as string, i]))
  const out: { e: GalleryEntryX; g: number; file: string; i: number }[] = []
  for (const file of Object.keys(modules).sort()) {
    const list = modules[file]?.default
    if (!Array.isArray(list)) continue
    list.forEach((e, i) => out.push({ e, g: rank.get(e.group) ?? GROUPS.length, file, i }))
  }
  const seen = new Set<string>()
  const entries: GalleryEntryX[] = []
  for (const x of out.sort((a, b) => a.g - b.g || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || a.i - b.i)) {
    if (seen.has(x.e.id)) continue // a duplicate id (two files claiming one component) keeps the first, never throws on the owner's page
    seen.add(x.e.id)
    entries.push(x.e)
  }
  cached = entries
  return entries
}

/** The same list with the optional bench and merge fields; the bench mount and the gallery pane read this. */
export const collectEntriesX = (): GalleryEntryX[] => collectEntries() as GalleryEntryX[]
