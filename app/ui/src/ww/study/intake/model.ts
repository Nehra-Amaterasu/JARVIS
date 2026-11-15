// Pure helpers of the intake desk (package C03): dates in words, the three groups of the ledger, the page, the batch rule,
// the older fold, the provenance sentence and the ladder. No React, no port, so a test can try every case.
import { LADDER, type IntakeRow, type IntakeSource, type LadderStage } from './types'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_MS = 86_400_000

/** Rows per page of the ledger: seven 44 px rows, three 28 px headers, the 44 px foot and the card's padding are 492 px of the 664 px canvas, so nothing scrolls. */
export const PER_PAGE = 7
/** A NEW row left alone this long folds into one line. Never deleted. */
export const OLDER_DAYS = 14

const parts = (day: string): [number, number, number] => {
  const [y, m, d] = day.split('-').map(Number)
  return [y, m, d]
}
/** Days since the epoch of a "YYYY-MM-DD" day, in UTC arithmetic so a time zone never shifts a date. */
export const dayNumber = (day: string): number => { const [y, m, d] = parts(day); return Math.round(Date.UTC(y, m - 1, d) / DAY_MS) }
/** The local calendar day of an epoch ms. */
export function localDay(ms: number): string {
  const t = new Date(ms)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

/** "Tue 18 Nov, 17:00"; a date without a time is just the date; the year appears only when it is not this year. */
export function dueWords(date: string | null, time: string | null, now: number): string {
  if (!date) return 'no date'
  const [y, m, d] = parts(date)
  const dow = DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  const year = y === new Date(now).getFullYear() ? '' : ` ${y}`
  return `${dow} ${d} ${MON[m - 1]}${year}${time ? `, ${time}` : ''}`
}

/** A reading of an ambiguous date, short: "3 Dec" or "12 Mar 2027". */
export function readingWords(date: string, now: number): string {
  const [y, m, d] = parts(date)
  return `${d} ${MON[m - 1]}${y === new Date(now).getFullYear() ? '' : ` ${y}`}`
}

export type GroupKey = 'earlier' | 'week' | 'later' | 'none'
export const GROUP_LABEL: Record<GroupKey, string> = { earlier: 'Earlier', week: 'This week', later: 'Later', none: 'No date' }
const GROUP_ORDER: GroupKey[] = ['earlier', 'week', 'later', 'none']

export function groupOf(row: IntakeRow, now: number): GroupKey {
  if (!row.date) return 'none'
  const diff = dayNumber(row.date) - dayNumber(localDay(now))
  return diff < 0 ? 'earlier' : diff < 7 ? 'week' : 'later'
}

/** Sort by date then time, rows with no date last, then by when they were added (newest first). */
export function byDue(a: IntakeRow, b: IntakeRow): number {
  if (!!a.date !== !!b.date) return a.date ? -1 : 1
  if (a.date && b.date && a.date !== b.date) return dayNumber(a.date) - dayNumber(b.date)
  if ((a.time ?? '') !== (b.time ?? '')) return (a.time ?? '99:99') < (b.time ?? '99:99') ? -1 : 1
  return b.added - a.added
}

export interface LedgerPage {
  /** Headers with the rows of this page under them; a group split across pages shows its whole count on each. */
  groups: { key: GroupKey; label: string; total: number; rows: IntakeRow[] }[]
  page: number
  pages: number
}

export function pageOf(rows: readonly IntakeRow[], page: number, now: number, per = PER_PAGE): LedgerPage {
  const sorted = [...rows].sort(byDue)
  const pages = Math.max(1, Math.ceil(sorted.length / per))
  const at = Math.min(Math.max(0, page), pages - 1)
  const totals = new Map<GroupKey, number>()
  for (const r of sorted) totals.set(groupOf(r, now), (totals.get(groupOf(r, now)) ?? 0) + 1)
  const slice = sorted.slice(at * per, at * per + per)
  const groups = GROUP_ORDER.flatMap((key) => {
    const inGroup = slice.filter((r) => groupOf(r, now) === key)
    return inGroup.length ? [{ key, label: GROUP_LABEL[key], total: totals.get(key) ?? 0, rows: inGroup }] : []
  })
  return { groups, page: at, pages }
}

/** The order the keyboard walks and the pager pages: the sorted rows. */
export const walkOrder = (rows: readonly IntakeRow[]): IntakeRow[] => [...rows].sort(byDue)

export const isOlder = (r: IntakeRow, now: number): boolean => r.state === 'new' && now - r.added > OLDER_DAYS * DAY_MS

/** The one batch the desk offers: rows that are still NEW, are dated without doubt and already have a confirmed subject. */
export const batchEligible = (r: IntakeRow): boolean => r.state === 'new' && r.kind !== 'file' && !!r.date && !r.ambiguous && r.subject !== ''

export interface Draft { date?: string; subject?: string }
/** Can this row be accepted now? A file row is taken, not accepted; an ambiguous date needs a choice first. */
export const canAccept = (r: IntakeRow, d: Draft): boolean => r.kind !== 'file' && (!r.ambiguous || !!r.date || !!d.date)

export const SOURCE_WORD: Record<IntakeSource, string> = { paste: 'Pasted', ics: 'Calendar file', folder: 'Folder', archive: 'Archive', classroom: 'Classroom' }
const SOURCE_FROM: Record<IntakeSource, string> = {
  paste: 'a pasted line', ics: 'a calendar file', folder: 'a file in your watched folder', archive: 'a file inside a Classroom export you made', classroom: 'Classroom',
}

/** Where an item came from, in one sentence: the door, the original line or file when the store kept it, and when. */
export function provenanceLine(r: IntakeRow, now: number): string {
  const when = new Date(r.added)
  const day = localDay(r.added) === localDay(now) ? 'today' : `${when.getDate()} ${MON[when.getMonth()]}`
  const hhmm = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`
  const what = r.raw ? ` “${r.raw}”` : r.file ? ` “${r.file.name}”` : ''
  return `Read from ${SOURCE_FROM[r.source]}${what}, ${day} at ${hhmm}.`
}

export type RungState = 'done' | 'next' | 'later' | 'skipped'
/** The five rungs of a file's ladder and where each stands. A file he saved himself never went through LINKED and ASKED. */
export function ladderOf(r: IntakeRow): { stage: LadderStage; state: RungState }[] {
  const reached: LadderStage | null = r.ladder ?? (r.state === 'taken' ? 'ingested' : r.file ? 'downloaded' : null)
  const at = reached ? LADDER.indexOf(reached) : -1
  const own = r.source !== 'classroom'
  return LADDER.map((stage, i): { stage: LadderStage; state: RungState } => {
    if (own && (stage === 'linked' || stage === 'asked')) return { stage, state: 'skipped' }
    if (i <= at) return { stage, state: 'done' }
    return { stage, state: i === at + 1 ? 'next' : 'later' }
  })
}
export const RUNG_WORD: Record<LadderStage, string> = { linked: 'Linked', asked: 'Asked', downloaded: 'Downloaded', matched: 'Matched', ingested: 'Read' }

export const sizeWords = (n: number): string => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
