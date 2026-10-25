/**
 * Every tab except Core is its own chunk, fetched the first time it is opened.
 *
 * Measured 2026-10-25 (docs/research/2026-10-25-ui-speed.md): Core is the tab the
 * window opens on, so only it ships in the entry chunk; Yaadash, Limbs, Connect and
 * System were more minified JS parsed before the first paint, and Aankhen (three.js)
 * and Mission (its syllabus) were already split. Once the window has painted,
 * prefetchPages() loads the light pages while the CPU is idle, so switching to them
 * later does not wait on the parser.
 */
import type { ComponentType } from 'react'

type Loader = () => Promise<{ default: ComponentType }>

export const PAGE_LOADERS: Record<string, Loader> = {
  yaadash: () => import('./pages/Yaadash').then((m) => ({ default: m.YaadashPage })),
  // The 3D twin pulls in three.js (~600 kB): it loads only when Aankhen is opened.
  aankhen: () => import('./pages/Aankhen').then((m) => ({ default: m.AankhenPage })),
  limbs: () => import('./pages/Limbs').then((m) => ({ default: m.LimbsPage })),
  connect: () => import('./pages/Connect').then((m) => ({ default: m.ConnectPage })),
  system: () => import('./pages/System').then((m) => ({ default: m.SystemPage })),
  // Mission Germoney carries its whole syllabus (~150 kB of content).
  mission: () => import('./germoney/MissionRoot').then((m) => ({ default: m.MissionRoot })),
}

/** The light pages only. Aankhen (three.js) and Mission stay unloaded until opened:
 *  evaluating them costs memory on a laptop already near its commit limit, and the
 *  files come from 127.0.0.1, so the first open waits on parsing, not the network. */
export const PREFETCH_ORDER = ['yaadash', 'limbs', 'connect', 'system'] as const

type Idle = (cb: () => void, opts?: { timeout: number }) => number

/** Fetch (and parse) every page chunk, one at a time, in idle time. Returns a cancel. */
export function prefetchPages(order: readonly string[] = PREFETCH_ORDER, delayMs = 2500): () => void {
  let cancelled = false
  const idle: Idle = (window as unknown as { requestIdleCallback?: Idle }).requestIdleCallback
    ?? ((cb) => window.setTimeout(cb, 50))
  const next = (i: number) => {
    if (cancelled || i >= order.length) return
    idle(() => {
      if (cancelled) return
      const load = PAGE_LOADERS[order[i]]
      void (load ? load() : Promise.resolve()).catch(() => undefined).finally(() => next(i + 1))
    }, { timeout: 4000 })
  }
  const t = window.setTimeout(() => next(0), delayMs)
  return () => { cancelled = true; window.clearTimeout(t) }
}
