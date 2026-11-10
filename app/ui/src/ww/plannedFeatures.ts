/**
 * The carcass registry (plan 7): one entry for every feature the plan names that is not built yet.
 * Three things read it, so nothing is written twice and placement is testable:
 *   - a page renders its own placeholder with <Planned id="..."/> (Planned.tsx),
 *   - the Roadmap drawer lists every entry (overlays/Roadmap.tsx),
 *   - plannedFeatures.test.tsx checks coverage (plan items 7 to 19 once each, 28 entries, line lengths).
 *
 * An entry is DELETED in the same commit that ships the feature. A live control carries
 * `data-feature="<id>"`; while that id is still registered the stale test (staleEntries) fails.
 *
 * No number here may read as measured: the lines say "N" where a count belongs, and the page fills it
 * from live data (Planned `fill`) or leaves it out.
 */

/** E empty with a real first action, D disabled with a visible reason, C ComingCard, R Roadmap only. */
export type Pattern = 'empty' | 'disabled' | 'coming' | 'roadmap'

export interface Planned {
  id: string
  /** The plan's item number (7 to 19); the other rows carry none. */
  planItem?: number
  /** Where it renders: the page id of plan 3.3 (L, C1 to C6, R, phone) and the section id inside it. */
  page: string
  section: string
  label: string
  pattern: Pattern
  /** The one line shown: 15 to 140 characters, says what is missing and why. */
  line: string
  /** The precondition, shown on the Roadmap row. */
  needs: string
  /** The label of the real first action of an `empty` entry; the page supplies what it does. */
  action?: string
  when?: string
  /** The build chunk that ships it (plan section 9). */
  chunk?: string
  /** The row is already built and works; the registry only holds the blocked-state line. */
  built?: boolean
}

export const LINE_MIN = 15
export const LINE_MAX = 140

/** The Roadmap groups by where the feature lives, in the order the tabs run. */
export const GROUPS = ['Study', 'Tree', 'Life', 'Career', 'Proof', 'Setup', 'Left column', 'Phone'] as const
export type Group = (typeof GROUPS)[number]

const GROUP_OF_PAGE: Record<string, Group> = {
  C1: 'Study', C2: 'Tree', C3: 'Life', C4: 'Career', C5: 'Study', C6: 'Setup', R: 'Proof', L: 'Left column', phone: 'Phone',
}
export const groupOf = (p: Planned): Group => GROUP_OF_PAGE[p.page] ?? 'Setup'

export const PLANNED: readonly Planned[] = [
  // ---- the 13 numbered plan items (7 to 19)
  { id: 'sheets-rewritten', planItem: 7, page: 'C1', section: 'S2', label: 'Sheets with formulas and references', pattern: 'empty',
    line: 'No sheet is linked to this paper yet (N of N units).', action: 'Link a sheet',
    needs: 'A sheet linked per unit (every paper has no files today) and $...$ content in it.', chunk: '7' },
  { id: 'sharpen', planItem: 8, page: 'C2', section: 'T3', label: 'Sharpen and de-master', pattern: 'disabled', built: true,
    line: 'Sharpen needs one GATE-tier question solved on this node. No GATE bank yet.',
    needs: 'A GATE-tier question on the node. The server should supply the real blocker and the page shows that text.', chunk: '10' },
  { id: 'resource-progress', planItem: 9, page: 'C1', section: 'S7', label: 'Resource progress', pattern: 'roadmap',
    line: 'Chapter checklists per resource: not built. The resource itself opens now.',
    needs: 'A checklist typed once per resource. Only the checklist is not built; the Open link ships in chunk 7.', chunk: '7' },
  { id: 'knowledge-of-the-day', planItem: 10, page: 'C1', section: 'S6', label: 'Knowledge of the day, three tracks', pattern: 'roadmap',
    line: 'Today shows one track. Exam, skill and life tracks arrive with the concept bank.',
    needs: 'A concept bank that grows from sheets and notes.', chunk: '7' },
  { id: 'trees-v3', planItem: 11, page: 'C2', section: 'T1', label: 'Whole me, one canvas for all six trees', pattern: 'disabled',
    line: 'One canvas for all six trees is not built. Each tree opens on its own for now.',
    needs: 'The single-canvas build, and prerequisites that cross trees (none exist today).', chunk: '10' },
  { id: 'status-v2', planItem: 12, page: 'R', section: 'P3', label: 'Status v2, 4-week lines', pattern: 'empty',
    line: '4-week line: not built. Each tile shows this week only.',
    needs: 'The chart. "Needs 4 weeks of logs" appears only when that is the true blocker.', chunk: '9' },
  { id: 'life-v2', planItem: 13, page: 'C3', section: 'LF1', label: 'Holiday switch, library and music minutes', pattern: 'disabled',
    line: "Holiday switch is not built. Mark that day's classes Cancelled for now.",
    needs: 'The switch in the timetable engine.', chunk: '8' },
  { id: 'body-grand', planItem: 14, page: 'C3', section: 'LF5', label: 'Body, grand: discipline bank, V-taper targets', pattern: 'roadmap',
    line: 'Disciplines and standards are not built. Gym logs one session at a time.',
    needs: 'A discipline bank as data. Never medical advice.', chunk: '8' },
  { id: 'music-import', planItem: 15, page: 'C3', section: 'LF1', label: 'Music, history import then the API', pattern: 'roadmap',
    line: 'Spotify history import is not built. It needs your data export file first.',
    needs: 'The export file; later his own developer app.', chunk: '8' },
  { id: 'reels-v2', planItem: 16, page: 'C3', section: 'LF1', label: 'Reels v2, saved-file transcription', pattern: 'roadmap',
    line: 'Reels: a link and one line today. Transcription and summary are not built.',
    needs: 'A transcription job and a model summary.', chunk: '8' },
  { id: 'books', planItem: 17, page: 'C1', section: 'S6', label: 'Books, read-aloud and explain-back', pattern: 'roadmap',
    line: 'Book reader with read-aloud and explain-back is not built; the voice needs internet.',
    needs: 'The reader, and the online voice.', chunk: '7' },
  { id: 'ledger-publish', planItem: 18, page: 'R', section: 'P7', label: "Publish today's ledger", pattern: 'disabled',
    line: 'Publishing is not built.',
    needs: 'A public repo, a public-safe filter and an approval step per entry. The design is not decided.', when: 'needs a decision', chunk: '9' },
  { id: 'college-mail', planItem: 19, page: 'C6', section: 'SU13', label: 'College mail and Classroom', pattern: 'disabled',
    line: 'Waits on a one-hour test: can your college account authorise this app? Fallback: a watched folder.',
    needs: 'The test result; otherwise the watched folder and a calendar file.', chunk: '12' },

  // ---- the rows without an item number
  { id: 'cie-practice', page: 'C1', section: 'S3', label: 'CIE practice papers', pattern: 'empty',
    line: 'No CIE questions yet. A CIE paper is N marks; its shape is not set.', action: 'Add questions',
    needs: 'Questions in the bank (typed by hand, or on disk from the harvester) and the owner\'s answer on the shape.', chunk: '7' },
  { id: 'paste-paper', page: 'C1', section: 'S3', label: 'Paste a past paper', pattern: 'roadmap',
    line: 'Importing a pasted past paper needs a parser: not built. Add questions one at a time for now.',
    needs: 'A parser from pasted text to stem, marks and topic, and the owner\'s answer on sources.', when: 'needs a decision', chunk: '7' },
  { id: 'gate-tier', page: 'C1', section: 'S3', label: 'GATE tier', pattern: 'disabled',
    line: 'GATE: none on disk yet (N queued). Allowed sources only.',
    needs: 'GATE-tier items on disk per topic: own-written, openly licensed with a licence line, or pointer-only records. The control never falls back to exam questions.', chunk: 'H' },
  { id: 'parameterised-numericals', page: 'C1', section: 'S3', label: 'Parameterised numericals', pattern: 'roadmap', built: true,
    line: 'Numbers drawn fresh for each paper: circuits and control templates only so far.',
    needs: 'The symbolic generator that draws numbers and computes the key.', chunk: '7' },
  { id: 'proficiency', page: 'C1', section: 'S1', label: 'Proficiency per topic', pattern: 'empty',
    line: 'Proficiency per topic: not measured until you mark a paper.', action: 'Practice paper',
    needs: 'One marked paper.', chunk: '7' },
  { id: 'quest-lines', page: 'R', section: 'P4', label: 'Money and Social quest lines', pattern: 'disabled',
    line: 'Money and Social quest lines stay locked. Each row says why.',
    needs: 'The existing locked reason on each quest line, kept as it is.', chunk: '9' },
  { id: 'phone-pairing', page: 'L', section: 'L5', label: 'Phone pairing from Well Wisher', pattern: 'disabled', built: true,
    line: 'Not paired. Turn on the listener, pair, then scan.',
    needs: 'Already works as PhoneCard; this plan only adds the door. If the listener cannot start the line reads "Listener off".', chunk: '12' },
  { id: 'phone-papers', page: 'phone', section: 'last-line', label: 'Papers and formulas on the phone', pattern: 'disabled',
    line: 'Desktop only: papers, Tree, Setup (not on the phone yet).',
    needs: 'Server-emitted text for formulas and a phone paper view.', chunk: '13' },
  { id: 'harvester', page: 'C6', section: 'SU18', label: 'Question harvester', pattern: 'empty',
    line: 'Nothing fetched yet. A blocked source stays off until its licence line is recorded.', action: 'Queue a topic',
    needs: 'Backend chunk H, and each source\'s licence line recorded before it is switched on.', chunk: 'H' },
  { id: 'harvester-pdf', page: 'C6', section: 'SU18', label: 'PDF text for the harvester', pattern: 'disabled',
    line: 'PDF text uses the local PDF reader when present. A Python PDF library is not installed.',
    needs: 'The owner\'s OK for a PDF library; until then only the local reader.', when: 'needs a decision', chunk: 'H' },
  { id: 'dmat-practice', page: 'C1', section: 'S9', label: 'dMAT practice', pattern: 'roadmap', built: true,
    line: 'dMAT practice is not built. It will generate figure sequences, equation puzzles and Latin squares from the public rules.',
    needs: 'Backend chunk 2b and the view in chunk 7. After the build the empty state reads "No set taken yet."', chunk: '7' },
  { id: 'drafted-questions', page: 'C1', section: 'S3', label: 'Drafted questions to accept', pattern: 'roadmap',
    line: 'Drafted questions to accept or reject: not built. Add questions by hand or wait for the harvester.',
    needs: 'A drafting job and an accept or reject list, and the owner\'s answer on sources.', when: 'needs a decision', chunk: '7' },
  { id: 'calendar-file', page: 'C6', section: 'SU13', label: 'Calendar file of exams and study blocks', pattern: 'roadmap',
    line: 'A calendar file (.ics) to import on the phone: not built.',
    needs: 'The fallback of item 19: the file writer.', chunk: '12' },
  { id: 'phone-share', page: 'phone', section: 'last-line', label: 'Share a link from the phone', pattern: 'disabled',
    line: 'Sharing a reel from the phone: not built.',
    needs: 'The phone path of item 16.', chunk: '13' },
  { id: 'yaadash-link', page: 'C6', section: 'SU13', label: 'Yaadash link', pattern: 'disabled',
    line: 'Records are written to a staging folder for Yaadash to read. The reading side is not built here.',
    needs: 'Yaadash\'s reader of the staging folder. Whether the writer side is complete is unverified.', chunk: '12' },
]

export const plannedById = (id: string): Planned | undefined => PLANNED.find((p) => p.id === id)

/** Entries for a page and section: how a page asks "what do I owe here?". */
export const plannedFor = (page: string, section: string): Planned[] => PLANNED.filter((p) => p.page === page && p.section === section)

/**
 * Replace each stand-alone `N` in a line with the next live value. With no values the N stays: a
 * placeholder never invents a count. Extra values are ignored.
 */
export function fillLine(line: string, values?: readonly (string | number)[]): string {
  if (!values || values.length === 0) return line
  let i = 0
  return line.replace(/\bN\b/g, (m) => (i < values.length ? String(values[i++]) : m))
}

/**
 * The stale-placeholder check (plan 7): a feature that ships carries `data-feature="<id>"` on its live
 * control. An entry whose id is still registered while an enabled control with that id exists is stale and
 * must be deleted in the commit that shipped the feature. Returns the stale ids found under `root`.
 */
export function staleEntries(root: ParentNode = document): string[] {
  const out: string[] = []
  for (const p of PLANNED) {
    for (const el of root.querySelectorAll<HTMLElement>(`[data-feature="${p.id}"]`)) {
      const inert = el.getAttribute('aria-disabled') === 'true' || (el as HTMLButtonElement).disabled === true
      if (!inert && !el.closest('[data-planned]')) {
        out.push(p.id)
        break
      }
    }
  }
  return out
}

/** What the Roadmap lists: the entries not built yet. A built row (phone pairing, dMAT since chunk 7, sharpen since chunk 10, numericals since 10 Nov) keeps its
 * entry only for its blocked or empty state, so it must not appear in a list titled "What is not built". */
export const UNBUILT: readonly Planned[] = PLANNED.filter((p) => !p.built)
