/**
 * Dates and seeded randomness for the game. Everything is LOCAL-date based
 * ("YYYY-MM-DD"), because "today" means the day on Aman's clock, not UTC.
 *
 * Randomness is seeded by a string (usually the date), so a day's crit, crate and
 * contracts are fixed: reopening the app cannot reroll them.
 */

export const DAY_MS = 86_400_000

export function dateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Local midnight of a date key. */
export function fromKey(k: string): Date {
  const [y, m, d] = k.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(k: string, n: number): string {
  const d = fromKey(k)
  d.setDate(d.getDate() + n)
  return dateKey(d)
}

/** Whole days from a to b (b - a). DST-safe: rounds through local midnights. */
export function daysBetween(a: string, b: string): number {
  return Math.round((fromKey(b).getTime() - fromKey(a).getTime()) / DAY_MS)
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(k: string): number {
  return fromKey(k).getDay()
}

/** The Monday that starts k's week (weeks run Monday → Sunday). */
export function weekStart(k: string): string {
  const wd = weekday(k)
  return addDays(k, wd === 0 ? -6 : 1 - wd)
}

export function weekEnd(k: string): string {
  return addDays(weekStart(k), 6)
}

export function monthStart(k: string): string {
  return `${k.slice(0, 7)}-01`
}

export function addMonths(k: string, n: number): string {
  const d = fromKey(monthStart(k))
  d.setMonth(d.getMonth() + n)
  return dateKey(d)
}

export function monthEnd(k: string): string {
  return addDays(addMonths(k, 1), -1)
}

export function inRange(k: string, from: string, to: string): boolean {
  return k >= from && k <= to
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function prettyDate(k: string, withYear = false): string {
  const d = fromKey(k)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ''}`
}

export function prettyMonth(k: string): string {
  const d = fromKey(k)
  return `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`
}

/* ------------------------------------------------------------------ seeded RNG */
export function hashString(str: string): number {
  let h = 5381
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0
  return h >>> 0
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const rngFor = (seed: string) => mulberry32(hashString(seed))

export function pick<T>(items: readonly T[], rand: () => number): T {
  return items[Math.floor(rand() * items.length) % items.length]
}

/** Weighted pick of one index. */
export function pickWeighted(weights: number[], rand: () => number): number {
  const total = weights.reduce((a, b) => a + b, 0)
  let roll = rand() * total
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i]
    if (roll <= 0) return i
  }
  return weights.length - 1
}

/** Loose text match for voice commands: share of the query's words found in the target. */
export function wordScore(query: string, target: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöüß ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2)
  const q = norm(query)
  if (!q.length) return 0
  const t = new Set(norm(target))
  return q.filter((w) => t.has(w) || [...t].some((x) => x.startsWith(w) || w.startsWith(x))).length / q.length
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
