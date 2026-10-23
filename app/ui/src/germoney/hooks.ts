/**
 * Mission Germoney hooks: loading the stores, the calibration answers, GitHub.
 *
 * Mission v2 removed the AI side quests (useDailyQuests) and the syllabus's live
 * intel (useLiveIntel): contracts come from the skill tree now, and the latest
 * papers are the plan's daily digest per active node (/api/mission/findings).
 */
import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import AsyncStorage, { GithubConfig } from './platform'
import { useChecklistStore } from './stores/checklist-store'
import { useFailureStore } from './stores/failure-store'
import { useLogStore } from './stores/log-store'
import { usePlayerStore } from './stores/player-store'
import { useProofStore } from './stores/proof-store'
import { useWorkoutStore } from './stores/workout-store'

export const ONBOARDING_KEY = '@silicon_onboarding_v1'

/** The five self-rated skills captured during calibration (0 = NONE … 3 = STRONG). */
export type SkillKey = 'digitalLogic' | 'verilog' | 'programming' | 'math' | 'german'
export type GoalPreset = 'tu9-vlsi' | 'iit-mtech' | 'industry' | 'custom'
export interface OnboardingGoal { preset: GoalPreset; label: string }
/** Persisted at '@silicon_onboarding_v1'. */
export interface OnboardingData {
  goal: OnboardingGoal
  skills: Record<SkillKey, number>
  targetYear: number
  weeklyHours: number
  completedAt: string
}

/** Load every store once; resolves true when all are hydrated. */
export function useMissionLoaded(): boolean {
  const player = usePlayerStore((s) => s.isLoaded)
  const checklist = useChecklistStore((s) => s.isLoaded)
  const log = useLogStore((s) => s.isLoaded)
  const failures = useFailureStore((s) => s.isLoaded)
  const proofs = useProofStore((s) => s.isLoaded)
  const workouts = useWorkoutStore((s) => s.isLoaded)
  useEffect(() => {
    void usePlayerStore.getState().hydrate()
    void useChecklistStore.getState().hydrate()
    void useLogStore.getState().hydrate()
    void useFailureStore.getState().hydrate()
    void useProofStore.getState().hydrate()
    void useWorkoutStore.getState().hydrate()
  }, [])
  return player && checklist && log && failures && proofs && workouts
}

export async function getOnboarding(): Promise<OnboardingData | null> {
  try {
    const raw = await AsyncStorage.getItem(ONBOARDING_KEY)
    return raw ? (JSON.parse(raw) as OnboardingData) : null
  } catch {
    return null
  }
}

export function useOnboarding(): [OnboardingData | null | undefined, () => void] {
  const [ob, setOb] = useState<OnboardingData | null | undefined>(undefined)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    void getOnboarding().then(setOb)
  }, [tick])
  return [ob, () => setTick((t) => t + 1)]
}

/* ------------------------------------------------------------------ GitHub */
export interface GithubSummary {
  user: string; source: string; total: number; lastContribution: string | null; currentStreak: number
  days: { date: string; count: number }[]
  repos: { name: string; description: string | null; language: string | null; stars: number; updatedAt: string; url: string; fork: boolean }[]
}

let ghCache: { user: string; at: number; data: GithubSummary } | null = null

export function useGithub() {
  const syncGithub = usePlayerStore((s) => s.syncGithub)
  const [user, setUser] = useState<string | null | undefined>(undefined)
  const [summary, setSummary] = useState<GithubSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async (u?: string | null) => {
    const who = u ?? (await GithubConfig.getUser())
    setUser(who)
    if (!who) return
    if (ghCache && ghCache.user === who && Date.now() - ghCache.at < 5 * 60_000) {
      setSummary(ghCache.data)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const s = await api<GithubSummary>(`/api/germoney/github?user=${encodeURIComponent(who)}`)
      ghCache = { user: who, at: Date.now(), data: s }
      setSummary(s)
      // Rule 1 reads REAL commit data once GitHub is linked (as on the phone).
      syncGithub(s.lastContribution, s.total)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [syncGithub])

  useEffect(() => { void refresh() }, [refresh])

  const link = async (u: string) => {
    await GithubConfig.setUser(u)
    ghCache = null
    await refresh(u)
  }
  return { user, summary, error, loading, refresh: () => { ghCache = null; void refresh() }, link }
}
