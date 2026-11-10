/**
 * What the Proof panel reads, and how. Five routes, each in its own slot: a route that fails costs its card
 * and nothing else (plan 5.5: a render or load failure inside one card costs that card, not the page).
 *
 *   /api/mission/status      rank, level, the six stats, quest lines, "not counted"   (wellwisher.py, existing)
 *   /api/mission/status/v2   4-week series, consistency, full rank list, suggestions, Recent, Wins, advice (ww_status.py)
 *   /api/mission/weekly      the weekly review                                         (ww_insight.py, existing)
 *   /api/mission/engine/sessions  building hours from real commits                     (ww_sessions.py, existing)
 *   /api/mission/engine/proof     GitHub activity                                      (ww_proof.py, existing)
 *
 * Nothing is computed here that a route could say; the helpers below only format.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'

export type SlotState = 'loading' | 'ok' | 'error'
export interface Slot<T> {
  state: SlotState
  data: T | null
  error: string | null
}
const empty = <T,>(): Slot<T> => ({ state: 'loading', data: null, error: null })

export interface Stat {
  id: string
  name: string
  value: number
  unit?: string
  explain: string
}
export interface Domain {
  id: string
  name: string
  status: 'on' | 'off' | 'planned'
  why?: string
  tracks?: { id: string; name: string; level: number; max_level: number; earned: number; level_name: string }[]
}
export interface StatusView {
  date: string
  rank: { rank: string }
  level: { level: number; into: number; need: number }
  xp: number
  stats: Stat[]
  not_counted: { xp_from_games: number; xp_carried_over: number; nodes_claimed: string[]; explain: string }
  domains: Domain[]
}

export interface SeriesWeek {
  start: string
  end: string
  days_logged: number
  mean: number | null
}
export interface Series {
  id: string
  name: string
  want: string
  weeks: SeriesWeek[]
  points: number[]
  weeks_with_data: number
  enough_for_line: boolean
}
export interface ConsistencyRow {
  id: string
  name: string
  logged: number
  asked: number
  hit: number
  ratio: number | null
  need: number
}
export interface Requirement {
  req: string
  name: string
  have: number
  need: number
  met: boolean
}
export interface Go {
  ws?: 'study' | 'tree' | 'life' | 'career' | 'focus' | 'setup'
  view?: string | null
  card?: string
  label: string
}
export interface Suggestion {
  id: string | null
  text: string
  go: Go | null
  basis: string
}
export interface AdviceLine {
  id: string
  text: string
  source: { author: string; work: string; year: number; kind: string }
  strength: string
  strength_note: string
  limit: string
}
export interface RecentDay {
  date: string
  count: number
  xp: number
  minutes: number
  rows: { kind: string; label: string; xp: number; minutes: number | null; link: boolean }[]
  more: number
  zero_xp: { count: number; minutes: number; kinds: string[] }
}
export interface Win {
  date: string
  kind: string
  what: string
  label: string
  link: boolean
  xp: number
}
export interface StatusV2 {
  date: string
  series: Series[]
  weeks_note: string
  consistency: { window_days: number; counters: ConsistencyRow[]; hit: number; asked: number; ratio: number | null; rule: string }
  rank: { rank: string; next: string | null; target: string; top: boolean; requirements: Requirement[]; met: number; of: number }
  suggestions: Suggestion[]
  recent: RecentDay[]
  wins: Win[]
  advice: AdviceLine[]
}
export interface Weekly {
  status: string
  week: { start: string; end: string }
  totals: string
  moved: string[]
  stalled: string[]
  change: { text: string }
  say: string
}
export interface Sessions {
  status: string
  say: string
  today_minutes: number
  week_minutes: number
  week_areas: Record<string, number>
  model: { explain: string }
}
export interface GithubProof {
  status: string
  configured: boolean
  say: string
  user?: string
  fetched?: string | null
  active_last_30?: number
  today_done?: boolean
  suggestion?: { kind: string; text: string }
  error?: string | null
}

export interface ProofData {
  status: Slot<StatusView>
  v2: Slot<StatusV2>
  weekly: Slot<Weekly>
  sessions: Slot<Sessions>
  github: Slot<GithubProof>
}

const ROUTES = {
  status: '/api/mission/status',
  v2: '/api/mission/status/v2',
  weekly: '/api/mission/weekly',
  sessions: '/api/mission/engine/sessions',
  github: '/api/mission/engine/proof',
} as const
type Key = keyof typeof ROUTES

const initial = (): ProofData => ({ status: empty(), v2: empty(), weekly: empty(), sessions: empty(), github: empty() })

/**
 * Loads all five on mount and again on `reload()`. A reload keeps the last good data while it runs (a card does
 * not flash back to a skeleton), and a late answer from an older call never overwrites a newer one.
 */
export function useProofData(): { data: ProofData; reload: (keys?: Key[]) => void } {
  const [data, setData] = useState<ProofData>(initial)
  const gen = useRef<Record<Key, number>>({ status: 0, v2: 0, weekly: 0, sessions: 0, github: 0 })
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const reload = useCallback((keys: Key[] = Object.keys(ROUTES) as Key[]) => {
    for (const k of keys) {
      const mine = ++gen.current[k]
      api(ROUTES[k])
        .then((d) => ({ state: 'ok', data: d, error: null }) as Slot<never>)
        .catch((e: unknown) => ({ state: 'error', data: null, error: (e as Error).message || 'The server did not answer.' }) as Slot<never>)
        .then((slot) => {
          if (!alive.current || gen.current[k] !== mine) return
          setData((prev) => ({ ...prev, [k]: slot.state === 'error' && prev[k].data ? { ...prev[k], state: 'error', error: slot.error } : slot }))
        })
    }
  }, [])
  useEffect(() => {
    reload()
  }, [reload])
  return { data, reload }
}

// ---------------------------------------------------------------- formatting only

/** "Mon 10 Nov" from an ISO date, in the local calendar (never through UTC, which can shift the day). */
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function minutesLabel(m: number): string {
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h} h ${r} min` : `${h} h`
}

/** The one next step a stat shows when it is 0. Words only; the buttons live where the work is. */
export const STAT_NEXT: Record<string, string> = {
  knowledge: 'finish one skill-tree contract',
  focus: 'log 15 minutes of work',
  consistency: 'do one logged action today',
  proof: 'add a link to one finished contract',
  recall: 'finish one practice contract',
  vitality: 'turn on a quest line and log one session',
}

/** "Author, Year. Work" with the kind, e.g. for a source line under an advice sentence. */
export function sourceLine(s: AdviceLine['source']): string {
  const year = s.year < 1000 ? `${s.year} CE` : String(s.year)
  return `${s.author}, ${year}. ${s.work} (${s.kind})`
}
