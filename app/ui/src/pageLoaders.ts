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
import type { Registry } from './shared/planned/types'

type Loader = () => Promise<{ default: ComponentType }>

const JARVIS_LOADERS: Record<string, Loader> = {
  yaadash: () => import('./pages/Yaadash').then((m) => ({ default: m.YaadashPage })),
  // The 3D twin pulls in three.js (~600 kB): it loads only when Aankhen is opened.
  aankhen: () => import('./pages/Aankhen').then((m) => ({ default: m.AankhenPage })),
  limbs: () => import('./pages/Limbs').then((m) => ({ default: m.LimbsPage })),
  connect: () => import('./pages/Connect').then((m) => ({ default: m.ConnectPage })),
  system: () => import('./pages/System').then((m) => ({ default: m.SystemPage })),
}
// Mission Germoney carries its whole syllabus (~150 kB of content).
const WW_LOADERS: Record<string, Loader> = {
  mission: () => import('./germoney/MissionRoot').then((m) => ({ default: m.MissionRoot })),
}

// Seam cut: a VITE_PRODUCT build keeps only its own product's loaders (shared/product.ts says why the test is written in place), so the
// other product's chunks (three.js for ww, the whole syllabus for jarvis) are never emitted.
export const PAGE_LOADERS: Record<string, Loader> = {
  ...(import.meta.env.VITE_PRODUCT !== 'ww' ? JARVIS_LOADERS : {}),
  ...(import.meta.env.VITE_PRODUCT !== 'jarvis' ? WW_LOADERS : {}),
}

/**
 * Shell v2 (A.B05) reaches each product only through these two lazy handles, so shell/ itself names no product
 * module (seam S2, imports.test.ts) and a one-product build folds the other handle to null and emits nothing.
 *   - the planned-feature registries, merged by "What is coming" (only the ones this build has)
 *   - the Well Wisher frame's navigation, so a rail click switches the frame and a jump inside the frame
 *     (Tree's "Study this node") moves the rail
 */
export interface WwShellBridge {
  registry: Registry
  switchTo: (ws: 'study' | 'tree' | 'life' | 'career' | 'focus', view: string | null) => Promise<void>
  current: () => { ws: string; view: string | null }
  subscribe: (fn: (ws: string, view: string | null) => void) => () => void
}

export const loadWwShell: (() => Promise<WwShellBridge>) | null = import.meta.env.VITE_PRODUCT !== 'jarvis'
  ? () => Promise.all([import('./ww/plannedFeatures'), import('./ww/frame/navigate'), import('./ww/frame/frameStore')]).then(([p, n, f]) => ({
    registry: p.wwRegistry,
    switchTo: (ws, view) => n.switchWorkspace(ws, view),
    current: () => ({ ws: f.useFrame.getState().ws, view: f.useFrame.getState().view }),
    subscribe: (fn) => f.useFrame.subscribe((s, prev) => {
      if (s.ws !== prev.ws || s.view !== prev.view) fn(s.ws, s.view)
    }),
  }))
  : null

export const loadJarvisRegistry: (() => Promise<Registry>) | null = import.meta.env.VITE_PRODUCT !== 'ww'
  ? () => import('./jarvis/planned').then((m) => m.jarvisRegistry)
  : null

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
