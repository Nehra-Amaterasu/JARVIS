import { useEffect, useRef, useState } from 'react'

export const fmtInt = (n: number | null | undefined) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : Math.round(n).toLocaleString('en-IN')

export const fmt = (n: number | null | undefined, d = 1) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : n.toFixed(d)

export const fmtGb = (mb: number | null | undefined, d = 1) =>
  mb === null || mb === undefined ? '—' : (mb / 1024).toFixed(d)

export function fmtDur(s: number | null | undefined): string {
  if (s === null || s === undefined) return '—'
  if (s < 60) return `${Math.round(s)}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
  return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`
}

export const clock = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export const pad2 = (n: number) => String(n).padStart(2, '0')

/** Poll a loader every `ms` while mounted (and once immediately). */
export function usePoll<T>(load: () => Promise<T>, ms: number, deps: unknown[] = []): [T | null, boolean, () => void] {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const ref = useRef(load)
  ref.current = load
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    const run = async () => {
      try {
        const d = await ref.current()
        if (alive) setData(d)
      } catch {
        /* keep the last good value */
      } finally {
        if (alive) setLoading(false)
      }
    }
    void run()
    const id = ms > 0 ? window.setInterval(run, ms) : undefined
    return () => {
      alive = false
      window.clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, tick, ...deps])
  return [data, loading, () => setTick((t) => t + 1)]
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(id)
  }, [ms])
  return now
}
