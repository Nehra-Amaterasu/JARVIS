// The shapes of the Classroom routes (G-01 to G-13, prefix /api/mission/gcr). Every JSON answer is the envelope
// {state, reason, source, ...fields}; the fields below are the "..." of each route. Types only: nothing here runs.
import type { LampState } from '../../../shared/lamp'

export interface GcrScope { name: string; label: string; granted: boolean }
export interface GcrCounts { courses: number; files: number; notes: number; papers: number; faults: number }

/** G-05. `started` and `finished` are whatever stamp the engine writes; they are shown as text, never parsed. */
export interface GcrJob {
  status: 'idle' | 'running' | 'done' | 'failed'
  started: string | null
  finished: string | null
  text: string
  counts: GcrCounts | null
  fault_lines: string[]
}

/** G-01 (and G-03). */
export interface GcrStatusBody {
  scopes: GcrScope[]
  connecting: boolean
  synced_at: string
  counts: GcrCounts | null
  job: GcrJob | null
}

export interface GcrCourse {
  id: string
  name: string
  section: string
  state: LampState
  subject: string
  subject_source: string
  include: boolean
  files: number
  notes: number
  papers: number
  read_at: string
  link: string
}

export type GcrKind = 'notes' | 'paper' | 'other'

export interface GcrFile {
  id: string
  course: string
  course_name: string
  subject: string
  title: string
  ext: string
  kind: GcrKind
  kind_source: string
  state: LampState
  reason: string
  note_state: LampState
  note_reason: string
  pages: number | null
  words: number | null
  scanned_pages: number | null
  size: number | null
  modified: string
  post: { kind: string; title: string; topic: string }
  has_note: boolean
  has_original: boolean
  paper_id: string | null
}

export interface GcrNoteBody { markdown: string; title: string; words: number | null; pages: number | null; scanned_pages: number | null }

/** What the screens read from any route: the engine's state and sentence, and the fields when it answered. */
export interface GcrAnswer<T> {
  state: LampState
  /** The engine's sentence, or the app's own when the engine did not answer (routes absent, no token, no answer). */
  reason: string
  source: string
  /** 'engine' when the engine answered (a refusal included); 'app' when this window made the answer up from a missing piece. */
  from: 'engine' | 'app'
  /** HTTP status of the answer; 0 when none came. */
  status: number
  since: number | null
  data: T | null
}

export interface GcrOriginal { url: string; mime: string; bytes: number }

export interface GcrFileQuery { course?: string; kind?: GcrKind | ''; q?: string }
