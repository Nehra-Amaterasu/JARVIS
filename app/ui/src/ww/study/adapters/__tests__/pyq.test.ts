// The exam adapter (package AD08) against a fake engine: the envelope of every member, each state, each class of failure, the
// abort of a long job, and the two ways a member stays silent (the product gate off, no token). Every record is invented.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { STUDY_MEMBERS, composePort, type StudyMember, type StudyPort } from '../../ports'
import { nullStudyPort } from '../null.register'
import { TOKEN } from '../../../../lib/api'
import { createPyqPort, ABSENT_REASON } from '../pyq'
import { POLL } from '../pyqIngest'
import registration, { abortPyq } from '../pyq.register'
import { QTYPE, blueprint, boxIn, boxOut, checkResult, gainItems, generatedPaper, paperRow, patternSet, questionRow, reply } from '../pyqMap'
import { PAPER, PAPER_B, PNG, QUESTION, env, fakeEngine, list, refuse } from './fakeEngine'

const B = '/api/mission/pyq'
const TEN: StudyMember[] = ['papers', 'questions', 'ingest', 'decide', 'crop', 'blueprints', 'generate', 'patterns', 'practiseNext', 'check']
const instant = () => Promise.resolve()

function make(over: { gate?: () => boolean; token?: () => string; sleep?: (ms: number, s: AbortSignal) => Promise<void> } = {}) {
  return createPyqPort({ gate: () => true, token: () => 'tok', now: () => 5000, sleep: instant, ...over })
}
const file = (name: string, size = 8) => new File([new Uint8Array(size)], name, { type: 'application/pdf' })

afterEach(() => { vi.unstubAllGlobals() })

describe('the mappers keep what the engine said and invent nothing', () => {
  it('a reply passes the state through and carries data only for LIVE and SIMULATED', () => {
    for (const state of ['live', 'simulated'] as const) expect(reply(env(state, 'r'), 1, () => 7)).toEqual({ state, reason: 'r', since: 1, data: 7 })
    for (const state of ['waiting', 'planned', 'fault'] as const) expect(reply(env(state, 'r'), 1, () => 7)).toEqual({ state, reason: 'r', since: 1, data: null })
  })
  it('an answer with no valid state is a FAULT, never LIVE', () => {
    expect(reply({ reason: 'x' }, 1, () => 1).state).toBe('fault')
    expect(reply({ state: 'fine' }, 1, () => 1).state).toBe('fault')
  })
  it('a paper row: reviewed is accepted plus rejected, an unknown year is 0, there is no exam date', () => {
    expect(paperRow(PAPER)).toEqual({ id: PAPER.id, year: 2023, label: 'Paper A', examAt: null, questions: 6, reviewed: 4, pages: 4, subject: 'signals' })
    expect(paperRow(PAPER_B).year).toBe(0)
  })
  it('a question row: Q prefix, the topic key as the generator spells it, the share of the paper, the box as x y w h', () => {
    const r = questionRow(QUESTION, PAPER, 'data:image/png;base64,AAAA')
    expect(r).toMatchObject({ number: 'Q4', topicId: '2|Sampling', year: 2023, marks: 12, share: 0.2, tag: 'RULE', margin: 0.31, status: 'pending', type: 'numerical' })
    expect(r.crop).toEqual({ img: 'data:image/png;base64,AAAA', bbox: [10, 20, 100, 50], text: 'Invented question four.', textStatus: 'verified' })
    expect(boxIn([10, 20, 100, 50])).toEqual([10, 20, 110, 70])
    expect(boxOut([1, 2, 3])).toBeUndefined()
  })
  it('missing marks and a missing total give no share; an untagged question has an empty topic id; no text is crop-only', () => {
    const r = questionRow({ ...QUESTION, marks: null, unit: null, topic: '', text: '', text_status: 'none', has_crop: false }, PAPER_B)
    expect(r.share).toBeNull()
    expect(r.marks).toBeNull()
    expect(r.topicId).toBe('')
    expect(r.crop).toEqual({ textStatus: 'crop-only', bbox: [10, 20, 100, 50] })
  })
  it('the seven engine types fold onto the four glyphs, and a hand tag is HAND', () => {
    expect(QTYPE).toMatchObject({ descriptive: 'derivation', slide: 'short', unknown: 'short', mcq: 'mcq' })
    expect(questionRow({ ...QUESTION, tag_source: 'hand' }, PAPER).tag).toBe('HAND')
    expect(questionRow({ ...QUESTION, tag_source: 'model' }, PAPER).tag).toBe('MODEL')
  })
  it('patterns, gain, blueprint, generated paper and check map field for field', () => {
    expect(patternSet({ n_papers: 3, topics: [{ key: '1|A', unit: 1, topic: 'A', k: 2 }, { unit: 9 }] })).toEqual({ topics: [{ id: '1|A', label: 'A', unit: 'Unit 1' }], papers: 3, topicCounts: { '1|A': 2 } })
    expect(gainItems([{ key: '1|A', reason: 'set in 2 of 3 papers' }, {}])).toEqual([{ topicId: '1|A', reason: 'set in 2 of 3 papers' }])
    expect(blueprint({ origin: 'rule', sections: [{ name: 'A', questions: 5, attempt: 4, marks: 3 }] }, 'e1', 'Exam one')).toEqual({ id: 'e1', label: 'Exam one', origin: 'RULE', sections: [{ label: 'A', set: 5, attempt: 4, marksEach: 3 }] })
    expect(generatedPaper({ seed: 3, shortfall: ['needs 1 more 7-mark question'], sections: [{ slots: [{ question_id: 'q-1', source: 'hand' }, { question_id: '', source: 'hollow' }, { question_id: 'q-2', source: 'hollow' }] }] }, 'e1', 9))
      .toEqual({ blueprintId: 'e1', seed: 3, questionIds: ['q-1'], gaps: ['needs 1 more 7-mark question'] })
    expect(checkResult({ match: false, parsed: 3300, note: 'read in ohm' })).toEqual({ matches: false, working: 'Read 3300. read in ohm' })
    expect(checkResult(undefined)).toEqual({ matches: false, working: '' })
  })
})

describe('papers', () => {
  it('maps R-01 and passes LIVE through', async () => {
    const fx = fakeEngine({ [`GET ${B}/papers`]: { json: list([PAPER, PAPER_B], 'live', '2 papers on file.') } })
    const r = await make().port.papers!()
    expect(r).toMatchObject({ state: 'live', reason: '2 papers on file.', since: 5000 })
    expect(r.data).toHaveLength(2)
    expect(fx.calls[0].headers['x-jarvis-token']).toBe(TOKEN)
  })
  it('keeps the engine\'s WAITING and its reason, with no data', async () => {
    fakeEngine({ [`GET ${B}/papers`]: { json: list([], 'waiting', 'No papers on file yet.') } })
    expect(await make().port.papers!()).toEqual({ state: 'waiting', reason: 'No papers on file yet.', since: 5000, data: null })
  })
  it('keeps FAULT, SIMULATED and PLANNED the engine reports', async () => {
    fakeEngine({ [`GET ${B}/papers`]: { json: list([PAPER], 'fault', 'The folder is not there.') } })
    expect(await make().port.papers!()).toMatchObject({ state: 'fault', reason: 'The folder is not there.', data: null })
    fakeEngine({ [`GET ${B}/papers`]: { json: list([PAPER], 'simulated', 'invented') } })
    expect((await make().port.papers!()).state).toBe('simulated')
  })
  it('a 400, a 409, a 413 and a 500 are FAULT with the status and the engine\'s words', async () => {
    for (const [status, word] of [[400, 'refused'], [409, 'busy'], [413, 'refused'], [500, 'failed']] as const) {
      fakeEngine({ [`GET ${B}/papers`]: refuse(status, 'A plain sentence.') })
      const r = await make().port.papers!()
      expect(r.state, String(status)).toBe('fault')
      expect(r.reason).toContain(`HTTP ${status}`)
      expect(r.reason).toContain('A plain sentence.')
      expect(r.reason).toContain(word)
      expect(r.data).toBeNull()
    }
  })
  it('a 404 with a sentence (an unknown id) is FAULT; only the bare "Not Found" means the engine is absent', async () => {
    fakeEngine({ [`GET ${B}/papers`]: refuse(404, 'No such subject.') })
    expect((await make().port.papers!()).state).toBe('fault')
  })
  it('no answer at all is FAULT with a plain reason', async () => {
    fakeEngine({ [`GET ${B}/papers`]: { throws: new TypeError('Failed to fetch') } })
    const r = await make().port.papers!()
    expect(r.state).toBe('fault')
    expect(r.reason).toContain('did not answer')
  })
  it('a 404 "Not Found" on the prefix is WAITING "engine routes not found", and the next calls make no request for 15 s', async () => {
    const fx = fakeEngine({})
    let t = 1000
    const a = createPyqPort({ gate: () => true, token: () => 'tok', now: () => t, sleep: instant })
    expect(await a.port.papers!()).toMatchObject({ state: 'waiting', reason: ABSENT_REASON, data: null })
    await a.port.questions!()
    await a.port.patterns!()
    expect(fx.calls.length).toBe(1)
    t += 15_001
    await a.port.papers!()
    expect(fx.calls.length).toBe(2)
  })
  it('an HTML answer (the shell\'s fallback page) is the engine being absent, not LIVE', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html><title>x</title>', { status: 200, headers: { 'content-type': 'text/html' } })))
    expect(await make().port.papers!()).toMatchObject({ state: 'waiting', reason: ABSENT_REASON })
  })
  it('an answer with no state at all is FAULT', async () => {
    fakeEngine({ [`GET ${B}/papers`]: { json: { items: [PAPER] } } })
    expect((await make().port.papers!()).state).toBe('fault')
  })
})

describe('questions', () => {
  const table = () => ({
    [`GET ${B}/papers`]: { json: list([PAPER]) },
    [`GET ${B}/questions`]: { json: list([QUESTION, { ...QUESTION, id: 'q-000000000002', has_crop: false, label: 'Q5' }]) },
    [`GET ${B}/crops/q-000000000001`]: { bytes: PNG },
  })
  it('maps R-06 with the paper\'s year and share, and loads the crop as a data URI through the token header', async () => {
    const fx = fakeEngine(table())
    const r = await make().port.questions!({ paperId: PAPER.id, status: 'pending' })
    expect(r.state).toBe('live')
    expect(r.data).toHaveLength(2)
    expect(r.data![0]).toMatchObject({ id: 'q-000000000001', year: 2023, share: 0.2 })
    expect(r.data![0].crop.img).toBe(`data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`)
    expect(r.data![1].crop.img).toBeUndefined()
    const q = fx.calls.find((c) => c.path === `${B}/questions`)!
    expect(q.query.get('paper')).toBe(PAPER.id)
    expect(q.query.get('status')).toBe('pending')
    expect(q.query.get('limit')).toBe('500')
    expect(fx.calls.find((c) => c.path.includes('/crops/'))!.headers['x-jarvis-token']).toBe(TOKEN)
  })
  it('a crop that cannot be read leaves the card without an image, and the rows still arrive', async () => {
    fakeEngine({ ...table(), [`GET ${B}/crops/q-000000000001`]: refuse(404, 'No crop for this question.') })
    const r = await make().port.questions!()
    expect(r.state).toBe('live')
    expect(r.data![0].crop.img).toBeUndefined()
  })
  it('WAITING stays WAITING with its reason and no rows, and a crop is not fetched for it', async () => {
    const fx = fakeEngine({ [`GET ${B}/papers`]: { json: list([PAPER]) }, [`GET ${B}/questions`]: { json: list([], 'waiting', 'No questions yet.') } })
    expect(await make().port.questions!()).toMatchObject({ state: 'waiting', reason: 'No questions yet.', data: null })
    expect(fx.calls.some((c) => c.path.includes('/crops/'))).toBe(false)
  })
  it('asks for the rest by offset when the engine holds more than one page', async () => {
    const fx = fakeEngine({
      [`GET ${B}/papers`]: { json: list([PAPER]) },
      [`GET ${B}/questions`]: (c) => ({ json: list(c.query.get('offset') ? [{ ...QUESTION, id: 'q-000000000003', has_crop: false }] : [{ ...QUESTION, has_crop: false }], 'live', 'ok', { total: 2 }) }),
    })
    const r = await make().port.questions!()
    expect(r.data!.map((x) => x.id)).toEqual(['q-000000000001', 'q-000000000003'])
    expect(fx.calls.filter((c) => c.path === `${B}/questions`).map((c) => c.query.get('offset'))).toEqual([null, '1'])
  })
})

describe('ingest', () => {
  const running = { id: 'j-1', status: 'running', total: 1, done: 0, files: [], trace: [] }
  const done = { id: 'j-1', status: 'done', total: 1, done: 1, took_s: 2, files: [{ file: 'a.pdf', status: 'added', paper_id: PAPER.id, pages: 4, questions: 6, method: 'text-layer' }], trace: [{ t: 0, page: null, kind: 'open', text: 'a.pdf: 4 pages' }, { t: 0.4, page: 1, kind: 'page', text: 'p1: text layer, 900 characters' }] }

  it('uploads the raw bytes with the name in the query, polls R-13 with a growing wait, and returns the real trace', async () => {
    let polls = 0
    const waits: number[] = []
    const fx = fakeEngine({
      [`GET ${B}/papers`]: { json: list([PAPER]) },
      [`POST ${B}/upload`]: { json: env('live', 'Reading 1 file.', { job: running }) },
      [`GET ${B}/ingest/j-1`]: () => ({ json: env('live', 'Read 1 file: 6 questions.', { job: ++polls < 3 ? running : done }) }),
    })
    const r = await make({ sleep: async (ms) => { waits.push(ms) } }).port.ingest!({ route: 'drop', files: [file('a.pdf')] })
    expect(r.state).toBe('live')
    expect(r.reason).toBe('Read 1 file: 6 questions.')
    expect(r.data!.queued).toEqual([{ id: 'j-1:0', name: 'a.pdf', method: 'text-layer', wordsPerPage: [], reading: false }])
    expect(r.data!.events.map((e) => e.text)).toEqual(['a.pdf: 4 pages', 'p1: text layer, 900 characters'])
    expect(r.data!.events.every((e) => e.state === 'live')).toBe(true)
    expect(waits).toEqual([250, 400])
    const up = fx.calls.find((c) => c.path === `${B}/upload`)!
    expect(up.query.get('name')).toBe('a.pdf')
    expect(up.query.get('subject')).toBe('signals')
    expect(up.headers['content-type']).toBe('application/octet-stream')
    expect(up.headers['x-jarvis-token']).toBe(TOKEN)
    expect(up.raw).toBeInstanceOf(File)
  })
  it('the wait between polls grows by 1.6 and stops growing at the ceiling', async () => {
    let polls = 0
    const waits: number[] = []
    fakeEngine({
      [`GET ${B}/papers`]: { json: list([]) }, [`GET ${B}/academics`]: refuse(404, 'x'),
      [`POST ${B}/upload`]: { json: env('live', 'Reading.', { job: running }) },
      [`GET ${B}/ingest/j-1`]: () => ({ json: env('live', 'x', { job: ++polls < 12 ? running : done }) }),
    })
    await make({ sleep: async (ms) => { waits.push(ms) } }).port.ingest!({ route: 'drop', files: [file('a.pdf')] })
    expect(waits[0]).toBe(POLL.first)
    expect(Math.max(...waits)).toBe(POLL.cap)
    expect(waits.every((w, i) => i === 0 || w >= waits[i - 1])).toBe(true)
  })
  it('a job the engine answers FAULT for (a scanned page) is FAULT with the engine\'s first reason', async () => {
    fakeEngine({
      [`GET ${B}/papers`]: { json: list([]) },
      [`POST ${B}/upload`]: { json: env('live', 'Reading 1 file.', { job: running }) },
      [`GET ${B}/ingest/j-1`]: { json: env('fault', 'p. 3: no text layer; OCR arrives in EW8', { job: { ...done, files: [{ ...done.files[0], status: 'added' }] } }) },
    })
    const r = await make().port.ingest!({ route: 'drop', files: [file('a.pdf')] })
    expect(r).toMatchObject({ state: 'fault', reason: 'p. 3: no text layer; OCR arrives in EW8', data: null })
  })
  it('a file the engine refuses (400) names the file and the other files are still read', async () => {
    let ups = 0
    const fx = fakeEngine({
      [`GET ${B}/papers`]: { json: list([]) },
      [`POST ${B}/upload`]: (c) => (c.query.get('name') === 'bad.txt' ? refuse(400, 'Only .pdf or .pptx files are read.') : (ups++, { json: env('live', 'Reading 1 file.', { job: running }) })),
      [`GET ${B}/ingest/j-1`]: { json: env('live', 'Read 1 file.', { job: done }) },
    })
    const r = await make().port.ingest!({ route: 'drop', files: [file('bad.txt'), file('a.pdf')] })
    expect(ups).toBe(1)
    expect(fx.count('POST', `${B}/upload`)).toBe(2)
    expect(r.state).toBe('fault')
    expect(r.reason).toBe('bad.txt: Only .pdf or .pptx files are read.')
  })
  it('a job already running (409) is FAULT busy, not a crash', async () => {
    fakeEngine({ [`GET ${B}/papers`]: { json: list([]) }, [`POST ${B}/upload`]: refuse(409, 'Already reading files; wait for that to finish.') })
    const r = await make().port.ingest!({ route: 'drop', files: [file('a.pdf')] })
    expect(r.state).toBe('fault')
    expect(r.reason).toContain('Already reading files')
  })
  it('stops polling when the view unmounts: an aborted signal ends the loop and no further status call is made', async () => {
    const view = new AbortController()
    let sleeps = 0
    const fx = fakeEngine({
      [`GET ${B}/papers`]: { json: list([]) },
      [`POST ${B}/upload`]: { json: env('live', 'Reading.', { job: running }) },
      [`GET ${B}/ingest/j-1`]: { json: env('live', 'Reading.', { job: running }) },
    })
    const a = make({ sleep: (_ms, s) => new Promise<void>((resolve, reject) => {
      sleeps++
      if (sleeps === 2) view.abort()
      s.aborted ? reject(Object.assign(new Error('stopped'), { name: 'AbortError' })) : (s.addEventListener('abort', () => reject(Object.assign(new Error('stopped'), { name: 'AbortError' }))), setTimeout(resolve, 0))
    }) })
    const r = await a.port.ingest!({ route: 'drop', files: [file('a.pdf')], signal: view.signal } as never)
    expect(r).toMatchObject({ state: 'waiting', data: null })
    expect(r.reason).toContain('Stopped')
    const polled = fx.count('GET', `${B}/ingest/j-1`)
    await new Promise((x) => setTimeout(x, 20))
    expect(fx.count('GET', `${B}/ingest/j-1`)).toBe(polled)
    expect(polled).toBeLessThanOrEqual(3)
  })
  it('abortAll cancels a poll in flight and a later call starts fresh', async () => {
    let calls = 0
    fakeEngine({
      [`GET ${B}/papers`]: { json: list([]) },
      [`POST ${B}/upload`]: { json: env('live', 'Reading.', { job: running }) },
      [`GET ${B}/ingest/j-1`]: () => ({ json: env('live', 'Reading.', { job: calls++ > 50 ? done : running }) }),
    })
    let a!: ReturnType<typeof make>
    a = make({ sleep: async () => { if (calls === 2) a.abortAll(); await new Promise((x) => setTimeout(x, 0)) } })
    const r = await a.port.ingest!({ route: 'drop', files: [file('a.pdf')] })
    expect(r.state).toBe('waiting')
    expect(r.reason).toContain('Stopped')
    expect(calls).toBeLessThan(6)
    fakeEngine({ [`GET ${B}/papers`]: { json: list([PAPER]) } })
    expect((await a.port.papers!()).state).toBe('live')
  })
  it('a folder with nothing new is LIVE with nothing queued; a folder with files is polled', async () => {
    fakeEngine({ [`GET ${B}/papers`]: { json: list([]) }, [`POST ${B}/ingest`]: { json: env('live', 'Nothing new in the folder.', { job: null }) } })
    expect(await make().port.ingest!({ route: 'folder' })).toMatchObject({ state: 'live', reason: 'Nothing new in the folder.', data: { id: '', queued: [], events: [] } })
    const fx = fakeEngine({
      [`GET ${B}/papers`]: { json: list([]) }, [`POST ${B}/ingest`]: { json: env('live', 'Reading 1 file.', { job: running }) }, [`GET ${B}/ingest/j-1`]: { json: env('live', 'ok', { job: done }) },
    })
    const r = await make().port.ingest!({ route: 'folder' })
    expect(r.data!.queued).toHaveLength(1)
    expect(fx.calls.find((c) => c.path === `${B}/ingest` && c.method === 'POST')!.body).toEqual({ folder: true })
  })
  it('pasted text becomes a typed paper of blocks with no marks, so each question waits for review', async () => {
    const fx = fakeEngine({ [`GET ${B}/papers`]: { json: list([]) }, [`POST ${B}/papers`]: { json: env('live', '2 questions added.', { paper: { id: 'p-hand-1', title: 'Pasted questions' }, question_ids: ['q-1', 'q-2'] }) } })
    const r = await make().port.ingest!({ route: 'paste', text: 'First invented question here.\n\nSecond invented question.' })
    expect(r.state).toBe('live')
    expect(r.data!.queued[0]).toMatchObject({ method: 'pasted', wordsPerPage: [7], reading: false })
    expect(fx.calls.find((c) => c.method === 'POST')!.body).toEqual({ title: 'Pasted questions', questions: [{ text: 'First invented question here.' }, { text: 'Second invented question.' }] })
    expect((await make().port.ingest!({ route: 'paste', text: '  \n ' })).state).toBe('waiting')
  })
  it('no file is WAITING and Classroom is PLANNED, with no request for either', async () => {
    const fx = fakeEngine({ [`GET ${B}/papers`]: { json: list([]) } })
    expect(await make().port.ingest!({ route: 'drop', files: [] })).toMatchObject({ state: 'waiting', data: null })
    expect(await make().port.ingest!({ route: 'classroom' })).toMatchObject({ state: 'planned', data: null })
    expect(fx.writes()).toHaveLength(0)
  })
})

describe('decide: the student\'s own press is the only way into the bank', () => {
  const patched = (status: string) => ({ json: list([{ ...QUESTION, status }]) })
  it('accept, reject and undo write the status the key says, for that question only', async () => {
    for (const [kind, status] of [['accept', 'accepted'], ['reject', 'rejected'], ['undo', 'pending']] as const) {
      const fx = fakeEngine({ [`PATCH ${B}/questions`]: patched(status) })
      const r = await make().port.decide!({ kind, qid: 'q-000000000001' })
      expect(r).toMatchObject({ state: 'live', data: { qid: 'q-000000000001', status } })
      expect(fx.calls[0].body).toEqual({ ids: ['q-000000000001'], set: { status } })
    }
  })
  it('an edit sends the text, marks, type and the unit and topic of the topic id, and never a status', async () => {
    const fx = fakeEngine({ [`PATCH ${B}/questions`]: patched('pending') })
    const r = await make().port.decide!({ kind: 'edit', qid: 'q-000000000001', patch: { stem: 'New words.', marks: 5, type: 'short', topicId: '3|Z-transform' } })
    expect(fx.calls[0].body).toEqual({ ids: ['q-000000000001'], set: { text: 'New words.', marks: 5, type: 'short', unit: 3, topic: 'Z-transform' } })
    expect(r.data).toEqual({ qid: 'q-000000000001', status: 'pending' })
  })
  it('an accept the engine refuses ("Give its marks first.") is FAULT with that sentence and the question stays as it was', async () => {
    fakeEngine({ [`PATCH ${B}/questions`]: refuse(400, 'Give its marks first.') })
    const r = await make().port.decide!({ kind: 'accept', qid: 'q-000000000001' })
    expect(r).toMatchObject({ state: 'fault', data: null })
    expect(r.reason).toContain('HTTP 400')
    expect(r.reason).toContain('Give its marks first.')
  })
  it('merge and split have no route: PLANNED, and nothing is sent', async () => {
    const fx = fakeEngine({})
    expect(await make().port.decide!({ kind: 'merge', qid: 'q-1' })).toMatchObject({ state: 'planned', data: null })
    expect(await make().port.decide!({ kind: 'split', qid: 'q-1', at: 4 })).toMatchObject({ state: 'planned', data: null })
    expect(fx.calls).toHaveLength(0)
  })
  it('nothing else the adapter does ever sets a status: every member but decide leaves no PATCH and no accepted status', async () => {
    const fx = fakeEngine({
      [`GET ${B}/papers`]: { json: list([PAPER]) }, [`GET ${B}/questions`]: { json: list([{ ...QUESTION, has_crop: false }]) },
      [`POST ${B}/upload`]: { json: env('live', 'Reading.', { job: { id: 'j-1', status: 'running' } }) },
      [`GET ${B}/ingest/j-1`]: { json: env('live', 'ok', { job: { id: 'j-1', status: 'done', files: [], trace: [] } }) },
      [`PUT ${B}/crops/q-000000000001`]: { json: env('live', 'ok', { question: QUESTION }) }, [`GET ${B}/crops/q-000000000001`]: { bytes: PNG },
      [`GET ${B}/patterns`]: { json: env('live', 'ok', { patterns: { n_papers: 1, topics: [] } }) }, [`GET ${B}/practise-next`]: { json: list([]) },
      [`POST ${B}/check`]: { json: env('live', 'ok', { check: { match: true } }) }, [`POST ${B}/papers/generate`]: { json: env('live', 'ok', { paper: {} }) },
      [`POST ${B}/papers`]: { json: env('live', 'ok', { paper: { id: 'p-1' } }) },
    })
    const p = make().port
    await p.papers!(); await p.questions!(); await p.ingest!({ route: 'drop', files: [file('a.pdf')] }); await p.ingest!({ route: 'paste', text: 'one' })
    await p.crop!({ qid: 'q-000000000001', bbox: [0, 0, 10, 10] }); await p.patterns!(); await p.practiseNext!(); await p.check!({ qid: 'q-1', answer: '1' }); await p.generate!({ blueprintId: 'e1', seed: 1 })
    expect(fx.calls.filter((c) => c.method === 'PATCH')).toHaveLength(0)
    expect(JSON.stringify(fx.calls.map((c) => c.body))).not.toContain('accepted')
    expect(fx.calls.some((c) => c.path.endsWith('/tags/suggest'))).toBe(false)
  })
})

describe('crop', () => {
  it('sends the box as x0 y0 x1 y1 and returns the re-cut crop with its picture', async () => {
    const fx = fakeEngine({ [`PUT ${B}/crops/q-000000000001`]: { json: env('live', 'Crop saved.', { question: QUESTION }) }, [`GET ${B}/crops/q-000000000001`]: { bytes: PNG } })
    const r = await make().port.crop!({ qid: 'q-000000000001', bbox: [10, 20, 100, 50] })
    expect(fx.calls[0].body).toEqual({ bbox: [10, 20, 110, 70] })
    expect(r.state).toBe('live')
    expect(r.data).toMatchObject({ bbox: [10, 20, 100, 50], textStatus: 'verified' })
    expect(r.data!.img).toMatch(/^data:image\/png;base64,/)
  })
  it('a box outside the page (400) is FAULT with the engine\'s sentence', async () => {
    fakeEngine({ [`PUT ${B}/crops/q-000000000001`]: refuse(400, 'That box is outside the page.') })
    const r = await make().port.crop!({ qid: 'q-000000000001', bbox: [0, 0, 9999, 9999] })
    expect(r).toMatchObject({ state: 'fault', data: null })
    expect(r.reason).toContain('outside the page')
  })
})

describe('blueprints and generate', () => {
  const exams = { json: { papers: [{ id: 'e1', subject: 'signals', title: 'Exam one' }, { id: 'e2', subject: 'signals', title: 'Exam two' }] } }
  const bp = { exam: 'e1', origin: 'hand', total: 60, sections: [{ name: 'A', questions: 5, attempt: 4, marks: 15 }] }
  it('lists the balanced blueprints of the date sheet\'s exams, one per exam', async () => {
    fakeEngine({
      'GET /api/mission/exams': exams,
      [`GET ${B}/blueprints/e1`]: { json: env('live', 'Balanced: 60 marks.', { blueprint: bp }) },
      [`GET ${B}/blueprints/e2`]: { json: env('waiting', 'No blueprint. Infer one from a paper on file.', { blueprint: null }) },
    })
    const r = await make().port.blueprints!()
    expect(r.state).toBe('live')
    expect(r.data).toEqual([{ id: 'e1', label: 'Exam one', origin: 'HAND', sections: [{ label: 'A', set: 5, attempt: 4, marksEach: 15 }] }])
  })
  it('says when one does not balance, and with none balanced the engine\'s own WAITING or FAULT is kept', async () => {
    fakeEngine({
      'GET /api/mission/exams': exams,
      [`GET ${B}/blueprints/e1`]: { json: env('live', 'Balanced.', { blueprint: bp }) },
      [`GET ${B}/blueprints/e2`]: { json: env('fault', 'Section A: 4 times 15 is not 40.', { blueprint: bp }) },
    })
    expect((await make().port.blueprints!()).reason).toContain('1 more does not balance: Section A: 4 times 15 is not 40.')
    fakeEngine({ 'GET /api/mission/exams': exams, [`GET ${B}/blueprints/e1`]: { json: env('waiting', 'No blueprint. Infer one from a paper on file.', { blueprint: null }) }, [`GET ${B}/blueprints/e2`]: refuse(404, 'The paper\'s subject has no unit list yet.') })
    expect(await make().port.blueprints!()).toEqual({ state: 'waiting', reason: 'No blueprint. Infer one from a paper on file.', since: 5000, data: null })
    fakeEngine({ 'GET /api/mission/exams': exams, [`GET ${B}/blueprints/e1`]: { json: env('fault', 'Not balanced.', { blueprint: bp }) }, [`GET ${B}/blueprints/e2`]: { json: env('fault', 'Other.', { blueprint: bp }) } })
    expect((await make().port.blueprints!()).state).toBe('fault')
  })
  it('an empty date sheet is WAITING and asks nothing of the engine', async () => {
    const fx = fakeEngine({ 'GET /api/mission/exams': { json: { papers: [] } } })
    expect((await make().port.blueprints!()).state).toBe('waiting')
    expect(fx.calls.some((c) => c.path.startsWith(B))).toBe(false)
  })
  it('generate posts the exam and the seed, and maps the paper to question ids and gaps', async () => {
    const fx = fakeEngine({ [`POST ${B}/papers/generate`]: { json: env('live', '5 of 6 seats filled.', { paper: { id: 'g-1', seed: 7, shortfall: ['needs 1 more 7-mark question'], sections: [{ slots: [{ question_id: 'q-1', source: 'hand' }, { question_id: '', source: 'hollow' }] }] } }) } })
    const r = await make().port.generate!({ blueprintId: 'e1', seed: 7 })
    expect(fx.calls[0].body).toEqual({ exam: 'e1', seed: 7 })
    expect(r).toMatchObject({ state: 'live', reason: '5 of 6 seats filled.', data: { blueprintId: 'e1', seed: 7, questionIds: ['q-1'], gaps: ['needs 1 more 7-mark question'] } })
  })
  it('generate with no balanced blueprint (400) is FAULT with the engine\'s sentence', async () => {
    fakeEngine({ [`POST ${B}/papers/generate`]: refuse(400, 'The blueprint does not balance: Section A is short.') })
    const r = await make().port.generate!({ blueprintId: 'e1', seed: 1 })
    expect(r.state).toBe('fault')
    expect(r.reason).toContain('does not balance')
  })
})

describe('patterns, practise-next and check', () => {
  const patterns = { n_papers: 3, topics: [{ key: '1|A', unit: 1, topic: 'A', k: 2 }] }
  it('patterns reads the subject the papers carry and maps R-16; WAITING keeps its sentence and hides the counts', async () => {
    const fx = fakeEngine({ [`GET ${B}/papers`]: { json: list([PAPER, PAPER_B]) }, [`GET ${B}/patterns`]: { json: env('live', 'Counted over 3 papers.', { patterns }) } })
    const r = await make().port.patterns!()
    expect(fx.calls.find((c) => c.path === `${B}/patterns`)!.query.get('subject')).toBe('signals')
    expect(r).toMatchObject({ state: 'live', data: { papers: 3, topicCounts: { '1|A': 2 } } })
    fakeEngine({ [`GET ${B}/papers`]: { json: list([PAPER]) }, [`GET ${B}/patterns`]: { json: env('waiting', 'Too few papers to show a pattern: 2 more papers, 9 more reviewed questions.', { patterns, provisional: true }) } })
    // R-16 says provisional: the counts are still there, as a note. No topic and no count per topic travels with them, so a grid cannot draw a pattern.
    expect(await make().port.patterns!()).toEqual({
      state: 'waiting', reason: 'Too few papers to show a pattern: 2 more papers, 9 more reviewed questions.', since: 5000,
      data: { topics: [], papers: 3, topicCounts: {}, provisional: true, questions: 0 },
    })
    fakeEngine({ [`GET ${B}/papers`]: { json: list([PAPER]) }, [`GET ${B}/patterns`]: { json: env('waiting', 'Too few papers.', { patterns: { ...patterns, n_papers: 2, n_questions: 3 }, provisional: true }) } })
    expect((await make().port.patterns!()).data).toMatchObject({ papers: 2, questions: 3, provisional: true })
    // a WAITING answer that is not provisional keeps hiding the counts
    fakeEngine({ [`GET ${B}/papers`]: { json: list([PAPER]) }, [`GET ${B}/patterns`]: { json: env('waiting', 'x', { patterns }) } })
    expect((await make().port.patterns!()).data).toBeNull()
  })
  it('an unknown subject (404 "No such subject.") is FAULT, not "the engine is absent"', async () => {
    fakeEngine({ [`GET ${B}/papers`]: { json: list([PAPER]) }, [`GET ${B}/patterns`]: refuse(404, 'No such subject.') })
    const r = await make().port.patterns!()
    expect(r.state).toBe('fault')
    expect(r.reason).toContain('No such subject.')
  })
  it('with no subject on the papers the plan\'s only subject is used; with two, or none, it asks which', async () => {
    const fx = fakeEngine({ [`GET ${B}/papers`]: { json: list([PAPER_B]) }, 'GET /api/mission/academics': { json: { subjects: [{ id: 'maths' }] } }, [`GET ${B}/patterns`]: { json: env('live', 'ok', { patterns }) } })
    await make().port.patterns!()
    expect(fx.calls.find((c) => c.path === `${B}/patterns`)!.query.get('subject')).toBe('maths')
    const none = fakeEngine({ [`GET ${B}/papers`]: { json: list([PAPER_B]) }, 'GET /api/mission/academics': { json: { subjects: [{ id: 'a' }, { id: 'b' }] } } })
    expect(await make().port.patterns!()).toMatchObject({ state: 'waiting', data: null })
    expect(none.calls.some((c) => c.path === `${B}/patterns`)).toBe(false)
  })
  it('a subject set by hand wins over the papers', async () => {
    const fx = fakeEngine({ [`GET ${B}/papers`]: { json: list([PAPER]) }, [`GET ${B}/practise-next`]: { json: list([{ key: '1|A', reason: 'set in 2 of 3 papers, not practised' }], 'live', '1 topic, about 30 of 60 minutes.') } })
    const a = make()
    a.setSubject('physics')
    const r = await a.port.practiseNext!()
    expect(fx.calls.find((c) => c.path === `${B}/practise-next`)!.query.get('subject')).toBe('physics')
    expect(r.data).toEqual([{ topicId: '1|A', reason: 'set in 2 of 3 papers, not practised' }])
  })
  it('practise-next WAITING is kept with its reason', async () => {
    fakeEngine({ [`GET ${B}/papers`]: { json: list([PAPER]) }, [`GET ${B}/practise-next`]: { json: list([], 'waiting', 'No topic has 3 reviewed questions yet.') } })
    expect(await make().port.practiseNext!()).toMatchObject({ state: 'waiting', reason: 'No topic has 3 reviewed questions yet.', data: null })
  })
  it('check maps a match or a miss with the engine\'s note, never a mark', async () => {
    const fx = fakeEngine({ [`POST ${B}/check`]: { json: env('live', 'It does not match the key.', { check: { match: false, key: '3.3 kohm', parsed: 3300, tolerance: 0.01, note: 'read as ohm' } }) } })
    const r = await make().port.check!({ qid: 'n:rc:5:u1', answer: '3300' })
    expect(fx.calls[0].body).toEqual({ question_id: 'n:rc:5:u1', answer: '3300' })
    expect(r.data).toEqual({ matches: false, working: 'Read 3300. read as ohm' })
    expect(JSON.stringify(r)).not.toMatch(/mark|score|pass/i)
  })
  it('a question with no numeric key is WAITING with the engine\'s reason, and a non-number answer is FAULT 400', async () => {
    fakeEngine({ [`POST ${B}/check`]: { json: env('waiting', 'This question has no numeric key.', { check: { match: null } }) } })
    expect(await make().port.check!({ qid: 'q-1', answer: '1' })).toMatchObject({ state: 'waiting', reason: 'This question has no numeric key.', data: null })
    fakeEngine({ [`POST ${B}/check`]: refuse(400, 'Type the answer as a number.') })
    expect((await make().port.check!({ qid: 'q-1', answer: 'abc' })).state).toBe('fault')
  })
})

describe('silence', () => {
  const calls: Record<string, (p: Partial<StudyPort>) => Promise<unknown>> = {
    papers: (p) => p.papers!(), questions: (p) => p.questions!(), ingest: (p) => p.ingest!({ route: 'drop', files: [file('a.pdf')] }),
    decide: (p) => p.decide!({ kind: 'accept', qid: 'q-1' }), crop: (p) => p.crop!({ qid: 'q-1', bbox: [0, 0, 1, 1] }), blueprints: (p) => p.blueprints!(),
    generate: (p) => p.generate!({ blueprintId: 'e1', seed: 1 }), patterns: (p) => p.patterns!(), practiseNext: (p) => p.practiseNext!(), check: (p) => p.check!({ qid: 'q-1', answer: '1' }),
  }
  it('with the product gate off no member makes a request and each answers what the null adapter answers', async () => {
    const fx = fakeEngine({ [`GET ${B}/papers`]: { json: list([PAPER]) } })
    const a = make({ gate: () => false })
    for (const m of TEN) {
      const got = await calls[m](a.port)
      const want = await (nullStudyPort[m] as (...x: unknown[]) => Promise<unknown>)()
      expect(got, m).toEqual(want)
    }
    expect(fx.calls).toHaveLength(0)
  })
  it('with no token no member makes a request either', async () => {
    const fx = fakeEngine({ [`GET ${B}/papers`]: { json: list([PAPER]) } })
    const a = make({ token: () => '' })
    for (const m of TEN) expect((await calls[m](a.port) as { state: string }).state, m).toBe('waiting')
    expect(fx.calls).toHaveLength(0)
  })
})

describe('registration', () => {
  it('registers at rank 10 and supplies exactly the ten members of the exam slice', () => {
    expect(registration.id).toBe('pyq')
    expect(registration.rank).toBe(10)
    expect(Object.keys(registration.port).sort()).toEqual([...TEN].sort())
  })
  it('composed over the null adapter, the six members it does not supply stay the null adapter\'s', async () => {
    const port = composePort([{ id: 'null', rank: 0, port: nullStudyPort }, registration])
    for (const m of STUDY_MEMBERS.filter((x) => !TEN.includes(x))) {
      const want = await (nullStudyPort[m] as (...x: unknown[]) => Promise<unknown>)()
      expect(await (port[m] as (...x: unknown[]) => Promise<unknown>)(), m).toEqual(want)
    }
  })
  it('the registered adapter, in a window with no token, answers WAITING without a request (the desk\'s default port)', async () => {
    const fx = fakeEngine({ [`GET ${B}/papers`]: { json: list([PAPER]) } })
    expect((await registration.port.papers!()).state).toBe('waiting')
    expect(fx.calls).toHaveLength(0)
    expect(() => abortPyq()).not.toThrow()
  })
})
