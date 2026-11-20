// Sound's live data, as hooks over a SoundPort. The classic cards used `usePoll`, which keeps the last good value when a
// route stops answering and so can never say "WAITING, because": these hooks record the failure and its words, and the
// view drops the stale value (a route that does not answer is WAITING with the reason, never yesterday's "playing").
//
// Timers, all bounded: the media state is read every 5 s while the view is mounted and at once after a media event on the
// bus (`refreshKey`); the library is read once, then every 0.9 s only while an ingest job runs; the words once.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LibraryAnswer, LibraryView } from '../../lib/library'
import type { MediaReceipt, MediaState, Source } from '../../lib/media'
import { ROUTE_IDLE, type RouteStatus } from './model'
import type { SoundPort } from './port'

const reasonOf = (e: unknown) => (e instanceof Error && e.message ? e.message : 'no answer')

/** One route, polled: its last good value, whether it answers now, and why not. */
export function useRoute<T>(load: () => Promise<T>, pollMs: number, refreshKey: unknown = 0) {
  const [data, setData] = useState<T | null>(null)
  const [route, setRoute] = useState<RouteStatus>(ROUTE_IDLE)
  const fn = useRef(load)
  fn.current = load
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    const run = async () => {
      try {
        const d = await fn.current()
        if (!alive) return
        setData(d)
        setRoute({ ok: true, reason: null, at: Date.now() })
      } catch (e) {
        if (alive) setRoute((r) => ({ ok: false, reason: reasonOf(e), at: r.at }))
      }
    }
    void run()
    const id = pollMs > 0 ? window.setInterval(run, pollMs) : undefined
    return () => {
      alive = false
      if (id !== undefined) window.clearInterval(id)
    }
  }, [pollMs, tick, refreshKey])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, route, reload }
}

/** One typed play of this window: what was asked, where it was sent and the server's own answer. */
export interface PlayEntry {
  /** Epoch ms of the answer. */
  at: number
  source: Source
  query: string
  receipt: MediaReceipt
}

/** How many plays the ledger keeps (the view draws that many rows). */
export const HISTORY_ROWS = 5

export interface MediaLive {
  /** The plays typed in this window, newest first. Optional so a caller that has none draws the empty ledger. */
  history?: PlayEntry[]
  state: MediaState | null
  route: RouteStatus
  receipt: MediaReceipt | null
  busy: boolean
  source: Source
  control: (action: string, value?: string) => void
  play: (query: string) => Promise<boolean>
  choose: (s: Source) => void
  saveFolder: (path: string) => Promise<boolean>
}

const failure = (action: string, e: unknown): MediaReceipt => ({ ok: false, say: reasonOf(e), confirmed: false, action, at: Date.now() / 1000 })

export function useMedia(port: SoundPort, pollMs: number, refreshKey: unknown): MediaLive {
  const { data, route, reload } = useRoute(() => port.media(), pollMs, refreshKey)
  const [receipt, setReceipt] = useState<MediaReceipt | null>(null)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<PlayEntry[]>([])
  const [picked, setPicked] = useState<Source | null>(null)
  // A route that stopped answering shows no value at all: useRoute keeps the last good one, and "playing" from before the
  // failure must never be drawn as the present.
  const state = route.ok ? data : null
  const source: Source = picked ?? data?.settings.default_source ?? 'auto'
  // The pick is released only when the server's own answer agrees with it, so a poll that was already in flight when the
  // choice was sent (still carrying the old default) cannot snap the chip back.
  useEffect(() => { if (picked && data?.settings.default_source === picked) setPicked(null) }, [data, picked])

  const act = useCallback(async (action: string, fn: () => Promise<MediaReceipt>, log?: { query: string; source: Source }): Promise<boolean> => {
    setBusy(true)
    const keep = (r: MediaReceipt) => { if (log) setHistory((h) => [{ at: Date.now(), source: log.source, query: log.query, receipt: r }, ...h].slice(0, HISTORY_ROWS)) }
    try {
      const r = await fn()
      setReceipt(r)
      keep(r)
      return r.ok
    } catch (e) {
      const r = failure(action, e)
      setReceipt(r)
      keep(r)
      return false
    } finally {
      setBusy(false)
      reload()
    }
  }, [reload])

  return {
    state,
    route,
    receipt: receipt ?? (state?.last ? { ...state.last, action: 'play' } : null),
    busy,
    history,
    source,
    control: (action, value) => { if (!busy) void act(action, () => port.control(action, value)) },
    play: async (query) => {
      const q = query.trim()
      if (!q || busy) return false
      return act('play', () => port.play(q, source), { query: q, source })
    },
    choose: (s) => {
      setPicked(s)
      port.setSource(s).then(reload, (e) => { setPicked(null); setReceipt(failure('settings', e)) })
    },
    saveFolder: async (path) => {
      try {
        await port.setFolder(path.trim())
        reload()
        return true
      } catch (e) {
        setReceipt(failure('settings', e))
        return false
      }
    },
  }
}

export interface LibraryLive {
  view: LibraryView | null
  route: RouteStatus
  running: boolean
  note: string | null
  add: (path: string) => Promise<boolean>
  forget: (docId: string) => Promise<void>
  ask: (question: string) => Promise<LibraryAnswer | null>
  asking: boolean
  error: string | null
}

export function useLibrary(port: SoundPort): LibraryLive {
  const [polling, setPolling] = useState(false)
  const { data: view, route, reload } = useRoute(() => port.library(), polling ? 900 : 0)
  const running = view?.job?.state === 'running'
  const last = useRef<string | undefined>(undefined)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    setPolling(running)
    const was = last.current
    last.current = view?.job?.state
    if (was === 'running' && view?.job && view.job.state !== 'running') {
      setNote(view.job.state === 'done' ? 'Reading finished.' : (view.job.error ?? 'Reading failed.'))
    }
  }, [running, view?.job])
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return {
    view,
    route,
    running,
    note,
    asking,
    error,
    add: async (path) => {
      try {
        await port.ingest(path.trim())
        setNote(null)
        setError(null)
        setPolling(true)
        reload()
        return true
      } catch (e) {
        setError(reasonOf(e))
        return false
      }
    },
    forget: async (docId) => {
      try {
        await port.forget(docId)
        setError(null)
      } catch (e) {
        setError(reasonOf(e))
      }
      reload()
    },
    ask: async (question) => {
      setAsking(true)
      setError(null)
      try {
        return await port.ask(question)
      } catch (e) {
        setError(reasonOf(e))
        return null
      } finally {
        setAsking(false)
      }
    },
  }
}

export interface WordsLive {
  table: Record<string, string> | null
  route: RouteStatus
  error: string | null
  save: (word: string, say: string) => Promise<boolean>
  remove: (word: string) => Promise<void>
  hear: (word: string, say: string) => Promise<string>
}

export function useWords(port: SoundPort): WordsLive {
  const { data, route } = useRoute(() => port.words(), 0)
  const [local, setLocal] = useState<Record<string, string> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const table = local ?? data?.table ?? null
  return {
    table,
    route,
    error,
    save: async (word, say) => {
      try {
        setLocal((await port.setWord(word.trim(), say.trim())).table)
        setError(null)
        return true
      } catch (e) {
        setError(reasonOf(e))
        return false
      }
    },
    remove: async (word) => {
      try {
        setLocal((await port.removeWord(word)).table)
        setError(null)
      } catch (e) {
        setError(reasonOf(e))
      }
    },
    // Hear says the SPOKEN form itself, so a person can check the sound before keeping it (the classic key said the word
    // and relied on the table already holding it, which a draft does not).
    hear: async (_word, say) => {
      try {
        const via = await port.hear(say)
        setError(null)
        return via === 'jarvis' ? 'JARVIS is saying it.' : 'Played in this window.'
      } catch (e) {
        setError(reasonOf(e))
        return `Could not play it: ${reasonOf(e)}`
      }
    },
  }
}
