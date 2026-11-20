// The pure side of the Close view (package L03): when to say "Pick up here.", the last three logged days, and the three-row plan for tomorrow.
// No React, no clock, no fetch. The wording is neutral by construction: there is no count of days away, nothing is zeroed, nothing is
// compared and nothing says what was not done.
import { addDays, parseYmd } from '../../../shared/almanac'

/** Whole days between two local dates. */
export const daysBetween = (a: string, b: string): number => Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 86_400_000)

/** A return is the first opening after two or more days without one; the same day, or the next, is not a return. */
export const RETURN_AFTER = 2

export function isReturn(lastSeen: string | null, today: string): boolean {
  return !!lastSeen && /^\d{4}-\d{2}-\d{2}$/.test(lastSeen) && daysBetween(lastSeen, today) >= RETURN_AFTER
}

export interface LoggedDay { date: string; minutes: number }

/** The newest `n` days up to today that hold a logged study block, newest first. Days with nothing logged are not listed and nothing is said about them. */
export function lastLogged(minutes: Readonly<Record<string, number>>, today: string, n = 3): LoggedDay[] {
  return Object.entries(minutes)
    .filter(([d, m]) => d <= today && m > 0 && /^\d{4}-\d{2}-\d{2}$/.test(d))
    .map(([date, m]) => ({ date, minutes: m }))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, n)
}

export const tomorrowOf = (today: string): string => addDays(today, 1)

export interface PlanRow { cue: string; step: string; minutes: number | null }
export const PLAN_ROWS = 3

/** A row is worth saving when it has a step; the cue is optional ("When <cue>, I will <step> for <n> min"). Minutes are read loosely and held to 1..600. */
export function planRows(drafts: readonly { cue: string; step: string; minutes: string }[]): PlanRow[] {
  return drafts
    .slice(0, PLAN_ROWS)
    .filter((d) => d.step.trim() !== '')
    .map((d) => {
      const n = Number(d.minutes.replace(/[^\d]/g, ''))
      return { cue: d.cue.trim(), step: d.step.trim(), minutes: n >= 1 && n <= 600 ? n : null }
    })
}

/** The row as the sentence it stands for. */
export const planSentence = (r: PlanRow): string => `When ${r.cue || 'the time comes'}, I will ${r.step}${r.minutes ? ` for ${r.minutes} min` : ''}.`
