/**
 * The four sub-projects of the spine (design-language-v3.md 3.1, 8.3). The sub-project is a presentation grouping over
 * the ids of shell/ids.ts, which stay as they are: Senses and Memory still belong to the product `jarvis` in the code, the
 * spine shows them as Aankhen and Yadaash. The ground follows the sub-project: Well Wisher is light, the other three dark.
 */
import { PRODUCTS } from '../store'
import { SECTIONS, sectionById, type Place, type ProductId } from '../ids'

export type SubProjectId = 'jarvis' | 'aankhen' | 'yadaash' | 'wellwisher'
export type Ground = 'dark' | 'light'

export interface SubProject {
  id: SubProjectId
  name: string
  /** The product the sections belong to in shell/ids.ts (a build may carry only one of them). */
  product: ProductId
  ground: Ground
  /** Section ids in spine order. */
  sections: readonly string[]
}

export const SUBPROJECTS: readonly SubProject[] = [
  { id: 'jarvis', name: 'JARVIS', product: 'jarvis', ground: 'dark', sections: ['core', 'room', 'console'] },
  { id: 'aankhen', name: 'Aankhen', product: 'jarvis', ground: 'dark', sections: ['senses'] },
  { id: 'yadaash', name: 'Yadaash', product: 'jarvis', ground: 'dark', sections: ['memory'] },
  { id: 'wellwisher', name: 'Well Wisher', product: 'ww', ground: 'light', sections: ['day', 'focus', 'study', 'tree', 'career'] },
]

/** The sub-projects this build has (a single-product build drops the other product's tiles). */
export function availableSubProjects(products: readonly ProductId[] = PRODUCTS): SubProject[] {
  return SUBPROJECTS.filter((p) => products.includes(p.product))
}

export function subProjectById(id: SubProjectId): SubProject {
  return SUBPROJECTS.find((p) => p.id === id)!
}

export function subProjectOfSection(section: string): SubProject | undefined {
  return SUBPROJECTS.find((p) => p.sections.includes(section))
}

/** The ten sections in the order the spine shows them (Alt+Up and Alt+Down walk this list). */
export function spineOrder(products: readonly ProductId[] = PRODUCTS): string[] {
  return availableSubProjects(products).flatMap((p) => [...p.sections])
}

/** The place a section opens on: its first view. */
export function homeOfSection(section: string): Place | null {
  const s = sectionById(section)
  return s ? { product: s.product, section: s.id, view: s.views[0] } : null
}

/** The section Alt+Down (delta 1) or Alt+Up (delta -1) reaches from a section; it wraps at both ends. */
export function stepSection(current: string, delta: -1 | 1, products: readonly ProductId[] = PRODUCTS): string | null {
  const order = spineOrder(products)
  if (order.length === 0) return null
  const i = order.indexOf(current)
  return order[(i < 0 ? 0 : i + delta + order.length) % order.length]
}

/** The view Alt+Right (delta 1) or Alt+Left (delta -1) reaches inside a section; it wraps. */
export function stepViewOf(section: string, view: string, delta: -1 | 1): string | null {
  const views = sectionById(section)?.views ?? []
  if (views.length < 2) return null
  const i = Math.max(0, views.indexOf(view))
  return views[(i + delta + views.length) % views.length]
}

/** Every section and view the spine and the top plate can reach, for the tests that prove nothing is orphaned. */
export function reachablePlaces(): Place[] {
  return SECTIONS.flatMap((s) => s.views.map((view) => ({ product: s.product, section: s.id, view })))
}

/**
 * Hash routing (3.4). `#core`, `#today` and `#console` are the three drawn views, every other place is
 * `#section/view`. The old route form `#/section/view` is accepted too. Returns null for a hash that names no place.
 */
const SHORT: Record<string, [string, string]> = { core: ['core', 'talk'], today: ['day', 'today'], console: ['console', 'health'] }

export function placeOfHash(hash: string): Place | null {
  const h = hash.replace(/^#\/?/, '').toLowerCase()
  if (!h) return null
  const parts = h.split(/[/.:]/)
  const [sec, view] = parts[1] === undefined && SHORT[parts[0]] ? SHORT[parts[0]] : [parts[0], parts[1]]
  const s = sectionById(sec)
  if (!s) return null
  return { product: s.product, section: s.id, view: view && s.views.includes(view) ? view : s.views[0] }
}

export function hashOfPlace(p: { section: string; view: string }): string {
  for (const [alias, [sec, view]] of Object.entries(SHORT)) if (sec === p.section && view === p.view) return `#${alias}`
  return `#${p.section}/${p.view}`
}
