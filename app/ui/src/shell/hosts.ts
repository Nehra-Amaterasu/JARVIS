/**
 * What each frozen view shows inside the new canvas until its own section package lands (integrator's scope
 * decision 3: render the existing page for that area, or a planned plate, never fake content).
 *
 *   page     a legacy JARVIS tab id, rendered as it is today
 *   ww       the Well Wisher frame, switched to a workspace and its view (the frame's own strip is hidden)
 *   events   the event log the ticker used to show (Console / Events), from the same store
 *   planned  a registry entry homed in this view, shown as its planned plate
 *   none     nothing exists yet: an honest "not built" plate, no content
 *
 * `shared` marks a view that shows the same legacy page as a sibling view: the canvas says so in one line,
 * so switching to it never pretends a new page appeared.
 */
export type WsName = 'study' | 'tree' | 'life' | 'career' | 'focus'

export type Host =
  | { kind: 'page'; tab: string; shared?: boolean }
  | { kind: 'ww'; ws: WsName; view: string | null; tab: string; shared?: boolean }
  | { kind: 'events' }
  | { kind: 'planned'; entry: string }
  | { kind: 'none' }

export const HOSTS: Record<string, Host> = {
  'core.talk': { kind: 'page', tab: 'core' },
  'core.sound': { kind: 'page', tab: 'core', shared: true },
  'room.switches': { kind: 'page', tab: 'limbs' },
  'room.rules': { kind: 'page', tab: 'limbs', shared: true },
  'senses.presence': { kind: 'page', tab: 'aankhen' },
  'senses.signal': { kind: 'page', tab: 'aankhen', shared: true },
  'senses.teach': { kind: 'page', tab: 'aankhen', shared: true },
  'memory.recall': { kind: 'page', tab: 'yaadash' },
  'memory.beliefs': { kind: 'page', tab: 'yaadash', shared: true },
  'memory.people': { kind: 'page', tab: 'yaadash', shared: true },
  'memory.keep': { kind: 'page', tab: 'connect' },
  'console.health': { kind: 'page', tab: 'system' },
  'console.events': { kind: 'events' },
  'console.connections': { kind: 'page', tab: 'connect', shared: true },
  'console.hardware': { kind: 'page', tab: 'limbs', shared: true },
  'console.crew': { kind: 'planned', entry: 'jarvis.agents' },
  // Well Wisher: the frame's workspaces; `tab` is the legacy id whose destination opens that workspace (workspaces.ts)
  'day.today': { kind: 'ww', ws: 'life', view: 'today', tab: 'quests' },
  'day.week': { kind: 'ww', ws: 'life', view: 'week', tab: 'quests' },
  'day.body': { kind: 'ww', ws: 'life', view: 'week', tab: 'quests', shared: true },
  'day.close': { kind: 'none' },
  'focus.start': { kind: 'ww', ws: 'focus', view: 'crucible', tab: 'crucible' },
  'focus.session': { kind: 'ww', ws: 'focus', view: 'crucible', tab: 'crucible', shared: true },
  'focus.rest': { kind: 'none' },
  'study.papers': { kind: 'ww', ws: 'study', view: 'papers', tab: 'schedule' },
  'study.practice': { kind: 'ww', ws: 'focus', view: 'drill', tab: 'drill' },
  'study.plan': { kind: 'ww', ws: 'study', view: 'plan', tab: 'schedule' },
  'study.library': { kind: 'ww', ws: 'study', view: 'library', tab: 'schedule' },
  'study.dmat': { kind: 'ww', ws: 'study', view: 'dmat', tab: 'schedule' },
  'tree.tree': { kind: 'ww', ws: 'tree', view: null, tab: 'syllabus' },
  'career.pipeline': { kind: 'ww', ws: 'career', view: 'pipeline', tab: 'campaign' },
  'career.certs': { kind: 'ww', ws: 'career', view: 'certs', tab: 'campaign' },
  'career.abroad': { kind: 'ww', ws: 'career', view: 'abroad', tab: 'campaign' },
  'career.money': { kind: 'ww', ws: 'career', view: 'money', tab: 'campaign' },
  'career.ladder': { kind: 'ww', ws: 'career', view: 'plan', tab: 'campaign' },
}

/** The shell view id a frame (workspace, view) pair belongs to, so a jump inside Well Wisher (Tree's "Study this
 *  node") moves the rail with it. An exact non-shared match wins, then the workspace's first non-shared view. */
export function placeOfFrame(ws: string, view: string | null): string | null {
  const entries = Object.entries(HOSTS).filter(([, h]) => h.kind === 'ww' && h.ws === ws && !h.shared)
  const exact = entries.find(([, h]) => h.kind === 'ww' && h.view === view)
  return (exact ?? entries[0])?.[0] ?? null
}
