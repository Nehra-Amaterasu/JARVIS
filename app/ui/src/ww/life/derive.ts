// Life: the pure reading of server answers (plan 4.6). No React, no fetch, so the rules below are testable
// on fictional rows and shared by the workspace and by the left column's counter tiles.

export type ClassStatus = 'present' | 'absent' | 'cancelled'
export interface TodayClass { id: string; start: string; end: string | null; subject: string; name: string; kind: string; room: string; status: ClassStatus | null }
export interface SubjectRow { subject: string; name: string; held: number; attended: number; weekly: number; pct: number | null; can_miss: number; need: number; last: string | null }
export interface AttendanceAnswer {
  status: string; date: string; say: string; note?: string; risks: string[]
  rule: { threshold: number; scope: 'per_subject' | 'overall'; confirmed: boolean; note?: string }
  today: TodayClass[]; subjects: SubjectRow[]
  overall: { held: number; attended: number; pct: number | null; can_miss: number; need: number } | null
}

export interface Counter { id: string; name: string; want: 'less' | 'more' | 'yes'; today: number | null; line: number | null; on_line: boolean | null; last7: number[] }
export interface ItemRow { index: number; kind: string; text: string; minutes?: number; url?: string; explained?: string }
export interface Pending { queued_today: number; due: number; total: number }

/**
 * Fewer tapped classes than this and a percentage says nothing: 2 classes held and 1 attended is "50 %",
 * and a red word under it would punish a Monday. Below it a subject is shown as "n tapped so far" and
 * never as behind. 5 is an assumption (A): one daily lecture for a week, where one absence still moves the
 * figure by 20 points. It is a display rule only; the server's margin arithmetic is unchanged.
 */
export const MIN_SAMPLE = 5

export type MarginTone = 'none' | 'few' | 'ok' | 'tight' | 'behind'
export interface MarginView { tone: MarginTone; text: string; detail: string }

const classes = (n: number) => `${n} class${n === 1 ? '' : 'es'}`

/** What one subject's row says. "Behind" is a state with a name, never a verdict: no red, no "failing", no "skip". */
export function marginView(r: SubjectRow, threshold: number): MarginView {
  const t = `${Math.round(threshold * 100)}%`
  if (!r.held) return { tone: 'none', text: 'no class tapped yet', detail: '' }
  if (r.held < MIN_SAMPLE) return { tone: 'few', text: `${r.held} tapped so far`, detail: `too few to judge (${MIN_SAMPLE} needed)` }
  if (r.need) return { tone: 'behind', text: `behind by ${classes(r.need)}`, detail: `${r.need} in a row reaches ${t}` }
  if (r.can_miss <= 0) return { tone: 'tight', text: 'at the line', detail: `holding ${t}` }
  return { tone: 'ok', text: `margin ${classes(r.can_miss)}`, detail: `above ${t}` }
}

const URGENCY: Record<MarginTone, number> = { behind: 0, tight: 1, ok: 2, few: 3, none: 4 }
/**
 * The order the card lists subjects in: behind first (most classes needed first), then at the line, then the
 * rest by least margin. A subject with too few classes to judge goes last: nothing is known about it yet.
 * Stable, so equal rows keep the timetable's own order.
 */
export function byUrgency(rows: SubjectRow[], threshold: number): SubjectRow[] {
  const key = (r: SubjectRow) => {
    const m = marginView(r, threshold)
    return [URGENCY[m.tone], m.tone === 'behind' ? -r.need : m.tone === 'ok' ? r.can_miss : 0] as const
  }
  return rows
    .map((r, i) => ({ r, i, k: key(r) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.i - b.i)
    .map((x) => x.r)
}

export const percent =(x: number | null) => (x == null ? 'no figure yet' : `${Math.round(x * 100)}%`)

export interface ClassProgress { total: number; present: number; absent: number; cancelled: number; pending: number }
export function classProgress(today: TodayClass[] | undefined): ClassProgress {
  const list = today ?? []
  const n = (s: ClassStatus) => list.filter((c) => c.status === s).length
  return { total: list.length, present: n('present'), absent: n('absent'), cancelled: n('cancelled'), pending: list.filter((c) => c.status === null).length }
}

export type CollegeState = 'no-class' | 'pending' | 'went' | 'not-today'
/**
 * "Went to college", read from the class list and from nothing else. The old tile was a counter of its own
 * (a 0 you tapped by hand) and could sit at 0 beside three classes marked present (LIFE-06). Here:
 * one class marked present is a yes, whatever else happened; with none present it is "not yet" while a class
 * is still unmarked and "not today" only when every class is marked absent or cancelled; no classes = no tile value.
 */
export function wentToCollege(today: TodayClass[] | undefined): CollegeState {
  const p = classProgress(today)
  if (!p.total) return 'no-class'
  if (p.present) return 'went'
  return p.pending ? 'pending' : 'not-today'
}

export const COLLEGE_WORD: Record<CollegeState, string> = { 'no-class': 'No class today', pending: 'Not yet', went: 'Yes', 'not-today': 'Not today' }

export interface Tile { id: string; name: string; kind: 'count' | 'yes' | 'derived'; value: number | null; word: string; counter: Counter }
/** The left column's counter tiles. The college counter is derived from the class list (never tapped), the rest are the counters as the server has them. */
export function counterTiles(counters: Counter[], attendance: AttendanceAnswer | null | undefined): Tile[] {
  return counters.map((c) => {
    if (c.id === 'college' && attendance && attendance.status === 'ok') {
      const s = wentToCollege(attendance.today)
      return { id: c.id, name: c.name, kind: 'derived', value: s === 'went' ? 1 : s === 'no-class' ? null : 0, word: COLLEGE_WORD[s], counter: c }
    }
    if (c.want === 'yes') return { id: c.id, name: c.name, kind: 'yes', value: c.today, word: c.today ? 'Yes' : 'Not yet', counter: c }
    return { id: c.id, name: c.name, kind: 'count', value: c.today, word: c.today === null ? 'none yet' : String(c.today), counter: c }
  })
}

/** The cue under a reel: it is asked tomorrow, or it is waiting to be explained. A reel already explained has none. */
export function itemCue(it: { kind: string; explained?: string }): string | null {
  if (it.kind !== 'reel' || it.explained) return null
  return 'will ask tomorrow'
}

export function pendingWord(p: Pending): string {
  if (!p.total) return ''
  const reels = `${p.total} reel${p.total === 1 ? '' : 's'}`
  if (p.due) return `${reels} pending, ${p.due} ready to explain`
  return `${reels} pending, asked tomorrow`
}

export interface QuestDraft { sets: string[]; proof: string }
/** The Log session button takes the fill once any set value or a proof link is typed (plan 3.3). */
export const questTyped = (d: QuestDraft) => d.sets.some((s) => s.trim() !== '') || d.proof.trim() !== ''
/** The numbers actually typed, in order; blanks are skipped, never counted as 0. */
export const questSets = (d: QuestDraft) => d.sets.filter((s) => s.trim() !== '').map(Number).filter((n) => Number.isFinite(n))
