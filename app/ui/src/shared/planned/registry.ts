// The registry mechanism (spec 12.2): pure functions, no React, so both products and the tests share it.
import { isKnownHome } from './homes'
import type { PlannedEntry, Registry } from './types'

export const LINE_MIN = 15
export const LINE_MAX = 140
export const WORKS_TODAY_MIN = 15
export const WORKS_TODAY_MAX = 100

/**
 * A registry over a live array. `byId` and `forHome` read the array at call time, because the pre-overhaul
 * test pushes a synthetic entry into the exported list and expects every lookup to see it.
 */
export function createRegistry<E extends PlannedEntry>(entries: readonly E[]): Registry<E> {
  return {
    entries,
    byId: (id) => entries.find((e) => e.id === id),
    forHome: (home) => entries.filter((e) => e.home === home),
  }
}

/**
 * Replace each stand-alone `N` in a line with the next live value. With no values the N stays: a placeholder
 * never invents a count. Extra values are ignored.
 */
export function fillLine(line: string, values?: readonly (string | number)[]): string {
  if (!values || values.length === 0) return line
  let i = 0
  return line.replace(/\bN\b/g, (m) => (i < values.length ? String(values[i++]) : m))
}

/**
 * Words that make a placeholder read as live or as a hook (spec 12.4 "Never on a planned item", N1 and N3).
 * `new` is matched as a word so "renewal" and "knew" pass.
 */
const BANNED = /\b(soon|beta|new|unlock|miss|coming soon|notify|waitlist)\b/i
/** Tokens whose digits are a name, not a count: GATE and CIE are exam names, "4-week" is a unit of the status line. */
const NAMED_DIGITS = /\b4-week\b/g
const MONTH = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*'
// ISO date, "November 12" and "12 November": the three shapes a date takes in a line.
const DATE_LIKE = new RegExp(`\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b${MONTH}\\s+\\d{1,2}\\b|\\b\\d{1,2}\\s+${MONTH}\\b`, 'i')
const ISO = /^\d{4}-\d{2}-\d{2}$/

/**
 * T5 and T10 for one entry. Returns the problems found, empty when clean. The duplicate-position check
 * (two entries with the same home, slot and label) needs the whole list and lives in `lintRegistry`.
 */
export function lintEntry(e: PlannedEntry): string[] {
  const out: string[] = []
  const at = e.id
  if (e.line.length < LINE_MIN || e.line.length > LINE_MAX) out.push(`${at}: line is ${e.line.length} characters, want ${LINE_MIN} to ${LINE_MAX}`)
  if (e.works_today !== undefined && (e.works_today.length < WORKS_TODAY_MIN || e.works_today.length > WORKS_TODAY_MAX)) {
    out.push(`${at}: works_today is ${e.works_today.length} characters, want ${WORKS_TODAY_MIN} to ${WORKS_TODAY_MAX}`)
  }
  for (const [field, text] of [['line', e.line], ['works_today', e.works_today ?? '']] as const) {
    const bare = text.replace(NAMED_DIGITS, '').replace(/\b(GATE|CIE)\b/g, '')
    if (/\d/.test(bare)) out.push(`${at}: ${field} holds a digit (a count reads as measured)`)
    if (DATE_LIKE.test(text)) out.push(`${at}: ${field} holds a date`)
    const hit = BANNED.exec(text)
    if (hit) out.push(`${at}: ${field} uses the banned word "${hit[0]}"`)
  }
  if (e.needs.trim().length === 0) out.push(`${at}: needs is empty`)
  if (e.action !== undefined && e.pattern !== 'empty') out.push(`${at}: action only belongs on an empty entry`)
  if (!isKnownHome(e.home)) out.push(`${at}: home "${e.home}" is not in the frozen view table`)
  if (!ISO.test(e.since) || !ISO.test(e.reviewBy)) out.push(`${at}: since or reviewBy is not YYYY-MM-DD`)
  else if (e.reviewBy < e.since) out.push(`${at}: reviewBy is earlier than since`)
  return out
}

/** Every per-entry problem plus the duplicate-position and duplicate-id checks (T5). */
export function lintRegistry(reg: Registry): string[] {
  const out = reg.entries.flatMap(lintEntry)
  const seenId = new Set<string>()
  const seenPos = new Set<string>()
  for (const e of reg.entries) {
    if (seenId.has(e.id)) out.push(`${e.id}: duplicate id`)
    seenId.add(e.id)
    const pos = `${e.home}|${e.slot ?? ''}|${e.label}`
    if (seenPos.has(pos)) out.push(`${e.id}: same home, slot and label as another entry`)
    seenPos.add(pos)
  }
  return out
}

/** T6: a registry holds only its own product's entries, and an id from the other product's namespace is a leak. */
export function productLeaks(reg: Registry, product: PlannedEntry['product']): string[] {
  const other = product === 'ww' ? 'jarvis' : 'ww'
  return reg.entries
    .filter((e) => e.product !== product || e.id.startsWith(`${other}.`))
    .map((e) => e.id)
}

/**
 * Entries whose `reviewBy` is on or before `today`: the gate-report line "entries past review". Never an
 * assertion in a unit test, because a test that fails on the calendar breaks unrelated work.
 */
export function pastReview(reg: Registry, today: string): PlannedEntry[] {
  return reg.entries.filter((e) => e.reviewBy <= today)
}

/** Overlay and chip order: build first, account last (the order the owner can act on them). */
export const BLOCKER_ORDER: readonly PlannedEntry['blocker'][] = ['build', 'data', 'hardware', 'decision', 'licence', 'account']

/** The words the overlay prints for each blocker ("who decides"). */
export const BLOCKER_WORDS: Record<PlannedEntry['blocker'], string> = {
  build: 'Waiting to be built',
  data: 'Waiting for data',
  hardware: 'Waiting for hardware',
  decision: 'Waiting for your decision',
  licence: 'Waiting on a licence',
  account: 'Waiting on an account',
}

/** The section of an entry: the first part of its home ('study.library' is in 'study', 'phone' in 'phone'). */
export const sectionOf = (e: PlannedEntry): string => e.home.split('.')[0]

/** Entries a person may be told are "coming": an entry that is built and only holds a blocked-state line is not. */
export function listable(registries: readonly Registry[]): PlannedEntry[] {
  return registries.flatMap((r) => r.entries).filter((e) => !e.built)
}
