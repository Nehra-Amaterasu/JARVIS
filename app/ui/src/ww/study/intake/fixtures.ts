// Invented rows for the gallery, the tests and the bench (package C03). Every item is made up: no real course, institution or
// paper text. Everything drawn from here is stamped SIMULATED by the screen that shows it. The fixture desk is an in-memory
// IntakeDeskPort with a tiny fixture reader for pasted lines and calendar events, so a gallery state can be driven by hand; it
// is not the engine's parser and says so in the reason of every answer.
import type { PortReply } from '../ports'
import { localDay } from './model'
import type { IntakeDeskPort } from './port'
import type { ArchiveListing, CourseRow, IcsResult, IntakeRow, PasteResult, SubjectOption } from './types'

/** A fixed clock: Sunday 15 November 2026, noon, local. */
export const NOW = new Date(2026, 10, 15, 12, 0).getTime()
const H = 3_600_000
const D = 24 * H

export const SUBJECTS: SubjectOption[] = [
  { id: 'maths', label: 'Maths' },
  { id: 'signals', label: 'Signals' },
  { id: 'thermo', label: 'Thermodynamics' },
  { id: 'circuits', label: 'Circuits' },
]

const base: Omit<IntakeRow, 'id' | 'source' | 'kind' | 'title'> = {
  state: 'new', date: null, time: null, readings: [], ambiguous: false, subject: '', suggestion: null, repeats: false, file: null, added: NOW - 2 * H,
}
const row = (id: string, source: IntakeRow['source'], kind: IntakeRow['kind'], title: string, over: Partial<IntakeRow> = {}): IntakeRow => ({ ...base, id, source, kind, title, ...over })

export const ROWS: IntakeRow[] = [
  row('r1', 'paste', 'deadline', 'Assignment 3', { date: '2026-11-18', time: '17:00', suggestion: { subject: 'maths', score: 0.8 }, raw: 'Maths Assignment 3 - due 18 Nov 5pm' }),
  row('r2', 'paste', 'deadline', 'Lab report 2', { date: '2026-11-19', time: '09:00', subject: 'signals', raw: 'Signals Lab report 2 - due 19 Nov 9am' }),
  row('r3', 'ics', 'event', 'Thermo tutorial', { date: '2026-11-20', time: '14:00', suggestion: { subject: 'thermo', score: 0.72 } }),
  row('r4', 'paste', 'deadline', 'Quiz 1', {
    date: null, ambiguous: true, readings: ['2026-12-03', '2027-03-12'], raw: 'Circuits Quiz 1 - due 03/12', suggestion: { subject: 'circuits', score: 0.66 },
  }),
  row('r5', 'ics', 'deadline', 'Problem set 5', { date: '2026-11-27', time: '23:59', subject: 'maths' }),
  row('r6', 'folder', 'file', 'notes-unit4.pdf', { file: { name: 'notes-unit4.pdf', size: 482_000, owned: false }, added: NOW - H, suggestion: { subject: 'signals', score: 0.75 } }),
  row('r7', 'folder', 'file', 'scan-2019.pdf', { file: { name: 'scan-2019.pdf', size: 3_200_000, owned: false }, added: NOW - 30 * 60_000 }),
  row('r8', 'paste', 'deadline', 'Project proposal', { date: '2026-12-04', subject: 'circuits', raw: 'Circuits Project proposal - due 4 Dec' }),
  row('r9', 'ics', 'event', 'Weekly tutorial', { date: '2026-11-17', time: '10:00', repeats: true, subject: 'maths' }),
  row('r10', 'paste', 'deadline', 'Assignment 1', { date: '2026-11-01', added: NOW - 20 * D, raw: 'Maths Assignment 1 - due 1 Nov' }),
  row('r11', 'ics', 'deadline', 'Lab 1 write-up', { state: 'accepted', date: '2026-11-12', time: '12:00', subject: 'signals' }),
  row('r12', 'paste', 'event', 'Seminar', { state: 'declined', date: '2026-11-21', time: '16:00' }),
]

export const COURSES: CourseRow[] = [
  { id: 'c1', name: 'Maths', from: 'lists', subject: 'maths', suggestion: null, items: 4 },
  { id: 'c2', name: 'Signals and Systems', from: 'lists', subject: '', suggestion: { subject: 'signals', score: 0.71 }, items: 3 },
  { id: 'c3', name: 'Workshop practice, term two, group B (the longer name that the mapper truncates)', from: 'lists', subject: '', suggestion: null, items: 1 },
]

export const ARCHIVE: ArchiveListing = {
  id: 'a1', name: 'classroom-export.zip',
  entries: [
    { id: 'e1', name: 'week1-slides.pdf', size: 912_000 },
    { id: 'e2', name: 'week2-slides.pdf', size: 1_050_000 },
    { id: 'e3', name: 'tutorial-sheet.pdf', size: 220_000 },
    { id: 'e4', name: 'recording.mp4', size: 52_000_000, refused: 'a video is not read' },
    { id: 'e5', name: '../outside.pdf', size: 4_000, refused: 'a path that leaves the archive is refused' },
  ],
}

/** Three pasted lines the fixture reader can read and one it cannot, for the Paste door's gallery state. */
export const PASTE_SAMPLE = [
  'Maths Assignment 4 - due 25 Nov 5pm',
  'Signals Lab 3 - due 2 Dec',
  'Circuits viva on Thursday',
  'Thermo problem set - due 28 Nov 11:30am',
].join('\n')

/** A calendar file of three events, one repeating and one with no start, for the calendar-file door's gallery state. */
export const ICS_SAMPLE = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT', 'SUMMARY:Signals tutorial', 'DTSTART:20261124T100000', 'RRULE:FREQ=WEEKLY', 'END:VEVENT',
  'BEGIN:VEVENT', 'SUMMARY:Thermo quiz', 'DTSTART:20261126T140000', 'END:VEVENT',
  'BEGIN:VEVENT', 'SUMMARY:Open day', 'END:VEVENT',
  'END:VCALENDAR',
].join('\n')

/** Forty NEW rows in two courses, one mapped (the batch and paging test of the critic's improvement). */
export function manyRows(n = 40): IntakeRow[] {
  return Array.from({ length: n }, (_, i) => row(`m${i}`, i % 2 ? 'ics' : 'paste', 'deadline', `Task ${i + 1}`, {
    date: i % 9 === 8 ? null : localDay(NOW + (i % 30) * D), time: i % 3 ? '17:00' : null, subject: i % 2 ? 'maths' : '', added: NOW - (i % 5) * H,
  }))
}

const ok = <T,>(data: T, reason = 'invented items, not read from a list'): PortReply<T> => ({ state: 'simulated', reason, since: NOW, data })

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
/** The fixture reader of one pasted line: "<title> - due <d> <Mon> [<h>[:<mm>]am|pm]". Anything else is listed as not read. */
export function fixtureReadLine(line: string, id: string, added: number): IntakeRow | null {
  const m = /^(.+?)\s*[-–]\s*due\s+(\d{1,2})\s+([A-Za-z]{3})[a-z]*(?:\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm))?\s*$/i.exec(line.trim())
  const mon = m ? MONTHS.indexOf(m[3].toLowerCase()) : -1
  if (!m || mon < 0) return null
  let h = m[4] ? Number(m[4]) % 12 + (m[6].toLowerCase() === 'pm' ? 12 : 0) : null
  if (h !== null && h > 23) h = null
  const year = new Date(NOW).getFullYear() + (mon < new Date(NOW).getMonth() ? 1 : 0)
  return row(id, 'paste', 'deadline', m[1].trim(), {
    date: `${year}-${String(mon + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`, time: h === null ? null : `${String(h).padStart(2, '0')}:${m[5] ?? '00'}`, raw: line.trim(), added,
  })
}

const icsStamp = (s: string): { date: string; time: string | null } | null => {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/.exec(s.trim())
  return m ? { date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ? `${m[4]}:${m[5]}` : null } : null
}
/** The fixture reader of a calendar file: VEVENT blocks with SUMMARY and DTSTART; an event with no readable start is skipped. */
export function fixtureReadIcs(text: string, idBase: string, added: number): IcsResult {
  const items: IntakeRow[] = []
  let skipped = 0
  for (const block of text.split('BEGIN:VEVENT').slice(1)) {
    const sum = /SUMMARY[^:\n]*:(.+)/.exec(block)?.[1]?.trim()
    const start = icsStamp(/DTSTART[^:\n]*:(.+)/.exec(block)?.[1] ?? '')
    if (!sum || !start) { skipped += 1; continue }
    items.push(row(`${idBase}${items.length}`, 'ics', 'event', sum, { ...start, repeats: /RRULE/.test(block), added }))
  }
  return { items, skipped }
}

export interface FixtureDeskOptions { rows?: IntakeRow[]; courses?: CourseRow[] }

/** An in-memory desk over the fixtures; every answer is SIMULATED and says so. Used by the gallery, the bench and the tests. */
export function makeFixtureDesk(o: FixtureDeskOptions = {}): IntakeDeskPort {
  let rows = (o.rows ?? ROWS).map((r) => ({ ...r }))
  let courses = (o.courses ?? COURSES).map((c) => ({ ...c }))
  let n = 0
  const put = (r: IntakeRow) => { rows = rows.map((x) => (x.id === r.id ? r : x)) }
  const find = (id: string) => rows.find((r) => r.id === id)
  const gone = <T,>(): PortReply<T> => ({ state: 'fault', reason: 'no such item', since: NOW, data: null })
  return {
    list: async () => ok(rows.map((r) => ({ ...r }))),
    subjects: async () => ok(SUBJECTS),
    paste: async (text): Promise<PortReply<PasteResult>> => {
      const items: IntakeRow[] = []
      const unread: PasteResult['unread'] = []
      text.split(/\r?\n/).forEach((line, i) => {
        if (!line.trim()) return
        const r = fixtureReadLine(line, `p${++n}`, NOW)
        if (r) items.push(r)
        else unread.push({ line: i + 1, text: line.trim(), reason: 'no date after the word due' })
      })
      rows = [...rows, ...items]
      return ok({ items, unread }, 'read by the fixture reader, not the engine')
    },
    ics: async (text) => {
      const res = fixtureReadIcs(text, `i${++n}-`, NOW)
      rows = [...rows, ...res.items]
      return ok(res, 'read by the fixture reader, not the engine')
    },
    decide: async (id, patch) => {
      const r = find(id)
      if (!r) return gone()
      const next = { ...r, state: patch.state, date: patch.date ?? r.date, ambiguous: patch.date ? false : r.ambiguous, subject: patch.subject ?? r.subject }
      put(next)
      return ok(next)
    },
    take: async (id) => {
      const r = find(id)
      if (!r) return gone()
      const next = { ...r, state: 'taken' as const, ladder: 'ingested' as const }
      put(next)
      return ok(next)
    },
    remove: async (id) => {
      const r = find(id)
      if (!r) return gone()
      rows = rows.filter((x) => x.id !== id)
      return ok({ row: true, file: !!r.file?.owned })
    },
    courses: async () => ok(courses.map((c) => ({ ...c }))),
    mapCourse: async (id, subject) => {
      const c = courses.find((x) => x.id === id)
      if (!c) return gone()
      const next = { ...c, subject }
      courses = courses.map((x) => (x.id === id ? next : x))
      return ok(next)
    },
    archive: async () => ok(ARCHIVE, 'a fixture listing, not a real export'),
    queueArchive: async (_id, ids) => ok({ queued: ids.length }),
  }
}
