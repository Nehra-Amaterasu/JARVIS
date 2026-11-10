/**
 * The Crucible's rules, as pure functions the test can drive (plan 4.8, chunk 10).
 *
 * What changed against germoney/pages/Crucible.tsx, on purpose:
 *   - the wager is OPT-IN (off by default) and so are the guards; the old page took the wager at Start;
 *   - tracks come from the weekly rotation in the plan state, not a fixed list of five game tracks;
 *   - minutes go through the plan's one log writer (usePlan.log), so they reach Recent and the Floor
 *     ticks when the event comes back; the old page wrote only to the game ledger;
 *   - the copy is neutral: a session "ended", never "failed" or "lost".
 *
 * Kept from the old page, with its numbers: the 25-minute minimum, 20 s of a distraction in front, 5 minutes
 * of an empty room (only with the real sensor), a heartbeat every 15 s and a minute without one meaning the
 * window was closed, and 10 minutes as the least that counts when a session ends early.
 */
import type { RotationDay } from '../../germoney/game/plan'

export const LENGTHS = [25, 50, 75, 90] as const
export type Length = (typeof LENGTHS)[number]
export const DEFAULT_LENGTH: Length = 50
/** XP wagered and won per length. 25, 50 and 90 are the old page's numbers; 75 sits on the same line between 50 and 90. */
export const WAGER: Record<Length, number> = { 25: 10, 50: 20, 75: 30, 90: 40 }
export const WIN: Record<Length, number> = { 25: 40, 50: 80, 75: 110, 90: 140 }
export const STRIKE_S = 20
export const ROOM_EMPTY_S = 300
export const BEAT_MS = 15_000
export const STALE_BEAT_MS = 60_000
export const MIN_COUNTED_MIN = 10
export const STORAGE_KEY = '@ww_focus_active'

export interface Active {
  startedAt: number
  durationS: number
  lastBeat: number
  track: string
  trackLabel: string
  wager: boolean
  guards: boolean
  length: number
}

export interface TrackOption { id: string; label: string }

/** The tracks of the week's rotation, once each, in weekday order. */
export function tracksFromRotation(rotation: Record<string, RotationDay> | undefined | null): TrackOption[] {
  const out: TrackOption[] = []
  for (const k of Object.keys(rotation ?? {}).sort()) {
    const d = (rotation as Record<string, RotationDay>)[k]
    if (d?.track && !out.some((t) => t.id === d.track)) out.push({ id: d.track, label: d.label || d.track })
  }
  return out
}

/** Today's track: the rotation's entry for this ISO weekday (Monday = 1), else the first track. */
export function todaysTrack(rotation: Record<string, RotationDay> | undefined | null, now: Date): string | null {
  const iso = now.getDay() === 0 ? 7 : now.getDay()
  return rotation?.[String(iso)]?.track ?? tracksFromRotation(rotation)[0]?.id ?? null
}

export const elapsedS = (a: Active, now: number) => Math.max(0, Math.min(a.durationS, (now - a.startedAt) / 1000))
export const remainingS = (a: Active, now: number) => Math.max(0, a.durationS - (now - a.startedAt) / 1000)
export const heldMinutes = (a: Active, now: number) => elapsedS(a, now) / 60

export const fmt = (s: number) => {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const x = Math.floor(s % 60)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`
}

/**
 * A session found in storage when the page opens:
 *   running  time is left and the window was not closed (or the guards are off, so a gap proves nothing)
 *   done     the time ran out while the page was away
 *   ended    the guards were on and the window was closed for over a minute: the held minutes count, the wager does not
 */
export function resumeVerdict(a: Active, now: number): 'running' | 'done' | 'ended' {
  if (a.guards && now - a.lastBeat > STALE_BEAT_MS) return 'ended'
  return remainingS(a, now) <= 0 ? 'done' : 'running'
}

/** How a session that stopped early is worded: the minutes that count, in neutral words. */
export function endedLine(held: number, reason: string): { counted: number; text: string } {
  const counted = held >= MIN_COUNTED_MIN ? Math.round(held) : 0
  return {
    counted,
    text: counted > 0 ? `Session ended: ${reason} ${counted} min counted.` : `Session ended: ${reason} Under ${MIN_COUNTED_MIN} minutes, so nothing was logged.`,
  }
}

/** The wager cannot be taken with less XP than it asks, said before Start, not after. */
export const wagerShortfall = (xp: number, length: Length) => (xp < WAGER[length] ? `Wager needs ${WAGER[length]} XP; you have ${xp}. Turn the wager off or earn some first.` : null)
