/**
 * The frozen ids of docs/design/jarvis-product-overhaul.md 3.2, in rail order (3.1.2, I37) and, inside
 * a section, in view-switch order. keymap.test.ts asserts this order equals the 3.2 table as amended by
 * D-V2-10 (20.2: `day.month` after `day.week`, `focus.drill` last in Focus; 34 views become 36, asserted by
 * viewCount.test.ts), so the rail, Ctrl+1..5 and the palette cannot drift from the spec. Ids never change;
 * only an order may, and then only here. This is the single-source id table (15.6 rule 5): section
 * packages import it and register a view in shell/views/, they never copy or edit it after wave 5.
 */
export type ProductId = 'jarvis' | 'ww'

export interface SectionDef {
  id: string
  product: ProductId
  label: string
  /** View ids without the section prefix, in view-switch order. */
  views: readonly string[]
}

export const SECTIONS: readonly SectionDef[] = [
  { id: 'core', product: 'jarvis', label: 'Core', views: ['talk', 'sound'] },
  { id: 'room', product: 'jarvis', label: 'Room', views: ['switches', 'rules'] },
  { id: 'senses', product: 'jarvis', label: 'Senses', views: ['presence', 'signal', 'teach'] },
  { id: 'memory', product: 'jarvis', label: 'Memory', views: ['recall', 'beliefs', 'people', 'keep'] },
  { id: 'console', product: 'jarvis', label: 'Console', views: ['health', 'events', 'connections', 'hardware', 'crew'] },
  { id: 'day', product: 'ww', label: 'Day', views: ['today', 'week', 'month', 'body', 'close'] },
  { id: 'focus', product: 'ww', label: 'Focus', views: ['start', 'session', 'rest', 'drill'] },
  { id: 'study', product: 'ww', label: 'Study', views: ['papers', 'practice', 'plan', 'library', 'dmat'] },
  { id: 'tree', product: 'ww', label: 'Tree', views: ['tree'] },
  { id: 'career', product: 'ww', label: 'Career', views: ['pipeline', 'certs', 'abroad', 'money', 'ladder'] },
] as const

export const PRODUCT_LABEL: Record<ProductId, string> = { jarvis: 'JARVIS', ww: 'Well Wisher' }

/** Human words for a view id; the id is the contract, the label is copy. */
export const VIEW_LABEL: Record<string, string> = {
  talk: 'Talk', sound: 'Sound', switches: 'Switches', rules: 'Rules', presence: 'Presence', signal: 'Signal', teach: 'Teach',
  recall: 'Recall', beliefs: 'Beliefs', people: 'People', keep: 'Keep', health: 'Health', events: 'Events',
  connections: 'Connections', hardware: 'Hardware', crew: 'Crew', today: 'Today', week: 'Week', month: 'Month', body: 'Body', close: 'Close',
  start: 'Start', session: 'Session', rest: 'Rest', drill: 'Drill', papers: 'Papers', practice: 'Practice', plan: 'Plan', library: 'Library',
  dmat: 'dMAT', tree: 'Tree', pipeline: 'Pipeline', certs: 'Certs', abroad: 'Abroad', money: 'Money', ladder: 'Ladder',
}

export function sectionsOf(product: ProductId): SectionDef[] {
  return SECTIONS.filter((s) => s.product === product)
}

export function sectionById(id: string): SectionDef | undefined {
  return SECTIONS.find((s) => s.id === id)
}

/** `<section>.<view>` is the full view id in code and tests. */
export function viewId(section: string, view: string): string {
  return `${section}.${view}`
}

export interface Place {
  product: ProductId
  section: string
  view: string
}

/** The first view of the first section is each product's home (3.5: jarvis core.talk, ww day.today). */
export function homeOf(product: ProductId): Place {
  const s = sectionsOf(product)[0]
  return { product, section: s.id, view: s.views[0] }
}

/**
 * Legacy ids that resolve to a view of the table (D-V2-10, D-V2-11). `drill` was the Well Wisher tab and later a
 * Study view; Drill now lives in Focus, so the old word opens `focus.drill`. `month` names the Life calendar.
 */
export const ALIASES: Readonly<Record<string, string>> = { drill: 'focus.drill', month: 'day.month' }

/** The place an alias names, or null. */
export function resolveAlias(alias: string): Place | null {
  const id = ALIASES[alias]
  if (!id) return null
  const [sec, view] = id.split('.')
  const s = sectionById(sec)
  return s && s.views.includes(view) ? { product: s.product, section: s.id, view } : null
}

/** Parse `#/<section>/<view>` (3.2 route form) or `#/<alias>`; unknown parts fall back to the section's first view. */
export function parseRoute(hash: string): Place | null {
  const m = hash.match(/#\/([a-z]+)(?:\/([a-z]+))?/)
  if (!m) return null
  const s = sectionById(m[1])
  if (!s) return m[2] ? null : resolveAlias(m[1])
  const view = m[2] && s.views.includes(m[2]) ? m[2] : s.views[0]
  return { product: s.product, section: s.id, view }
}
