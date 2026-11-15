// Package C03 (Intake UI): the nouns of the manual intake desk. The shapes are the screens' own needs; the route shapes of
// R-36 to R-42 are written once in docs/design/well-wisher-engine-plan.md and the adapter of AD09 maps one onto the other
// (snake_case on the wire, camelCase here). Nothing in this file reads a route.
import type { LampState } from '../../../shared/lamp'

/** Where an item came from. `classroom` is drawn PLANNED until the owner signs in; no row carries it today. */
export type IntakeSource = 'paste' | 'ics' | 'folder' | 'archive' | 'classroom'
export type IntakeKind = 'deadline' | 'event' | 'file'
/** `taken`: a file row the student sent to Papers or Notes. A row is `new` until his press. */
export type IntakeState = 'new' | 'accepted' | 'declined' | 'taken'

/** The five rungs of an attachment (spec 21.4.3). The connector alone can reach LINKED; the other four are his. */
export const LADDER = ['linked', 'asked', 'downloaded', 'matched', 'ingested'] as const
export type LadderStage = (typeof LADDER)[number]

export interface IntakeRow {
  id: string
  source: IntakeSource
  kind: IntakeKind
  state: IntakeState
  title: string
  /** Local calendar day, "YYYY-MM-DD", or null when no date was read (or it is ambiguous and not yet chosen). */
  date: string | null
  /** Local "HH:MM", or null for a date without a time (shown as a date, never as midnight). */
  time: string | null
  /** Two readings ("03/04" is a 3 April or a 4 March) when the date is ambiguous; empty otherwise. */
  readings: string[]
  ambiguous: boolean
  /** The confirmed subject id, or "". A suggestion is never applied by itself. */
  subject: string
  suggestion: { subject: string; score: number } | null
  repeats: boolean
  file: { name: string; size: number; owned: boolean } | null
  /** The line or file name the item was read from, when the store kept it. Shown as provenance; absent is said, not invented. */
  raw?: string
  /** Epoch ms the row was added. */
  added: number
  /** Where the attachment stands, for a Classroom row (later) or a file row. */
  ladder?: LadderStage
}

export interface SubjectOption { id: string; label: string }

export interface CourseRow {
  id: string
  /** The name as read; the mapper truncates it at 36 characters and shows the whole of it on focus. */
  name: string
  from: 'lists' | 'classroom'
  subject: string
  suggestion: { subject: string; score: number } | null
  items: number
}

export interface UnreadLine { line: number; text: string; reason: string }
export interface PasteResult { items: IntakeRow[]; unread: UnreadLine[] }
export interface IcsResult { items: IntakeRow[]; skipped: number }
export interface ArchiveEntry { id: string; name: string; size: number; refused?: string }
export interface ArchiveListing { id: string; name: string; entries: ArchiveEntry[] }

export interface DecidePatch {
  state: IntakeState
  date?: string
  subject?: string
}

/** The lamp state and reason a whole screen shows for its data. */
export interface DeskHead { state: LampState; reason: string }
