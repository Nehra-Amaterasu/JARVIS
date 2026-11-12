/**
 * The art-id resolver (docs/design/jarvis-product-overhaul.md 8.2 item 2, 8.5.3, 8.6.2).
 *
 * The product names art by id (`art.core.hill`), never by catalogue id or file. The manifest, written by
 * tools/art/build_art.py, says which files an id has and which track each belongs to. This module is pure:
 * it takes the manifest, the active track and the loaders, so a test can build one with fake files and the
 * track can never be read from a global in the middle of a decision.
 *
 *   customer track (the default)  resolves only ids that have a customer file: generated, own or public domain
 *   private track                 also resolves ids the private build staged into private-local/, and prefers
 *                                 that file over the customer one
 *
 * An id with no file on the active track resolves to null and the caller draws its caption or empty state:
 * the app never shows a placeholder picture as if it were the art.
 */
export type ArtKind = 'png' | 'svg' | 'txt' | 'webp'
export type Track = 'customer' | 'private'

export interface ArtFile { path: string; sha256: string; bytes: number; kind: ArtKind }
export interface ArtRow {
  track: 'customer' | 'private-only'
  files: ArtFile[]
  private_source: string | null
  customer_source: string | null
  licence: string
  budget_bytes: number
  recipe_sha256: string
}
export interface ArtManifest { version: number; env: Record<string, string>; art: Record<string, ArtRow> }

/** A lazy loader returns an asset URL (images, svg) or the raw text (txt). Keys are `./<folder>/<file>`. */
export type Loader = () => Promise<string>
export interface ArtSources { urls: Record<string, Loader>; texts: Record<string, Loader> }

export interface ArtEntry { id: string; kind: ArtKind; source: 'customer' | 'private'; file: string }

const KINDS: readonly string[] = ['png', 'svg', 'txt', 'webp']

/** `./private-local/art.core.hill-still.png` -> { id: 'art.core.hill-still', kind: 'png' } (ids contain dots). */
export function parsePrivateKey(key: string): { id: string; kind: ArtKind } | null {
  const name = key.slice(key.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  const kind = name.slice(dot + 1)
  if (dot < 1 || !KINDS.includes(kind) || !name.startsWith('art.')) return null
  return { id: name.slice(0, dot), kind: kind as ArtKind }
}

export interface ArtResolver {
  /** The id is in the manifest, on any track. */
  known(id: string): boolean
  /** Every id the active track can draw. */
  ids(): string[]
  entry(id: string): ArtEntry | null
  /** URL of an image or svg, or null. */
  url(id: string): Promise<string | null>
  /** Text of a txt art file, fetched once and cached, or null. */
  text(id: string): Promise<string | null>
}

export function createArtResolver(
  manifest: ArtManifest,
  track: Track,
  customer: ArtSources,
  priv: () => ArtSources | null = () => null,
): ArtResolver {
  const cache = new Map<string, Promise<string | null>>()

  function entry(id: string): ArtEntry | null {
    if (track === 'private') {
      const p = priv()
      if (p) {
        for (const key of [...Object.keys(p.urls), ...Object.keys(p.texts)]) {
          const k = parsePrivateKey(key)
          if (k && k.id === id) return { id, kind: k.kind, source: 'private', file: key }
        }
      }
    }
    const row = manifest.art[id]
    if (!row || row.track !== 'customer' || row.files.length === 0) return null
    const f = row.files[0]
    return { id, kind: f.kind, source: 'customer', file: './' + f.path }
  }

  function load(id: string, want: 'url' | 'text'): Promise<string | null> {
    const e = entry(id)
    if (!e || (e.kind === 'txt') !== (want === 'text')) return Promise.resolve(null)
    const src = e.source === 'private' ? priv() : customer
    const loader = src && (want === 'text' ? src.texts[e.file] : src.urls[e.file])
    if (!loader) return Promise.resolve(null)
    const key = want + '|' + e.source + '|' + e.file
    let p = cache.get(key)
    if (!p) {
      p = loader().catch(() => null)             // a missing chunk is an absent picture, not a crash
      cache.set(key, p)
    }
    return p
  }

  return {
    known: (id) => id in manifest.art,
    ids: () => {
      const out = new Set(Object.keys(manifest.art).filter((id) => entry(id)))
      const p = track === 'private' ? priv() : null
      if (p) for (const key of [...Object.keys(p.urls), ...Object.keys(p.texts)]) { const k = parsePrivateKey(key); if (k) out.add(k.id) }
      return [...out].sort()
    },
    entry,
    url: (id) => load(id, 'url'),
    text: (id) => load(id, 'text'),
  }
}
