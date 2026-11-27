// The shapes of the Classroom routes (G-01 to G-13, prefix /api/mission/gcr). Every JSON answer is the envelope
// {state, reason, source, ...fields}; the fields below are the "..." of each route. Types only: nothing here runs.
import type { LampState } from '../../../shared/lamp'

export interface GcrScope { name: string; label: string; granted: boolean }
export interface GcrCounts { courses: number; files: number; notes: number; papers: number; faults: number }

/** G-05. `started` and `finished` are whatever stamp the engine writes; they are shown as text, never parsed. */
export interface GcrJob {
  status: 'idle' | 'running' | 'done' | 'failed' | 'stopped'
  started: string | null
  finished: string | null
  text: string
  counts: GcrCounts | null
  fault_lines: string[]
}

/** One signed-in account of G-01: a short lower-case name, its own state word and the engine's sentence. */
export interface GcrAccount { name: string; state: LampState; reason: string }

/** G-01 (and G-03). */
export interface GcrStatusBody {
  accounts?: GcrAccount[]
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
  /** The lamp word the screen draws. The engine's item `state` is Google's own course state ("active", "archived", ...), so the adapter
   *  maps it (courseLamp) and keeps the engine's word in `google_state`. */
  state: LampState
  /** Google's course state as the engine sent it, when it was not a lamp word. */
  google_state?: string
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
  /** True when the newer version of this file could not be fetched, so this is an older copy. */
  stale?: boolean
  /** Other courses the same file was posted in. */
  also_in?: { course: string; post_title: string }[]
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

// ---------------------------------------------------------------- G-14 to G-19 (what is due, announcements, calendar, reminders)

/** What Classroom says of his own submission: the engine passes its word through, and the screen never turns it into a grade or a judgement. */
export type GcrWork = 'assigned' | 'turned_in' | 'returned' | 'unknown'

/** The reminder made for an assignment: its id is the one of /api/reminders, `due` is local "YYYY-MM-DDTHH:MM". */
export interface GcrReminder { id: string; due: string; text?: string }

export interface GcrAssignment {
  id: string
  course: string
  course_name: string
  subject: string
  title: string
  /** "YYYY-MM-DD", or "" when the work has no due date. */
  due: string
  /** "HH:MM" local time, or "". */
  due_time: string
  days_left: number | null
  link: string
  work: GcrWork
  /** What Classroom reports; never a judgement made here. */
  late: boolean
  reminder: GcrReminder | null
  updated?: string
}

export interface GcrAssignmentCounts { open: number; turned_in: number; late: number; no_due_date: number }

/** G-15's fields. `read_at` is the engine's stamp of the last read, shown as text. */
export interface GcrAssignmentsBody { items: GcrAssignment[]; counts: GcrAssignmentCounts | null; read_at: string }

export interface GcrAnnouncement { id: string; course: string; course_name: string; text: string; posted: string; link: string }

export interface GcrEvent { id: string; title: string; start: string; end: string; all_day: boolean; calendar: string; link: string }

export interface GcrAssignmentQuery { course?: string; show?: 'open' | 'all' }
