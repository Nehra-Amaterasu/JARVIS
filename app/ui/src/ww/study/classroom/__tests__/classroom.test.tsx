// The Classroom plate, the shelf and the note reader, rendered against a fake client. Every name, title and sentence is invented.
// The plate's keys per state, the connect poll that stops on unmount, the shelf listing courses and files, the note shown as
// text (a <script> stays text), the blob URL revoked on close, and the engine's own sentence after a kind change and a send to the
// paper desk.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { mount } from '../../../../__tests__/ww/_stubs'
import { POLL_MS, type GcrClient } from '../../adapters/gcr'
import type { GcrAnswer, GcrCourse, GcrFile, GcrJob, GcrStatusBody } from '../../adapters/gcrTypes'
import { nullIntakeDesk, type IntakeDeskPort } from '../../intake/port'
import { ClassroomPlate } from '../ClassroomPlate'
import { ClassroomShelf, SEARCH_MS } from '../ClassroomShelf'
import { ACCOUNT_RULE, FAULTS_SHOWN } from '../LinkPanel'
import { STALE_SENTENCE } from '../ShelfPanes'
import { NoteView, parseNote } from '../markdown'
import { APPROVE_SENTENCE } from '../useClassroomLink'

let m: ReturnType<typeof mount> | null = null
afterEach(() => { m?.unmount(); m = null; document.body.innerHTML = ''; vi.useRealTimers() })

const q = (sel: string) => document.body.querySelector(sel) as HTMLElement
const qa = (sel: string) => Array.from(document.body.querySelectorAll<HTMLElement>(sel))
const button = (re: RegExp) => qa('button').find((b) => re.test(b.textContent ?? ''))
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() }) }
const typeInto = (el: HTMLInputElement, v: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const pick = (el: HTMLSelectElement, v: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, v)
  el.dispatchEvent(new Event('change', { bubbles: true }))
})

// ------------------------------------------------------------------------------------------------ invented records
const COUNTS = { courses: 2, files: 3, notes: 1, papers: 1, faults: 2 }
const body = (over: Partial<GcrStatusBody> = {}): GcrStatusBody => ({ scopes: [{ name: 's', label: 'Read your courses', granted: true }], connecting: false, synced_at: '2026-11-22 09:30', counts: COUNTS, job: null, ...over })
const answer = <T,>(state: GcrAnswer<T>['state'], reason: string, data: T | null, over: Partial<GcrAnswer<T>> = {}): GcrAnswer<T> =>
  ({ state, reason, source: 'the Classroom link', from: 'engine', status: 200, since: 1, data, ...over })
const COURSE_A: GcrCourse = { id: 'c-a', name: 'Signals Studio', section: 'Section Q', state: 'live', subject: 'signals', subject_source: 'your plan', include: true, files: 2, notes: 1, papers: 1, read_at: '2026-11-22', link: '' }
const COURSE_B: GcrCourse = { id: 'c-b', name: 'Applied Maths', section: '', state: 'live', subject: '', subject_source: '', include: false, files: 1, notes: 0, papers: 0, read_at: '2026-11-22', link: '' }
const file = (over: Partial<GcrFile>): GcrFile => ({
  id: 'f-1', course: 'c-a', course_name: 'Signals Studio', subject: 'signals', title: 'Week 3 slides', ext: 'pdf', kind: 'notes', kind_source: 'engine', state: 'live', reason: '',
  note_state: 'live', note_reason: 'note written from 12 pages', pages: 12, words: 900, scanned_pages: 0, size: 2000, modified: '2026-11-20',
  post: { kind: 'material', title: 'Week 3', topic: 'Sampling' }, has_note: true, has_original: true, paper_id: null, ...over,
})
const F1 = file({})
const F2 = file({ id: 'f-2', title: 'Mock paper A', kind: 'paper', note_reason: 'a paper: no note is written', has_note: false, post: { kind: 'assignment', title: 'Mock', topic: 'Mock' } })
const F3 = file({ id: 'f-3', title: 'Lab slides', ext: 'pptx', course: 'c-b', course_name: 'Applied Maths', note_reason: 'slides: text only' })
const NOTE = '---\ntitle: "Week 3 slides"\ncourse: Signals Studio\npages: 12\nauthor: nobody shown\n---\n# Sampling\n\nFirst line.\nSecond line.\n\n> a quoted line\n> and another\n\n## Aliasing\n\n<script>alert(1)</script> stays text'

/** A client whose every route answers LIVE with the invented records, so a test overrides only what it checks. */
function fakeClient(over: Partial<GcrClient> = {}): GcrClient {
  const c: GcrClient = {
    status: vi.fn(async () => answer('live', 'Linked.', body())),
    connect: vi.fn(async () => answer('waiting', APPROVE_SENTENCE, body({ connecting: true }))),
    disconnect: vi.fn(async () => answer('waiting', 'Not linked.', body({ counts: null }))),
    sync: vi.fn(async () => answer('live', 'Started.', { job: { status: 'running', started: 'now', finished: '', text: 'Reading course 1 of 2', counts: null, fault_lines: [] } as GcrJob })),
    job: vi.fn(async () => answer('live', 'ok', { job: { status: 'running', started: 'now', finished: '', text: 'Reading course 2 of 2', counts: null, fault_lines: [] } as GcrJob })),
    courses: vi.fn(async () => answer('live', 'ok', { items: [COURSE_A, COURSE_B] })),
    patchCourse: vi.fn(async (id, patch) => answer('live', 'ok', { course: { ...(id === 'c-a' ? COURSE_A : COURSE_B), ...patch } as GcrCourse })),
    files: vi.fn(async (query) => answer('live', 'ok', { items: [F1, F2, F3].filter((f) => !query?.course || f.course === query.course) })),
    setKind: vi.fn(async (id, kind) => answer('live', `Marked ${id} as ${kind}.`, { file: file({ id, kind }) })),
    note: vi.fn(async () => answer('live', 'ok', { markdown: NOTE, title: 'Week 3 slides', words: 900, pages: 12, scanned_pages: 0 })),
    original: vi.fn(async () => answer('live', 'ok', { url: 'about:blank#invented-1', mime: 'application/pdf', bytes: 4 })),
    revokeOriginal: vi.fn(),
    openInProgram: vi.fn(async () => answer('live', 'Opened in the PC program for PPTX.', {})),
    toPapers: vi.fn(async () => answer('live', 'Sent: its questions wait for your review.', { paper_id: 'p-1' })),
    // the Due routes are tested in due.test.tsx; here they answer what an engine with nothing read answers
    stopSync: vi.fn(async () => answer('waiting', 'Stopping after the file being fetched.', { job: { status: 'running', started: 'now', finished: '', text: 'Stopping', counts: null, fault_lines: [] } as GcrJob })),
    assignments: vi.fn(async () => answer('waiting', 'No coursework read yet: run a sync.', null as never)),
    openAssignment: vi.fn(async () => answer('live', 'Opened in your browser.', {})),
    remind: vi.fn(async () => answer('waiting', 'No reminder was made.', null as never)),
    removeReminder: vi.fn(async () => answer('live', 'Reminder removed.', {})),
    announcements: vi.fn(async () => answer('waiting', 'No announcements read yet: run a sync.', null as never)),
    calendar: vi.fn(async () => answer('waiting', 'The calendar has not been read yet: run a sync.', null as never)),
    ...over,
  }
  return c
}
const statusOnly = (r: GcrAnswer<GcrStatusBody>) => fakeClient({ status: vi.fn(async () => r) })
const subjectsDesk: IntakeDeskPort = { ...nullIntakeDesk, subjects: async () => ({ state: 'live', reason: '', since: 1, data: [{ id: 'signals', label: 'Signals' }, { id: 'maths', label: 'Maths' }] }) }

// ------------------------------------------------------------------------------------------------ the note reader
describe('the Markdown reader', () => {
  it('reads the front matter into a header (title, course, pages), not raw text, and ignores the other keys', () => {
    const p = parseNote(NOTE)
    expect(p.meta).toMatchObject({ title: 'Week 3 slides', course: 'Signals Studio', pages: '12' })
    m = mount(<NoteView markdown={NOTE} />)
    const meta = q('[data-component="note-meta"]').textContent ?? ''
    expect(meta).toContain('Week 3 slides')
    expect(meta).toContain('Signals Studio')
    expect(meta).toContain('12')
    expect(meta).not.toContain('nobody shown')
    expect(q('[data-component="note-view"]').textContent).not.toContain('---')
  })
  it('renders # and ## as headings, > lines as one block quote, and blank lines as paragraph breaks', () => {
    m = mount(<NoteView markdown={NOTE} />)
    expect(qa('h3').map((h) => h.textContent)).toEqual(['Sampling'])
    expect(qa('h4').map((h) => h.textContent)).toEqual(['Aliasing'])
    expect(qa('blockquote')).toHaveLength(1)
    expect(q('blockquote').textContent).toBe('a quoted line\nand another')
    expect(qa('p.cr-md-p')).toHaveLength(2)
    expect(qa('p.cr-md-p')[0].textContent).toBe('First line.\nSecond line.')
  })
  it('a <script> in the text stays text: no element is made from it', () => {
    m = mount(<NoteView markdown={NOTE} />)
    expect(document.body.querySelector('script')).toBeNull()
    expect(qa('p.cr-md-p')[1].textContent).toBe('<script>alert(1)</script> stays text')
  })
  it('a note with no front matter, an unclosed one, and an empty note are shown as they are', () => {
    expect(parseNote('# Only a heading').meta).toEqual({})
    const unclosed = parseNote('---\ntitle: x\nbody text')
    expect(unclosed.meta).toEqual({})
    expect(unclosed.blocks.map((b) => b.text).join(' ')).toContain('title: x')
    expect(parseNote('').blocks).toEqual([])
  })
  it('windows line endings read the same', () => {
    expect(parseNote('---\r\ntitle: A\r\n---\r\n# H\r\n\r\ntext').blocks.map((b) => b.kind)).toEqual(['h1', 'p'])
  })
})

// ------------------------------------------------------------------------------------------------ the plate
describe('the Classroom plate: keys per state', () => {
  const keys = () => qa('[data-door="classroom"] button').map((b) => (b.textContent ?? '').trim())

  it('PLANNED shows its word and reason and no key', async () => {
    m = mount(<ClassroomPlate client={statusOnly(answer<GcrStatusBody>('planned', 'Classroom is not built.', null, { from: 'app', status: 0 }))} />)
    await flush()
    expect(q('[data-door="classroom"]').textContent).toContain('PLANNED')
    expect(q('[data-door="classroom"]').textContent).toContain('Classroom is not built.')
    expect(q('[data-door="classroom"]').tagName).not.toBe('BUTTON')
    expect(keys()).toEqual([])
  })
  it('WAITING because the routes are absent (from the app) has no key: there is nothing to connect to', async () => {
    m = mount(<ClassroomPlate client={statusOnly(answer<GcrStatusBody>('waiting', 'engine routes not found', null, { from: 'app', status: 0 }))} />)
    await flush()
    expect(q('[data-door="classroom"]').textContent).toContain('WAITING')
    expect(q('[data-door="classroom"]').textContent).toContain('engine routes not found')
    expect(keys()).toEqual([])
  })
  it('WAITING from the engine draws Connect; pressing it calls G-02 and shows the approve sentence with the key held', async () => {
    const client = statusOnly(answer('waiting', 'Not linked yet.', body({ counts: null })))
    m = mount(<ClassroomPlate client={client} />)
    await flush()
    expect(keys()).toEqual(['Connect', 'Add account'])
    click(button(/^Connect$/)!)
    await flush()
    expect(client.connect).toHaveBeenCalledTimes(1)
    expect(q('[data-door="classroom"]').textContent).toContain(APPROVE_SENTENCE)
    expect(button(/Connect/)!.getAttribute('aria-disabled')).toBe('true')
  })
  it('a 409 on Connect prints the engine sentence', async () => {
    const client = fakeClient({
      status: vi.fn(async () => answer('waiting', 'Not linked yet.', body({ counts: null }))),
      connect: vi.fn(async () => answer<GcrStatusBody>('waiting', 'A sign-in is already open.', null, { status: 409 })),
    })
    m = mount(<ClassroomPlate client={client} />)
    await flush()
    click(button(/^Connect$/)!)
    await flush()
    expect(q('[data-component="classroom-say"]').textContent).toContain('A sign-in is already open.')
  })
  it('FAULT draws Connect again and the reason in full', async () => {
    const reason = 'The permission to read course files is missing; connect again and allow it.'
    m = mount(<ClassroomPlate client={statusOnly(answer('fault', reason, body({ scopes: [{ name: 'd', label: 'Read course files', granted: false }] })))} />)
    await flush()
    expect(q('[data-door="classroom"]').textContent).toContain('FAULT')
    expect(q('[data-door="classroom"]').textContent).toContain(reason)
    expect(q('[data-door="classroom"]').textContent).toContain('Not allowed yet: Read course files.')
    expect(keys()).toEqual(['Connect', 'Add account'])
  })
  it('LIVE draws the last sync time, the counts under its LIVE word, Sync now and Disconnect', async () => {
    const client = fakeClient()
    m = mount(<ClassroomPlate client={client} onShelf={() => undefined} />)
    await flush()
    const t = q('[data-door="classroom"]').textContent ?? ''
    expect(t).toContain('LIVE')
    expect(t).toContain('Last sync: 2026-11-22 09:30')
    expect(q('[data-component="classroom-counts"]').textContent).toBe('2 courses, 3 files, 1 notes, 1 papers, 2 faults')
    expect(keys()).toEqual(['Sync now', 'Open the shelf', 'Disconnect', 'Add account'])
    click(button(/Sync now/)!)
    await flush()
    expect(client.sync).toHaveBeenCalledWith(undefined, expect.anything())
    expect(q('[data-component="classroom-job"]').textContent).toBe('Reading course 1 of 2')
    expect(button(/Sync now/)!.getAttribute('aria-disabled')).toBe('true')
  })
  it('Disconnect calls G-03 and the plate goes back to WAITING', async () => {
    const client = fakeClient()
    m = mount(<ClassroomPlate client={client} />)
    await flush()
    click(button(/Disconnect/)!)
    await flush()
    expect(client.disconnect).toHaveBeenCalledTimes(1)
    expect(keys()).toEqual(['Connect', 'Add account'])
  })
  it('the faults of the last sync are listed as text: the first five, then "and N more"', async () => {
    const lines = Array.from({ length: 7 }, (_, i) => `File ${i + 1} could not be read.`)
    const job: GcrJob = { status: 'done', started: 'a', finished: 'b', text: 'Done with faults', counts: COUNTS, fault_lines: lines }
    m = mount(<ClassroomPlate client={statusOnly(answer('live', 'Linked.', body({ job })))} />)
    await flush()
    const items = qa('[data-component="classroom-faults"] li').map((l) => l.textContent)
    expect(items).toHaveLength(FAULTS_SHOWN + 1)
    expect(items.slice(0, FAULTS_SHOWN)).toEqual(lines.slice(0, FAULTS_SHOWN))
    expect(items[FAULTS_SHOWN]).toBe('and 2 more')
  })
  it('five faults or fewer have no "and N more"', async () => {
    const job: GcrJob = { status: 'done', started: 'a', finished: 'b', text: 'Done', counts: COUNTS, fault_lines: ['One failed.', 'Two failed.'] }
    m = mount(<ClassroomPlate client={statusOnly(answer('live', 'Linked.', body({ job })))} />)
    await flush()
    expect(qa('[data-component="classroom-faults"] li').map((l) => l.textContent)).toEqual(['One failed.', 'Two failed.'])
  })
})

describe('the polls', () => {
  it('while connecting, G-01 is asked every 2 s; when the unmount comes the asking stops', async () => {
    vi.useFakeTimers()
    const client = fakeClient({ status: vi.fn(async () => answer('waiting', APPROVE_SENTENCE, body({ connecting: true, counts: null }))) })
    m = mount(<ClassroomPlate client={client} />)
    await flush()
    const first = (client.status as ReturnType<typeof vi.fn>).mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS) })
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS) })
    const polled = (client.status as ReturnType<typeof vi.fn>).mock.calls.length
    expect(polled).toBeGreaterThanOrEqual(first + 2)
    m.unmount()
    m = null
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS * 5) })
    expect((client.status as ReturnType<typeof vi.fn>).mock.calls.length).toBe(polled)
  })
  it('the signal given to a request is aborted when the view closes', async () => {
    const seen: AbortSignal[] = []
    const client = fakeClient({ status: vi.fn(async (s?: AbortSignal) => { if (s) seen.push(s); return answer('live', 'Linked.', body()) }) })
    m = mount(<ClassroomPlate client={client} />)
    await flush()
    expect(seen.length).toBeGreaterThan(0)
    m.unmount()
    m = null
    expect(seen.every((s) => s.aborted)).toBe(true)
  })
  it('while a sync runs, G-05 is asked every 2 s; when it is done the status is read again', async () => {
    vi.useFakeTimers()
    const running: GcrJob = { status: 'running', started: 'a', finished: '', text: 'Reading course 1 of 2', counts: null, fault_lines: [] }
    const done: GcrJob = { status: 'done', started: 'a', finished: 'b', text: 'Read 2 courses', counts: COUNTS, fault_lines: [] }
    const client = fakeClient({
      status: vi.fn(async () => answer('live', 'Linked.', body({ job: running }))),
      job: vi.fn(async () => answer('live', 'ok', { job: done })),
    })
    m = mount(<ClassroomPlate client={client} />)
    await flush()
    const before = (client.status as ReturnType<typeof vi.fn>).mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS) })
    expect(client.job).toHaveBeenCalledTimes(1)
    await flush()
    expect((client.status as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(before)
  })
})

// ------------------------------------------------------------------------------------------------ the shelf
describe('the Classroom shelf', () => {
  const start = async (client: GcrClient = fakeClient()) => { m = mount(<ClassroomShelf client={client} desk={subjectsDesk} />); await flush(); return client }

  it('without a link it is a pose with the state word and the reason, and no list', async () => {
    await start(statusOnly(answer('waiting', 'Not linked yet.', body({ counts: null }))))
    expect(q('[data-component="classroom-shelf"]').textContent).toContain('WAITING')
    expect(q('[data-component="classroom-shelf"]').textContent).toContain('Not linked yet.')
    expect(qa('[data-component="classroom-courses"]')).toHaveLength(0)
    expect(qa('[data-component="classroom-files"]')).toHaveLength(0)
  })
  it('lists the courses with name, section, state word, mapped subject, include switch and counts', async () => {
    await start()
    const rows = qa('[data-course]')
    expect(rows.map((r) => r.querySelector('.cr-name')!.textContent)).toEqual(['Signals Studio', 'Applied Maths'])
    expect(rows[0].textContent).toContain('Section Q')
    expect(rows[0].textContent).toContain('LIVE')
    expect(rows[0].textContent).toContain('2 files, 1 notes, 1 papers')
    expect((rows[0].querySelector('select') as HTMLSelectElement).value).toBe('signals')
    expect(rows[0].querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('true')
    expect(rows[1].querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('false')
  })
  it('mapping a subject and the include switch are PATCH calls that change one field each', async () => {
    const client = await start()
    pick(qa('[data-course="c-b"] select')[0] as HTMLSelectElement, 'maths')
    await flush()
    expect(client.patchCourse).toHaveBeenCalledWith('c-b', { subject: 'maths' }, expect.anything())
    click(qa('[data-course="c-b"] [role="switch"]')[0])
    await flush()
    expect(client.patchCourse).toHaveBeenCalledWith('c-b', { include: true }, expect.anything())
    expect(qa('[data-course="c-b"] [role="switch"]')[0].getAttribute('aria-checked')).toBe('true')
  })
  it('lists the files with title, type, topic, state word and the note reason; choosing a course asks only for its files', async () => {
    const client = await start()
    const rows = qa('[data-file]')
    expect(rows.map((r) => r.querySelector('.cr-name')!.textContent)).toEqual(['Week 3 slides', 'Mock paper A', 'Lab slides'])
    expect(rows[0].textContent).toContain('PDF, Sampling')
    expect(rows[0].textContent).toContain('note written from 12 pages')
    click(qa('[data-course="c-b"] .cr-pick')[0])
    await flush()
    expect(client.files).toHaveBeenLastCalledWith({ course: 'c-b', kind: '', q: '' }, expect.anything())
    expect(qa('[data-file]').map((r) => r.querySelector('.cr-name')!.textContent)).toEqual(['Lab slides'])
  })
  it('the kind filter and the search ask the engine (the search after a pause)', async () => {
    vi.useFakeTimers()
    const client = await start()
    click(button(/^Papers$/) ?? qa('[role="radio"]').find((r) => /Papers/.test(r.textContent ?? ''))!)
    await flush()
    expect(client.files).toHaveBeenLastCalledWith({ course: undefined, kind: 'paper', q: '' }, expect.anything())
    typeInto(q('input.ww-input') as HTMLInputElement, 'mock')
    await act(async () => { await vi.advanceTimersByTimeAsync(SEARCH_MS) })
    await flush()
    expect(client.files).toHaveBeenLastCalledWith({ course: undefined, kind: 'paper', q: 'mock' }, expect.anything())
  })
  it('Read note shows the note: the header, a heading, a quote, and the engine words on a missing note', async () => {
    const client = await start()
    click(qa('[data-file="f-1"] .cr-pick')[0])
    await flush()
    click(button(/Read note/)!)
    await flush()
    expect(client.note).toHaveBeenCalledWith('f-1', expect.anything())
    expect(q('[data-component="note-view"] h3').textContent).toBe('Sampling')
    expect(q('[data-component="note-view"]').textContent).toContain('a quoted line')
    expect(document.body.querySelector('[data-component="classroom-open"] script')).toBeNull()
  })
  it('a note that is not there is a pose with the engine reason, not an empty page', async () => {
    const client = fakeClient({ note: vi.fn(async () => answer('waiting', 'The note is written after the sync reads this file.', { markdown: '', title: '', words: null, pages: null, scanned_pages: null })) })
    await start(client)
    click(qa('[data-file="f-1"] .cr-pick')[0])
    await flush()
    click(button(/Read note/)!)
    await flush()
    expect(q('[data-component="classroom-open"]').textContent).toContain('WAITING')
    expect(q('[data-component="classroom-open"]').textContent).toContain('The note is written after the sync reads this file.')
  })
  it('Open original puts a PDF in an iframe with a title from the blob URL, and closing revokes that URL', async () => {
    const client = await start()
    click(qa('[data-file="f-1"] .cr-pick')[0])
    await flush()
    click(button(/Open original/)!)
    await flush()
    const frame = q('iframe') as HTMLIFrameElement
    expect(frame.getAttribute('src')).toBe('about:blank#invented-1')
    expect(frame.getAttribute('title')).toBe('Original of Week 3 slides')
    expect(client.revokeOriginal).not.toHaveBeenCalled()
    click(button(/^Close$/)!)
    await flush()
    expect(client.revokeOriginal).toHaveBeenCalledWith('about:blank#invented-1')
    expect(document.body.querySelector('iframe')).toBeNull()
  })
  it('an image goes in an <img> with alt text, and choosing another file revokes the URL too', async () => {
    const png = file({ id: 'f-4', title: 'Board photo', ext: 'png' })
    const client = fakeClient({
      files: vi.fn(async () => answer('live', 'ok', { items: [F1, png] })),
      original: vi.fn(async () => answer('live', 'ok', { url: 'blob:invented-2', mime: 'image/png', bytes: 8 })),
    })
    await start(client)
    click(qa('[data-file="f-4"] .cr-pick')[0])
    await flush()
    click(button(/Open original/)!)
    await flush()
    expect(q('img.cr-img').getAttribute('alt')).toBe('Original: Board photo')
    click(qa('[data-file="f-1"] .cr-pick')[0])
    await flush()
    expect(client.revokeOriginal).toHaveBeenCalledWith('blob:invented-2')
  })
  it('the shelf closing revokes the URL it still holds', async () => {
    const client = await start()
    click(qa('[data-file="f-1"] .cr-pick')[0])
    await flush()
    click(button(/Open original/)!)
    await flush()
    m!.unmount()
    m = null
    expect(client.revokeOriginal).toHaveBeenCalledWith('about:blank#invented-1')
  })
  it('a type the app cannot show has no in-app original key, only Open in its own program, which prints the engine sentence', async () => {
    const client = await start()
    click(qa('[data-file="f-3"] .cr-pick')[0])
    await flush()
    expect(button(/Open original/)).toBeUndefined()
    click(button(/Open in its own program/)!)
    await flush()
    expect(client.openInProgram).toHaveBeenCalledWith('f-3', expect.anything())
    expect(q('[data-component="classroom-notice"]').textContent).toContain('Opened in the PC program for PPTX.')
  })
  it('Mark as paper calls G-09 and shows the engine sentence; the key for the kind it already has is not drawn', async () => {
    const client = await start()
    click(qa('[data-file="f-1"] .cr-pick')[0])
    await flush()
    expect(button(/Mark as notes/)).toBeUndefined()
    click(button(/Mark as paper/)!)
    await flush()
    expect(client.setKind).toHaveBeenCalledWith('f-1', 'paper', expect.anything())
    expect(q('[data-component="classroom-notice"]').textContent).toContain('Marked f-1 as paper.')
    expect(button(/Mark as paper/)).toBeUndefined()
    expect(button(/Mark as notes/)).toBeDefined()
  })
  it('Send to paper desk is for a PDF paper only and shows the returned sentence; a refusal shows its sentence', async () => {
    const client = await start()
    click(qa('[data-file="f-1"] .cr-pick')[0])
    await flush()
    expect(button(/Send to paper desk/)!.getAttribute('aria-disabled')).toBe('true')
    expect(q('[data-component="classroom-reader"]').textContent).toContain('Mark it as a paper first.')
    click(qa('[data-file="f-2"] .cr-pick')[0])
    await flush()
    click(button(/Send to paper desk/)!)
    await flush()
    expect(client.toPapers).toHaveBeenCalledWith('f-2', expect.anything())
    expect(q('[data-component="classroom-notice"]').textContent).toContain('Sent: its questions wait for your review.')
    click(qa('[data-file="f-3"] .cr-pick')[0])
    await flush()
    expect(button(/Send to paper desk/)).toBeUndefined()
  })
  it('a busy paper desk shows its own sentence', async () => {
    const client = fakeClient({ toPapers: vi.fn(async () => answer<{ paper_id: string | null }>('waiting', 'The paper desk is busy with another file.', null, { status: 409 })) })
    await start(client)
    click(qa('[data-file="f-2"] .cr-pick')[0])
    await flush()
    click(button(/Send to paper desk/)!)
    await flush()
    expect(q('[data-component="classroom-notice"]').textContent).toContain('The paper desk is busy with another file.')
  })
  it('Sync this course sends that course to G-04', async () => {
    const client = await start()
    click(qa('[data-course="c-a"] .cr-pick')[0])
    await flush()
    click(button(/Sync this course/)!)
    await flush()
    expect(client.sync).toHaveBeenCalledWith(['c-a'], expect.anything())
  })
})

// ------------------------------------------------------------------------------------------------ the face
describe('the face switch', () => {
  it('Intake, Library and Classroom are the three faces; Classroom shows the shelf, honestly PLANNED in a window with no token', async () => {
    const { default: View } = await import('../../intake/IntakeDeskView')
    m = mount(<View />)
    await flush()
    const face = (name: string) => qa('button,[role="radio"]').find((b) => (b.textContent ?? '').trim() === name)!
    expect(['Intake', 'Library', 'Classroom'].every((n) => !!face(n))).toBe(true)
    click(face('Classroom'))
    await flush()
    expect(q('[data-component="classroom-shelf"]').textContent).toContain('PLANNED')
    expect(qa('[data-component="classroom-courses"]')).toHaveLength(0)
    click(face('Intake'))
    await flush()
    expect(q('[data-door="classroom"]')).not.toBeNull()
  })
})

// ------------------------------------------------------------------------------------------------ accounts, stale, also_in, stopped
const ACCOUNTS = [{ name: 'main', state: 'live' as const, reason: 'Signed in and reading.' }, { name: 'college', state: 'waiting' as const, reason: 'Not signed in yet.' }]
const withAccounts = (over: Partial<GcrStatusBody> = {}) => body({ accounts: ACCOUNTS, ...over })
const nameOf = (b: HTMLElement) => b.getAttribute('aria-label') ?? (b.textContent ?? '').trim()

describe('accounts on the plate', () => {
  it('each account shows its name, state word and the engine reason, with the one key that fits it', async () => {
    m = mount(<ClassroomPlate client={statusOnly(answer('live', 'Linked.', withAccounts()))} />)
    await flush()
    const rows = qa('[data-component="classroom-accounts"] li')
    expect(rows.map((r) => r.dataset.account)).toEqual(['main', 'college'])
    expect(rows[0].textContent).toContain('LIVE')
    expect(rows[0].textContent).toContain('Signed in and reading.')
    expect(rows[1].textContent).toContain('WAITING')
    expect(rows[1].textContent).toContain('Not signed in yet.')
    expect(qa('[data-door="classroom"] button').map(nameOf)).toEqual(['Disconnect main', 'Connect college', 'Sync now', 'Add account'])
  })
  it('Disconnect acts on the chosen account only: G-03 gets that name', async () => {
    const client = statusOnly(answer('live', 'Linked.', withAccounts()))
    m = mount(<ClassroomPlate client={client} />)
    await flush()
    click(qa('button').find((b) => nameOf(b) === 'Disconnect main')!)
    await flush()
    expect(client.disconnect).toHaveBeenCalledWith('main', expect.anything())
  })
  it('Connect on a waiting account sends its name to G-02', async () => {
    const client = statusOnly(answer('live', 'Linked.', withAccounts()))
    m = mount(<ClassroomPlate client={client} />)
    await flush()
    click(qa('button').find((b) => nameOf(b) === 'Connect college')!)
    await flush()
    expect(client.connect).toHaveBeenCalledWith('college', expect.anything())
  })
  it('Add account asks for a short name, refuses a bad one in the field with a plain sentence, and sends a good one', async () => {
    const client = statusOnly(answer('live', 'Linked.', withAccounts()))
    m = mount(<ClassroomPlate client={client} />)
    await flush()
    click(button(/^Add account$/)!)
    const box = () => q('[data-component="classroom-add-account"]')
    const input = () => box().querySelector('input') as HTMLInputElement
    click(button(/Connect this account/)!)
    expect(box().textContent).toContain('Type a short name first.')
    typeInto(input(), 'My College')
    expect(box().textContent).toContain(ACCOUNT_RULE)
    expect(input().getAttribute('aria-invalid')).toBe('true')
    typeInto(input(), 'a'.repeat(21))
    expect(box().textContent).toContain(ACCOUNT_RULE)
    click(button(/Connect this account/)!)
    expect(client.connect).not.toHaveBeenCalled()
    typeInto(input(), 'lab-2')
    expect(box().textContent).not.toContain(ACCOUNT_RULE)
    click(button(/Connect this account/)!)
    await flush()
    expect(client.connect).toHaveBeenCalledWith('lab-2', expect.anything())
    expect(qa('[data-component="classroom-add-account"]')).toHaveLength(0)
  })
  it('PLANNED draws no Add account key, and an engine that sends no accounts keeps the single Connect and Disconnect', async () => {
    m = mount(<ClassroomPlate client={statusOnly(answer<GcrStatusBody>('planned', 'Classroom is not built.', null, { from: 'app', status: 0 }))} />)
    await flush()
    expect(qa('[data-door="classroom"] button')).toHaveLength(0)
    m.unmount()
    m = mount(<ClassroomPlate client={fakeClient()} />)
    await flush()
    expect(button(/^Disconnect$/)).toBeTruthy()
    expect(qa('[data-component="classroom-accounts"]')).toHaveLength(0)
  })
  it('the first pane of the shelf lists the accounts too', async () => {
    m = mount(<ClassroomShelf client={statusOnly(answer('live', 'Linked.', withAccounts()))} desk={subjectsDesk} />)
    await flush()
    expect(q('[data-component="classroom-accounts"]').textContent).toContain('college')
  })
})

describe('a stopped job, a stale file and the other courses of a file', () => {
  const stopped: GcrJob = { status: 'stopped', started: 'a', finished: 'b', text: 'Stopped after 1 of 2 courses: Google asked the app to slow down.', counts: COUNTS, fault_lines: [] }
  it('the job status stopped is a word and the engine sentence in full', async () => {
    m = mount(<ClassroomPlate client={statusOnly(answer('live', 'Linked.', body({ job: stopped })))} />)
    await flush()
    expect(q('[data-component="classroom-job"]').dataset.status).toBe('stopped')
    expect(q('[data-component="classroom-job"]').textContent).toBe(`Stopped. ${stopped.text}`)
  })
  it('a note that is waiting shows its own state word beside its reason, not the LIVE of the file alone', async () => {
    const odd = file({ id: 'f-8', title: 'Scanned worksheet', note_state: 'waiting', note_reason: 'The scan has no readable text yet.' })
    m = mount(<ClassroomShelf client={fakeClient({ files: vi.fn(async () => answer('live', 'ok', { items: [odd] })) })} desk={subjectsDesk} />)
    await flush()
    const note = q('[data-file="f-8"] [data-component="classroom-note-state"]')
    expect(note.textContent).toContain('WAITING')
    expect(note.textContent).toContain('The scan has no readable text yet.')
  })
  it('a stale file says it is an older copy, in the list and in the reader; also_in names the other courses', async () => {
    const odd = file({ id: 'f-9', title: 'Old syllabus', stale: true, also_in: [{ course: 'Applied Maths', post_title: 'Syllabus' }, { course: 'Lab', post_title: 'Syllabus' }] })
    const client = fakeClient({ files: vi.fn(async () => answer('live', 'ok', { items: [odd, F1] })) })
    m = mount(<ClassroomShelf client={client} desk={subjectsDesk} />)
    await flush()
    const row = q('[data-file="f-9"]')
    expect(row.textContent).toContain(STALE_SENTENCE)
    expect(row.textContent).toContain('Also in: Applied Maths, Lab')
    expect(q('[data-file="f-1"]').textContent).not.toContain('older copy')
    expect(q('[data-file="f-1"]').textContent).not.toContain('Also in')
    click(row.querySelector('.cr-pick')!)
    await flush()
    const card = q('[data-component="classroom-reader"]').textContent ?? ''
    expect(card).toContain(STALE_SENTENCE)
    expect(card).toContain('Also in: Applied Maths, Lab')
  })
})
