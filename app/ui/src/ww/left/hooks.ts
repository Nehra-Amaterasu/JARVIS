/**
 * The bridges from the existing stores to the view-model's raw shapes. Each hook selects only the
 * primitives it needs, so a card re-renders when ITS inputs change and not when a sibling's do.
 */
import { useEffect, useMemo, useState, type RefObject } from 'react'
import { usePlan } from '../../germoney/game/plan'
import { useFrame } from '../frame/frameStore'
import { resolveSeason, type SeasonView, type ServerSeason } from '../frame/season'
import type { RawDay, RawHorizon } from './model'
import { useLeft } from './store'

/** The season exactly as Frame resolves it: the server's dict plus the owner's pill. */
export function useSeason(): SeasonView {
  const server = usePlan((s) => (s.today as { season?: ServerSeason } | null)?.season ?? null)
  const mode = useFrame((s) => s.seasonMode)
  return useMemo(() => resolveSeason(server, mode), [server, mode])
}

/** Horizon (normal season): the next application, its first step, the week's goal. Null until the plan has loaded. */
export function useHorizon(): RawHorizon | null {
  const deadlines = usePlan((s) => s.today?.deadlines)
  const career = usePlan((s) => s.today?.three?.career_next ?? null)
  const loaded = usePlan((s) => s.today !== null)
  const rung = usePlan((s) => s.ladder?.week.goals[0]?.title ?? null)
  return useMemo(() => {
    if (!loaded) return null
    const d = (deadlines ?? []).slice().sort((a, b) => (a.days_left ?? 1e9) - (b.days_left ?? 1e9))[0]
    const deadline = d ? { org: d.org, programme: d.programme, days_left: d.days_left } : career ? { org: career.title, programme: '', days_left: career.days_left } : null
    return { deadline, first_step: career?.action ?? null, rung }
  }, [loaded, deadlines, career, rung])
}

/** What Now and Close the day need from the plan: contracts done, minutes logged today, days away, tomorrow. */
export function useDay(): RawDay | null {
  const loaded = usePlan((s) => s.today !== null)
  const date = usePlan((s) => s.today?.date ?? null)
  const contracts = usePlan((s) => s.today?.contracts ?? null)
  const wb = usePlan((s) => s.today?.welcome_back ?? null)
  const events = usePlan((s) => s.state?.events ?? null)
  const tomorrow = useLeft((s) => s.tomorrow)
  const pending = useLeft((s) => s.loggedPending)
  return useMemo(() => {
    if (!loaded) return pending > 0 ? { done: null, total: null, logged_minutes: pending, tomorrow, idle_days: null, slipped: 0 } : null
    const logged = events && date ? events.filter((e) => e.date === date && e.kind === 'log').reduce((n, e) => n + (e.minutes ?? 0), 0) + pending : pending > 0 ? pending : null
    return {
      done: contracts ? contracts.filter((c) => c.done).length : null,
      total: contracts ? contracts.length : null,
      logged_minutes: logged,
      tomorrow,
      idle_days: wb ? wb.idle_days : null,
      slipped: wb ? wb.slipped.length : 0,
    }
  }, [loaded, date, contracts, wb, events, tomorrow, pending])
}

export interface Budget {
  /** Class rows shown before "+N later today". */
  classRows: number
  /** Counter tiles shown before "+N more in Life". */
  tiles: number
}

/**
 * How much of Classes and Counters fits (plan 4.1, "Height arithmetic"): below 720 px of column height
 * Classes shows 3 rows and Counters 2 rows of 3; 720 to 900 px shows 5 class rows; above that all.
 * A column that is the page (narrow density) has no height to run out of and shows everything. Before the
 * first measurement, and where nothing can be measured (a test DOM), it is the compact 3 / 6.
 */
export function useBudget(ref: RefObject<HTMLElement | null>): Budget {
  const [b, setB] = useState<Budget>({ classRows: 3, tiles: 6 })
  useEffect(() => {
    const host = ref.current?.closest<HTMLElement>('.ww-left') ?? ref.current?.parentElement
    if (!host) return
    const read = () => {
      const h = host.clientHeight
      const narrow = host.closest<HTMLElement>('[data-density]')?.dataset.density === 'narrow'
      const next: Budget = narrow ? { classRows: 99, tiles: 99 } : h <= 0 || h < 720 ? { classRows: 3, tiles: 6 } : h <= 900 ? { classRows: 5, tiles: 9 } : { classRows: 99, tiles: 99 }
      setB((cur) => (cur.classRows === next.classRows && cur.tiles === next.tiles ? cur : next))
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(host)
    return () => ro.disconnect()
  }, [ref])
  return b
}
