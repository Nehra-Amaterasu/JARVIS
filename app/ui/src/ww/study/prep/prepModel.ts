// The pure parts of the Prepare face (board requests 21 and 23, queue rows R34 and V8): the one sentence on top of WHERE IT STANDS,
// the rows of counts, the words of each step and of a run before it is pressed. Each is built only from the engine's counts and
// sentences, so a test checks every rule without a screen. No judgement is added: a count is said, never graded.
import type { ClaudeModel, PrepCounts, Provider, RunInfo, Step, SubjectCounts } from '../adapters/pyqPrep'

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** A topic can stand on an evening sheet with this many accepted questions with text and marks (ww_pyq/next.py MIN_QUESTIONS, 3). */
export const SHEET_MIN_QUESTIONS = 3

/**
 * The plain sentence on top of the counts: what is missing for the study screens to work, from the counts alone. Examples on his
 * real store of 28 Nov (880 questions, 0 accepted): "880 questions, 0 accepted: nothing can be ranked or put on a sheet yet."
 */
export function missingSentence(c: PrepCounts | null): string {
  if (!c || c.questions === null || c.accepted === null) return 'The counts have not been read, so nothing is said about them.'
  const loose = c.withoutSubject ?? 0
  const tail = loose > 0 ? ` ${plural(loose, 'paper has', 'papers have')} no subject, so ${loose === 1 ? 'its' : 'their'} questions are in no subject's count.` : ''
  if ((c.papers ?? 0) === 0 && c.questions === 0) return 'No paper on file yet, so there is nothing to prepare.'
  if (c.questions === 0) return `${plural(c.papers ?? 0, 'paper', 'papers')} on file and no question read from ${c.papers === 1 ? 'it' : 'them'} yet.${tail}`
  if (c.accepted === 0) return `${plural(c.questions, 'question', 'questions')}, 0 accepted: nothing can be ranked or put on a sheet yet.${tail}`
  const ready = c.sheetReadyTopics
  if (ready === 0) return `${plural(c.accepted, 'question', 'questions')} accepted, and no topic has ${SHEET_MIN_QUESTIONS} accepted questions: no evening sheet can be built yet.${tail}`
  if (ready === null) return `${plural(c.accepted, 'question', 'questions')} of ${c.questions} accepted; the engine sent no count of topics ready for a sheet.${tail}`
  return `${plural(ready, 'topic is', 'topics are')} ready for an evening sheet; ${c.pending ?? 0} of ${plural(c.questions, 'question', 'questions')} still wait for review.${tail}`
}

export interface CountRow { key: string; label: string; value: number | null; note?: string }

/** The totals, in the order he reads them: what is on file, then what is reviewed, then what the study screens need. */
export function totalRows(c: PrepCounts): CountRow[] {
  return [
    { key: 'papers', label: 'Papers', value: c.papers, note: 'solution sheets are counted apart' },
    { key: 'without_subject', label: 'Papers without a subject', value: c.withoutSubject },
    { key: 'question_banks', label: 'Question banks', value: c.questionBanks },
    { key: 'solutions', label: 'Solution sheets', value: c.solutions?.papers ?? null, note: c.solutions?.items !== null && c.solutions?.items !== undefined ? `${plural(c.solutions.items, 'item', 'items')}, never questions` : undefined },
    { key: 'questions', label: 'Questions', value: c.questions },
    { key: 'pending', label: 'Pending review', value: c.pending },
    { key: 'accepted', label: 'Accepted', value: c.accepted },
    { key: 'accepted_unmarked', label: 'Accepted, marks not printed', value: c.acceptedUnmarked },
    { key: 'with_marks', label: 'With marks', value: c.withMarks },
    { key: 'marks_not_printed', label: 'Marks not printed', value: c.marksNotPrinted, note: 'questions of a question bank' },
    { key: 'tagged', label: 'With a topic', value: c.tagged },
    { key: 'not_questions', label: 'Not questions', value: c.notQuestions, note: 'kept out of acceptance' },
    { key: 'sheet_ready_topics', label: 'Topics ready for a sheet', value: c.sheetReadyTopics, note: `${SHEET_MIN_QUESTIONS} accepted questions each` },
  ]
}

export function subjectRows(s: SubjectCounts): CountRow[] {
  return [
    { key: 'papers', label: 'Papers', value: s.papers },
    { key: 'questions', label: 'Questions', value: s.questions },
    { key: 'pending', label: 'Pending', value: s.pending },
    { key: 'accepted', label: 'Accepted', value: s.accepted },
    { key: 'with_marks', label: 'With marks', value: s.withMarks },
    { key: 'tagged', label: 'With a topic', value: s.tagged },
    { key: 'sheet_ready_topics', label: 'Topics ready', value: s.sheetReadyTopics },
  ]
}

/** What each step does, in the engine's terms (plan 9.0, the lines of 28 Nov), said before any press. */
export const STEP_WORDS: Record<Step, { label: string; does: string }> = {
  subjects: { label: "Find each paper's subject", does: "By its Classroom course, a course code or the subject's name on it. A model's pick is only kept as a suggestion for your press; a subject you chose is never overwritten." },
  reread: { label: 'Read the papers again', does: "With today's reader. A paper's questions are replaced only when none of them is accepted, tagged by you or edited by you, and the old ones are kept beside it in one backup file." },
  tags: { label: 'Tag topics', does: "The rule first. With the model, it picks one of the subject's own topics or none, 20 questions a batch; a pick outside your topics is dropped and a tag you set is never touched." },
  accept: { label: 'Accept safe questions', does: 'Only when your policy under Who decides is on: questions read from a text layer, over 40 characters, with a subject, marks (a question bank prints none), a unit and a topic. Each says it was accepted by rule; Take back returns them.' },
}

/** The engine's measured times (board request 23; research file of 28 Nov), said on the tray before Run. */
export const MEASURED = 'Measured by the engine on 28 Nov: reading 89 papers again took 240 to 510 s (4 to 9 minutes), and one model batch of 20 questions takes 30 to 50 s.'

/** How many papers or questions the model is asked in a look (apply false): one batch of 20, so a look costs 30 to 50 s, not a run. */
export const LOOK_MODEL_LIMIT = 20

export const PROVIDER_WORD: Record<Provider, string> = { off: 'Off (rules only)', local: 'Local model', claude: 'Claude' }

/**
 * The engine's sentence for each choice of R-64, as routes_ww_pyq_model.py writes it once that choice is on file. R-64 answers the sentence
 * of the choice on file only, so the sentences of the other two are these copies of its words; they are said BEFORE a choice is pressed.
 */
export function providerSentence(p: Provider, model: ClaudeModel | null): string {
  if (p === 'off') return 'Rules only: no model is asked, and nothing leaves this PC.'
  if (p === 'local') return 'The local model on this PC is asked, and nothing leaves this PC.'
  return `Claude (${model ?? 'sonnet'}) is asked through the Claude tool on this PC: the text of your questions and notes leaves this PC and counts against your Claude usage.`
}

/** The policy's two sentences (routes_ww_pyq_prep.py policy_answer), and what "safe" means there (R-70's source string). */
export const POLICY_ON = 'Questions safe to trust may be accepted by rule; each says so.'
export const POLICY_OFF = 'Off: nothing enters the bank without your review.'
export const SAFE_MEANS = 'Safe means: text read from a text layer (never OCR, never a picture), over 40 characters, a paper with a subject, marks present (a question bank prints none), a unit and a topic present. One press of Take back returns every question the rule accepted in that subject to pending.'

/** What a press of Run will do, said before it: the steps in the engine's order, on what, with what. */
export function runWords(steps: readonly Step[], subjectName: string | null, model: { on: boolean; name: string; sendsOut: boolean }): string {
  const order: Step[] = (['subjects', 'reread', 'tags', 'accept'] as Step[]).filter((s) => steps.includes(s))
  if (!order.length) return 'Tick at least one step first.'
  const what = order.map((s) => STEP_WORDS[s].label.toLowerCase()).join(', then ')
  const on = subjectName ? `the papers of ${subjectName}` : 'every subject and every paper'
  const by = model.on ? `with the model${model.name ? ` (${model.name})` : ''}${model.sendsOut ? '; the text of your questions leaves this PC and counts against your Claude usage' : ''}` : 'by rule only, no model asked'
  return `Run writes to your question store: ${what}, on ${on}, ${by}. Every value it writes says who set it.`
}

export const END_WORD: Record<Exclude<RunInfo['status'], 'running'>, string> = { done: 'Done', stopped: 'Stopped', failed: 'Failed' }

/** The counts shown side by side while a run goes and when it ends: before it and now. */
export const BEFORE_NOW: { key: keyof PrepCounts; label: string }[] = [
  { key: 'accepted', label: 'Accepted' },
  { key: 'tagged', label: 'With a topic' },
  { key: 'withoutSubject', label: 'Papers without a subject' },
  { key: 'pending', label: 'Pending review' },
  { key: 'withMarks', label: 'With marks' },
  { key: 'sheetReadyTopics', label: 'Topics ready for a sheet' },
]

/** A count as drawn: the engine's number, or "not reported" when it sent none (never 0). */
export const countText = (v: number | null | undefined): string => (typeof v === 'number' ? String(v) : 'not reported')
