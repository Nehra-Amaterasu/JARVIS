// The intake desk's port (package C03). `StudyPort.intake()` is frozen and answers only a count and a folder flag, which is not
// enough to draw a ledger; this is the one wider port the desk needs, kept in this folder so no frozen signature changes. The
// adapter of AD09 fills it over R-36 to R-42 (and the archive listing of E17) with `registerIntakeDesk`. Until then the null
// desk answers WAITING with a reason for every member, so a screen draws a hollow form and says why instead of inventing rows.
import { waiting } from '../adapters/types'
import type { PortReply } from '../ports'
import type { ArchiveListing, CourseRow, DecidePatch, IcsResult, IntakeRow, PasteResult, SubjectOption } from './types'

export interface IntakeDeskPort {
  list(): Promise<PortReply<IntakeRow[]>>
  subjects(): Promise<PortReply<SubjectOption[]>>
  /** R-37: the lines become rows in state `new`; unread lines come back listed, never guessed. */
  paste(text: string): Promise<PortReply<PasteResult>>
  /** R-38: the events become rows in state `new`. */
  ics(text: string): Promise<PortReply<IcsResult>>
  /** R-39: accept or decline; also `new` again, which is the Undo (the engine lane must allow it). */
  decide(id: string, patch: DecidePatch): Promise<PortReply<IntakeRow>>
  /** R-40: a file row goes to the paper ingest or to notes, on his press. */
  take(id: string, to: 'papers' | 'notes'): Promise<PortReply<IntakeRow>>
  /** R-41: removes the row, and the file only when the app owns the copy. */
  remove(id: string): Promise<PortReply<{ row: boolean; file: boolean }>>
  courses(): Promise<PortReply<CourseRow[]>>
  mapCourse(id: string, subject: string): Promise<PortReply<CourseRow>>
  /** R-46 with a file: lists what a Classroom export holds, from a copy of the .zip he picked; nothing is extracted by listing. */
  archive(file: File): Promise<PortReply<ArchiveListing>>
  /** R-46 with a path: the same listing for an absolute .zip path on this PC (a 500 MB export is not sent through the browser). */
  archivePath?(path: string): Promise<PortReply<ArchiveListing>>
  /** R-47: extracts only the named entries into the paper desk's reading job; the desk calls it with one name per press. */
  queueArchive(listingId: string, entryIds: string[]): Promise<PortReply<{ queued: number }>>
  /** The lines the store set aside on its last list (a rows file it could not read), for a screen to print under a fault. */
  problems?(): string[]
  /** Set when the store keeps a decision: R-39 takes accepted or declined only, so no Undo is drawn and no row goes back to new. */
  noUndo?: string
}

const ENGINE = 'the intake store has not answered yet'

export const nullIntakeDesk: IntakeDeskPort = {
  list: async () => waiting(ENGINE),
  subjects: async () => waiting(ENGINE),
  paste: async () => waiting('reading a list needs the intake store'),
  ics: async () => waiting('reading a calendar file needs the intake store'),
  decide: async () => waiting('a decision is saved by the intake store'),
  take: async () => waiting('reading a file needs the paper engine'),
  remove: async () => waiting('removing a row needs the intake store'),
  courses: async () => waiting('class names come from your lists'),
  mapCourse: async () => waiting('a mapping is saved by the intake store'),
  archive: async () => waiting('listing an export needs the archive reader'),
  queueArchive: async () => waiting('queueing needs the archive reader'),
}

let current: IntakeDeskPort = nullIntakeDesk

/** The desk the screens use. An adapter file calls `registerIntakeDesk` once; a test or the gallery passes its own as a prop. */
export const intakeDesk = (): IntakeDeskPort => current
export function registerIntakeDesk(port: Partial<IntakeDeskPort> | null): void {
  current = port ? { ...nullIntakeDesk, ...port } : nullIntakeDesk
}
