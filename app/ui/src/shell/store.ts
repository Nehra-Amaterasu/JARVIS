/**
 * Shell v2 state: which product, the place per product, the one open overlay and a short Back history.
 * It is not lib/store.ts's `tab` (that stays the legacy page key, which the canvas still sets so the old
 * pages render); this store is the frozen-id address of what is on screen.
 *
 * Defaults (3.4): a product opens on its last section and view; `day` always opens `day.today`, it never
 * switches view by clock time. The last place per product is kept in localStorage (wrapped: blocked storage
 * costs only the restore).
 */
import { create } from 'zustand'
import { homeOf, parseRoute, sectionById, type Place, type ProductId } from './ids'
import { readRecord, writeRecord } from './record'

export type OverlayId = 'palette' | 'shortcuts' | 'roadmap'

/** Back history is bounded (Strand B: bounded caches). 20 places is far more than Esc/Alt+Left is used for. */
export const HISTORY_MAX = 20

interface ShellState {
  product: ProductId
  places: Record<ProductId, Place>
  /** The last view chosen inside each section this session, so a rail click returns to it. */
  lastView: Record<string, string>
  overlay: OverlayId | null
  roadmapFocus: string | null
  history: Place[]

  go: (p: Place, opts?: { history?: boolean }) => void
  goSection: (section: string) => void
  setView: (view: string) => void
  stepView: (delta: -1 | 1) => void
  swapProduct: () => void
  back: () => boolean
  openOverlay: (id: OverlayId, focus?: string | null) => void
  closeOverlay: () => void
}

const PLACE_KEY = 'shell.place'
const PRODUCT_KEY = 'shell.product'

/** Which products this build has. Written in place so Vite folds it (shared/product.ts says why). */
export const PRODUCTS: readonly ProductId[] =
  import.meta.env.VITE_PRODUCT === 'jarvis' ? ['jarvis'] : import.meta.env.VITE_PRODUCT === 'ww' ? ['ww'] : ['jarvis', 'ww']

function readPlace(product: ProductId): Place {
  try {
    const raw = localStorage.getItem(`${PLACE_KEY}.${product}`)
    const p = raw ? (JSON.parse(raw) as Partial<Place>) : null
    const s = p?.section ? sectionById(p.section) : undefined
    if (s && s.product === product && typeof p?.view === 'string' && s.views.includes(p.view)) {
      return { product, section: s.id, view: s.id === 'day' ? 'today' : p.view }
    }
  } catch {
    /* fall through to home */
  }
  return homeOf(product)
}

function savePlace(p: Place): void {
  try {
    localStorage.setItem(`${PLACE_KEY}.${p.product}`, JSON.stringify(p))
    localStorage.setItem(PRODUCT_KEY, p.product)
  } catch {
    /* storage blocked */
  }
}

function initialProduct(route: Place | null): ProductId {
  if (route && PRODUCTS.includes(route.product)) return route.product
  try {
    const p = localStorage.getItem(PRODUCT_KEY) as ProductId | null
    if (p && PRODUCTS.includes(p)) return p
  } catch {
    /* default */
  }
  return PRODUCTS[0]
}

function initial(): { product: ProductId; places: Record<ProductId, Place> } {
  const route = typeof location !== 'undefined' ? parseRoute(location.hash) : null
  const product = initialProduct(route)
  const places = { jarvis: readPlace('jarvis'), ww: readPlace('ww') }
  if (route && PRODUCTS.includes(route.product)) places[route.product] = route
  return { product, places }
}

function touchRecord(p: Place): void {
  const now = Date.now()
  const prev = readRecord(p.product)
  const same = !!prev && prev.section === p.section && prev.view === p.view
  writeRecord({
    product: p.product, section: p.section, view: p.view,
    object: same ? prev.object : null, openedAt: same ? prev.openedAt : now, lastConfirmedAt: now,
  })
}

export const useShell = create<ShellState>((set, get) => ({
  ...initial(),
  lastView: {},
  overlay: null,
  roadmapFocus: null,
  history: [],

  go: (p, opts) => {
    const s = get()
    if (!PRODUCTS.includes(p.product)) return
    const cur = s.places[s.product]
    if (s.product === p.product && cur.section === p.section && cur.view === p.view) return
    const history = opts?.history === false ? s.history : [...s.history, cur].slice(-HISTORY_MAX)
    set({ product: p.product, places: { ...s.places, [p.product]: p }, lastView: { ...s.lastView, [p.section]: p.view }, history })
    savePlace(p)
    touchRecord(p)
  },
  goSection: (section) => {
    const def = sectionById(section)
    if (!def) return
    const view = def.id === 'day' ? 'today' : get().lastView[def.id] ?? def.views[0]
    get().go({ product: def.product, section: def.id, view })
  },
  setView: (view) => {
    const s = get()
    const cur = s.places[s.product]
    if (!sectionById(cur.section)?.views.includes(view)) return
    s.go({ ...cur, view })
  },
  stepView: (delta) => {
    const s = get()
    const cur = s.places[s.product]
    const views = sectionById(cur.section)?.views ?? []
    const next = views[views.indexOf(cur.view) + delta]
    if (next) s.go({ ...cur, view: next })
  },
  swapProduct: () => {
    const s = get()
    const other = PRODUCTS.find((p) => p !== s.product)
    if (other) s.go(s.places[other])
  },
  back: () => {
    const s = get()
    const prev = s.history[s.history.length - 1]
    if (!prev) return false
    set({ history: s.history.slice(0, -1) })
    get().go(prev, { history: false })
    return true
  },
  openOverlay: (overlay, focus = null) => set({ overlay, roadmapFocus: overlay === 'roadmap' ? focus : null }),
  closeOverlay: () => set({ overlay: null, roadmapFocus: null }),
}))

export const currentPlace = (s: { product: ProductId; places: Record<ProductId, Place> }): Place => s.places[s.product]

/** Tests only: back to a clean start. */
export function resetShellForTests(): void {
  useShell.setState({ ...initial(), lastView: {}, overlay: null, roadmapFocus: null, history: [] })
}
