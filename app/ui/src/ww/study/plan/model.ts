// The plan view's pure parts (package Y03): what a unit is, which paper is chosen, how a long list is paged. Nothing here reads
// a store or a route, so a gallery state and a test hand the same shapes to the drawing as the live view does.
import type { ExamPaper } from '../../../germoney/pages/Exams'

/** A unit of the syllabus as the landscape and the gauges draw it. */
export interface UnitReading {
  id: string
  /** The unit's printed title; may be empty. */
  name: string
  /** The number printed with the unit ("3" for Unit 3). */
  num: number
  /** The unit's share of the paper, 0 to 1 (topics counted until marks per unit are on file). */
  share: number
  /** The student's own proficiency from marked answers, 0 to 1. null: not measured. */
  proficiency: number | null
  /** Answers behind the proficiency. */
  n: number
  /** Topics the student has marked learned or solid: one small tree each. */
  trees: number
}

/** Below this many answers a unit is "not measured": a flat slab, a dashed rim, no arc length (spec 20.7.5). */
export const MIN_N = 5

export const isMeasured = (u: Pick<UnitReading, 'proficiency' | 'n'>): boolean => u.proficiency !== null && u.n >= MIN_N

/** The unit with the shortest arc among units with at least MIN_N answers; null when none is measured. */
export function weakestUnit(units: readonly UnitReading[]): UnitReading | null {
  const m = units.filter(isMeasured)
  if (!m.length) return null
  return m.reduce((a, b) => ((b.proficiency as number) < (a.proficiency as number) ? b : a))
}

export const unitLabel = (u: Pick<UnitReading, 'num' | 'name'>): string => (u.name ? `Unit ${u.num}, ${u.name}` : `Unit ${u.num}`)

/**
 * The units of one paper, from the syllabus topics the student already keeps (their own learned/solid marks). Marks per
 * unit and answers per unit come from the Study port when its engine is merged; until then every unit is "not measured"
 * (proficiency null, n 0) and the footprint is the unit's share of topics.
 */
export function unitsOfPaper(p: ExamPaper | null | undefined, measured?: Record<string, { proficiency: number; n: number }>): UnitReading[] {
  if (!p || !p.topics?.length) return []
  const by = new Map<number, { title: string; count: number; trees: number }>()
  for (const t of p.topics) {
    const e = by.get(t.unit) ?? { title: t.unit_title ?? '', count: 0, trees: 0 }
    e.count += 1
    if (t.state === 'learned' || t.state === 'solid') e.trees += 1
    by.set(t.unit, e)
  }
  const total = p.topics.length
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([num, e]) => {
    const id = `${p.id}:u${num}`
    const m = measured?.[id]
    return { id, name: e.title, num, share: e.count / total, proficiency: m ? m.proficiency : null, n: m ? m.n : 0, trees: e.trees }
  })
}

/** The paper the view opens on: the chosen one, else the nearest that has not happened yet, else the latest. */
export function chosenPaper(papers: readonly ExamPaper[], id: string | null): ExamPaper | null {
  if (!papers.length) return null
  const hit = id ? papers.find((p) => p.id === id) : undefined
  if (hit) return hit
  const ahead = papers.filter((p) => p.days_left >= 0).sort((a, b) => a.days_left - b.days_left)
  return ahead[0] ?? [...papers].sort((a, b) => (a.date < b.date ? 1 : -1))[0]
}

export interface Paged<T> { items: T[]; page: number; pages: number }
/** One page of a list; the page is clamped, so a list that shrinks never lands on an empty page. */
export function paged<T>(all: readonly T[], per: number, page: number): Paged<T> {
  const pages = Math.max(1, Math.ceil(all.length / per))
  const p = Math.min(Math.max(0, page), pages - 1)
  return { items: all.slice(p * per, p * per + per), page: p, pages }
}

/** A seeded generator (mulberry32): the same unit id draws the same sigil on every visit, so a sigil never changes. */
export function seeded(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19) }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The four bands of the retention view, fresh to due (spec 20.7.4). Words only: the estimate is never a number. */
export const BANDS = ['fresh', 'settled', 'fading', 'due'] as const
export type Band = (typeof BANDS)[number]
export interface OrbitTopic { id: string; label: string; band: Band }

/** The words of the plan view that carry a rule of the owner's: nothing predicts a paper or a result. */
export const FOOTER = 'From your own records. This prepares practice; it does not predict a paper or a result.'
