// The adapter side of the Study port (package Y01). `ports.ts` collects every `adapters/*.register.ts` file, and each file
// exports one `StudyAdapterRegistration`. This file holds the registration type and the two honest answers an adapter
// uses when it has nothing to say, so the null adapter (and any later adapter that is half built) cannot invent data.
import type { PortReply, StudyPort } from '../ports'

/** One adapter file's registration. A later adapter overrides only the members it supplies, by rank. */
export interface StudyAdapterRegistration {
  id: string
  /** The null adapter is 0; a real adapter is 10 or more. A higher rank wins per member. */
  rank: number
  port: Partial<StudyPort>
}

/** WAITING with a reason, and no data. The default answer of every member until an engine route is merged. */
export const waiting = <T,>(reason: string): PortReply<T> => ({ state: 'waiting', reason, since: null, data: null })

/** PLANNED: no code path exists yet (the Classroom connector, for one). */
export const planned = <T,>(reason: string): PortReply<T> => ({ state: 'planned', reason, since: null, data: null })

// ------------------------------------------------------------------------------------------------ OCR on demand and drafts from notes
// Routes R-28, R-48, R-49 (OCR) and R-50 to R-52 (drafts) of docs/design/well-wisher-engine-plan.md, section 9.0 (25 Nov lines).
// They are not members of the frozen sixteen-member Study port: the paper desk reaches them through `PyqClient` (adapters/pyqExtras.ts).

/** The words of a reply that is not a port member's: the same shape as `PortReply`, but `data` may travel with WAITING too,
 * because "Stopping after the page being read" is WAITING while a job still has a page number the desk must keep drawing. */
export interface ClientReply<T> {
  state: import('../../../shared/lamp').LampState
  reason: string
  since: number | null
  data: T | null
}

export type OcrJobStatus = 'running' | 'done' | 'failed' | 'stopped'
export interface OcrJob {
  id: string
  status: OcrJobStatus
  paperId: string
  pagesTotal: number
  pagesDone: number
  /** The page being read (1-based), or null when the engine named none. */
  pageNow: number | null
  pagesRead: number
  /** Pages whose mean line confidence was under the gate: they stay pictures. */
  pagesBelowGate: number
  /** Drafts the reading produced. They arrive pending, never accepted. */
  questions: number
  started: string | null
  finished: string | null
  /** Seconds per page as the engine measured it; null before the first page is done. */
  secondsPerPage: number | null
}
export interface OcrStatus {
  engine: { name: string; version: string; device: string; installed: boolean } | null
  /** The confidence below which a page is left as a picture (0.85 on 25 Nov). */
  gate: number
  job: OcrJob | null
  /** Papers on file with pages that have no text layer, and how many pages that is. */
  waiting: { papers: number; pages: number }
}

export type DraftStatus = 'pending' | 'accepted' | 'rejected'
export interface DraftRow {
  id: string
  subject: string
  unit: number | null
  topic: string
  text: string
  marks: number | null
  status: DraftStatus
  /** Always "model-draft" from the engine today; kept so a different origin is never drawn as the model's. */
  origin: string
  sources: { fileId: string; title: string }[]
  /** The engine's own checks: did the draft copy its passage, and the 5-word-shingle similarity (0 to 1). Null when it sent none. */
  copied: boolean | null
  similarity: number | null
  made: string
  /** Why the engine stored it as rejected (copied from the notes, for one). */
  reason: string
  /** Set once the draft became a question of the bank. */
  questionId: string | null
  edited: boolean
}
export interface DraftRequest { subject: string; topic: string; unit?: number; count?: number; marks?: number }
export interface DraftPatch { status: 'accepted' | 'rejected'; text?: string; marks?: number; unit?: number; topic?: string }

/** The OCR and draft calls of the paper desk. Every call answers the engine's own state and sentence; none is invented. */
export interface PyqClient {
  ocrStatus(signal?: AbortSignal): Promise<ClientReply<OcrStatus>>
  ocrStart(paperId: string, pages?: number[]): Promise<ClientReply<OcrStatus>>
  ocrStop(): Promise<ClientReply<OcrStatus>>
  draftsMake(req: DraftRequest): Promise<ClientReply<DraftRow[]>>
  draftsList(filter?: { subject?: string; status?: DraftStatus }, signal?: AbortSignal): Promise<ClientReply<DraftRow[]>>
  draftsDecide(id: string, patch: DraftPatch): Promise<ClientReply<DraftRow>>
  /** Cancel every call in flight (a view calls this when it unmounts). */
  abortAll(): void
}
