// The Classroom adapter against a fake engine: the envelope of G-01 mapped onto ClassroomStatus in each of the five states, the
// engine being absent, the sentences of a 400 and a 409 kept as the engine said them, the two ways the client stays silent (the
// product gate off, no token), the query of the file list, the original as a blob URL, and the abort. Every record is invented.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { STUDY_MEMBERS, composePort } from '../../ports'
import { nullStudyPort } from '../null.register'
import { ABSENT_REASON, NOT_BUILT_REASON, NO_TOKEN_REASON, createGcr } from '../gcr'
import registration from '../gcr.register'
import { env, fakeEngine, refuse } from './fakeEngine'

const B = '/api/mission/gcr'
const COUNTS = { courses: 2, files: 9, notes: 4, papers: 1, faults: 0 }
const STATUS = { scopes: [{ name: 'courses.read', label: 'Read your courses', granted: true }], connecting: false, synced_at: '2026-11-22 10:00', counts: COUNTS, job: null }
const JOB = { status: 'running', started: '2026-11-22 10:01', finished: '', text: 'Reading course 1 of 2', counts: null, fault_lines: [] }

function make(over: { gate?: () => boolean; token?: () => string } = {}) {
  return createGcr({ gate: () => true, token: () => 'tok', now: () => 5000, ...over })
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('G-01 mapped onto the port member classroom()', () => {
  it('LIVE carries the counts, the time, the scopes and the job; connected is true', async () => {
    fakeEngine({ [`GET ${B}/status`]: { json: env('live', 'Linked.', STATUS) } })
    const r = await make().port.classroom!()
    expect(r.state).toBe('live')
    expect(r.reason).toBe('Linked.')
    expect(r.data).toMatchObject({ connected: true, courses: 2, connecting: false, syncedAt: '2026-11-22 10:00', counts: COUNTS, job: null })
    expect(r.data?.scopes?.[0].granted).toBe(true)
  })
  it.each(['planned', 'waiting', 'fault'] as const)('%s keeps the engine reason and carries no data', async (state) => {
    fakeEngine({ [`GET ${B}/status`]: { json: env(state, `the engine says ${state}`, { ...STATUS, counts: COUNTS }) } })
    const r = await make().port.classroom!()
    expect(r).toMatchObject({ state, reason: `the engine says ${state}`, data: null })
  })
  it('a SIMULATED answer is not LIVE: no data is drawn as measured', async () => {
    fakeEngine({ [`GET ${B}/status`]: { json: env('simulated', 'a rehearsal', STATUS) } })
    const r = await make().port.classroom!()
    expect(r.state).toBe('simulated')
    expect(r.data).toBeNull()
  })
  it('an answer with no valid state is a FAULT, never LIVE', async () => {
    fakeEngine({ [`GET ${B}/status`]: { json: { reason: 'x' } } })
    expect((await make().port.classroom!()).state).toBe('fault')
  })
  it('the other fifteen members are not supplied: they stay the null adapter', () => {
    expect(Object.keys(registration.port)).toEqual(['classroom'])
    expect(registration.id).toBe('gcr')
    expect(registration.rank).toBe(10)
    const port = composePort([{ id: 'null', rank: 0, port: nullStudyPort }, registration])
    expect(STUDY_MEMBERS.filter((m) => port[m] !== nullStudyPort[m])).toEqual(['classroom'])
  })
})

describe('the engine is absent, or refuses', () => {
  it('a 404 "Not Found" on the prefix is WAITING "engine routes not found", from the app, with no data', async () => {
    fakeEngine({})
    const g = make()
    const s = await g.client.status()
    expect(s).toMatchObject({ state: 'waiting', reason: ABSENT_REASON, from: 'app', data: null })
    expect((await g.port.classroom!()).reason).toBe(ABSENT_REASON)
    expect((await g.client.courses()).reason).toBe(ABSENT_REASON)
    expect((await g.client.sync()).reason).toBe(ABSENT_REASON)
  })
  it('a 400 keeps the engine sentence as the reason, from the engine, with the status', async () => {
    fakeEngine({ [`POST ${B}/sync`]: refuse(400, 'Sign in to Classroom first.') })
    const r = await make().client.sync(['c-1'])
    expect(r).toMatchObject({ state: 'waiting', reason: 'Sign in to Classroom first.', from: 'engine', status: 400, data: null })
  })
  it('a 409 on connect and on sync keeps the busy sentence', async () => {
    fakeEngine({ [`POST ${B}/connect`]: refuse(409, 'A sign-in is already open.'), [`POST ${B}/sync`]: refuse(409, 'A sync is already running.') })
    const g = make()
    expect(await g.client.connect()).toMatchObject({ reason: 'A sign-in is already open.', status: 409, data: null })
    expect(await g.client.sync()).toMatchObject({ reason: 'A sync is already running.', status: 409, data: null })
  })
  it('a server error is a FAULT with the status, and no answer at all is a FAULT from the app', async () => {
    fakeEngine({ [`GET ${B}/courses`]: refuse(500, 'boom') })
    const g = make()
    expect(await g.client.courses()).toMatchObject({ state: 'fault', status: 500 })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    expect(await g.client.courses()).toMatchObject({ state: 'fault', from: 'app' })
  })
  it('a 409 on to-papers and a 400 on a non-PDF are the engine sentences too', async () => {
    fakeEngine({ [`POST ${B}/files/f-1/to-papers`]: refuse(409, 'The paper desk is busy.'), [`POST ${B}/files/f-2/to-papers`]: refuse(400, 'Only a PDF can go to the paper desk.') })
    const g = make()
    expect((await g.client.toPapers('f-1')).reason).toBe('The paper desk is busy.')
    expect((await g.client.toPapers('f-2')).reason).toBe('Only a PDF can go to the paper desk.')
  })
})

describe('the client stays silent when it must', () => {
  it.each([
    ['the product gate off', { gate: () => false }],
    ['no token in the window', { token: () => '' }],
  ] as const)('with %s no request is made: PLANNED status, WAITING for the rest', async (_n, over) => {
    const e = fakeEngine({ [`GET ${B}/status`]: { json: env('live', 'x', STATUS) } })
    const g = make(over)
    expect(await g.client.status()).toMatchObject({ state: 'planned', reason: NOT_BUILT_REASON, from: 'app', data: null })
    expect(await g.client.connect()).toMatchObject({ state: 'waiting', reason: NO_TOKEN_REASON })
    expect((await g.client.files()).data).toBeNull()
    expect((await g.client.original('f-1')).data).toBeNull()
    expect((await g.port.classroom!()).state).toBe('planned')
    expect(e.calls).toHaveLength(0)
  })
})

describe('the routes and their bodies', () => {
  it('the file list sends the course, the kind and the text; an empty filter sends nothing', async () => {
    const e = fakeEngine({ [`GET ${B}/files`]: { json: env('live', 'ok', { items: [] }) } })
    const g = make()
    await g.client.files({ course: 'c-1', kind: 'paper', q: ' signals ' })
    await g.client.files({ kind: '', q: '  ' })
    expect([...e.calls[0].query.entries()]).toEqual([['course', 'c-1'], ['kind', 'paper'], ['q', 'signals']])
    expect([...e.calls[1].query.entries()]).toEqual([])
  })
  it('sync sends the courses only when they are named; patches carry exactly the field changed', async () => {
    const e = fakeEngine({
      [`POST ${B}/sync`]: { json: env('live', 'started', { job: JOB }) },
      [`PATCH ${B}/courses/c-1`]: { json: env('live', 'ok', { course: { id: 'c-1' } }) },
      [`PATCH ${B}/files/f-1`]: { json: env('live', 'Marked as a paper.', { file: { id: 'f-1', kind: 'paper' } }) },
    })
    const g = make()
    const s = await g.client.sync()
    expect(s.data?.job.status).toBe('running')
    await g.client.sync(['c-1'])
    await g.client.patchCourse('c-1', { include: false })
    const k = await g.client.setKind('f-1', 'paper')
    expect(e.calls.map((c) => c.body)).toEqual([{}, { courses: ['c-1'] }, { include: false }, { kind: 'paper' }])
    expect(k.reason).toBe('Marked as a paper.')
  })
  it('the original is fetched with the token header and handed over as a blob URL; revoking calls revokeObjectURL', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:original-1')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const e = fakeEngine({ [`GET ${B}/files/f-1/original`]: { bytes: new Uint8Array([37, 80, 68, 70]), type: 'application/pdf' } })
    const g = make()
    const r = await g.client.original('f-1')
    expect(e.calls[0].headers['x-jarvis-token']).toBe('tok')
    expect(r.data).toEqual({ url: 'blob:original-1', mime: 'application/pdf', bytes: 4 })
    g.client.revokeOriginal(r.data!.url)
    expect(revoke).toHaveBeenCalledWith('blob:original-1')
  })
  it('a refused original keeps the engine sentence', async () => {
    fakeEngine({ [`GET ${B}/files/f-1/original`]: refuse(404, 'The original is not on this PC.') })
    expect(await make().client.original('f-1')).toMatchObject({ state: 'waiting', reason: 'The original is not on this PC.', status: 404, data: null })
  })
})

describe('abort', () => {
  it('abortAll stops a request in flight, and later calls start fresh', async () => {
    vi.stubGlobal('fetch', vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('stopped'), { name: 'AbortError' })))
    })))
    const g = make()
    const p = g.client.status()
    g.abortAll()
    expect(await p).toMatchObject({ state: 'waiting', reason: 'Stopped: the view was closed.' })
    fakeEngine({ [`GET ${B}/status`]: { json: env('live', 'ok', STATUS) } })
    expect((await g.client.status()).state).toBe('live')
  })
  it('the caller signal stops one call', async () => {
    vi.stubGlobal('fetch', vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('stopped'), { name: 'AbortError' })))
    })))
    const own = new AbortController()
    const p = make().client.courses(own.signal)
    own.abort()
    expect((await p).reason).toBe('Stopped: the view was closed.')
  })
})
