// The OCR and draft calls of the paper desk (package O) against a fake engine: R-28, R-48, R-49, R-50, R-51 and R-52 with each
// state and each class of failure, the two ways the client stays silent (gate off, no token), and the new fields the mappers keep
// (a paper's fault lines, an OCR question's confidence, a whole-page draft, a picture-only question). Every record is invented.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPyqClient, draftRow, NOT_CONNECTED, ocrJob, ocrStatus } from '../pyqExtras'
import { createPyqPort } from '../pyq'
import { paperRow, questionRow } from '../pyqMap'
import { PAPER, QUESTION, env, fakeEngine, list, refuse } from './fakeEngine'

const B = '/api/mission/pyq'
const make = (over: { gate?: () => boolean; token?: () => string } = {}) => createPyqClient({ gate: () => true, token: () => 'tok', now: () => 7000, ...over })

const JOB = { id: 'o-1', status: 'running', paper_id: PAPER.id, pages_total: 7, pages_done: 2, page_now: 4, pages_read: 2, pages_below_gate: 0, questions: 3, started: '2026-11-27T10:00:00', finished: null, seconds_per_page: 13.8 }
const ENGINE = { name: 'invented-ocr', version: '1.0', device: 'cpu', installed: true }
const ocrAnswer = (state: string, reason: string, job: unknown = JOB, waiting = { papers: 4, pages: 31 }) => env(state, reason, { engine: ENGINE, gate: 0.85, job, waiting })
const DRAFT = {
  id: 'd-1', subject: 'signals', unit: 2, topic: 'Sampling', text: 'State the sampling theorem and one condition it needs.', marks: null, status: 'pending', origin: 'model-draft',
  sources: [{ file_id: 'f-1', title: 'Signals Studio notes 2' }], checks: { copied: false, similarity: 0.31 }, made: '2026-11-27T10:05:00',
}

afterEach(() => { vi.unstubAllGlobals() })

describe('mappers', () => {
  it('a job keeps every number the engine sent and nothing it did not', () => {
    expect(ocrJob(JOB)).toEqual({
      id: 'o-1', status: 'running', paperId: PAPER.id, pagesTotal: 7, pagesDone: 2, pageNow: 4, pagesRead: 2, pagesBelowGate: 0, questions: 3,
      started: '2026-11-27T10:00:00', finished: null, secondsPerPage: 13.8,
    })
    expect(ocrJob({ ...JOB, page_now: undefined, seconds_per_page: null })).toMatchObject({ pageNow: null, secondsPerPage: null })
    expect(ocrJob({ ...JOB, status: 'paused' })).toBeNull()
    expect(ocrJob(null)).toBeNull()
  })
  it('a status carries the engine, the gate as sent, the job and the waiting counts', () => {
    expect(ocrStatus(ocrAnswer('waiting', 'x', null))).toEqual({ engine: { ...ENGINE, installed: true }, gate: 0.85, job: null, waiting: { papers: 4, pages: 31 } })
    expect(ocrStatus({ state: 'live', gate: 0.9 }).gate).toBe(0.9)
  })
  it('a draft keeps the checks as the engine\'s numbers; an unknown status is dropped, not guessed', () => {
    expect(draftRow(DRAFT)).toMatchObject({ id: 'd-1', status: 'pending', marks: null, copied: false, similarity: 0.31, sources: [{ fileId: 'f-1', title: 'Signals Studio notes 2' }], questionId: null })
    expect(draftRow({ ...DRAFT, checks: undefined })).toMatchObject({ copied: null, similarity: null })
    expect(draftRow({ ...DRAFT, status: 'maybe' })).toBeNull()
    expect(draftRow({ ...DRAFT, status: 'accepted', question_id: 'q-9', edited: true })).toMatchObject({ status: 'accepted', questionId: 'q-9', edited: true })
  })
  it('a paper row keeps its fault lines and subject; an OCR question keeps its confidence; "p3" is a whole page; a picture-only question is crop-only', () => {
    const faults = ['p. 3: no text layer; run OCR on this paper', 'p. 5: read at confidence 0.71, below 0.85; left as a picture']
    expect(paperRow({ ...PAPER, faults, method: 'mixed' })).toMatchObject({ subject: 'signals', faults, method: 'mixed' })
    expect(paperRow(PAPER)).not.toHaveProperty('faults')
    const q = questionRow({ ...QUESTION, label: 'p3', text: 'Invented recognised words.', text_status: 'unverified', ocr_confidence: 0.91 }, PAPER)
    expect(q).toMatchObject({ number: 'p3', wholePage: true, ocrConfidence: 0.91 })
    expect(q.crop.textStatus).toBe('unverified')
    expect(questionRow(QUESTION, PAPER)).not.toHaveProperty('wholePage')
    const pic = questionRow({ ...QUESTION, text: '', text_status: 'none' }, PAPER)
    expect(pic.crop.textStatus).toBe('crop-only')
    expect(pic.stem).toBe('')
  })
})

describe('OCR', () => {
  it('R-28 passes LIVE through with the job; WAITING keeps the counts it carries', async () => {
    fakeEngine({ [`GET ${B}/ocr`]: { json: ocrAnswer('live', 'Reading page 3 of 7.') } })
    const r = await make().ocrStatus()
    expect(r).toMatchObject({ state: 'live', reason: 'Reading page 3 of 7.', since: 7000 })
    expect(r.data!.job!.pagesDone).toBe(2)
    fakeEngine({ [`GET ${B}/ocr`]: { json: ocrAnswer('waiting', '4 papers have 31 pages with no text layer.', null) } })
    const w = await make().ocrStatus()
    expect(w).toMatchObject({ state: 'waiting', reason: '4 papers have 31 pages with no text layer.' })
    expect(w.data!.waiting).toEqual({ papers: 4, pages: 31 })
  })
  it('R-48 posts the page list when there is one and an empty body when there is not', async () => {
    const fx = fakeEngine({ [`POST ${B}/papers/${PAPER.id}/ocr`]: { json: ocrAnswer('live', 'Reading page 1 of 7.') } })
    await make().ocrStart(PAPER.id)
    await make().ocrStart(PAPER.id, [3, 5])
    expect(fx.calls.map((c) => c.body)).toEqual([{}, { pages: [3, 5] }])
  })
  it('a 409 is the engine\'s own sentence, WAITING; a 400 is the engine\'s sentence, FAULT; neither is wrapped', async () => {
    fakeEngine({ [`POST ${B}/papers/${PAPER.id}/ocr`]: refuse(409, 'OCR is already reading a paper; wait for it or stop it.') })
    expect(await make().ocrStart(PAPER.id)).toEqual({ state: 'waiting', reason: 'OCR is already reading a paper; wait for it or stop it.', since: 7000, data: null })
    fakeEngine({ [`POST ${B}/papers/${PAPER.id}/ocr`]: refuse(400, 'This paper has no page waiting for OCR.') })
    expect(await make().ocrStart(PAPER.id)).toEqual({ state: 'fault', reason: 'This paper has no page waiting for OCR.', since: 7000, data: null })
  })
  it('R-49 is a DELETE and answers WAITING "Stopping after the page being read." with the job still there', async () => {
    const fx = fakeEngine({ [`DELETE ${B}/ocr`]: { json: ocrAnswer('waiting', 'Stopping after the page being read.') } })
    const r = await make().ocrStop()
    expect(fx.calls[0].method).toBe('DELETE')
    expect(r).toMatchObject({ state: 'waiting', reason: 'Stopping after the page being read.' })
    expect(r.data!.job!.status).toBe('running')
  })
  it('an engine failure is named with its status; no answer is named; an answer with no state is a FAULT', async () => {
    fakeEngine({ [`GET ${B}/ocr`]: refuse(500, 'boom') })
    expect((await make().ocrStatus()).reason).toBe('The engine failed (HTTP 500): boom')
    fakeEngine({ [`GET ${B}/ocr`]: { throws: new TypeError('Failed to fetch') } })
    expect(await make().ocrStatus()).toMatchObject({ state: 'fault', reason: 'The app did not answer (Failed to fetch).' })
    fakeEngine({ [`GET ${B}/ocr`]: { json: { job: JOB } } })
    expect((await make().ocrStatus()).state).toBe('fault')
  })
  it('routes that are not mounted are WAITING "engine routes not found", and the client does not ask again at once', async () => {
    const fx = fakeEngine({})
    const c = make()
    expect(await c.ocrStatus()).toMatchObject({ state: 'waiting', reason: 'engine routes not found' })
    await c.ocrStatus()
    expect(fx.calls).toHaveLength(1)
  })
  it('with the gate off or no token nothing is called and the answer is the null adapter\'s WAITING', async () => {
    const fx = fakeEngine({})
    expect(await make({ gate: () => false }).ocrStatus()).toEqual({ state: 'waiting', reason: NOT_CONNECTED, since: null, data: null })
    expect((await make({ token: () => '' }).draftsMake({ subject: 's', topic: 't' })).state).toBe('waiting')
    expect(fx.calls).toHaveLength(0)
  })
  it('abortAll aborts the signal of a request in flight, a request that was stopped says so, and a later call starts fresh', async () => {
    const fx = fakeEngine({ [`GET ${B}/ocr`]: { json: ocrAnswer('live', 'x') } })
    const c = make()
    await c.ocrStatus()
    const signal = (fx.fetchMock.mock.calls[0][1] as RequestInit).signal as AbortSignal
    expect(signal.aborted).toBe(false)
    c.abortAll()
    expect(signal.aborted).toBe(true)
    fakeEngine({ [`GET ${B}/ocr`]: { throws: Object.assign(new Error('gone'), { name: 'AbortError' }) } })
    expect((await c.ocrStatus()).reason).toMatch(/Stopped/)
    fakeEngine({ [`GET ${B}/ocr`]: { json: ocrAnswer('live', 'x') } })
    expect((await c.ocrStatus()).state).toBe('live')
  })
})

describe('drafts', () => {
  it('R-50 sends only what was set and maps the drafts, pending and unaccepted', async () => {
    const fx = fakeEngine({ [`POST ${B}/drafts/from-notes`]: { json: list([DRAFT], 'live', '1 draft to review, written from 1 of your notes.') } })
    const r = await make().draftsMake({ subject: 'signals', topic: 'Sampling', count: 3 })
    expect(fx.calls[0].body).toEqual({ subject: 'signals', topic: 'Sampling', count: 3 })
    expect(r.state).toBe('live')
    expect(r.data![0]).toMatchObject({ status: 'pending', origin: 'model-draft', marks: null })
  })
  it('the waiting, planned and fault answers keep the engine\'s sentence and carry no drafts', async () => {
    for (const [state, reason] of [['waiting', 'The local model is not running.'], ['planned', 'Drafting is off: rules only.'], ['fault', 'The model answered, but not as questions; nothing was kept.']] as const) {
      fakeEngine({ [`POST ${B}/drafts/from-notes`]: { json: list([], state, reason) } })
      expect(await make().draftsMake({ subject: 'signals', topic: 'Sampling' })).toEqual({ state, reason, since: 7000, data: null })
    }
  })
  it('a 409 while OCR reads is the engine\'s sentence, WAITING', async () => {
    fakeEngine({ [`POST ${B}/drafts/from-notes`]: refuse(409, 'OCR is reading; drafting waits for it.') })
    expect(await make().draftsMake({ subject: 'signals', topic: 'Sampling' })).toMatchObject({ state: 'waiting', reason: 'OCR is reading; drafting waits for it.', data: null })
  })
  it('R-51 asks with the subject and status filters in the query', async () => {
    const fx = fakeEngine({ [`GET ${B}/drafts`]: { json: list([DRAFT, { ...DRAFT, id: 'd-2', status: 'rejected', reason: 'copies its passage', checks: { copied: true, similarity: 0.82 } }]) } })
    const r = await make().draftsList({ subject: 'signals', status: 'pending' })
    expect(fx.calls[0].query.get('subject')).toBe('signals')
    expect(fx.calls[0].query.get('status')).toBe('pending')
    expect(r.data!.map((d) => d.status)).toEqual(['pending', 'rejected'])
    expect(r.data![1]).toMatchObject({ copied: true, similarity: 0.82, reason: 'copies its passage' })
  })
  it('R-52 is a PATCH with the status the student pressed and nothing else unless he edited', async () => {
    const fx = fakeEngine({ [`PATCH ${B}/drafts/d-1`]: { json: env('live', 'Accepted.', { draft: { ...DRAFT, status: 'accepted', marks: 5, question_id: 'q-9' }, question: { id: 'q-9' } }) } })
    const r = await make().draftsDecide('d-1', { status: 'accepted', marks: 5 })
    expect(fx.calls[0].body).toEqual({ status: 'accepted', marks: 5 })
    expect(r.data).toMatchObject({ status: 'accepted', questionId: 'q-9' })
  })
  it('a decided draft the engine did not send back is a FAULT, not a success', async () => {
    fakeEngine({ [`PATCH ${B}/drafts/d-1`]: { json: env('live', 'Accepted.', {}) } })
    expect((await make().draftsDecide('d-1', { status: 'accepted', marks: 5 })).state).toBe('fault')
  })
})

describe('Word papers and picture-only questions through the existing ingest', () => {
  const file = (name: string) => new File([new Uint8Array(8)], name, { type: '' })
  it('a .docx goes up with its own name; a file Word cannot print fails with the engine\'s printable sentence', async () => {
    const sentence = 'Word is not installed on this PC, so a Word file cannot be read. Save it as PDF and drop that.'
    const job = { id: 'j-9', status: 'failed', total: 1, done: 1, files: [{ file: 'mock-paper-a.docx', status: 'failed', note: sentence }], trace: [] }
    const fx = fakeEngine({
      [`GET ${B}/papers`]: { json: list([]) }, [`GET /api/mission/academics`]: refuse(404, 'x'),
      [`POST ${B}/upload`]: { json: env('live', 'Reading 1 file.', { job: { ...job, status: 'running' } }) },
      [`GET ${B}/ingest/j-9`]: { json: env('fault', sentence, { job }) },
    })
    const adapter = createPyqPort({ gate: () => true, token: () => 'tok', now: () => 5000, sleep: () => Promise.resolve() })
    const r = await adapter.port.ingest!({ route: 'drop', files: [file('mock-paper-a.docx')] })
    expect(fx.calls.find((c) => c.path === `${B}/upload`)!.query.get('name')).toBe('mock-paper-a.docx')
    expect(r).toMatchObject({ state: 'fault', reason: sentence, data: null })
  })
})
