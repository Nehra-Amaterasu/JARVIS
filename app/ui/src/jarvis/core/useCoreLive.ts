// The Core view's live data: what lib/store already holds (core, turns, vitals, lamp readings, read only), the voice
// frames and stage timings from the view's own bus socket (busFeed.ts), and the 7-day medians from the latency route.
//
// Timers, all bounded: none at idle. The 1 s tick runs only while a pipeline stage is running (the node's elapsed
// text, spec 20.9.1), and the medians are fetched once on mount and again only when a new reply has finished.
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, post, type CoreInfo, type Turn, type Vitals } from '../../lib/api'
import { useStore } from '../../lib/store'
import type { LampReading } from '../../shared/lamp'
import { attachVoiceFeed, voiceSignal, type CoreView, type VoiceSignal } from '../voice'
import { coreBus } from './busFeed'
import {
  TICK_MS, coreViewOf, organReadings, ribbonStages, runningStage, stageMedians, stageSeconds, trackSince,
  type Organ, type RibbonStage, type StageId, type StageMedian,
} from './model'

export type Verdict = 'good' | 'wrong' | 'slow' | 'misheard'

export interface CoreActions {
  wake: (mode: 'voice' | 'text') => Promise<void>
  sleep: () => Promise<void>
  say: (text: string) => Promise<void>
  flag: (turn: Turn, verdict: Verdict, expected?: string, question?: string, teach?: boolean) => Promise<string>
}

export interface CoreLive {
  core: CoreInfo | null
  coreView: CoreView
  turns: Turn[]
  organs: Organ[]
  stages: RibbonStage[]
  medians: Record<StageId, StageMedian>
  last: Record<StageId, number | null>
  signal: VoiceSignal
  vitals: Vitals | null
  now: number
  actions: CoreActions
}

const NO_MEDIANS: Record<StageId, StageMedian> = { hear: { value: null, n: 0 }, write: { value: null, n: 0 }, think: { value: null, n: 0 }, say: { value: null, n: 0 } }

interface LatencyView { recent?: Record<string, unknown>[] }

export function useCoreLive(): CoreLive {
  const core = useStore((s) => s.core)
  const turns = useStore((s) => s.turns)
  const vitals = useStore((s) => s.vitals)
  const readings = useStore((s) => s.readings) as Record<string, LampReading>
  const refreshCore = useStore((s) => s.refreshCore)
  const toast = useStore((s) => s.toast)

  // ---- the state word's start time (the store keeps only the word)
  const since = useRef<{ state: string; since: number } | null>(null)
  const word = core?.running ? core.state : 'off'
  since.current = trackSince(since.current, word, Date.now())
  const stateSince = core?.running ? since.current.since : null

  // ---- the bus: voice frames into the shared signal, stage timings into `live`
  const [live, setLive] = useState<Record<string, number>>({})
  useEffect(() => {
    const detach = attachVoiceFeed(voiceSignal, (handler) => coreBus.subscribe(handler))
    const off = coreBus.subscribe((ev) => {
      if (ev.kind !== 'timing' || typeof ev.stage !== 'string' || typeof ev.seconds !== 'number') return
      const stage = ev.stage
      const seconds = ev.seconds
      setLive((p) => (p[stage] === seconds ? p : { ...p, [stage]: seconds }))
    })
    void refreshCore()
    return () => {
      detach()
      off()
    }
  }, [refreshCore])

  // ---- medians: once now, then once per finished reply (never on a timer)
  const replies = turns.filter((t) => t.role === 'jarvis' && t.done).length
  const [medians, setMedians] = useState<Record<StageId, StageMedian>>(NO_MEDIANS)
  useEffect(() => {
    let alive = true
    api<LatencyView>('/api/settings/latency').then(
      (v) => { if (alive) setMedians(stageMedians(v.recent ?? [])) },
      () => { if (alive) setMedians(NO_MEDIANS) },
    )
    return () => { alive = false }
  }, [replies])

  // ---- the 1 s tick, only while a stage runs
  const running = runningStage(core)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setTick((n) => n + 1), TICK_MS)
    return () => clearInterval(id)
  }, [running])

  // a running core's stage timings are this run's; with the core off the last turn's are not shown as current
  const timings = useMemo(() => ({ ...(core?.timings ?? {}), ...live }), [core?.timings, live])
  const last = useMemo(() => stageSeconds(core?.running ? timings : null), [core?.running, timings])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [core, vitals, readings, tick, turns])
  const coreView = useMemo(() => coreViewOf(core, stateSince), [core, stateSince])
  const stages = useMemo(() => ribbonStages({ core, stateSince, now, last, medians }), [core, stateSince, now, last, medians])
  const organs = useMemo(() => organReadings({ core, vitals, readings, now }), [core, vitals, readings, now])

  const actions = useMemo<CoreActions>(() => {
    const guard = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn()
      } catch (e) {
        toast(`${label}: ${(e as Error).message}`, 'fault')
        throw e
      }
    }
    return {
      wake: (mode) => guard('Wake', async () => { await post('/api/core/start', { mode }); await refreshCore() }),
      sleep: () => guard('Sleep', async () => { await post('/api/core/stop'); await refreshCore() }),
      say: (text) => guard('Send', () => post('/api/core/say', { text })),
      flag: async (turn, verdict, expected = '', question = '', teach = false) => {
        const session = (turn as Turn & { session?: string }).session
        await post('/api/transcripts/flag', { session, id: turn.id, verdict, expected })
        if (verdict === 'wrong' && teach && expected.trim()) {
          const r = await post<{ added: boolean }>('/api/memory/teach', { question, answer: expected.trim() })
          return r.added ? 'taught: he gives that answer from now on' : 'he already had that correction'
        }
        return verdict === 'good' ? 'marked good' : `marked ${verdict}: in the next review`
      },
    }
  }, [refreshCore, toast])

  return { core, coreView, turns, organs, stages, medians, last, signal: voiceSignal, vitals, now, actions }
}
