/**
 * The tab table (plan 3.2): six workspaces in one order, and where each of the 15 legacy Mission tab
 * ids lands. lib/store.ts is the owner-overhaul's file now, so this table lives here and the app's
 * `Tab` type is only imported, never edited.
 */
import type { Tab } from '../../lib/store'
import type { OverlayId } from './overlayRegistry'

export const WS_IDS = ['study', 'tree', 'life', 'career', 'focus', 'setup'] as const
export type WsId = (typeof WS_IDS)[number]

export interface WsDef {
  id: WsId
  label: string
  /** Alt+n */
  key: 1 | 2 | 3 | 4 | 5 | 6
  /** The legacy tab id that names this workspace (deep links, saved tab choices). */
  tab: Tab
}
export const WORKSPACES: readonly WsDef[] = [
  { id: 'study', label: 'Study', key: 1, tab: 'schedule' },
  { id: 'tree', label: 'Tree', key: 2, tab: 'syllabus' },
  { id: 'life', label: 'Life', key: 3, tab: 'quests' },
  { id: 'career', label: 'Career', key: 4, tab: 'campaign' },
  { id: 'focus', label: 'Focus', key: 5, tab: 'crucible' },
  { id: 'setup', label: 'Setup', key: 6, tab: 'calibration' },
]
export const wsLabel = (id: WsId) => WORKSPACES.find((w) => w.id === id)!.label

export interface Destination {
  /** 'default' is the season's first workspace (Study in exams, Life otherwise). */
  ws: WsId | 'default'
  view?: string
  /** Opens the Proof panel over the workspace. */
  panel?: 'proof'
  overlay?: OverlayId
  /** A card or section inside the workspace to scroll to once the pages are built. */
  anchor?: string
}

/** The 15 tab ids of the 'mission' group in lib/store.ts, and their destination (plan 3.2 table). */
export const LEGACY: Record<string, Destination> = {
  mission: { ws: 'default' },
  schedule: { ws: 'study', view: 'plan' },
  syllabus: { ws: 'tree' },
  quests: { ws: 'life' },
  campaign: { ws: 'career', view: 'pipeline' },
  trials: { ws: 'career', view: 'abroad' },
  armory: { ws: 'career', view: 'money' },
  status: { ws: 'default', panel: 'proof' },
  proof: { ws: 'default', panel: 'proof' },
  crucible: { ws: 'focus', view: 'crucible' },
  drill: { ws: 'focus', view: 'drill' },
  terminal: { ws: 'default', overlay: 'log' },
  forge: { ws: 'life', anchor: 'gym' },
  interrogation: { ws: 'study', view: 'library', anchor: 'explain-back' },
  calibration: { ws: 'setup', view: 'calibration' },
}
export const LEGACY_IDS = Object.keys(LEGACY)

export function isWsId(x: unknown): x is WsId {
  return WS_IDS.includes(x as WsId)
}

/** Where a legacy tab id opens, or null when the id is not a Well Wisher one. `first` is the season's first workspace. */
export function destinationOf(tab: string, first: WsId): (Destination & { ws: WsId }) | null {
  const d = LEGACY[tab]
  if (!d) return null
  return { ...d, ws: d.ws === 'default' ? first : d.ws }
}
