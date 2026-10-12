/**
 * The study library's data (app/jarvis_app/routes_library.py) and the pure logic
 * the panel needs: splitting an answer into text and citation chips, describing a
 * document honestly (scanned pages are named, not hidden), and the answer's tone.
 *
 * Kept out of the component so it is unit-tested without rendering.
 */

export interface LibraryDoc {
  doc_id: string
  file: string
  path: string
  kind: 'pdf' | 'docx' | 'pptx' | 'md' | 'txt'
  title: string
  pages: number
  chunks: number
  words: number
  scanned: number[]
  blank: number[]
  ocr: number[]
  notes: string[]
  embedder: string | null
  added: string
  updated: string
  also_at?: string[] | null
}

export interface LibraryJob {
  state: 'idle' | 'running' | 'done' | 'failed'
  path?: string
  done?: number
  total?: number | null
  current?: string | null
  counts?: Record<string, number>
  problems?: { file: string; status: string; note: string | null }[]
  took_s?: number
  error?: string
}

export interface LibraryView {
  root: string
  documents: number
  chunks: number
  pages: number
  scanned_pages: number
  embedder: { name: string | null; ready: boolean; error: string | null }
  mode: 'hybrid' | 'keyword-only'
  ocr: boolean
  docs: LibraryDoc[]
  job: LibraryJob
}

export interface LibrarySource {
  n: number
  id: string
  doc_id: string
  file: string
  kind: string
  page: number
  loc: string
  heading: string
  text: string
  path: string | null
  title: string | null
  distance: number | null
  bm25_rank: number | null
  vector_rank: number | null
}

export interface LibraryAnswer {
  question: string
  answer: string | null
  abstained: boolean
  reason: string
  used: number[]
  invalid: number[]
  uncited: boolean
  /** The model cited passages AND said the notes do not cover it; shown, not hidden. */
  caveat?: string
  sources: LibrarySource[]
  mode: 'hybrid' | 'keyword-only'
  llm: string | null
  llm_error?: string
  took_ms: number
  retrieval_ms: number
  best_distance: number | null
  coverage: number
}

export type Segment = { kind: 'text'; text: string } | { kind: 'cite'; ns: number[]; raw: string }

const CITE = /\[(\d+(?:\s*(?:,|–|-|and)\s*\d+)*)\]/g

/** The numbers inside one bracket: "1, 3" -> [1, 3]; "2-4" -> [2, 3, 4]. */
export function citeNumbers(body: string): number[] {
  const out: number[] = []
  const push = (n: number) => { if (!out.includes(n)) out.push(n) }
  for (const part of body.split(/\s*(?:,|and)\s*/)) {
    const range = part.match(/^(\d+)\s*[–-]\s*(\d+)$/)
    if (range) {
      const a = Number(range[1]), b = Number(range[2])
      for (let n = a; n <= b && n - a < 50; n++) push(n)
    } else if (/^\d+$/.test(part.trim())) push(Number(part.trim()))
  }
  return out
}

/** An answer as text runs and citation chips, in order. Mirrors library.cited_numbers. */
export function splitCitations(answer: string): Segment[] {
  const out: Segment[] = []
  let last = 0
  for (const m of answer.matchAll(CITE)) {
    const at = m.index ?? 0
    if (at > last) out.push({ kind: 'text', text: answer.slice(last, at) })
    out.push({ kind: 'cite', ns: citeNumbers(m[1]), raw: m[0] })
    last = at + m[0].length
  }
  if (last < answer.length) out.push({ kind: 'text', text: answer.slice(last) })
  return out
}

export const KIND_LABEL: Record<string, string> = { pdf: 'PDF', docx: 'DOCX', pptx: 'SLIDES', md: 'MD', txt: 'TXT' }

/** "4 pages · 3 passages · 1 scanned, not read" — what JARVIS really holds of a file. */
export function docSummary(d: LibraryDoc): string {
  const parts: string[] = []
  if (d.pages) parts.push(`${d.pages} ${d.kind === 'pptx' ? 'slide' : 'page'}${d.pages === 1 ? '' : 's'}`)
  parts.push(`${d.chunks} passage${d.chunks === 1 ? '' : 's'}`)
  if (d.scanned?.length) parts.push(`${d.scanned.length} scanned, not read`)
  if (d.ocr?.length) parts.push(`${d.ocr.length} read by OCR`)
  return parts.join(' · ')
}

/** Where the citation points, for a header: "DE_L4_Sequential.pdf · p. 3". */
export const sourceLabel = (s: Pick<LibrarySource, 'file' | 'loc'>) => `${s.file} · ${s.loc}`

/**
 * Tone = provenance (styles/tokens.css):
 *   live    an answer whose every citation points at a passage you can open
 *   sim     drafted without citations, or with keyword-only retrieval: check it
 *   fault   the model was down, or it cited a passage that does not exist
 *   quiet   an honest "not in your notes"
 */
export function answerTone(a: LibraryAnswer): 'live' | 'sim' | 'fault' | 'quiet' {
  if (a.llm_error || a.invalid.length) return 'fault'
  if (a.abstained) return 'quiet'
  if (a.uncited || !a.used.length) return 'sim'
  return 'live'
}

/** Fraction done of an ingest, 0..1 (0 while the folder is still being listed). */
export function jobFraction(j: LibraryJob | null | undefined): number {
  if (!j || !j.total) return 0
  return Math.max(0, Math.min(1, (j.done ?? 0) / j.total))
}

/** "9 new · 2 unchanged · 1 not read" after an ingest. */
export function jobSummary(j: LibraryJob): string {
  const c = j.counts ?? {}
  const parts: string[] = []
  const fresh = (c.added ?? 0) + (c.updated ?? 0)
  if (fresh) parts.push(`${fresh} new or changed`)
  if (c.unchanged) parts.push(`${c.unchanged} unchanged`)
  if (c.moved) parts.push(`${c.moved} moved`)
  if (c.duplicate) parts.push(`${c.duplicate} duplicate${c.duplicate === 1 ? '' : 's'}`)
  const bad = (c.failed ?? 0) + (c.skipped ?? 0)
  if (bad) parts.push(`${bad} not read`)
  return parts.join(' · ') || 'nothing to read there'
}

// The question's scaffolding, as in library.py's _QUERY_STOP: not worth marking.
const STOP = new Set(('what which when where does with that this from have about between explain ' +
  'describe define difference meaning versus should would could there their they them your mine ' +
  'notes kya hai hain mein kaise kyun hota hoti farak batao').split(' '))

/** Words worth marking in a cited passage (the question's longer words). */
export function markTerms(question: string): string[] {
  return [...new Set(question.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])].filter((w) => !STOP.has(w))
}
