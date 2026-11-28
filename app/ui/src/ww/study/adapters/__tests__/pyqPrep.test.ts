// The preparation client (board requests 21 and 23; routes R-64 to R-74 and R-04's role) against a fake engine, with answers shaped
// as app/tests/test_pyq_prep.py and test_pyq_prep_run.py read them: what each call sends (apply only as he chose it), what the mappers
// keep and drop (a count the engine did not send stays null, never 0), the 409 and 400 sentences, and the two ways the client stays
// silent. Every record is invented.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPrepClient, modelInfo, NOT_CONNECTED, prepCounts, rereadRow, runInfo, subjectsAnswer, tagsAnswer } from '../pyqPrep'
import { env, fakeEngine, refuse } from './fakeEngine'

const B = '/api/mission/pyq'
const make = (over: { gate?: () => boolean; token?: () => string } = {}) => createPrepClient({ gate: () => true, token: () => 'tok', now: () => 5000, ...over })
afterEach(() => { vi.unstubAllGlobals() })

const SUB = { subject: 'fixture-signals', name: 'Fixture Signals', papers: 3, questions: 40, pending: 40, accepted: 0, with_marks: 12, tagged: 0, sheet_ready_topics: 0 }
const COUNTS = {
  papers: 4, questions: 52, pending: 52, accepted: 0, with_marks: 12, tagged: 0, sheet_ready_topics: 0, without_subject: 1,
  by_subject: [SUB, { ...SUB, subject: 'fixture-maths', name: 'Fixture Maths', papers: 0, questions: 0, pending: 0, with_marks: 0, sheet_ready_topics: 2 }],
  courses: { mapped: 2, unmapped: 1, state: 'live', reason: '' },
  solutions: { papers: 1, items: 6, paired: 0 }, question_banks: 1, not_questions: 2, marks_not_printed: 9, accepted_unmarked: 0,
}
const JOB = (over: Record<string, unknown> = {}) => ({
  id: 'r-000000000001', status: 'running', steps: ['subjects', 'tags'], step: 'tags', unit: 'questions', done: 20, total: 60,
  counts_before: COUNTS, counts_now: { ...COUNTS, tagged: 20 }, started: '2026-11-28T10:00:00', finished: null, seconds: 41.5, failures: 1,
  notes: ['Fixture Signals: 1 batch of the model failed; its questions are as they were.'], results: {}, subjects: ['fixture-signals'], model: 'claude sonnet', error: null, ...over,
})

describe('mappers', () => {
  it('R-65 counts keep every number sent, sum the sheet-ready topics of the subjects, and leave an unsent count null', () => {
    const c = prepCounts(COUNTS)!
    expect(c).toMatchObject({ papers: 4, questions: 52, accepted: 0, withoutSubject: 1, questionBanks: 1, notQuestions: 2, marksNotPrinted: 9, acceptedUnmarked: 0, sheetReadyTopics: 2 })
    expect(c.solutions).toEqual({ papers: 1, items: 6, paired: 0 })
    expect(c.courses).toEqual({ mapped: 2, unmapped: 1, state: 'live', reason: '' })
    expect(c.bySubject.map((s) => s.subject)).toEqual(['fixture-signals', 'fixture-maths'])
    const older = prepCounts({ papers: 2, questions: 5, by_subject: [] })!
    expect(older).toMatchObject({ accepted: null, questionBanks: null, marksNotPrinted: null, sheetReadyTopics: null, solutions: null, courses: null })
    expect(prepCounts(null)).toBeNull()
  })
  it('a subject row without an id is dropped, not named', () => {
    expect(prepCounts({ by_subject: [{ name: 'x' }, SUB] })!.bySubject).toHaveLength(1)
  })
  it('R-64: the provider, the Claude model, what is found on this PC and sends_out; an unknown provider is nothing', () => {
    expect(modelInfo({ provider: 'claude', claude_model: 'opus', available: { local: false, claude: true }, sends_out: true, name: 'claude opus' }))
      .toEqual({ provider: 'claude', claudeModel: 'opus', name: 'claude opus', available: { local: false, claude: true }, sendsOut: true })
    expect(modelInfo({ provider: 'gpt' })).toBeNull()
    expect(modelInfo({ provider: 'off' })).toMatchObject({ available: { local: null, claude: null }, sendsOut: null, claudeModel: null })
  })
  it('R-66 and R-68 answers keep the engine counts and its reasons per paper', () => {
    const s = subjectsAnswer({ items: [{ paper: 'p-1', title: 'Invented paper', subject: 'fixture-signals', rule: 'code', written: '', reason: "The subject's course code is on it." }, { title: 'no id' }], counts: { course: 0, code: 1 }, model: '', asked: 0, roles: [{ paper: 'p-2', title: 'QB unit 2', role: 'question_bank', written: false }], pairs: [] })
    expect(s.items).toHaveLength(1)
    expect(s.counts).toEqual({ course: 0, code: 1 })
    expect(s.roles[0]).toMatchObject({ role: 'question_bank', written: false })
    expect(tagsAnswer({ subject: 'fixture-signals', rule: 5, model: 0, none: 0, left: 35, not_question: 2, model_name: '' })).toMatchObject({ rule: 5, left: 35, notQuestion: 2, failedBatches: null })
  })
  it('R-67 rows: a paper not read keeps its counts null', () => {
    expect(rereadRow({ paper: 'p-1', title: '', questions_before: null, questions_after: null, reason: 'Stopped before this paper.' })).toMatchObject({ questionsBefore: null, changed: false })
    expect(rereadRow({ title: 'x' })).toBeNull()
  })
  it('R-73: the job record with its notes; no run is null', () => {
    const j = runInfo({ run: JOB() })!
    expect(j).toMatchObject({ status: 'running', step: 'tags', done: 20, total: 60, seconds: 41.5, failures: 1, model: 'claude sonnet' })
    expect(j.countsBefore?.tagged).toBe(0)
    expect(j.countsNow?.tagged).toBe(20)
    expect(j.notes[0]).toContain('batch of the model failed')
    expect(runInfo({ run: null })).toBeNull()
    expect(runInfo({ run: { status: 'odd' } })).toBeNull()
  })
})

describe('the calls', () => {
  it('gate off or no token: nothing is called', async () => {
    const e = fakeEngine({})
    expect((await make({ gate: () => false }).counts()).reason).toBe(NOT_CONNECTED)
    expect((await make({ token: () => '' }).runStatus()).state).toBe('waiting')
    expect(e.calls).toHaveLength(0)
  })
  it('R-65 WAITING "No paper on file yet." still carries its counts', async () => {
    fakeEngine({ [`GET ${B}/prep`]: { json: env('waiting', 'No paper on file yet.', { counts: { ...COUNTS, papers: 0, questions: 0, by_subject: [] } }) } })
    const r = await make().counts()
    expect(r).toMatchObject({ state: 'waiting', reason: 'No paper on file yet.' })
    expect(r.data?.papers).toBe(0)
  })
  it('a look sends apply false and the model only as ticked, with the limit of a look', async () => {
    const e = fakeEngine({
      [`POST ${B}/prep/subjects`]: { json: env('live', 'Would set a subject on 1 paper by rule (0 by course, 1 by code, 0 by name); 2 still without one.', { items: [], count: 0, counts: {}, courses: [], roles: [], pairs: [] }) },
      [`POST ${B}/prep/tags`]: { json: env('live', 'Would tag 5 by rule and 0 by the model; 0 fit none of the topics, 35 are still without a topic.', { subject: 'fixture-signals', rule: 5, model: 0, none: 0, left: 35 }) },
      [`POST ${B}/prep/reread`]: { json: env('live', 'Reading again would change 0 papers of 2; nothing was written.', { items: [], count: 0, changed: 0 }) },
    })
    const c = make()
    await c.subjects({ apply: false, useModel: false })
    await c.tags({ subject: 'fixture-signals', apply: false, useModel: true, limit: 20 })
    await c.reread({ apply: false, papers: ['p-1'] })
    await c.reread({ apply: false })
    expect(e.calls.map((x) => x.body)).toEqual([
      { apply: false, use_model: false },
      { subject: 'fixture-signals', apply: false, use_model: true, limit: 20 },
      { apply: false, papers: ['p-1'] },
      { apply: false },
    ])
  })
  it('R-72 sends the steps in the engine order and only the subjects he named; a 409 is the engine sentence as WAITING', async () => {
    const e = fakeEngine({ [`POST ${B}/prep/run`]: { json: env('live', 'Step subjects: 0 of 3 papers done, 0 s so far.', { run: JOB({ step: 'subjects', done: 0, total: 3, unit: 'papers' }) }) } })
    const r = await make().runStart({ steps: ['tags', 'subjects'], useModel: false })
    expect(e.calls[0].body).toEqual({ steps: ['subjects', 'tags'], use_model: false })
    expect(r.data?.status).toBe('running')
    await make().runStart({ steps: ['accept'], subjects: ['fixture-signals'], useModel: true })
    expect(e.calls[1].body).toEqual({ steps: ['accept'], use_model: true, subjects: ['fixture-signals'] })
    fakeEngine({ [`POST ${B}/prep/run`]: refuse(409, 'A preparation run is already going; wait for it or stop it.') })
    expect(await make().runStart({ steps: ['tags'], useModel: false })).toMatchObject({ state: 'waiting', reason: 'A preparation run is already going; wait for it or stop it.', data: null })
  })
  it('R-73 "No preparation run yet." is WAITING with no record; R-74 stopping is WAITING with the record still drawn', async () => {
    fakeEngine({ [`GET ${B}/prep/run`]: { json: env('waiting', 'No preparation run yet.', { run: null }) }, [`DELETE ${B}/prep/run`]: { json: env('waiting', 'Stopping after the batch or paper in hand.', { run: JOB() }) } })
    expect(await make().runStatus()).toMatchObject({ state: 'waiting', data: null })
    const s = await make().runStop()
    expect(s).toMatchObject({ state: 'waiting', reason: 'Stopping after the batch or paper in hand.' })
    expect(s.data?.status).toBe('running')
  })
  it('R-74 with no run is the engine 400 sentence', async () => {
    fakeEngine({ [`DELETE ${B}/prep/run`]: refuse(400, 'No preparation run is going.') })
    expect(await make().runStop()).toMatchObject({ state: 'fault', reason: 'No preparation run is going.' })
  })
  it('R-64 PUT sends the provider and the Claude model; the 400 when the tool is not found is shown and nothing moves', async () => {
    const e = fakeEngine({ [`PUT ${B}/model`]: { json: env('live', 'Claude (haiku) is asked through the Claude tool on this PC: the text of your questions and notes leaves this PC and counts against your Claude usage.', { provider: 'claude', claude_model: 'haiku', available: { local: false, claude: true }, sends_out: true, name: 'claude haiku' }) } })
    const r = await make().setModel('claude', 'haiku')
    expect(e.calls[0].body).toEqual({ provider: 'claude', claude_model: 'haiku' })
    expect(r.data).toMatchObject({ provider: 'claude', sendsOut: true })
    await make().setModel('off')
    expect(e.calls[1].body).toEqual({ provider: 'off' })
    fakeEngine({ [`PUT ${B}/model`]: refuse(400, 'The Claude tool is not found on this PC, so Claude cannot be chosen.') })
    expect(await make().setModel('claude')).toMatchObject({ state: 'fault', reason: 'The Claude tool is not found on this PC, so Claude cannot be chosen.', data: null })
  })
  it('R-69 the policy: off by default, set by his press only, and an answer without the policy is not shown as switched', async () => {
    const e = fakeEngine({
      [`GET ${B}/prep/policy`]: { json: env('live', 'Off: nothing enters the bank without your review.', { policy: { auto_accept: false } }) },
      [`PUT ${B}/prep/policy`]: { json: env('live', 'Questions safe to trust may be accepted by rule; each says so.', { policy: { auto_accept: true } }) },
    })
    expect((await make().policy()).data).toEqual({ autoAccept: false })
    expect((await make().setPolicy(true)).data).toEqual({ autoAccept: true })
    expect(e.calls[1].body).toEqual({ auto_accept: true })
    fakeEngine({ [`PUT ${B}/prep/policy`]: { json: env('live', 'x', {}) } })
    expect((await make().setPolicy(true)).state).toBe('fault')
  })
  it('R-70 PLANNED when the policy is off still carries the counts; R-71 says how many went back', async () => {
    fakeEngine({
      [`POST ${B}/prep/accept`]: { json: env('planned', 'Acceptance by rule is off; only you can turn it on.', { accepted: 0, held: {}, unmarked: 0, counts: COUNTS, before: COUNTS }) },
      [`POST ${B}/prep/unaccept`]: { json: env('live', 'Returned 3 questions accepted by rule to pending.', { returned: 3, counts: COUNTS, before: COUNTS }) },
    })
    const a = await make().accept('fixture-signals')
    expect(a).toMatchObject({ state: 'planned', reason: 'Acceptance by rule is off; only you can turn it on.' })
    expect(a.data?.counts?.questions).toBe(52)
    expect((await make().unaccept('fixture-signals')).data?.returned).toBe(3)
  })
  it('R-04 role: PATCH {role}; an answer whose paper does not carry the role is not shown as changed', async () => {
    const e = fakeEngine({ [`PATCH ${B}/papers/p-1`]: { json: env('live', 'Paper updated.', { paper: { id: 'p-1', role: 'solution', role_source: 'hand' } }) } })
    expect((await make().setRole('p-1', 'solution')).data).toEqual({ id: 'p-1', role: 'solution', roleSource: 'hand' })
    expect(e.calls[0].body).toEqual({ role: 'solution' })
    fakeEngine({ [`PATCH ${B}/papers/p-1`]: refuse(400, "A paper's role is paper, question_bank, solution or notes.") })
    expect(await make().setRole('p-1', 'exam')).toMatchObject({ state: 'fault', reason: "A paper's role is paper, question_bank, solution or notes." })
    fakeEngine({ [`PATCH ${B}/papers/p-1`]: { json: env('live', 'Paper updated.', { paper: { id: 'p-1', role: 'paper' } }) } })
    expect((await make().setRole('p-1', 'solution')).state).toBe('fault')
  })
})
