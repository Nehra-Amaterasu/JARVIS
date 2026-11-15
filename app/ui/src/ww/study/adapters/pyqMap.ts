// The mapping of the exam routes (R-01 to R-27, docs/design/well-wisher-engine-plan.md section 9.1.5) onto the Study port's
// own shapes (package AD08). Pure functions, so every one has a test with a fake answer. The rule of the file: a field the engine
// did not send stays absent, null or empty; no mapper fills a gap with a plausible value.
import { isLampState, showsNumber, type LampState } from '../../../shared/lamp'
import type {
  Blueprint, CheckResult, CropInfo, GainItem, GeneratedPaper, PaperRow, PatternSet, PortReply, QType, QuestionRow, ReviewStatus, TagSource, TextStatus, Topic, TraceEvent,
} from '../ports'

// ------------------------------------------------------------------------------------------------ the engine's records
export interface EnvelopeIn { state?: unknown; reason?: unknown; source?: unknown; [k: string]: unknown }
export interface ECrop { page?: number; bbox?: number[]; png?: string }
export interface EPaper {
  id: string; title?: string; filename?: string; year?: number | null; subject?: string; pages?: number; total_marks?: number | null
  counts?: { questions?: number; pending?: number; accepted?: number; rejected?: number; marks_missing?: number }
}
export interface EQuestion {
  id: string; paper_id: string; label?: string; text?: string; text_status?: string; crop?: ECrop | null; marks?: number | null; type?: string; status?: string
  unit?: number | null; topic?: string; tag_source?: string; tag_margin?: number | null; has_crop?: boolean; updated?: string
}
export interface ETrace { t?: number; page?: number | null; kind?: string; text?: string }
export interface EJobFile { file?: string; status?: string; paper_id?: string; pages?: number; questions?: number; method?: string; note?: string }
export interface EJob { id: string; status?: string; done?: number; total?: number; current?: string | null; files?: EJobFile[]; trace?: ETrace[]; took_s?: number | null }
export interface ESection { name?: string; questions?: number; attempt?: number; marks?: number }
export interface EBlueprint { exam?: string; origin?: string; total?: number; duration_min?: number; sections?: ESection[] }
export interface ESlot { question_id?: string; source?: string }
export interface EGenerated { id?: string; exam?: string; seed?: number; shortfall?: string[]; sections?: { slots?: ESlot[] }[] }

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const str = (x: unknown): string => (typeof x === 'string' ? x : '')
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

// ------------------------------------------------------------------------------------------------ the envelope
/**
 * An engine answer as a port reply. The engine's state is passed through untouched; an answer with no valid state is a FAULT (it
 * is never read as LIVE). Data travels only with LIVE and SIMULATED, as the port's type promises.
 */
export function reply<T>(env: EnvelopeIn, now: number, build: (env: EnvelopeIn) => T): PortReply<T> {
  if (!env || !isLampState(env.state)) return { state: 'fault', reason: 'The engine answered without a state, so nothing is shown.', since: now, data: null }
  const state: LampState = env.state
  const reason = str(env.reason) || (state === 'fault' ? 'no reason given' : '')
  return { state, reason, since: now, data: showsNumber(state) ? build(env) : null }
}

// ------------------------------------------------------------------------------------------------ papers and questions
export function paperRow(p: EPaper): PaperRow {
  const c = p.counts ?? {}
  return {
    id: p.id,
    // The engine allows a paper whose year is unknown (null); the port's year is a number, so an unknown year is 0 and says nothing else.
    year: num(p.year) ?? 0,
    label: str(p.title) || str(p.filename) || p.id,
    examAt: null, // the engine records no exam date on a paper
    questions: c.questions ?? 0,
    reviewed: (c.accepted ?? 0) + (c.rejected ?? 0),
    pages: num(p.pages) ?? 0,
  }
}

/** The engine's question types are seven; the port draws four glyphs. descriptive reads as a long answer, the rest as short. */
export const QTYPE: Record<string, QType> = { numerical: 'numerical', derivation: 'derivation', short: 'short', mcq: 'mcq', descriptive: 'derivation', slide: 'short', unknown: 'short' }
const TAG: Record<string, TagSource> = { hand: 'HAND', rule: 'RULE', model: 'MODEL', none: 'RULE' }
const TEXT: Record<string, TextStatus> = { verified: 'verified', unverified: 'unverified', none: 'crop-only' }
const STATUS: Record<string, ReviewStatus> = { pending: 'pending', accepted: 'accepted', rejected: 'rejected' }

/** The topic id the strata and the generator share: unit and topic joined as ww_generator.topic_key does. Empty when untagged. */
export const topicKey = (unit: number | null | undefined, topic: string | undefined): string => (typeof unit === 'number' && topic ? `${unit}|${topic}` : '')

/** [x0, y0, x1, y1] in PDF points to the port's [x, y, w, h]. */
export const boxOut = (b: number[] | undefined): [number, number, number, number] | undefined =>
  b && b.length === 4 && b.every((n) => Number.isFinite(n)) ? [b[0], b[1], b[2] - b[0], b[3] - b[1]] : undefined
/** The port's [x, y, w, h] back to the engine's [x0, y0, x1, y1]. */
export const boxIn = (b: readonly [number, number, number, number]): [number, number, number, number] => [b[0], b[1], b[0] + b[2], b[1] + b[3]]

export function cropInfo(q: EQuestion, img?: string): CropInfo {
  const text = str(q.text)
  const textStatus = TEXT[str(q.text_status)] ?? (text ? 'unverified' : 'crop-only')
  const out: CropInfo = { textStatus }
  if (img) out.img = img
  const bbox = boxOut(q.crop?.bbox)
  if (bbox) out.bbox = bbox
  if (text) out.text = text
  return out
}

export function questionRow(q: EQuestion, paper: EPaper | undefined, img?: string): QuestionRow {
  const marks = num(q.marks)
  const total = num(paper?.total_marks)
  const label = str(q.label)
  return {
    id: q.id,
    paperId: q.paper_id,
    number: /^\d/.test(label) ? `Q${label}` : label || '?',
    year: num(paper?.year) ?? 0,
    topicId: topicKey(q.unit, q.topic),
    type: QTYPE[str(q.type)] ?? 'short',
    marks,
    share: marks !== null && total !== null && total > 0 ? clamp01(marks / total) : null,
    tag: TAG[str(q.tag_source)] ?? 'RULE',
    margin: clamp01(num(q.tag_margin) ?? 0),
    status: STATUS[str(q.status)] ?? 'pending',
    stem: str(q.text),
    crop: cropInfo(q, img),
  }
}

// ------------------------------------------------------------------------------------------------ the ingest job
/** The engine's trace kinds are the reading steps; only a fault is drawn as one. Offsets in seconds become epoch ms from `startedAt`. */
export function traceEvents(trace: ETrace[] | undefined, startedAt: number, idPrefix: string): TraceEvent[] {
  return (trace ?? []).map((e, i) => {
    const fault = e.kind === 'fault'
    return { id: `${idPrefix}-${i}`, at: Math.round(startedAt + (num(e.t) ?? 0) * 1000), kind: fault ? 'fault' : e.kind === 'ocr' ? 'ocr' : 'read', text: str(e.text), state: fault ? 'fault' : 'live' }
  })
}

export const METHOD: Record<string, 'text-layer' | 'ocr' | 'pasted' | 'slides'> = { 'text-layer': 'text-layer', slides: 'slides', ocr: 'ocr', mixed: 'ocr', typed: 'pasted' }

// ------------------------------------------------------------------------------------------------ patterns, blueprints, generated paper, check
export interface EPatterns { n_papers?: number; topics?: { key?: string; unit?: number; topic?: string; k?: number }[] }
export function patternSet(p: EPatterns | undefined): PatternSet {
  const topics: Topic[] = []
  const topicCounts: Record<string, number> = {}
  for (const t of p?.topics ?? []) {
    if (!t.key) continue
    topics.push({ id: t.key, label: str(t.topic) || t.key, unit: typeof t.unit === 'number' ? `Unit ${t.unit}` : '' })
    topicCounts[t.key] = num(t.k) ?? 0
  }
  return { topics, papers: num(p?.n_papers) ?? 0, topicCounts }
}

export interface EGain { key?: string; reason?: string }
export const gainItems = (items: EGain[] | undefined): GainItem[] => (items ?? []).filter((i) => i.key).map((i) => ({ topicId: str(i.key), reason: str(i.reason) }))

export function blueprint(bp: EBlueprint, examId: string, label: string): Blueprint {
  return {
    id: examId,
    label,
    // `marks` is what each question of the section carries and `questions` how many are set; the port names them marksEach and set.
    sections: (bp.sections ?? []).map((s) => ({ label: str(s.name), set: num(s.questions) ?? 0, attempt: num(s.attempt) ?? 0, marksEach: num(s.marks) ?? 0 })),
    origin: bp.origin === 'rule' ? 'RULE' : 'HAND',
  }
}

export function generatedPaper(g: EGenerated, blueprintId: string, seed: number): GeneratedPaper {
  const ids: string[] = []
  for (const s of g.sections ?? []) for (const slot of s.slots ?? []) if (slot.question_id && slot.source !== 'hollow') ids.push(slot.question_id)
  return { blueprintId, seed: num(g.seed) ?? seed, questionIds: ids, gaps: Array.isArray(g.shortfall) ? g.shortfall.filter((x): x is string => typeof x === 'string') : [] }
}

export interface ECheck { match?: boolean | null; key?: string; parsed?: unknown; tolerance?: unknown; note?: string }
/** A check never carries a mark. `working` is the engine's own note and the number it read, nothing more. */
export function checkResult(c: ECheck | undefined): CheckResult {
  const read = c?.parsed !== undefined && c.parsed !== null ? `Read ${typeof c.parsed === 'object' ? JSON.stringify(c.parsed) : String(c.parsed)}. ` : ''
  return { matches: c?.match === true, working: `${read}${str(c?.note)}`.trim() }
}
