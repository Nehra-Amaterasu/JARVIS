// The frozen view-id table of spec 3.2, as data, so T4 ("home exists") can check an entry against it.
// Order follows the spec table (rail order, then view-switch order). A change here is a spec change: day.month and
// focus.drill were added by direction v2 (wave 5; N02 registers the views, G01 gives them a home here).

export const VIEW_IDS: readonly string[] = [
  'core.talk', 'core.sound',
  'room.switches', 'room.rules',
  'senses.presence', 'senses.signal', 'senses.teach',
  'memory.recall', 'memory.beliefs', 'memory.people', 'memory.keep',
  'console.health', 'console.events', 'console.connections', 'console.hardware', 'console.crew',
  'day.today', 'day.week', 'day.month', 'day.body', 'day.close',
  'focus.start', 'focus.session', 'focus.drill', 'focus.rest',
  'study.papers', 'study.practice', 'study.plan', 'study.library', 'study.dmat',
  'tree.tree',
  'career.pipeline', 'career.certs', 'career.abroad', 'career.money', 'career.ladder',
  'proof.rail', 'proof.panel',
]

/** The Settings sheet: three new views, then the 18 existing Setup section ids unchanged (the anchors in ww/setup). */
export const SETTINGS_FIXED: readonly string[] = ['settings.appearance', 'settings.quiet', 'settings.data']

/** The phone page is a home of its own (spec 4.6): it is not a section of the desktop shell. */
export const PHONE_HOME = 'phone'

/** The views that run a loop. They carry no plate or chip at all (rule R5, T8). */
export const LOOP_VIEWS: readonly string[] = ['day.today', 'focus.session', 'core.talk', 'room.switches']

/**
 * Is `home` a place a planned item may live? `settings.<id>` is accepted for any non-empty id because the
 * existing Setup section ids belong to the Well Wisher chat and may gain members; the shape is what is frozen.
 */
export function isKnownHome(home: string): boolean {
  if (home === PHONE_HOME) return true
  if (VIEW_IDS.includes(home)) return true
  return /^settings\.[a-z0-9][a-z0-9-]*$/.test(home)
}
