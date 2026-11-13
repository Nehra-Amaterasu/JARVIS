// RackRow logic (spec 20.5.2): the rule that a unit is CONFIRMED only after the board has reported. A prop that says
// "confirmed" with no report time behind it is shown as unconfirmed ("sent, not acknowledged"): a switch the owner pressed
// is a command, not a fact, and the confirmed lamp is the one place where the room's truth shows.

import { sinceText, readingOf, type LampState } from '../../lamp'

export type RackState = 'unconfirmed' | 'confirmed' | 'fault' | 'planned'
export const RACK_STATES: readonly RackState[] = ['unconfirmed', 'confirmed', 'fault', 'planned']

/** A report newer than this makes the ASCII pulse appear (spec: "only if a report came in the last minute"). */
export const PULSE_WINDOW_MS = 60_000
export const PULSE = '▁▂▁'

export const isReportTime = (t: unknown): t is number => typeof t === 'number' && Number.isFinite(t) && t > 0

/** The state to draw: `confirmed` needs a report time; without one it falls back to unconfirmed. Everything else is as given. */
export function effectiveRackState(state: RackState, reportedAt: number | null | undefined): RackState {
  return state === 'confirmed' && !isReportTime(reportedAt) ? 'unconfirmed' : state
}

/** The lamp state that goes with a rack state, so the same shape means the same thing everywhere. */
export const RACK_LAMP: Record<RackState, LampState> = { unconfirmed: 'waiting', confirmed: 'live', fault: 'fault', planned: 'planned' }

export const RACK_WORD: Record<RackState, string> = {
  unconfirmed: 'sent, not acknowledged',
  confirmed: 'confirmed',
  fault: 'fault',
  planned: 'planned, not built',
}

/** True when the pulse may be drawn: the row is confirmed (or unconfirmed but heard from) and the report is under a minute old. */
export function showsPulse(state: RackState, reportedAt: number | null | undefined, now: number): boolean {
  if (state === 'planned' || state === 'fault') return false
  return isReportTime(reportedAt) && now - reportedAt >= 0 && now - reportedAt <= PULSE_WINDOW_MS
}

/** The last-seen text: the caller's own string, else the age of the report, else "never reported". */
export function lastSeenText(lastSeen: string | undefined, reportedAt: number | null | undefined, now: number): string {
  if (lastSeen) return lastSeen
  if (!isReportTime(reportedAt)) return 'never reported'
  return sinceText(readingOf({ state: 'live', since: reportedAt, reason: '' }), now)
}
