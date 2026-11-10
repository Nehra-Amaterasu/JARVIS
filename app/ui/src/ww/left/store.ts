/**
 * The left column's data (no new route): five existing reads, each in its own slice so a tap on one card
 * changes one slice and re-renders one card (plan 5.8.4, the render-count test).
 *
 *   exams       GET  /api/mission/exams       papers for Countdown, tomorrow's first block for Close the day
 *   director    GET  /api/mission/director    step 1 = Now's one "next"
 *   attendance  GET  /api/mission/attendance  today's classes; POST .../attendance/{slot}/{status}
 *   life        GET  /api/mission/life        counters;          POST .../life/count
 *   remote      GET  /api/remote              whether any phone is paired (L5)
 *
 * Plan state (welcome-back, contracts done, minutes logged today, deadlines, the ladder) is read from the
 * existing usePlan store, which MissionRoot already hydrates. Taps are optimistic: the display moves on the
 * tap, the reply replaces it, and a failure puts the snapshot back and says so (never a silent revert).
 */
import { create } from 'zustand'
import { api, post } from '../../lib/api'
import { useStore } from '../../lib/store'
import type { ClassStatus, RawClass, RawCounter, RawNow, RawPaper } from './model'

type Phase = 'idle' | 'loading' | 'ok' | 'error'

interface ExamsRes {
  papers?: (RawPaper & { may_miss?: boolean })[]
  days?: { date: string; slots?: { label: string; minutes: number; reserved?: boolean; blocks?: { title: string; minutes: number; focus?: { title: string }[] }[] }[] }[]
}
interface DirectorRes {
  status?: string
  steps?: { kind: RawNow['kind']; title: string; minutes: number; why?: string; paper?: string }[]
}
interface AttendanceRes {
  status?: string
  today?: { id: string; start: string; name: string; kind?: string; status: ClassStatus | null }[]
}
interface LifeRes {
  status?: string
  counters?: { id: string; name: string; today: number | null }[]
}
interface RemoteRes {
  devices?: unknown[]
}

export interface LeftData {
  papers: RawPaper[] | null
  tomorrow: string | null
  now: RawNow | null
  classes: RawClass[] | null
  counters: RawCounter[] | null
  /** null = not read; a number = how many phones are paired. */
  paired: number | null
  /** Minutes the user tapped that the server has not confirmed yet (shown at once, taken back on an error). */
  loggedPending: number
  /** The counter the last tap touched, so "Undo last tap" has something to undo. */
  lastCount: string | null
  phase: Record<'exams' | 'director' | 'attendance' | 'life' | 'remote', Phase>
}

interface LeftActions {
  load: () => Promise<void>
  loadSlice: (k: keyof LeftData['phase']) => Promise<void>
  tapClass: (slot: string, status: ClassStatus | 'clear') => Promise<void>
  tapCount: (id: string, delta: 1 | -1) => Promise<void>
  addPending: (minutes: number) => void
}

const blank = (): LeftData => ({
  papers: null, tomorrow: null, now: null, classes: null, counters: null, paired: null, loggedPending: 0, lastCount: null,
  phase: { exams: 'idle', director: 'idle', attendance: 'idle', life: 'idle', remote: 'idle' },
})

const toast = (text: string, tone: 'live' | 'fault' | 'info' = 'info') => useStore.getState().toast(text, tone)

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Tomorrow's first block as one sentence, from the exams plan (the same days list Close the day reads). */
function tomorrowOf(r: ExamsRes, now = new Date()): string | null {
  const t = new Date(now)
  t.setDate(t.getDate() + 1)
  const day = r.days?.find((d) => d.date === ymd(t))
  const slot = day?.slots?.find((s) => !s.reserved && (s.blocks?.length ?? 0) > 0)
  const b = slot?.blocks?.[0]
  return b ? `${b.title}${b.focus?.[0] ? `: ${b.focus[0].title}` : ''}` : null
}

let countSeq = 0

export const useLeft = create<LeftData & LeftActions>((set, get) => {
  const phase = (k: keyof LeftData['phase'], v: Phase) => set((s) => ({ phase: { ...s.phase, [k]: v } }))
  const loaders: Record<keyof LeftData['phase'], () => Promise<void>> = {
    exams: async () => {
      const r = await api<ExamsRes>('/api/mission/exams')
      set({ papers: Array.isArray(r?.papers) ? r.papers : [], tomorrow: tomorrowOf(r ?? {}) })
    },
    director: async () => {
      const r = await api<DirectorRes>('/api/mission/director')
      const s = r?.status === 'ok' ? r.steps?.[0] : undefined
      set({ now: s ? { kind: s.kind, title: s.title, minutes: s.minutes, why: s.why ?? null, paper: s.paper ?? null } : null })
    },
    attendance: async () => {
      const r = await api<AttendanceRes>('/api/mission/attendance')
      set({ classes: r?.status === 'ok' && Array.isArray(r.today) ? r.today.map((c) => ({ id: c.id, start: c.start, name: c.name, kind: c.kind, status: c.status ?? null })) : [] })
    },
    life: async () => {
      const r = await api<LifeRes>('/api/mission/life')
      set({ counters: r?.status === 'ok' && Array.isArray(r.counters) ? r.counters.map((c) => ({ id: c.id, name: c.name, today: c.today })) : [] })
    },
    remote: async () => {
      const r = await api<RemoteRes>('/api/remote')
      set({ paired: Array.isArray(r?.devices) ? r.devices.length : null })
    },
  }
  const loadSlice = async (k: keyof LeftData['phase']) => {
    phase(k, 'loading')
    try {
      await loaders[k]()
      phase(k, 'ok')
    } catch {
      phase(k, 'error')
    }
  }
  return {
    ...blank(),
    loadSlice,
    load: async () => {
      await Promise.all((Object.keys(loaders) as (keyof LeftData['phase'])[]).map(loadSlice))
    },

    tapClass: async (slot, status) => {
      const before = get().classes
      if (!before) return
      // the tap moves the row at once; the reply (the whole attendance answer) replaces it
      set({ classes: before.map((c) => (c.id === slot ? { ...c, status: status === 'clear' ? null : status } : c)) })
      try {
        const r = await post<AttendanceRes>(`/api/mission/attendance/${encodeURIComponent(slot)}/${status}`, {})
        if (r?.status === 'ok' && Array.isArray(r.today)) set({ classes: r.today.map((c) => ({ id: c.id, start: c.start, name: c.name, kind: c.kind, status: c.status ?? null })) })
      } catch {
        set({ classes: before })
        toast('Could not save that class. Nothing changed.', 'fault')
      }
    },

    tapCount: async (id, delta) => {
      const before = get().counters
      if (!before) return
      // Three quick taps send three requests; only the newest reply is applied, so an older one landing late
      // never makes the number jump back (the same rule as the Life page's DayCard).
      const mine = ++countSeq
      set({ lastCount: delta === 1 ? id : null, counters: before.map((c) => (c.id === id ? { ...c, today: Math.max(0, (c.today ?? 0) + delta) } : c)) })
      try {
        const r = await post<LifeRes>('/api/mission/life/count', { id, delta })
        if (mine === countSeq && r?.status === 'ok' && Array.isArray(r.counters)) set({ counters: r.counters.map((c) => ({ id: c.id, name: c.name, today: c.today })) })
      } catch {
        if (mine === countSeq) set({ counters: before })
        toast('Could not save that count. Nothing changed.', 'fault')
      }
    },

    addPending: (minutes) => set((s) => ({ loggedPending: Math.max(0, s.loggedPending + minutes) })),
  }
})

export const resetLeftForTests = () => {
  countSeq = 0
  useLeft.setState(blank())
}
