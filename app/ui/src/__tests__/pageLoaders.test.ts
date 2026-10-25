import { afterEach, describe, expect, it, vi } from 'vitest'
import { PAGE_LOADERS, PREFETCH_ORDER, prefetchPages } from '../pageLoaders'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('page chunks', () => {
  it('every lazily loaded tab resolves to a component (catches a renamed export)', async () => {
    for (const [tab, load] of Object.entries(PAGE_LOADERS)) {
      if (tab === 'aankhen') continue          // three.js needs WebGL; its export is checked below by name
      const m = await load()
      expect(typeof m.default, tab).toBe('function')
    }
  }, 60000)

  it('Aankhen exports the page the loader asks for', async () => {
    const src = (await import('../pages/Aankhen?raw')).default as string
    expect(src).toMatch(/export function AankhenPage\(/)
  })

  it('Core is not a lazy chunk; the heavy tabs are never prefetched', () => {
    expect(PAGE_LOADERS.core).toBeUndefined()
    expect(PREFETCH_ORDER).not.toContain('aankhen')
    expect(PREFETCH_ORDER).not.toContain('mission')
    for (const t of PREFETCH_ORDER) expect(PAGE_LOADERS[t]).toBeTypeOf('function')
  })
})

describe('prefetchPages', () => {
  it('loads the pages one after another after the delay, and stops when cancelled', async () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const keep = { ...PAGE_LOADERS }
    for (const k of ['yaadash', 'limbs', 'connect']) {
      PAGE_LOADERS[k] = () => { calls.push(k); return Promise.resolve({ default: () => null }) }
    }
    try {
      prefetchPages(['yaadash', 'limbs', 'connect'], 1000)
      await vi.advanceTimersByTimeAsync(900)
      expect(calls).toEqual([])                      // nothing competes with the first paint
      await vi.advanceTimersByTimeAsync(5000)
      expect(calls).toEqual(['yaadash', 'limbs', 'connect'])

      calls.length = 0
      const cancel = prefetchPages(['yaadash', 'limbs'], 1000)
      await vi.advanceTimersByTimeAsync(500)
      cancel()                                       // the window closed, or the tab was left
      await vi.advanceTimersByTimeAsync(5000)
      expect(calls).toEqual([])
    } finally {
      Object.assign(PAGE_LOADERS, keep)
    }
  })

  it('a page that fails to load does not stop the others', async () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const keep = { ...PAGE_LOADERS }
    PAGE_LOADERS.yaadash = () => { calls.push('yaadash'); return Promise.reject(new Error('offline')) }
    PAGE_LOADERS.limbs = () => { calls.push('limbs'); return Promise.resolve({ default: () => null }) }
    try {
      prefetchPages(['yaadash', 'limbs'], 0)
      await vi.advanceTimersByTimeAsync(1000)
      expect(calls).toEqual(['yaadash', 'limbs'])
    } finally {
      Object.assign(PAGE_LOADERS, keep)
    }
  })
})
