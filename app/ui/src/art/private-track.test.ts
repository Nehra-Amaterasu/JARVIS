// The private track end to end (A.G03): with VITE_ART_TRACK=private and the staged files present, every one of the
// eleven ids resolves to a real file. The files are the owner's and git-ignored, so this test skips on a checkout
// that has not run `python tools/art/build_art.py --private --stage-private`; it never reads or prints their pixels.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CENTREPIECE_IDS } from './centrepieces'

const STAGE = join(resolve(__dirname), 'private-local')
const staged = existsSync(STAGE) ? readdirSync(STAGE).filter((f) => f.startsWith('art.')) : []

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe.skipIf(staged.length === 0)('private track with staged files', () => {
  it('resolves all eleven centrepiece ids to a file, preferring the private one', async () => {
    vi.stubEnv('VITE_ART_TRACK', 'private')
    vi.resetModules()
    const art = await import('./index')
    expect(art.ART_TRACK).toBe('private')
    for (const id of CENTREPIECE_IDS) {
      const e = (await art.artUrl(id), art.artEntry(id))
      expect(e, id).not.toBeNull()
      expect(e!.source, id).toBe('private')
      const got = e!.kind === 'txt' ? await art.artText(id) : await art.artUrl(id)
      expect(typeof got, id).toBe('string')
      expect((got as string).length, id).toBeGreaterThan(0)
    }
  })

  it('on the customer track the same staged folder is never read', async () => {
    vi.stubEnv('VITE_ART_TRACK', 'customer')
    vi.resetModules()
    const art = await import('./index')
    expect(art.ART_TRACK).toBe('customer')
    for (const id of CENTREPIECE_IDS) {
      const e = art.artEntry(id)
      if (e) expect(e.source, id).toBe('customer')
    }
  })
})
