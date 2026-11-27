// The Study ports (package Y01, contract table of UW7): one TypeScript type, `StudyPort`, that every Study screen reads and
// writes through. A screen never calls a route; it calls a port, and a port is filled by an adapter file
// (`adapters/<name>.register.ts`). Until an engine route is merged the only adapter is the null one, and the null
// adapter answers WAITING with a reason, so a screen draws a hollow form and says why instead of inventing a number.
//
// The shapes below are the shapes of the screens' own needs (what the Paper Desk and the Review Desk draw); the route
// shapes are written once in docs/design/well-wisher-engine-plan.md, and the adapter of AD08 maps one onto the other.
// Freeze note (spec 21.9, risk 5): later Study packages (AD08, X03, X06, X08, X10, C03) import this file; a member or a
// field changes only by a dated line on the wave comms board, never by a quiet edit.
import { WAITING_DEFAULT, type LampState } from '../../shared/lamp'
import type { StudyAdapterRegistration } from './adapters/types'

export type { StudyAdapterRegistration } from './adapters/types'

/** What a port answers: the lamp state of the source, why in words, when, and the data only when the state may carry it. */
export interface PortReply<T> {
  state: LampState
  /** One short sentence. WAITING says what is awaited; FAULT says what failed; SIMULATED says what generated it. */
  reason: string
  /** Epoch ms of the answer; null when the source has never reported. */
  since: number | null
  /** Present for LIVE and SIMULATED; null for WAITING, PLANNED and FAULT (a number is never drawn for those). */
  data: T | null
}

// ------------------------------------------------------------------------------------------------ the nouns

/** Where a tag on a question came from. RULE is a counted rule, MODEL the local model's suggestion, HAND the student's own. */
export type TagSource = 'RULE' | 'MODEL' | 'HAND'
/** The question types of the Strata glyphs: circle numerical, square derivation, triangle short answer, cross multiple choice. */
export type QType = 'numerical' | 'derivation' | 'short' | 'mcq'
/** `verified`: the student checked the recognised text against the crop. `unverified`: recognised, not checked. `crop-only`: no text at all. */
export type TextStatus = 'verified' | 'unverified' | 'crop-only'
export type ReviewStatus = 'pending' | 'accepted' | 'rejected'

export interface Topic {
  id: string
  label: string
  /** The syllabus unit the topic belongs to ("Unit 2"); drives the unit filter of the Strata. */
  unit: string
}

export interface CropInfo {
  /** A URL or data URI of the page crop. Absent: the crop has not been rendered, and the card says so. */
  img?: string
  /** The question's box on its page, in page units [x, y, w, h]; the crop is the source of truth, the text is a reading of it. */
  bbox?: readonly [number, number, number, number]
  text?: string
  textStatus: TextStatus
}

export interface PaperRow {
  id: string
  /** The exam year, or null when the engine does not know it (R32, 27 Nov: it was 0, which drew a year column headed "0"). */
  year: number | null
  /** The student's own label for the file ("Paper 2023"); never an institution or course name in a tracked file. */
  label: string
  /** The exam date, epoch ms, or null when unknown. */
  examAt: number | null
  questions: number
  reviewed: number
  pages: number
  /** The subject slug the engine filed the paper under; absent when it sent none. */
  subject?: string
  /** The engine's fault lines of the paper ("p. 3: no text layer; run OCR on this paper"), as sent. */
  faults?: string[]
  /** How the engine read it: text-layer, ocr, mixed, typed, slides. Absent when it sent none. */
  method?: string
}

export interface QuestionRow {
  id: string
  paperId: string
  /** The number printed on the paper ("Q4"). */
  number: string
  /** The year of its paper; null when that paper has no known year. */
  year: number | null
  topicId: string
  type: QType
  /** Marks as read; null when the paper's marks were not found. */
  marks: number | null
  /** The share of the paper's marks this question carries, 0 to 1, or null when marks are missing. */
  share: number | null
  tag: TagSource
  /** The tagging margin: how far the best topic is ahead of the next (0 to 1). Low means uncertain. */
  margin: number
  status: ReviewStatus
  stem: string
  crop: CropInfo
  /** Rubric points, when the student or the model drafted any. */
  rubric?: RubricPoint[]
  /** The mean line confidence of an OCR reading (0 to 1) as the engine sent it; absent for a question read from a text layer. */
  ocrConfidence?: number | null
  /** A page that OCR read but where no question start was found: one draft for the whole page, to split by hand (label "p3"). */
  wholePage?: boolean
  /** Where the question came from as the engine says (paper, hand, template, model-draft, harvest). */
  origin?: string
}

export interface RubricPoint {
  id: string
  text: string
  marks: number
  /** MODEL points stay dashed until the student accepts them. */
  origin: TagSource
  accepted: boolean
}

export type TraceKind = 'read' | 'ocr' | 'marks' | 'topic' | 'model' | 'fault'

/** One real event of one extraction run. The trace is the list of what happened; nothing is printed that did not occur. */
export interface TraceEvent {
  id: string
  /** Epoch ms of the event. */
  at: number
  kind: TraceKind
  /** The line, e.g. "read p1 text-layer ok" or "Q4 topic: RULE 0.64, next 0.33". */
  text: string
  /** The lamp state of the line: ok is LIVE, a fixture line SIMULATED, a pending model WAITING, a failure FAULT. */
  state: LampState
}

export type RouteId = 'drop' | 'paste' | 'folder' | 'classroom'
export interface IngestRoute {
  id: RouteId
  label: string
  state: LampState
  reason: string
}
export interface QueuedFile {
  id: string
  name: string
  method: 'text-layer' | 'ocr' | 'pasted' | 'slides'
  /** Words per page as the extractor counted them; an empty list while the file has not been read. */
  wordsPerPage: number[]
  reading: boolean
}
export interface IngestJob {
  id: string
  queued: QueuedFile[]
  events: TraceEvent[]
}
export interface IngestInput {
  route: RouteId
  files?: File[]
  text?: string
}

export type Decision =
  | { kind: 'accept'; qid: string }
  | { kind: 'edit'; qid: string; patch: Partial<Pick<QuestionRow, 'stem' | 'marks' | 'topicId' | 'type'>> }
  | { kind: 'merge'; qid: string }
  | { kind: 'split'; qid: string; at: number }
  | { kind: 'reject'; qid: string }
  | { kind: 'undo'; qid: string }
export interface DecisionResult {
  qid: string
  status: ReviewStatus
}

export interface CropRequest {
  qid: string
  bbox: readonly [number, number, number, number]
}

// The members below are the later packages' (X03 blueprint, X06 patterns, X08 marking, X10 readiness, C03 library, AD11
// classroom). They are typed here, once, so no later package reshapes the port; each is small on purpose.
export interface Blueprint {
  id: string
  label: string
  /** Sections as the source paper printed them. */
  sections: { label: string; set: number; attempt: number; marksEach: number }[]
  origin: TagSource
}
export interface GenerateRequest {
  blueprintId: string
  /** The seed is printed on the paper's footer so a paper can be drawn again. */
  seed: number
}
export interface GeneratedPaper {
  blueprintId: string
  seed: number
  questionIds: string[]
  /** Slots no reviewed question could fill, as words ("needs 2 more"). */
  gaps: string[]
}
export interface PatternSet {
  /** The syllabus topics, in syllabus order: the rows of the Paper Strata. */
  topics: Topic[]
  /** Papers on file when the figures were counted. Figures are LIVE only at 3 or more. */
  papers: number
  /** R-16 answered WAITING with the counts still present: fewer than 3 papers or 20 counted questions. The counts are a note, never a pattern. */
  provisional?: boolean
  /** Counted questions (accepted, with a unit and a topic); set with `provisional`. */
  questions?: number
  /** Topic id to the number of papers it was set in. */
  topicCounts: Record<string, number>
}
export interface GainItem {
  topicId: string
  /** A reason in words ("set in 5 of 6 papers, not practised"), never a forecast. */
  reason: string
  /** The engine's printed terms of the order as plain words, so the order can be redone by hand; absent when the engine sent none. */
  terms?: string
}
export interface CheckInput {
  qid: string
  answer: string
}
export interface CheckResult {
  matches: boolean
  working: string
}
export interface Readiness {
  practisedWeight: number
  timedPapers: number
  markedQuestions: number
  cardsDue: number
}
export interface Tonight {
  repeated: string[]
  cards: string[]
  gaps: string[]
}
export interface QueueItem {
  id: string
  kind: 'review' | 'card' | 'variant'
  label: string
}
export interface HarvestStatus {
  enabled: boolean
  queued: number
}
export interface IntakeStatus {
  files: number
  folderChosen: boolean
}
export interface ClassroomStatus {
  connected: boolean
  courses: number
  /** Added with the Classroom link (all optional, so nothing that read the two fields above changes). */
  connecting?: boolean
  syncedAt?: string
  scopes?: { name: string; label: string; granted: boolean }[]
  counts?: { courses: number; files: number; notes: number; papers: number; faults: number } | null
  job?: { status: 'idle' | 'running' | 'done' | 'failed' | 'stopped'; started: string | null; finished: string | null; text: string; fault_lines: string[] } | null
}

export interface QuestionFilter {
  paperId?: string
  status?: ReviewStatus
}

/** The sixteen members of the Study port, one per question a Study screen asks. */
export interface StudyPort {
  papers(): Promise<PortReply<PaperRow[]>>
  questions(filter?: QuestionFilter): Promise<PortReply<QuestionRow[]>>
  ingest(input: IngestInput): Promise<PortReply<IngestJob>>
  decide(decision: Decision): Promise<PortReply<DecisionResult>>
  crop(req: CropRequest): Promise<PortReply<CropInfo>>
  blueprints(): Promise<PortReply<Blueprint[]>>
  generate(req: GenerateRequest): Promise<PortReply<GeneratedPaper>>
  patterns(): Promise<PortReply<PatternSet>>
  /** The gain-ranked list of what to practise next (20.7.9). Not the Today list `NextThree` of DB01. */
  practiseNext(): Promise<PortReply<GainItem[]>>
  check(input: CheckInput): Promise<PortReply<CheckResult>>
  readiness(): Promise<PortReply<Readiness>>
  tonight(): Promise<PortReply<Tonight>>
  queue(): Promise<PortReply<QueueItem[]>>
  harvest(): Promise<PortReply<HarvestStatus>>
  intake(): Promise<PortReply<IntakeStatus>>
  classroom(): Promise<PortReply<ClassroomStatus>>
}

export type StudyMember = keyof StudyPort
export const STUDY_MEMBERS: readonly StudyMember[] = [
  'papers', 'questions', 'ingest', 'decide', 'crop', 'blueprints', 'generate', 'patterns',
  'practiseNext', 'check', 'readiness', 'tonight', 'queue', 'harvest', 'intake', 'classroom',
]

/** Put the registrations of every adapter file together: per member, the highest rank wins; the first file by path breaks a tie. */
export function composePort(regs: readonly StudyAdapterRegistration[]): StudyPort {
  const sorted = [...regs].sort((a, b) => a.rank - b.rank)
  const out: Partial<Record<StudyMember, unknown>> = {}
  for (const r of sorted) for (const k of STUDY_MEMBERS) if (r.port[k]) out[k] = r.port[k]
  // a member nobody supplies answers WAITING, so a missing adapter is never a thrown error on a screen
  for (const k of STUDY_MEMBERS) out[k] ??= () => Promise.resolve({ ...WAITING_DEFAULT, reason: 'no adapter registered', data: null })
  return out as unknown as StudyPort
}

const isReg = (x: unknown): x is StudyAdapterRegistration =>
  !!x && typeof x === 'object' && typeof (x as StudyAdapterRegistration).id === 'string' &&
  typeof (x as StudyAdapterRegistration).rank === 'number' && typeof (x as StudyAdapterRegistration).port === 'object'

/** Collect `adapters/*.register.ts` modules (default or `registration` export); a file with no registration is skipped. */
export function collectAdapters(modules: Record<string, unknown>): StudyAdapterRegistration[] {
  const out: StudyAdapterRegistration[] = []
  for (const path of Object.keys(modules).sort()) {
    const m = modules[path] as { default?: unknown; registration?: unknown } | undefined
    const reg = isReg(m?.default) ? m!.default : isReg(m?.registration) ? m!.registration : null
    if (reg) out.push(reg)
  }
  return out
}

/** The port the screens use: every registered adapter, composed. */
export const STUDY_PORT: StudyPort = composePort(collectAdapters(import.meta.glob('./adapters/*.register.ts', { eager: true })))
