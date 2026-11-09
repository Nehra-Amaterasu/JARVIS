/**
 * The one place KaTeX is imported. Dynamic, on the first formula that mounts, never at first paint:
 * the Vite entry chunk must not grow by the library (about 0.6 to 0.7 MB with its fonts; the measured
 * delta is in the commit that added this file). The stylesheet comes with it, and Vite emits the
 * KaTeX fonts as local assets, so nothing is fetched from a CDN: the app is offline.
 *
 * Failure is quiet and final for the session: if the chunk cannot load, loadKatex() resolves to null
 * once and every formula stays on the home-grown fallback. Nothing here throws into a render.
 */
import type { KatexOptions } from 'katex'

export interface KatexApi { renderToString(tex: string, options?: KatexOptions): string }

let api: KatexApi | null = null
let pending: Promise<KatexApi | null> | null = null
const subs = new Set<() => void>()

/** The loaded engine, or null while it loads, after a failed load, and on the server. */
export function katexNow(): KatexApi | null { return api }

export function subscribeKatex(cb: () => void): () => void {
  subs.add(cb)
  return () => { subs.delete(cb) }
}

export function loadKatex(): Promise<KatexApi | null> {
  if (api) return Promise.resolve(api)
  if (pending) return pending
  pending = (async () => {
    try {
      const [mod] = await Promise.all([import('katex'), import('katex/dist/katex.min.css')])
      const k = ((mod as { default?: KatexApi }).default ?? mod) as KatexApi
      if (typeof k.renderToString !== 'function') return null
      api = k
      subs.forEach((f) => f())
      return api
    } catch {
      return null
    }
  })()
  return pending
}

/** Test seam: forget the loaded engine so a test can exercise the lazy path again. */
export function resetKatexForTests(): void { api = null; pending = null; subs.clear() }
