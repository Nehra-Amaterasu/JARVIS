/**
 * Season and evening on the desktop (plan 3.3 state rules). The SERVER computes them once
 * (jarvis_app/ww_season.py) and sends the same dict to this window (`season` on /api/mission/today) and
 * to the phone page, so the two can never disagree. This file only reads that dict and applies the
 * owner's pill (Auto / Exams / Normal), which the server does not know about.
 *
 * When the dict is missing (an older server, the plan not loaded yet) the answer is "normal, unknown"
 * and says so; it is never a guess presented as a measurement.
 */
import type { WsId } from './workspaces'

export type SeasonName = 'exams' | 'normal'
export type SeasonMode = 'auto' | SeasonName
export const SEASON_MODES: SeasonMode[] = ['auto', 'exams', 'normal']

export interface ServerSeason {
  season: SeasonName
  mode: SeasonMode
  window_days: number
  nearest_days: number | null
  evening: boolean
  evening_why: 'clock' | 'blocks_done' | null
  left_top: 'countdown' | 'horizon'
  opens: 'study' | 'life'
  due_soon_days: number
  findings_hidden: boolean
  now_card: 'now' | 'close_the_day'
}

export interface SeasonView extends ServerSeason {
  /** False when the server sent nothing: the values below are the quiet default, not a reading. */
  known: boolean
  firstWorkspace: WsId
}

const FALLBACK: ServerSeason = {
  season: 'normal', mode: 'auto', window_days: 45, nearest_days: null, evening: false, evening_why: null,
  left_top: 'horizon', opens: 'life', due_soon_days: 7, findings_hidden: false, now_card: 'now',
}

/** The pill's override, built from the same table the server uses (ww_season.py), so only the choice differs. */
export function resolveSeason(server: ServerSeason | null | undefined, mode: SeasonMode): SeasonView {
  const base = server ?? FALLBACK
  const season: SeasonName = mode === 'auto' ? base.season : mode
  const exams = season === 'exams'
  return {
    ...base,
    known: !!server,
    mode,
    season,
    left_top: exams ? 'countdown' : 'horizon',
    opens: exams ? 'study' : 'life',
    due_soon_days: exams ? 3 : 7,
    findings_hidden: exams,
    firstWorkspace: exams ? 'study' : 'life',
  }
}

const KEY = 'ww.season.mode'
export function readSeasonMode(): SeasonMode {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'exams' || v === 'normal' ? v : 'auto'
  } catch {
    return 'auto'
  }
}
export function writeSeasonMode(mode: SeasonMode): void {
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    /* blocked: the pill still works for this page */
  }
}

/** The one polite line announced when the season changes (never on first paint). */
export function seasonAnnouncement(v: SeasonView): string {
  return v.season === 'exams'
    ? 'Exam season: Countdown on the left, Study first.'
    : 'Normal season: Horizon on the left, Life first.'
}
