// The pure side of the Ledger drawer (package L03): spend bands and totals, the rolling seven-day line of a habit, and the cells of the
// habit ribbon. No React, no clock, no fetch. Nothing here is a run of days: a count can fall as well as rise, a day with nothing logged is
// a neutral cell, and no function returns a run length or zeroes a count.
import { addDays } from '../../../shared/almanac'
import type { HabitEvent, SpendRow } from './stores'

// ------------------------------------------------------------------------------------------------ spending

export const BANDS = ['small', 'middle', 'large'] as const
export type Band = 0 | 1 | 2

/** The two cut points that split the amounts into three bands of about equal count (tertiles). With fewer than three amounts every entry is "middle". */
export function tertiles(amounts: readonly number[]): [number, number] {
  const a = [...amounts].filter((x) => Number.isFinite(x) && x >= 0).sort((x, y) => x - y)
  if (a.length < 3) return [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  return [a[Math.floor(a.length / 3)], a[Math.floor((2 * a.length) / 3)]]
}

/** Which of the three bands an amount falls in: below the first cut, up to the second, at or above it. Short lists are all middle. */
export function bandOf(amount: number, cuts: readonly [number, number]): Band {
  if (!Number.isFinite(cuts[0])) return 1
  return amount < cuts[0] ? 0 : amount < cuts[1] ? 1 : 2
}

export interface SpendColumn { date: string; dots: Band[] }

/** One column per day of the month, one dot per entry, the dot's height by band. Days with no entry have an empty column. */
export function spendColumns(rows: readonly SpendRow[], month: string): SpendColumn[] {
  const cuts = tertiles(rows.map((r) => r.amount))
  const last = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()
  return Array.from({ length: last }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`
    return { date, dots: rows.filter((r) => r.date === date).map((r) => bandOf(r.amount, cuts)) }
  })
}

export const monthTotal = (rows: readonly SpendRow[]): number => Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100

export interface Share { category: string; total: number; frac: number }
/** Category totals, largest first, with each one's share of the month's total. */
export function shares(rows: readonly SpendRow[]): Share[] {
  const by = new Map<string, number>()
  for (const r of rows) by.set(r.category, (by.get(r.category) ?? 0) + r.amount)
  const total = monthTotal(rows)
  return [...by.entries()].map(([category, t]) => ({ category, total: Math.round(t * 100) / 100, frac: total > 0 ? t / total : 0 })).sort((a, b) => b.total - a.total || (a.category < b.category ? -1 : 1))
}

/** An entered amount, read loosely: "12", "12.5", "1,250", " 40 ". Anything else is null (the form says so in words). */
export function parseAmount(s: string): number | null {
  const t = s.trim().replace(/,/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  const n = Number(t)
  return n > 0 ? n : null
}

// ------------------------------------------------------------------------------------------------ habits

export const countOn = (events: readonly HabitEvent[], habit: string, date: string): number => events.filter((e) => e.habit === habit && e.at === date).length

/** The last seven days (oldest first, today last) as counts. It falls as readily as it rises; there is nothing to lose. */
export function rolling7(events: readonly HabitEvent[], habit: string, today: string): { date: string; n: number }[] {
  return Array.from({ length: 7 }, (_, i) => { const date = addDays(today, i - 6); return { date, n: countOn(events, habit, date) } })
}

export interface RibbonCell {
  date: string
  count: number
  /** The side of the subdivision: 0 = nothing logged (a neutral inset), 1, 2 or 4 tiles to a side. */
  grid: 0 | 1 | 2 | 4
  /** How many of the grid's tiles are filled. */
  tiles: number
}

/**
 * The ribbon of `days` days ending today. Each day's cell subdivides as more events are logged (a quadtree: 1 tile, then 2 x 2, then
 * 4 x 4), so the drawing is deterministic from the log and a longer log reads as a finer cell. A day with nothing logged is an inset cell.
 */
export function ribbon(events: readonly HabitEvent[], habit: string, today: string, days = 28): RibbonCell[] {
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i - (days - 1))
    const count = countOn(events, habit, date)
    const grid = count === 0 ? 0 : count === 1 ? 1 : count <= 4 ? 2 : 4
    return { date, count, grid, tiles: grid === 0 ? 0 : grid === 1 ? 1 : Math.min(count, grid * grid) }
  })
}
