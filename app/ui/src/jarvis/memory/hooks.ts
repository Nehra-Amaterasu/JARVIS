// The Memory section's hooks: a loader that never claims a number before the route answered, the session's recall trail
// (memory only: a trail is not a streak, so nothing is written to disk), and the local history of fixes (seven days).
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { addFix, pruneFixes, pushRecall, removeFix, type FixRow, type Recall } from './model'
import type { Loadable } from './types'

const LOADING: Loadable<never> = { state: 'loading', data: null, error: null }

/**
 * Load once when the view opens and again on `reload()`; a reload keeps the old data on screen until the new one lands,
 * so a number never flashes to "loading" under the owner's eyes. `again` (optional) asks for one more read after a
 * delay, which the galaxy route needs while it builds the layout of the new store state in the background.
 */
export function useLoad<T>(load: () => Promise<T>, key: unknown = null, again?: (v: T) => number | null): { v: Loadable<T>; reload: () => void } {
  const [v, setV] = useState<Loadable<T>>(LOADING)
  const [tick, setTick] = useState(0)
  const ref = useRef(load)
  ref.current = load
  const againRef = useRef(again)
  againRef.current = again
  const tries = useRef(0)
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    ref.current().then(
      (data) => {
        if (!alive) return
        setV({ state: 'ready', data, error: null })
        const wait = againRef.current?.(data)
        if (wait && tries.current < 5) {
          tries.current += 1
          timer = setTimeout(() => setTick((t) => t + 1), wait)
        } else tries.current = 0
      },
      (e) => { if (alive) setV((cur) => (cur.state === 'ready' ? cur : { state: 'fault', data: null, error: (e as Error)?.message || 'the route did not answer' })) },
    )
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [tick, key])
  const reload = useCallback(() => { tries.current = 0; setTick((t) => t + 1) }, [])
  return { v, reload }
}

/* ------------------------------------------------------------------ the recall trail (this session only) */
let recalls: Recall[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
export const recallStore = {
  get: () => recalls,
  subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } },
  push(q: string, hits: number, at = Date.now()) { recalls = pushRecall(recalls, q, hits, at); emit() },
  /** Tests and fixtures only. */
  set(list: Recall[]) { recalls = list; emit() },
}
export const useRecalls = (): Recall[] => useSyncExternalStore(recallStore.subscribe, recallStore.get, recallStore.get)

/* ------------------------------------------------------------------ the history of fixes (local, seven days) */
const KEY = 'jarvis.memory.fixes'
function readFixes(now: number): FixRow[] {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY)
    const rows = raw ? (JSON.parse(raw) as FixRow[]) : []
    return pruneFixes(Array.isArray(rows) ? rows.filter((r) => r && typeof r.id === 'string' && typeof r.after === 'string') : [], now)
  } catch {
    return [] // storage blocked or damaged: the page works, it only remembers nothing
  }
}
function writeFixes(rows: FixRow[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(rows)) } catch { /* private window: nothing to keep */ }
}

export interface FixHistory { rows: FixRow[]; add(row: FixRow): void; remove(id: string): void }
export function useFixHistory(now: () => number = Date.now): FixHistory {
  const [rows, setRows] = useState<FixRow[]>(() => readFixes(now()))
  const add = useCallback((row: FixRow) => setRows((cur) => { const next = addFix(cur, row, now()); writeFixes(next); return next }), [now])
  const remove = useCallback((id: string) => setRows((cur) => { const next = removeFix(cur, id); writeFixes(next); return next }), [])
  return { rows, add, remove }
}
