// The art-id resolver and the committed manifest (docs/design/jarvis-product-overhaul.md 8.5.3 items 2 and 4, 8.6.2).
import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ART_MANIFEST, ART_TRACK, artEntry, artIds, artKnown, artText, artUrl } from './index'
import { createArtResolver, parsePrivateKey, type ArtManifest, type ArtSources } from './resolve'

const DIR = resolve(__dirname)
const row = (over: Partial<ArtManifest['art'][string]> = {}): ArtManifest['art'][string] => ({
  track: 'customer', files: [], private_source: null, customer_source: 'generator:x', licence: 'own', budget_bytes: 100, recipe_sha256: 'r', ...over,
})
const file = (path: string, kind: 'png' | 'svg' | 'txt' | 'webp' = 'png') => ({ path, sha256: 's', bytes: 1, kind })
const fake: ArtManifest = {
  version: 1, env: {},
  art: {
    'art.a.img': row({ files: [file('generated/art.a.img.png')] }),
    'art.a.txt': row({ files: [file('generated/art.a.txt.txt', 'txt')] }),
    'art.a.secret': row({ track: 'private-only', private_source: 'C01-01' }),
  },
}
const sources = (urls: Record<string, string> = {}, texts: Record<string, string> = {}, calls = { n: 0 }): ArtSources => ({
  urls: Object.fromEntries(Object.entries(urls).map(([k, v]) => [k, async () => { calls.n++; return v }])),
  texts: Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, async () => { calls.n++; return v }])),
})
const cust = () => sources({ './generated/art.a.img.png': '/img.png' }, { './generated/art.a.txt.txt': 'hello' })

describe('the resolver, customer track', () => {
  it('resolves customer ids to a url or text and knows every manifest id', async () => {
    const r = createArtResolver(fake, 'customer', cust())
    expect(await r.url('art.a.img')).toBe('/img.png')
    expect(await r.text('art.a.txt')).toBe('hello')
    expect(r.known('art.a.secret')).toBe(true)
    expect(r.ids()).toEqual(['art.a.img', 'art.a.txt'])
  })

  it('resolves no private-only id, and nothing for an unknown id', async () => {
    const r = createArtResolver(fake, 'customer', cust(), () => sources({ './private-local/art.a.secret.png': '/p.png' }))
    expect(r.entry('art.a.secret')).toBeNull()          // even if private files are around, the customer track never reads them
    expect(await r.url('art.a.secret')).toBeNull()
    expect(r.entry('art.nope.nothing')).toBeNull()
    expect(await r.text('art.nope.nothing')).toBeNull()
  })

  it('asks for the right kind: a txt id has no url and an image has no text', async () => {
    const r = createArtResolver(fake, 'customer', cust())
    expect(await r.url('art.a.txt')).toBeNull()
    expect(await r.text('art.a.img')).toBeNull()
  })

  it('fetches each file once and survives a failing loader', async () => {
    const calls = { n: 0 }
    const r = createArtResolver(fake, 'customer', sources({ './generated/art.a.img.png': '/img.png' }, {}, calls))
    await Promise.all([r.url('art.a.img'), r.url('art.a.img'), r.url('art.a.img')])
    expect(calls.n).toBe(1)
    const bad: ArtSources = { urls: { './generated/art.a.img.png': () => Promise.reject(new Error('chunk 404')) }, texts: {} }
    expect(await createArtResolver(fake, 'customer', bad).url('art.a.img')).toBeNull()
  })

  it('returns null for an id whose file is in the manifest but has no loader', async () => {
    expect(await createArtResolver(fake, 'customer', sources()).url('art.a.img')).toBeNull()
  })
})

describe('the resolver, private track', () => {
  const priv = () => sources({ './private-local/art.a.secret.png': '/secret.png', './private-local/art.a.img.png': '/private-img.png' })
  it('resolves private-only ids and prefers the private file over the customer one', async () => {
    const r = createArtResolver(fake, 'private', cust(), priv)
    expect(await r.url('art.a.secret')).toBe('/secret.png')
    expect(await r.url('art.a.img')).toBe('/private-img.png')
    expect(r.entry('art.a.img')?.source).toBe('private')
    expect(r.entry('art.a.txt')?.source).toBe('customer')   // no private file: falls back to the customer one
    expect(r.ids()).toEqual(['art.a.img', 'art.a.secret', 'art.a.txt'])
  })

  it('before the private sources are ready it still answers from the customer files', async () => {
    const r = createArtResolver(fake, 'private', cust(), () => null)
    expect(await r.url('art.a.img')).toBe('/img.png')
    expect(await r.url('art.a.secret')).toBeNull()
  })

  it('parses private file names (art ids contain dots)', () => {
    expect(parsePrivateKey('./private-local/art.core.hill-still.png')).toEqual({ id: 'art.core.hill-still', kind: 'png' })
    expect(parsePrivateKey('./private-local/art.x.y.txt')).toEqual({ id: 'art.x.y', kind: 'txt' })
    expect(parsePrivateKey('./private-local/C02-02.png')).toBeNull()
    expect(parsePrivateKey('./private-local/art.x.y.gif')).toBeNull()
    expect(parsePrivateKey('./private-local/.gitkeep')).toBeNull()
  })
})

describe('the committed manifest', () => {
  const files = Object.entries(ART_MANIFEST.art).flatMap(([id, r]) => r.files.map((f) => ({ id, f, budget: r.budget_bytes })))

  it('has one file on disk per entry with the recorded sha256 and size, and none unlisted', () => {
    expect(files.length).toBeGreaterThanOrEqual(7)
    for (const { id, f } of files) {
      const p = join(DIR, f.path)
      expect(existsSync(p), `${id}: ${f.path}`).toBe(true)
      const b = readFileSync(p)
      expect(createHash('sha256').update(b).digest('hex'), id).toBe(f.sha256)
      expect(b.length, id).toBe(f.bytes)
    }
    expect(readdirSync(join(DIR, 'generated')).sort()).toEqual(files.map((x) => x.f.path.split('/').pop()!).sort())
  })

  it('keeps every file within its byte budget and the whole set under 60 KB', () => {
    for (const { id, f, budget } of files) expect(f.bytes, id).toBeLessThanOrEqual(budget)
    expect(files.reduce((a, x) => a + x.f.bytes, 0)).toBeLessThan(60 * 1024)
  })

  it('gives every customer entry a licence line and no private-only entry a file', () => {
    for (const [id, r] of Object.entries(ART_MANIFEST.art)) {
      if (r.track === 'customer') { expect(r.licence.trim().length, id).toBeGreaterThan(10); expect(r.files.length, id).toBe(1) }
      else expect(r.files, id).toEqual([])
    }
  })

  it('holds no pixels of a private picture: only catalogue ids, recipe hashes and customer files', () => {
    const text = readFileSync(join(DIR, 'art-manifest.json'), 'utf8')
    expect(text).not.toMatch(/data:image|base64,|source_sha256|private-hashes/)
  })
})

describe('the default build resolves on the customer track', () => {
  it('uses the customer track unless VITE_ART_TRACK=private', () => {
    expect(ART_TRACK).toBe('customer')
  })

  it('resolves no private-only id through the real exports', async () => {
    for (const [id, r] of Object.entries(ART_MANIFEST.art)) {
      if (r.track !== 'private-only') continue
      expect(artKnown(id)).toBe(true)
      expect(artEntry(id)).toBeNull()
      expect(await artUrl(id)).toBeNull()
      expect(artIds()).not.toContain(id)
    }
  })

  it('loads a real image url and the real text of a txt art', async () => {
    expect(await artUrl('art.core.hill')).toMatch(/art\.core\.hill.*\.png|^data:image\/png/)
    expect(await artText('art.shell.404')).toBe(readFileSync(join(DIR, 'generated/art.shell.404.txt'), 'utf8'))
  })

  it('every id the customer track can draw has a loader that answers', async () => {
    for (const id of artIds()) {
      const e = artEntry(id)!
      const v = e.kind === 'txt' ? await artText(id) : await artUrl(id)
      expect(v, id).toBeTruthy()
    }
  })

  it('the private branch is gated in place in index.ts, so a customer build folds it away', () => {
    const src = readFileSync(join(DIR, 'index.ts'), 'utf8')
    expect(src).toMatch(/import\.meta\.env\.VITE_ART_TRACK === 'private'\s*\n?\s*\? import\('\.\/private'\)/)
    expect(src).not.toMatch(/^import .* from '\.\/private'/m)
    expect(readFileSync(join(DIR, '.gitignore'), 'utf8')).toMatch(/^private-local\/$/m)
  })

  it('does not call the loaders until an id is asked for (lazy per file)', () => {
    const spy = vi.fn()
    createArtResolver(fake, 'customer', { urls: { './generated/art.a.img.png': async () => { spy(); return 'x' } }, texts: {} })
    expect(spy).not.toHaveBeenCalled()
  })
})
