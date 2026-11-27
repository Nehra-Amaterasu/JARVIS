// The intake store's adapter against a fake engine whose bodies are the shapes of routes_ww_intake.py and routes_ww_pyq_takeout.py (as
// built on main 7e7e3c1): the row mapped to the desk's row, the filters, a paste sent as text (the browser reads no date), an ambiguous
// row that Accept refuses until a date is given, a take refused with 409 and 503 in the engine's own sentence, a delete, the fault with
// its problems, the export listed by path and by file, one entry accepted per call, and the two ways the adapter stays silent. Every
// record is invented.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { env, fakeEngine, list, refuse } from '../../../adapters/__tests__/fakeEngine'
import { nullIntakeDesk } from '../../port'
import { ABSENT_REASON, NO_UNDO, TAKEOUT, createIntakeStore, toListing, toRow } from '../store'

const B = '/api/mission/intake'
const SRC = 'what you brought in'
const eRow = (over: Record<string, unknown> = {}) => ({
  id: 'i-0123456789ab', source: 'paste', kind: 'deadline', state: 'new', title: 'Assignment 3', date: '2026-12-02', time: '17:00',
  readings: [{ date: '2026-12-02', order: '' }], ambiguous: false, subject: '', subject_suggestion: { subject: 'maths', score: 0.8 },
  repeats: 'none', file: null, raw_hash: 'x', added: '2026-11-27T10:00:00', updated: '2026-11-27T10:00:00', ...over,
})
const make = (over: { gate?: () => boolean; token?: () => string } = {}) => createIntakeStore({ gate: () => true, token: () => 'tok', now: () => 5000, ...over })
const resp = (state: string, reason: string, extra: Record<string, unknown> = {}) => ({ state, reason, source: SRC, ...extra })

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('the row', () => {
  it('maps the engine row onto the desk row: readings as dates, the suggestion, repeats as a flag and a word, added in ms', () => {
    const r = toRow(eRow({ ambiguous: true, date: null, readings: [{ date: '2026-12-03', order: 'day-month' }, { date: '2027-03-12', order: 'month-day' }], repeats: 'not expanded' }))!
    expect(r).toMatchObject({ id: 'i-0123456789ab', ambiguous: true, date: null, readings: ['2026-12-03', '2027-03-12'], readingOrders: ['day-month', 'month-day'], repeats: true, repeatsWord: 'not expanded', suggestion: { subject: 'maths', score: 0.8 } })
    expect(r.added).toBe(new Date(2026, 10, 27, 10, 0, 0).getTime())
    expect(toRow(eRow({ repeats: 'none' }))!.repeats).toBe(false)
  })
  it('a file row keeps its name, size and whether the app owns the copy; a row with a word it does not know is not drawn', () => {
    expect(toRow(eRow({ source: 'folder', kind: 'file', title: 'n.pdf', date: null, file: { name: 'n.pdf', size: 482000, owned: false } }))!.file).toEqual({ name: 'n.pdf', size: 482000, owned: false })
    expect(toRow(eRow({ state: 'sleeping' }))).toBeNull()
    expect(toRow({})).toBeNull()
  })
})

describe('R-36 the list', () => {
  it('LIVE keeps the engine sentence and maps the rows; the desk lists them with no query', async () => {
    const fx = fakeEngine({ [`GET ${B}`]: { json: list([eRow(), eRow({ id: 'i-ba9876543210', state: 'accepted' })], 'live', '2 rows brought in.') } })
    const r = await make().port.list()
    expect(r).toMatchObject({ state: 'live', reason: '2 rows brought in.' })
    expect(r.data?.map((x) => x.state)).toEqual(['new', 'accepted'])
    expect(fx.calls[0].query.toString()).toBe('')
  })
  it('an empty store is WAITING with the engine sentence and no rows', async () => {
    fakeEngine({ [`GET ${B}`]: { json: list([], 'waiting', 'Nothing brought in yet.') } })
    expect(await make().port.list()).toMatchObject({ state: 'waiting', reason: 'Nothing brought in yet.' })
  })
  it('a fault carries no rows and keeps the problems for the screen, newest sentence as the reason', async () => {
    const problems = ['rows.json could not be parsed; kept beside it as rows.json.1.corrupt.']
    fakeEngine({ [`GET ${B}`]: { json: list([], 'fault', problems[0], { problems }) } })
    const a = make()
    const r = await a.port.list()
    expect(r).toMatchObject({ state: 'fault', reason: problems[0], data: null })
    expect(a.port.problems!()).toEqual(problems)
  })
  it('live rows with problems keep both (rows mended in place)', async () => {
    fakeEngine({ [`GET ${B}`]: { json: list([eRow()], 'live', '1 row brought in.', { problems: ['1 row(s) in rows.json had no date or state; they are listed first and as new.'] }) } })
    const a = make()
    expect((await a.port.list()).data).toHaveLength(1)
    expect(a.port.problems!()).toHaveLength(1)
  })
  it('an answer with no valid state is a FAULT, and the engine being absent is WAITING', async () => {
    fakeEngine({ [`GET ${B}`]: { json: { items: [] } } })
    expect((await make().port.list()).state).toBe('fault')
    fakeEngine({})
    expect(await make().port.list()).toMatchObject({ state: 'waiting', reason: ABSENT_REASON })
  })
})

describe('R-37 paste', () => {
  it('sends the text and nothing else; the engine reads it; unread lines come back listed', async () => {
    const fx = fakeEngine({
      [`POST ${B}/paste`]: {
        json: resp('live', '1 new row from your lines; 1 line could not be read.', { items: [eRow()], count: 1, unread: [{ line: 2, text: 'viva on Thursday', reason: 'No date found.' }] }),
      },
    })
    const r = await make().port.paste('Maths Assignment 3 - due 2 Dec 5pm\nviva on Thursday')
    expect(fx.calls[0].body).toEqual({ text: 'Maths Assignment 3 - due 2 Dec 5pm\nviva on Thursday' })
    expect(r.reason).toBe('1 new row from your lines; 1 line could not be read.')
    expect(r.data?.items[0].title).toBe('Assignment 3')
    expect(r.data?.unread).toEqual([{ line: 2, text: 'viva on Thursday', reason: 'No date found.' }])
  })
  it('a 400 keeps the engine sentence as the reason and carries no data', async () => {
    fakeEngine({ [`POST ${B}/paste`]: refuse(400, 'Paste at least one line.') })
    expect(await make().port.paste('  ')).toMatchObject({ state: 'waiting', reason: 'Paste at least one line.', data: null })
  })
})

describe('R-38 the calendar file', () => {
  it('sends the raw text as the body and maps skipped and past', async () => {
    const fx = fakeEngine({ [`POST ${B}/ics`]: { json: resp('live', '1 new row from the calendar; 2 events already over, left out.', { items: [eRow({ source: 'ics', kind: 'event', repeats: 'expanded' })], count: 1, skipped: 0, past: 2 }) } })
    const r = await make().port.ics('BEGIN:VCALENDAR\nEND:VCALENDAR')
    expect(fx.calls[0].raw).toBeInstanceOf(Blob)
    expect(r.data).toMatchObject({ skipped: 0, past: 2 })
    expect(r.data?.items[0]).toMatchObject({ source: 'ics', repeats: true, repeatsWord: 'expanded' })
  })
  it('over 500 repeating events is 400 with the engine sentence', async () => {
    fakeEngine({ [`POST ${B}/ics`]: refuse(400, 'This calendar has 600 repeating events; I take at most 500 at a time. Export a shorter range.') })
    expect((await make().port.ics('x')).reason).toContain('at most 500')
  })
})

describe('R-39 accept and decline, R-40 take, R-41 delete', () => {
  it('Accept sends only what he gave: the state, the date he chose, the subject; the row comes back accepted', async () => {
    const fx = fakeEngine({ [`PATCH ${B}/i-0123456789ab`]: { json: resp('live', 'Row accepted.', { row: eRow({ state: 'accepted', ambiguous: false, date: '2026-12-03' }) }) } })
    const r = await make().port.decide('i-0123456789ab', { state: 'accepted', date: '2026-12-03', subject: 'maths' })
    expect(fx.calls[0].body).toEqual({ state: 'accepted', date: '2026-12-03', subject: 'maths' })
    expect(r.data).toMatchObject({ state: 'accepted', date: '2026-12-03' })
  })
  it('an ambiguous row refused for the date keeps the engine sentence', async () => {
    fakeEngine({ [`PATCH ${B}/i-0123456789ab`]: refuse(400, 'This date can be read two ways; give the date before accepting.') })
    expect((await make().port.decide('i-0123456789ab', { state: 'accepted' })).reason).toBe('This date can be read two ways; give the date before accepting.')
  })
  it('there is no way back to new: the adapter says so and sends nothing', async () => {
    const fx = fakeEngine({})
    const a = make()
    expect(await a.port.decide('i-0123456789ab', { state: 'new' })).toMatchObject({ state: 'waiting', reason: NO_UNDO })
    expect(fx.calls).toHaveLength(0)
    expect(a.port.noUndo).toBe(NO_UNDO)
  })
  it('Take sends the place and maps the row; a busy reader (409) and a desk not mounted (503) are the engine sentence, not a fault', async () => {
    const fx = fakeEngine({ [`POST ${B}/i-0123456789ab/take`]: { json: resp('live', 'Reading n.pdf into the paper desk.', { row: eRow({ kind: 'file', state: 'taken' }), job: { id: 'j1' } }) } })
    const r = await make().port.take('i-0123456789ab', 'papers')
    expect(fx.calls[0].body).toEqual({ to: 'papers' })
    expect(r.data?.state).toBe('taken')
    fakeEngine({ [`POST ${B}/i-0123456789ab/take`]: refuse(409, 'Already reading files; wait for that to finish.') })
    expect(await make().port.take('i-0123456789ab', 'papers')).toMatchObject({ state: 'waiting', reason: 'Already reading files; wait for that to finish.' })
    fakeEngine({ [`POST ${B}/i-0123456789ab/take`]: refuse(503, 'The paper desk is not up yet.') })
    expect(await make().port.take('i-0123456789ab', 'papers')).toMatchObject({ state: 'waiting', reason: 'The paper desk is not up yet.' })
  })
  it('Delete answers what was removed: the row, and the file only when the app owned the copy', async () => {
    const fx = fakeEngine({ [`DELETE ${B}/i-0123456789ab`]: { json: resp('live', 'Row removed.', { removed: { row: true, file: false } }) } })
    const r = await make().port.remove('i-0123456789ab')
    expect(fx.calls[0].method).toBe('DELETE')
    expect(r.data).toEqual({ row: true, file: false })
    fakeEngine({ [`DELETE ${B}/i-0123456789ab`]: refuse(404, 'No such row.') })
    expect(await make().port.remove('i-0123456789ab')).toMatchObject({ state: 'waiting', reason: 'No such row.', data: null })
  })
})

describe('the subjects of the plan', () => {
  it('are read from the academics route; none is WAITING', async () => {
    fakeEngine({ 'GET /api/mission/academics': { json: { subjects: [{ id: 'maths', name: 'Maths' }, { id: 'signals', name: 'Signals' }] } } })
    expect((await make().port.subjects()).data).toEqual([{ id: 'maths', label: 'Maths' }, { id: 'signals', label: 'Signals' }])
    fakeEngine({ 'GET /api/mission/academics': { json: { subjects: [] } } })
    expect((await make().port.subjects()).state).toBe('waiting')
  })
})

describe('R-46 and R-47 the Classroom export', () => {
  const listing = {
    id: 'tk-0123456789', name: 'export.zip', total_size: 1_500_000, note: 'Nothing is read until you ask.',
    entries: [
      { name: 'week1.pdf', size: 900_000, kind: 'pdf', refused: null },
      { name: 'clip.mp4', size: 590_000, kind: 'other', refused: null },
      { name: '../x.pdf', size: 10, kind: 'pdf', refused: 'The name leaves the archive.' },
    ],
  }
  const listed = resp('live', 'Listed 3 files in export.zip: 1 papers or decks you can read, 1 refused. Nothing was extracted.', { listing })
  it('lists by path with the path in the body and maps the entries by name, with kind and the engine refusal', async () => {
    const fx = fakeEngine({ [`POST ${TAKEOUT}`]: { json: listed } })
    const r = await make().port.archivePath!('D:\\Exports\\export.zip')
    expect(fx.calls[0].body).toEqual({ path: 'D:\\Exports\\export.zip' })
    expect(r.data?.entries.map((e) => [e.id, e.kind, e.refused])).toEqual([['week1.pdf', 'pdf', undefined], ['clip.mp4', 'other', undefined], ['../x.pdf', 'pdf', 'The name leaves the archive.']])
    expect(r.data).toMatchObject({ id: 'tk-0123456789', totalSize: 1_500_000 })
  })
  it('lists a picked file by sending the bytes with its name in the query', async () => {
    const fx = fakeEngine({ [`POST ${TAKEOUT}`]: { json: listed } })
    const f = new File([new Uint8Array([80, 75, 3, 4])], 'export.zip')
    await make().port.archive(f)
    expect(fx.calls[0].query.get('name')).toBe('export.zip')
    expect(fx.calls[0].raw).toBe(f)
  })
  it('a path that is not a .zip is the engine sentence; an oversize archive is 413 in its words', async () => {
    fakeEngine({ [`POST ${TAKEOUT}`]: refuse(400, 'There is no file at that path.') })
    expect(await make().port.archivePath!('C:\\none.zip')).toMatchObject({ state: 'waiting', reason: 'There is no file at that path.', data: null })
    fakeEngine({ [`POST ${TAKEOUT}`]: refuse(413, 'An export is at most 500 MB.') })
    expect((await make().port.archivePath!('C:\\big.zip')).reason).toBe('An export is at most 500 MB.')
  })
  it('accepts exactly the entries it is given, by name, and keeps the engine sentence', async () => {
    const fx = fakeEngine({ [`POST ${TAKEOUT}/tk-0123456789/accept`]: { json: resp('live', 'Reading 1 file from export.zip.', { job: { id: 'j' } }) } })
    const r = await make().port.queueArchive('tk-0123456789', ['week1.pdf'])
    expect(fx.calls[0].body).toEqual({ entries: ['week1.pdf'] })
    expect(r).toMatchObject({ state: 'live', reason: 'Reading 1 file from export.zip.', data: { queued: 1 } })
    fakeEngine({ [`POST ${TAKEOUT}/tk-0123456789/accept`]: refuse(409, 'Already reading files; wait for that to finish.') })
    expect((await make().port.queueArchive('tk-0123456789', ['week1.pdf'])).reason).toBe('Already reading files; wait for that to finish.')
  })
  it('toListing needs an id and entries', () => {
    expect(toListing({})).toBeNull()
  })
})

describe('silence and abort', () => {
  it.each([['the gate is off', { gate: () => false }], ['there is no token', { token: () => '' }]] as const)('when %s, nothing is called and every member answers what the null desk answers', async (_n, over) => {
    const fx = fakeEngine({})
    const p = make(over).port
    expect(await p.list()).toEqual(await nullIntakeDesk.list())
    expect(await p.paste('x')).toEqual(await nullIntakeDesk.paste('x'))
    expect(await p.take('i-0123456789ab', 'papers')).toEqual(await nullIntakeDesk.take('i-0123456789ab', 'papers'))
    expect(await p.queueArchive('tk-0123456789', ['a.pdf'])).toEqual(await nullIntakeDesk.queueArchive('tk-0123456789', ['a.pdf']))
    expect(fx.calls).toHaveLength(0)
  })
  it('courses and the mapping stay the null desk: no route reads class names', async () => {
    const p = make().port
    expect(await p.courses()).toEqual(await nullIntakeDesk.courses())
  })
  it('abortAll stops the call in flight, and a later call starts fresh', async () => {
    vi.stubGlobal('fetch', vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('stopped'), { name: 'AbortError' })))
    })))
    const a = make()
    const pending = a.port.list()
    a.abortAll()
    expect(await pending).toMatchObject({ state: 'waiting', reason: 'Stopped: the view was closed.' })
    fakeEngine({ [`GET ${B}`]: { json: env('live', 'ok', { items: [] }) } })
    expect((await a.port.list()).state).toBe('live')
  })
})
