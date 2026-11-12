/**
 * Art by id (docs/design/jarvis-product-overhaul.md 8). Import from here, not from resolve.ts.
 *
 *   const url = await artUrl('art.core.hill')      // image or svg, or null
 *   const text = await artText('art.memory.branch') // txt art, fetched once, or null
 *
 * The files are lazy: each one is its own chunk, loaded when a section asks for its art id.
 * VITE_ART_TRACK=customer (the default) resolves customer-safe files only; =private also reads the owner's
 * staged pictures and is never the default (8.6.2).
 */
import manifestJson from './art-manifest.json'
import { createArtResolver, type ArtManifest, type ArtSources, type Track } from './resolve'

export type { ArtEntry, ArtKind, ArtManifest, ArtResolver, ArtRow, Track } from './resolve'
export { createArtResolver } from './resolve'

export const ART_MANIFEST = manifestJson as ArtManifest

const customer: ArtSources = {
  urls: import.meta.glob('./generated/*.{png,svg,webp}', { query: '?url', import: 'default' }) as ArtSources['urls'],
  texts: import.meta.glob('./generated/*.txt', { query: '?raw', import: 'default' }) as ArtSources['texts'],
}

// The test is written in place on purpose: Vite folds `import.meta.env.X === 'literal'` to a constant and
// Rollup then drops the dynamic import, but a constant exported from another module does NOT fold (measured
// in shared/product.ts), which would pull the private glob into a customer build.
let priv: ArtSources | null = null
const privateReady: Promise<void> = import.meta.env.VITE_ART_TRACK === 'private'
  ? import('./private').then((m) => { priv = m.sources })
  : Promise.resolve()

export const ART_TRACK: Track = import.meta.env.VITE_ART_TRACK === 'private' ? 'private' : 'customer'

const resolver = createArtResolver(ART_MANIFEST, ART_TRACK, customer, () => priv)

export const artKnown = resolver.known
export const artEntry = resolver.entry
export const artIds = resolver.ids
export const artUrl = async (id: string) => { await privateReady; return resolver.url(id) }
export const artText = async (id: string) => { await privateReady; return resolver.text(id) }
