// Life: the server calls and the optimistic state around them (plan 4.6). One hook per answer, so a card
// that needs only the attendance never waits for the day's list, and the left column can reuse either.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, post } from '../../lib/api'
import type { AttendanceAnswer, Counter, ItemRow, Pending } from './derive'

export interface LifeDay {
  status: string; say: string; rule: string; date: string
  counters: Counter[]; items: { kind: string; text: string }[]; points_today: number
  weeks: { ends: string; points: number; logged: number }[]
  reels_to_explain: { date: string; index: number; text: string; url?: string; kind: string }[]
  last_grade?: { score: number; missing: string[]; note: string } | null
  item_rows: ItemRow[]
  reels_pending: Pending
}

export type Load<T> = { data: T | null; error: string | null; loading: boolean; reload: () => Promise<void>; set: (v: T | null) => void }

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : 'The server did not answer.')

/** GET a path once on mount; `reload` asks again. A failure keeps the last good answer and says so. */
export function useLoad<T>(path: string): Load<T> {
  const [data, set] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const live = useRef(true)
  const reload = useCallback(async () => {
    try {
      const r = await api<T>(path)
      if (live.current) {
        set(r)
        setError(null)
      }
    } catch (e) {
      if (live.current) setError(message(e))
    } finally {
      if (live.current) setLoading(false)
    }
  }, [path])
  useEffect(() => {
    live.current = true
    void reload()
    return () => {
      live.current = false
    }
  }, [reload])
  return { data, error, loading, reload, set }
}

export interface Notice {
  text: string
  /** Present for a notice that can be taken back: the Undo button runs it. */
  undo?: () => Promise<void>
  tone: 'info' | 'fault'
}

export type AddExtra = { minutes?: number; url?: string }

/** The day's list (LF1): add, delete and the undo of either, each moving the screen on the tap and the server after. */
export function useLifeDay() {
  const load = useLoad<LifeDay>('/api/mission/life/day')
  const { data: day, set, reload } = load
  // The newest list, for callbacks that outlive a render (an Undo button shown ten seconds ago).
  const dayRef = useRef<LifeDay | null>(null)
  dayRef.current = day
  const [notice, setNotice] = useState<Notice | null>(null)
  const seq = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  // A notice with an Undo stays 10 s: long enough to read, short enough that it never becomes a second list.
  const show = useCallback((n: Notice | null) => {
    if (timer.current) clearTimeout(timer.current)
    setNotice(n)
    if (n && n.tone === 'info') timer.current = setTimeout(() => setNotice(null), 10_000)
  }, [])

  // Only the newest reply is applied, so an older answer landing late never puts a deleted row back.
  const refresh = useCallback(
    async (mine: number) => {
      const r = await api<LifeDay>('/api/mission/life/day')
      if (mine === seq.current) set(r)
    },
    [set],
  )

  const restore = useCallback(
    async (removed: Omit<ItemRow, 'index'>, index: number) => {
      const mine = ++seq.current
      try {
        await post('/api/mission/life/item/restore', { index, item: removed })
        await refresh(mine)
        show(null)
      } catch (e) {
        show({ tone: 'fault', text: `Could not put that back: ${message(e)}` })
      }
    },
    [refresh, show],
  )

  const remove = useCallback(
    async (row: ItemRow) => {
      const day = dayRef.current
      if (!day) return
      const mine = ++seq.current
      const before = day
      const isReel = row.kind === 'reel' && !row.explained
      set({
        ...day,
        item_rows: day.item_rows.filter((r) => r.index !== row.index).map((r, i) => ({ ...r, index: i })),
        reels_pending: isReel ? { ...day.reels_pending, queued_today: Math.max(0, day.reels_pending.queued_today - 1), total: Math.max(0, day.reels_pending.total - 1) } : day.reels_pending,
      })
      try {
        const r = await post<{ removed: Omit<ItemRow, 'index'> } & Partial<LifeDay>>('/api/mission/life/item/delete', { index: row.index, kind: row.kind, text: row.text })
        if (mine === seq.current) await refresh(mine)
        show({ tone: 'info', text: `Removed ${row.kind}: ${row.text}.`, undo: () => restore(r.removed, row.index) })
      } catch (e) {
        if (mine === seq.current) set(before)             // roll back: the row is exactly where it was
        show({ tone: 'fault', text: `Could not remove that, it is still in the list: ${message(e)}` })
      }
    },
    [set, refresh, restore, show],
  )

  const add = useCallback(
    async (kind: string, text: string, extra: AddExtra = {}) => {
      const day = dayRef.current
      if (!day) return false
      const mine = ++seq.current
      const before = day
      const item: Omit<ItemRow, 'index'> = { kind, text: text.trim(), ...extra }
      set({
        ...day,
        item_rows: [...day.item_rows, { ...item, index: day.item_rows.length }],
        reels_pending: kind === 'reel' ? { ...day.reels_pending, queued_today: day.reels_pending.queued_today + 1, total: day.reels_pending.total + 1 } : day.reels_pending,
      })
      try {
        await post('/api/mission/life/item', { kind, text, ...extra })
        await refresh(mine)
        // Undo removes the newest row that still matches, by its text: the list may have moved in ten seconds.
        const undo = async () => {
          const now = dayRef.current?.item_rows ?? []
          const hit = [...now].reverse().find((r) => r.kind === kind && r.text === item.text)
          if (hit) await remove(hit)
          else show(null)
        }
        show({ tone: 'info', text: `Added ${kind}: ${item.text}.`, undo })
        return true
      } catch (e) {
        if (mine === seq.current) set(before)
        show({ tone: 'fault', text: `Could not save that: ${message(e)}` })
        return false
      }
    },
    [set, refresh, remove, show],
  )

  const explained = useCallback(
    async (date: string, index: number, text: string) => {
      const mine = ++seq.current
      try {
        await post('/api/mission/life/explained', { date, index, text })
        await refresh(mine)
        show({ tone: 'info', text: 'Saved to your knowledge.' })
      } catch (e) {
        show({ tone: 'fault', text: `Could not save that: ${message(e)}` })
      }
    },
    [refresh, show],
  )

  return { ...load, add, remove, explained, notice, dismiss: () => show(null), reloadDay: reload }
}

/** Today's classes and the per-subject margins (LF2 reads them; it never taps). */
export function useAttendance() {
  return useLoad<AttendanceAnswer>('/api/mission/attendance')
}

export interface BodyAnswer {
  status: string; say: string
  habits: { id: string; target: string; per_week: number; done_this_week: number; today_done: boolean; on_track: boolean; met: boolean }[]
  focus: { id: string; name: string; text: string }
}
export function useBody() {
  const load = useLoad<BodyAnswer>('/api/mission/body')
  const { data, set } = load
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)
  const mark = useCallback(
    async (id: string, done: boolean) => {
      if (!data) return
      const mine = ++seq.current
      const before = data
      set({ ...data, habits: data.habits.map((h) => (h.id === id ? { ...h, today_done: done, done_this_week: Math.max(0, h.done_this_week + (done ? 1 : -1)) } : h)) })
      try {
        const r = await post<BodyAnswer>(`/api/mission/habit/${encodeURIComponent(id)}`, { done })
        if (mine === seq.current) {
          set(r)
          setError(null)
        }
      } catch (e) {
        if (mine === seq.current) set(before)
        setError(`Could not save that habit: ${message(e)}`)
      }
    },
    [data, set],
  )
  return { ...load, mark, markError: error }
}
