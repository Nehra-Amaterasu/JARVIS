// The pure parts of the Paper Strata (package Y01): dot sizes, windows, counts and the arrow-key walk. The drawing only places
// what these return, so a test can check every rule without a screen.
import type { PaperRow, QType, TagSource, CropInfo, QuestionRow, Topic } from '../ports'
import type { Coverage } from './CoverageLedger'

export interface StrataCell {
  year: number
  topicId: string
  /** The topic's share of that paper's marks, 0 to 1. 0 draws a tick (the question is there, its marks are not known). */
  share: number
  type: QType
  /** The question the cell opens. */
  qid: string
  tag: TagSource
  /** The tagging margin, 0 to 1. */
  margin: number
  crop?: CropInfo
}

/** Dot widths in px: a tick for 0, then five steps from 4 to 26 (spec 20.7.1). */
export const DOT_STEPS = [4, 8, 13, 19, 26] as const
export const TICK_PX = 2
/** The share at which each step starts: under 5 percent is the smallest dot, 28 percent and over the largest. */
const EDGES = [0.05, 0.1, 0.18, 0.28] as const

export function dotSize(share: number): number {
  if (!(share > 0)) return TICK_PX
  const i = EDGES.findIndex((e) => share < e)
  return DOT_STEPS[i === -1 ? DOT_STEPS.length - 1 : i]
}

export const GLYPH_OF: Record<QType, 'circle' | 'square' | 'triangle' | 'cross'> = { numerical: 'circle', derivation: 'square', short: 'triangle', mcq: 'cross' }
export const TYPE_WORD: Record<QType, string> = { numerical: 'numerical', derivation: 'derivation', short: 'short answer', mcq: 'multiple choice' }

/** Columns that fit the 600 px strata at 44 px each beside a 132 px label and the 76 px count column. */
export const YEAR_WINDOW = 8
export const ROWS_PER_PAGE = 9

/** The years shown: `page` 0 is the newest window; each page steps one window back. Years come back oldest first. */
export function yearWindow(years: readonly number[], page: number, size = YEAR_WINDOW): { shown: number[]; pages: number } {
  const sorted = [...years].sort((a, b) => a - b)
  const pages = Math.max(1, Math.ceil(sorted.length / size))
  const p = Math.min(Math.max(0, page), pages - 1)
  const end = sorted.length - p * size
  return { shown: sorted.slice(Math.max(0, end - size), end), pages }
}

export function topicWindow(topics: readonly Topic[], unit: string | null, page: number, rows = ROWS_PER_PAGE): { shown: Topic[]; pages: number; total: number } {
  const list = unit ? topics.filter((t) => t.unit === unit) : [...topics]
  const pages = Math.max(1, Math.ceil(list.length / rows))
  const p = Math.min(Math.max(0, page), pages - 1)
  return { shown: list.slice(p * rows, p * rows + rows), pages, total: list.length }
}

export const unitsOf = (topics: readonly Topic[]): string[] => [...new Set(topics.map((t) => t.unit))]

/** In how many of the papers on file a topic was set: one count per year, however many questions it had that year. */
export function setIn(cells: readonly StrataCell[], topicId: string, years: readonly number[]): number {
  const have = new Set(cells.filter((c) => c.topicId === topicId).map((c) => c.year))
  return years.filter((y) => have.has(y)).length
}

/** One cell per topic and year: when a topic has several questions in a year their shares add (the topic's share of the marks). */
export function mergeCells(cells: readonly StrataCell[]): StrataCell[] {
  const by = new Map<string, StrataCell>()
  for (const c of cells) {
    const k = `${c.topicId}:${c.year}`
    const have = by.get(k)
    if (!have) by.set(k, { ...c })
    else {
      have.share += c.share
      // the cell opens the question with the lowest margin: that is the one a student most needs to look at
      if (c.margin < have.margin) { have.qid = c.qid; have.tag = c.tag; have.margin = c.margin; have.crop = c.crop; have.type = c.type }
    }
  }
  return [...by.values()]
}

export type Walk = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End' | 'PageUp' | 'PageDown'

/** Where the roving focus goes from (row, col) on a key; it stops at the edges, it never wraps. */
export function walk(row: number, col: number, key: Walk, rows: number, cols: number): [number, number] {
  const c = (n: number) => Math.min(cols - 1, Math.max(0, n))
  const r = (n: number) => Math.min(rows - 1, Math.max(0, n))
  switch (key) {
    case 'ArrowLeft': return [row, c(col - 1)]
    case 'ArrowRight': return [row, c(col + 1)]
    case 'ArrowUp': return [r(row - 1), col]
    case 'ArrowDown': return [r(row + 1), col]
    case 'Home': return [row, 0]
    case 'End': return [row, cols - 1]
    case 'PageUp': return [0, col]
    case 'PageDown': return [rows - 1, col]
  }
}

/** The Strata cells of a question list: a rejected question is not on the paper's record, a pending one is (it is shown, tagged as it stands). */
export const cellsOf = (qs: readonly QuestionRow[]): StrataCell[] =>
  qs.filter((q) => q.status !== 'rejected').map((q) => ({ year: q.year, topicId: q.topicId, share: q.share ?? 0, type: q.type, qid: q.id, tag: q.tag, margin: q.margin, crop: q.crop }))

/** The five counts of the Coverage Ledger, from the papers and questions as they stand. */
export function coverageOf(papers: readonly PaperRow[], qs: readonly QuestionRow[], lastRun: number | null): Coverage {
  const kept = qs.filter((q) => q.status !== 'rejected')
  return {
    papers: papers.length,
    questions: kept.length,
    reviewed: kept.filter((q) => q.status === 'accepted').length,
    taggedByHand: kept.filter((q) => q.tag === 'HAND').length,
    lastRun,
  }
}
