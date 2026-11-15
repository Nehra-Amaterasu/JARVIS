// The Console's live data, moved from pages/System.tsx, pages/Connect.tsx and pages/Limbs.tsx into hooks: the same routes
// (/api/settings/latency, /api/core/logs, /api/system, /api/crew, /api/connect, /api/board, /api/boards, /api/limbs), the
// same pollers (lib/format usePoll) and the same actions (lib/settings restartBrain and freeGpu, POST
// /api/crew/steward/run). Nothing is re-implemented and nothing is invented: a route that has not answered is null, and
// the views draw null as WAITING. Each hook returns plain data and plain functions, so the views take them as props.
import { useCallback, useMemo, useState } from 'react'
import { api, post, type Vitals } from '../../lib/api'
import type { BoardView } from '../../lib/board'
import type { BoardsView } from '../../lib/boards'
import type { CrewLoad } from '../../lib/crew'
import { useNow, usePoll } from '../../lib/format'
import type { LimbsView } from '../../lib/limbs'
import { chooseBrain, freeGpu, loadBrain, loadLatency, restartBrain, type BrainView, type LatencyView } from '../../lib/settings'
import { useStore } from '../../lib/store'
import { useCrew } from '../../components/Staff'
import type { FeedItem, Agent } from '../../lib/crew'
import type { JobSpec, Integration } from './model'

export interface LogLine { t: number; line: string }

export interface HealthLive {
  online: boolean | null
  lat: LatencyView | null
  crew: CrewLoad | null
  vitals: Vitals | null
  logs: LogLine[] | null
  board: BoardView | null
  /** Epoch seconds, once a second. */
  now: number
  coreBooting: boolean
  bootStep: string | null
  coreRunning: boolean
  jobs: JobSpec[]
  actions: HealthActions
}

export interface HealthActions {
  restartBrain: () => Promise<string>
  freeGpu: () => Promise<string>
  steward: () => Promise<string>
}

/** A job this view started: running (hollow, no fraction is reported for these routes), then done or FAULT with its reason. */
function useLocalJobs() {
  const [jobs, setJobs] = useState<JobSpec[]>([])
  const track = useCallback(async <T,>(id: string, label: string, fn: () => Promise<T>): Promise<T> => {
    const put = (j: JobSpec) => setJobs((l) => [j, ...l.filter((x) => x.id !== j.id)].slice(0, 3))
    put({ id, tag: 'SYS', label, state: 'hollow', reason: 'asked, waiting for the answer' })
    try {
      const r = await fn()
      put({ id, tag: 'SYS', label, state: 'done', fraction: 1, reason: 'finished' })
      return r
    } catch (e) {
      put({ id, tag: 'SYS', label, state: 'fault', reason: (e as Error).message || 'that did not work' })
      throw e
    }
  }, [])
  return { jobs, track }
}

export function useHealthLive(): HealthLive {
  const vitals = useStore((s) => s.vitals)
  const core = useStore((s) => s.core)
  const refresh = useStore((s) => s.refreshVitals)
  const now = useNow(1000) / 1000
  const [lat, latLoading, reloadLat] = usePoll(loadLatency, 2000)
  const crew = useCrew(4000, 8)
  const [logs] = usePoll(() => api<LogLine[]>('/api/core/logs?n=200'), 2500)
  const [board] = usePoll(() => api<BoardView>('/api/board'), 4000)
  const { jobs, track } = useLocalJobs()
  const online: boolean | null = lat || vitals ? true : latLoading ? null : false

  const actions = useMemo<HealthActions>(() => ({
    restartBrain: () => track('restart-brain', 'restart brain', async () => {
      const r = await restartBrain()
      reloadLat()
      void refresh()
      return `restarting JARVIS: ${r.brain}`
    }),
    freeGpu: () => track('free-gpu', 'free gpu', async () => {
      const r = await freeGpu()
      reloadLat()
      void refresh()
      return `freed ${r.freed_gb} GB: ${r.unloaded.join(', ') || 'nothing was loaded'}`
    }),
    steward: () => track('steward', 'steward check', async () => {
      await post('/api/crew/steward/run')
      reloadLat()
      return 'the steward checked everything'
    }),
  }), [track, reloadLat, refresh])

  return {
    online, lat, crew: crew.load, vitals, logs, board, now, jobs, actions,
    coreBooting: core?.state === 'booting', bootStep: core?.boot_step ?? null, coreRunning: !!core?.running,
  }
}

/* ------------------------------------------------------------------ events */
export function useEventsLive() {
  const events = useStore((s) => s.events)
  const online = useStore((s) => s.eventsOnline)
  const now = useNow(5000) / 1000
  return { events, online, now }
}

/* ------------------------------------------------------------------ connections */
export function useConnectionsLive() {
  const [items, loading] = usePoll(() => api<Integration[]>('/api/connect'), 15000)
  const [brain, , reloadBrain] = usePoll(loadBrain, 5000)
  const toast = useStore((s) => s.toast)
  const choose = useCallback(async (model: string) => {
    try {
      await chooseBrain(model)
      reloadBrain()
      toast('Brain chosen. It applies on the next restart.', 'info')
    } catch (e) {
      toast((e as Error).message || 'That did not work.', 'fault')
    }
  }, [reloadBrain, toast])
  const restart = useCallback(async () => {
    try {
      const r = await restartBrain()
      reloadBrain()
      toast(`Restarting JARVIS: ${r.brain}`, 'info')
    } catch (e) {
      toast((e as Error).message || 'That did not work.', 'fault')
    }
  }, [reloadBrain, toast])
  return { items: items as Integration[] | null, loading, brain: brain as BrainView | null, choose, restart }
}

/* ------------------------------------------------------------------ hardware */
export function useHardwareLive() {
  const [board, , reloadBoard] = usePoll(() => api<BoardView>('/api/board'), 2000)
  const [ports, , reloadPorts] = usePoll(() => api<BoardsView>('/api/boards'), 5000)
  const [limbs, , reloadLimbs] = usePoll(() => api<LimbsView>('/api/limbs'), 3000)
  const now = useNow(1000)
  return { board: board as BoardView | null, ports: ports as BoardsView | null, limbs: limbs as LimbsView | null, now, reloadBoard, reloadPorts, reloadLimbs }
}

/* ------------------------------------------------------------------ crew */
export interface CrewLive { load: CrewLoad | null; feed: FeedItem[]; agents: Agent[]; now: number; run: (id: string) => Promise<void> }

export function useCrewLive(): CrewLive {
  const crew = useCrew(2000, 12)
  const now = useNow(1000) / 1000
  const toast = useStore((s) => s.toast)
  const run = useCallback(async (id: string) => {
    try {
      await post(`/api/crew/${encodeURIComponent(id)}/run`)
      toast(`${id} ran its check.`, 'info')
    } catch (e) {
      toast((e as Error).message || 'That did not work.', 'fault')
    }
  }, [toast])
  return { load: crew.load, feed: crew.feed, agents: crew.agents, now, run }
}
