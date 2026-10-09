/**
 * Mission Germoney hooks — the phone app's hooks, rewired to the JARVIS server.
 *
 * AI is the LOCAL model now (Qwen3-4B via Ollama, through /api/germoney/ai). When it
 * can't produce valid output the deterministic engine takes over, exactly as the
 * phone app fell back when Gemini failed — and the UI labels which one you got
 * (amber "AI · local" = inferred; plain = the engine's fixed pool).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, post } from '../lib/api'
import AsyncStorage, { GithubConfig } from './platform'
import { useChecklistStore } from './stores/checklist-store'
import { useFailureStore } from './stores/failure-store'
import { useLogStore } from './stores/log-store'
import { LEVELS, dateKey, usePlayerStore, type PlayerData } from './stores/player-store'
import { useProofStore } from './stores/proof-store'
import { useWorkoutStore } from './stores/workout-store'
import { generateDailyQuests, type OnboardingData } from './utils/quest-engine'

export const ONBOARDING_KEY = '@silicon_onboarding_v1'

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

/* ------------------------------------------------------------------ daily quests */
export interface DisplayQuest { id: string; title: string; desc: string; reward: string }

const SKILL_LABELS: Record<string, string> = {
  digitalLogic: 'Digital Logic', verilog: 'Verilog/HDL', programming: 'Programming', math: 'Math/GATE', german: 'German',
}

function weakestSkills(ob: OnboardingData | null): string[] {
  if (!ob) return []
  return Object.entries(ob.skills).sort((a, b) => a[1] - b[1]).slice(0, 2).map(([k]) => SKILL_LABELS[k] ?? k)
}

function deterministic(player: PlayerData, ob: OnboardingData | null): DisplayQuest[] {
  const today = dateKey()
  return generateDailyQuests(player, ob, new Date()).map((q) => ({
    id: `det_${today}_${q.id}`, title: q.title, desc: q.description, reward: `+${q.xp} XP`,
  }))
}

export function useDailyQuests() {
  const player = usePlayerStore((s) => s.player)
  const [ob, setOb] = useState<OnboardingData | null>(null)
  const [ai, setAi] = useState<DisplayQuest[] | null>(null)
  const [state, setState] = useState<'engine' | 'ai' | 'loading'>('engine')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void getOnboarding().then(setOb) }, [])
  const fallback = useMemo(() => deterministic(player, ob), [player.level, ob]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async (force = false) => {
    const today = dateKey()
    const cacheKey = `@silicon_ai_quests_${today}_L${player.level}`
    if (!force) {
      const cached = await AsyncStorage.getItem(cacheKey)
      if (cached) {
        setAi(JSON.parse(cached))
        setState('ai')
        return
      }
    }
    setState('loading')
    setError(null)
    try {
      const o = await getOnboarding()
      const info = LEVELS.find((l) => l.level === player.level) ?? LEVELS[0]
      const r = await post<{ quests: { title: string; description: string; xp: number }[] }>('/api/germoney/ai/quests', {
        level: player.level, rank: info.rank, phase: info.phase, weakestSkills: weakestSkills(o), weeklyHours: o?.weeklyHours ?? 20,
      })
      const mapped = r.quests.map((q, i) => ({ id: `ai_${today}_L${player.level}_${i}`, title: q.title, desc: q.description, reward: `+${q.xp} XP` }))
      await AsyncStorage.setItem(cacheKey, JSON.stringify(mapped))
      setAi(mapped)
      setState('ai')
    } catch (e) {
      setError((e as Error).message)
      setState('engine')
    }
  }, [player.level])

  useEffect(() => {
    // Only reuse a cached AI set automatically; generating one is the user's call
    // (it loads the LLM into VRAM).
    void (async () => {
      const cached = await AsyncStorage.getItem(`@silicon_ai_quests_${dateKey()}_L${player.level}`)
      if (cached) { setAi(JSON.parse(cached)); setState('ai') }
    })()
  }, [player.level])

  return { quests: state === 'ai' && ai ? ai : fallback, source: state, error, generate: () => load(true), useEngine: () => { setAi(null); setState('engine') } }
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
      // Rule 1 runs on REAL commit data once GitHub is linked (as on the phone).
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

/* ------------------------------------------------------------------ live intel */
export interface ArxivPaper { id: string; title: string; summary: string; published: string; authors: string[]; url: string }
export interface IntelItem { title: string; why: string; searchQuery: string; type: 'paper' | 'video' | 'article' | 'tool' }

/** Topic tracks the rank: what's worth reading changes as the operative levels up. */
export function topicForLevel(level: number): string {
  if (level <= 1) return 'digital logic design fundamentals'
  if (level <= 3) return 'RTL design Verilog finite state machines'
  if (level <= 5) return 'SystemVerilog verification UVM coverage'
  if (level <= 7) return 'RISC-V processor microarchitecture pipeline'
  return 'VLSI physical design low power CMOS'
}

export function useLiveIntel() {
  const level = usePlayerStore((s) => s.player.level)
  const topic = topicForLevel(level)
  const [papers, setPapers] = useState<ArxivPaper[] | null>(null)
  const [items, setItems] = useState<IntelItem[] | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const loadPapers = useCallback(async () => {
    setState('loading')
    try {
      setPapers(await api<ArxivPaper[]>(`/api/germoney/arxiv?q=${encodeURIComponent(topic)}&max=6`))
      setState('idle')
    } catch (e) {
      setError((e as Error).message)
      setState('error')
    }
  }, [topic])

  const curate = useCallback(async () => {
    setState('loading')
    try {
      const info = LEVELS.find((l) => l.level === level) ?? LEVELS[0]
      const r = await post<{ items: IntelItem[] }>('/api/germoney/ai/curation', { rank: info.rank, topic })
      setItems(r.items)
      setState('idle')
    } catch (e) {
      setError((e as Error).message)
      setState('error')
    }
  }, [level, topic])

  useEffect(() => { void loadPapers() }, [loadPapers])
  return { topic, papers, items, state, error, loadPapers, curate }
}
