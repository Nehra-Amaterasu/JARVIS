// The pure side of the Body strip (package L03): the seven-day session strip, the recent sessions, the water drops and the next class.
// No React, no clock, no fetch. Nothing here counts a rest day against anyone: a day with no session is a quiet cell, and a rest day
// is simply not a session. No calorie, weight or body claim is made anywhere on this view.
import { addDays, parseYmd, ymd } from '../../../shared/almanac'

/** The part of a stored workout session this view reads (the Forge store's own shape, narrowed). */
export interface SessionLike { id: string; date: string; muscles: readonly string[]; entries: readonly { sets: number }[] }

/** The local calendar date of a stored timestamp, or null when it is not a date. */
export function dateOf(iso: string): string | null {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? ymd(new Date(t)) : null
}

export interface StripDay { iso: string; label: string; count: number }
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** The seven days ending today, oldest first, each with how many sessions were stored on it. */
export function sessionStrip(sessions: readonly SessionLike[], today: string): StripDay[] {
  return Array.from({ length: 7 }, (_, i) => {
    const iso = addDays(today, i - 6)
    return { iso, label: WD[(parseYmd(iso).getDay() + 6) % 7], count: sessions.filter((s) => dateOf(s.date) === iso).length }
  })
}

export interface Recent { id: string; date: string; muscles: string; sets: number }
/** The newest sessions first, as a row each: the day, the muscles named, the sets logged (0 when none were typed). */
export function recentSessions(sessions: readonly SessionLike[], n = 4): Recent[] {
  return sessions
    .map((s) => ({ s, d: dateOf(s.date) }))
    .filter((x): x is { s: SessionLike; d: string } => x.d !== null)
    .sort((a, b) => (a.s.date < b.s.date ? 1 : a.s.date > b.s.date ? -1 : 0))
    .slice(0, n)
    .map(({ s, d }) => ({ id: s.id, date: d, muscles: s.muscles.join(', ') || 'no muscles named', sets: s.entries.reduce((t, e) => t + (Number.isFinite(e.sets) ? e.sets : 0), 0) }))
}

/** The 28 days ending today as four rows of seven, oldest first: a rail of cells, a cell is quiet when no session was stored that day. */
export function monthRail(sessions: readonly SessionLike[], today: string): { rows: StripDay[][]; days: number } {
  const counts = new Map<string, number>()
  for (const s of sessions) { const d = dateOf(s.date); if (d) counts.set(d, (counts.get(d) ?? 0) + 1) }
  const all = Array.from({ length: 28 }, (_, i) => { const iso = addDays(today, i - 27); return { iso, label: WD[(parseYmd(iso).getDay() + 6) % 7], count: counts.get(iso) ?? 0 } })
  return { rows: [all.slice(0, 7), all.slice(7, 14), all.slice(14, 21), all.slice(21)], days: all.filter((d) => d.count > 0).length }
}

export const lastWeekCount = (strip: readonly StripDay[]): number => strip.reduce((s, d) => s + d.count, 0)

// ------------------------------------------------------------------------------------------------ water

export const DROPS = 8
export const GOAL_MIN = 1
export const GOAL_MAX = 8
export const DEFAULT_GOAL = 8

export const clampGoal = (n: number): number => Math.max(GOAL_MIN, Math.min(GOAL_MAX, Math.round(Number.isFinite(n) ? n : DEFAULT_GOAL)))

/** What a tap on drop `i` (0-based) does to the count: it fills up to that drop; a tap on the last filled drop removes one (so a count can fall). */
export function tapDrop(count: number, i: number): number {
  return i + 1 === count ? count - 1 : i + 1
}

/** The share of the goal reached, held to 0..1 for the arc. */
export const waterFrac = (count: number, goal: number): number => (goal > 0 ? Math.max(0, Math.min(1, count / goal)) : 0)

// ------------------------------------------------------------------------------------------------ classes

const mins = (t: string): number => { const m = /^(\d{1,2}):(\d{2})/.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN }

/** The next class that starts after `nowMin` (minutes since midnight) among today's, or null. A class already marked absent or cancelled is skipped. */
export function nextClass<T extends { start: string; status: 'present' | 'absent' | 'cancelled' | null }>(classes: readonly T[], nowMin: number): T | null {
  return [...classes]
    .filter((c) => c.status !== 'absent' && c.status !== 'cancelled' && mins(c.start) > nowMin)
    .sort((a, b) => mins(a.start) - mins(b.start))[0] ?? null
}

/** The time a reminder set `before` minutes ahead of a class would show, "HH:MM". */
export function remindAt(start: string, before: number): string {
  const t = mins(start) - before
  if (!Number.isFinite(t) || t < 0) return start
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}
