// The mapping of the exam routes (R-01 to R-27, docs/design/well-wisher-engine-plan.md section 9.1.5) onto the Study port's
// own shapes (package AD08). Pure functions, so every one has a test with a fake answer. The rule of the file: a field the engine
// did not send stays absent, null or empty; no mapper fills a gap with a plausible value.
import { isLampState, showsNumber, type LampState } from '../../../shared/lamp'
import type {
  Blueprint, CheckResult, CropInfo, GainItem, GeneratedPaper, PaperRole, PaperRow, PatternSet, PortReply, QType, QuestionRow, ReviewStatus, TagSource, TextStatus, Topic, TraceEvent,
} from '../ports'

// ------------------------------------------------------------------------------------------------ the engine's records
export interface EnvelopeIn { state?: unknown; reason?: unknown; source?: unknown; [k: string]: unknown }
export interface ECrop { page?: number; bbox?: number[]; png?: string }
export interface EPaper {
  id: string; title?: string; filename?: string; year?: number | null; subject?: string; pages?: number; total_marks?: number | null
  counts?: { questions?: number; pending?: number; accepted?: number; rejected?: number; marks_missing?: number }
  faults?: unknown; method?: string
  /** Wave EW11: paper, question_bank, solution or notes, and who set it (rule or hand). */
  role?: string; role_source?: string
}
export interface EQuestion {
  id: string; paper_id: string; label?: string; text?: string; text_status?: string; crop?: ECrop | null; marks?: number | null; type?: string; status?: string
  unit?: number | null; topic?: string; tag_source?: string; tag_margin?: number | null; has_crop?: boolean; updated?: string
  ocr_confidence?: number | null; origin?: string
  /** Wave EW11 (board request 23): marks null with marks_source "not printed"; not_question with who judged it; the model behind a tag; who accepted. */
  marks_source?: string; not_question?: boolean; not_question_source?: string; not_question_model?: string; tag_model?: string; accepted_by?: string; status_by?: string
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
    // The engine allows a paper whose year is unknown (null). It stays null (R32, 27 Nov: 0 drew a year column headed "0"); the desk
    // prints such a paper as "n.d." and leaves it out of the year columns.
    year: num(p.year),
    label: str(p.title) || str(p.filename) || p.id,
    examAt: null, // the engine records no exam date on a paper
    questions: c.questions ?? 0,
    reviewed: (c.accepted ?? 0) + (c.rejected ?? 0),
    pages: num(p.pages) ?? 0,
    ...(str(p.subject) ? { subject: str(p.subject) } : {}),
    ...(Array.isArray(p.faults) ? { faults: p.faults.filter((f): f is string => typeof f === 'string') } : {}),
    ...(str(p.method) ? { method: str(p.method) } : {}),
    ...(ROLES.includes(str(p.role) as PaperRole) ? { role: str(p.role) as PaperRole } : {}),
    ...(str(p.role_source) ? { roleSource: str(p.role_source) } : {}),
  }
}

const ROLES: readonly PaperRole[] = ['paper', 'question_bank', 'solution', 'notes']
/** The engine's marks_source for a question of a question bank that prints no marks (ww_pyq/store.py NOT_PRINTED). */
export const NOT_PRINTED = 'not printed'

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
    year: num(paper?.year),
    topicId: topicKey(q.unit, q.topic),
    type: QTYPE[str(q.type)] ?? 'short',
    marks,
    share: marks !== null && total !== null && total > 0 ? clamp01(marks / total) : null,
    tag: TAG[str(q.tag_source)] ?? 'RULE',
    margin: clamp01(num(q.tag_margin) ?? 0),
    status: STATUS[str(q.status)] ?? 'pending',
    stem: str(q.text),
    crop: cropInfo(q, img),
    // an OCR reading: the engine's mean confidence travels as it came, and is never turned into a grade
    ...(num(q.ocr_confidence) !== null ? { ocrConfidence: num(q.ocr_confidence) } : {}),
    // "p3": the page was read but no question start was found, so the whole page is one draft (engine plan, 25 Nov, "OCR as built")
    ...(/^p\d+$/i.test(label) ? { wholePage: true } : {}),
    ...(str(q.origin) ? { origin: str(q.origin) } : {}),
    // a question bank prints no marks: null stays null and says so, it is never 0 (board request 23)
    ...(marks === null && str(q.marks_source) === NOT_PRINTED ? { marksNotPrinted: true } : {}),
    ...(q.not_question === true ? { notQuestion: true, notQuestionBy: str(q.not_question_model) || str(q.not_question_source) || 'rule' } : {}),
    ...(str(q.tag_source) === 'model' && str(q.tag_model) ? { tagModel: str(q.tag_model) } : {}),
    // accepted by rule and not since by his hand (prep.unaccept reads the same two fields)
    ...(str(q.status) === 'accepted' && str(q.accepted_by) === 'rule' && str(q.status_by) !== 'hand' ? { acceptedBy: 'rule' } : {}),
  }
}

/** The words for a question's marks wherever they are drawn: the number, "marks not printed" for a question bank, or "marks not found". */
export const marksWords = (q: Pick<QuestionRow, 'marks' | 'marksNotPrinted'>): string =>
  q.marks !== null ? `${q.marks} ${q.marks === 1 ? 'mark' : 'marks'}` : q.marksNotPrinted ? 'marks not printed' : 'marks not found'

const TAG_WORD: Record<TagSource, string> = { RULE: 'the rule', MODEL: 'a model', HAND: 'you' }
/** Who set a question's topic, and who accepted it, in plain words (tag_source, tag_model, accepted_by). A model's tag is never his. */
export function provenanceWords(q: Pick<QuestionRow, 'tag' | 'tagModel' | 'status' | 'acceptedBy' | 'topicId'>): string {
  const bits: string[] = []
  if (q.topicId) bits.push(q.tag === 'MODEL' ? `Topic set by the model${q.tagModel ? ` ${q.tagModel}` : ''}, not checked by you` : `Topic set by ${TAG_WORD[q.tag]}`)
  if (q.status === 'accepted') bits.push(q.acceptedBy === 'rule' ? 'accepted by the rule, not by you' : 'accepted by you')
  return bits.join('; ')
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
export interface EPatterns { n_papers?: number; n_questions?: number; topics?: { key?: string; unit?: number; topic?: string; k?: number }[] }
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

export interface ETerms { marks_weight?: unknown; seen_share?: unknown; proficiency?: unknown; measured?: unknown; minutes?: unknown; syllabus_weight?: unknown; marks_basis?: unknown }
/** R-17's marks_basis (wave EW11): on what the topic was weighed when its questions print no marks (ww_pyq/patterns.py). */
const BASIS_WORDS: Record<string, string> = {
  assumed: 'weighed on assumed marks (the median of the marks printed in this subject)',
  mixed: 'weighed partly on assumed marks (the median of the marks printed in this subject)',
}
export interface EGain { key?: string; reason?: string; terms?: ETerms | null }
const SYLLABUS_WORD: Record<number, string> = { 3: 'high', 2: 'medium', 1: 'low' }

/** R-17's printed terms as plain words, the engine's numbers as sent and nothing added; a term the engine did not send is left out. */
export function termsText(t: ETerms | null | undefined): string {
  if (!t || typeof t !== 'object') return ''
  const parts: string[] = []
  const mw = num(t.marks_weight)
  if (mw !== null) parts.push(`marks weight ${mw.toFixed(2)}`)
  const share = num(t.seen_share)
  if (share !== null) parts.push(`set in ${Math.round(share * 100)} % of papers`)
  const prof = num(t.proficiency)
  if (prof !== null) parts.push(t.measured === true ? `proficiency ${prof.toFixed(2)} from your marks` : `proficiency ${prof.toFixed(2)}, not measured yet`)
  const sw = num(t.syllabus_weight)
  if (sw !== null) parts.push(`syllabus weight ${sw} of 3${SYLLABUS_WORD[sw] ? ` (${SYLLABUS_WORD[sw]})` : ''}`)
  const min = num(t.minutes)
  if (min !== null) parts.push(`about ${Math.round(min)} min`)
  // "printed" is the plain case and says nothing new; the other two are said, so an assumption is never read as a printed mark
  const basis = BASIS_WORDS[str(t.marks_basis)]
  if (basis) parts.push(basis)
  return parts.join('; ')
}

export const gainItems = (items: EGain[] | undefined): GainItem[] => (items ?? []).filter((i) => i.key).map((i) => {
  const terms = termsText(i.terms)
  return { topicId: str(i.key), reason: str(i.reason), ...(terms ? { terms } : {}) }
})

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
