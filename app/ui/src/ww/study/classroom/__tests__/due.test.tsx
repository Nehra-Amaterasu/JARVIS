// The Due view of the Classroom face, rendered against a fake client: the two-option switch, the filter with its four counts and the
// read-at time, the list in the engine's order with Classroom's own work words and "Late" only when it says late, the chosen
// assignment with Open in Classroom, one reminder per press and its removal, the announcements and calendar under it, the Stop key of
// a running sync, and Send to paper desk for Word files. Every name and title is invented.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { mount } from '../../../../__tests__/ww/_stubs'
import type { GcrClient } from '../../adapters/gcr'
import type { GcrAnswer, GcrAssignment, GcrFile, GcrJob, GcrStatusBody } from '../../adapters/gcrTypes'
import { nullIntakeDesk } from '../../intake/port'
import { ClassroomShelf } from '../ClassroomShelf'
import { daysText, dueText, formatStamp, NO_DATE_SENTENCE, TURN_IN_NOTE } from '../DuePanes'
import { goesToPaperDesk } from '../Reader'

let m: ReturnType<typeof mount> | null = null
afterEach(() => { m?.unmount(); m = null; document.body.innerHTML = ''; vi.useRealTimers() })

const q = (sel: string) => document.body.querySelector(sel) as HTMLElement
const qa = (sel: string) => Array.from(document.body.querySelectorAll<HTMLElement>(sel))
const button = (re: RegExp) => qa('button').find((b) => re.test(b.textContent ?? ''))
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve() }) }

const answer = <T,>(state: GcrAnswer<T>['state'], reason: string, data: T | null, over: Partial<GcrAnswer<T>> = {}): GcrAnswer<T> =>
  ({ state, reason, source: 'the Classroom link', from: 'engine', status: 200, since: 1, data, ...over })
const COUNTS = { courses: 2, files: 3, notes: 1, papers: 1, faults: 0 }
const status = (job: GcrJob | null = null): GcrStatusBody => ({ scopes: [], connecting: false, synced_at: '2026-11-25 09:00', counts: COUNTS, job })
const RUNNING: GcrJob = { status: 'running', started: 'now', finished: '', text: 'Reading course 1 of 2', counts: null, fault_lines: [] }

const asg = (over: Partial<GcrAssignment>): GcrAssignment => ({
  id: 'a-1', course: 'c-a', course_name: 'Signals Studio', subject: 'signals', title: 'Lab sheet 3', due: '2026-11-27', due_time: '18:00', days_left: 2,
  link: 'https://classroom.google.com/c/invented/a/1', work: 'assigned', late: false, reminder: null, ...over,
})
const A1 = asg({})
const A2 = asg({ id: 'a-2', course: 'c-b', course_name: 'Applied Maths', title: 'Problem set 5', due: '2026-11-24', due_time: '23:59', days_left: -1, work: 'turned_in', late: true })
const A3 = asg({ id: 'a-3', title: 'Reading notes', due: '', due_time: '', days_left: null, work: 'unknown' })
const A4 = asg({ id: 'a-4', title: 'Mock quiz', work: 'returned', reminder: { id: 'rem-9', due: '2026-11-26T18:00', text: 'Mock quiz is due' } })
const ITEMS = [A2, A1, A4, A3]
const COURSE_A = { id: 'c-a', name: 'Signals Studio', section: '', state: 'live' as const, subject: '', subject_source: '', include: true, files: 0, notes: 0, papers: 0, read_at: '', link: '' }
const COURSE_B = { ...COURSE_A, id: 'c-b', name: 'Applied Maths' }

function client(over: Partial<GcrClient> = {}): GcrClient {
  return {
    status: vi.fn(async () => answer('live', 'Linked.', status())),
    connect: vi.fn(), disconnect: vi.fn(),
    sync: vi.fn(), job: vi.fn(async () => answer('live', 'ok', { job: RUNNING })),
    courses: vi.fn(async () => answer('live', 'ok', { items: [COURSE_A, COURSE_B] })),
    patchCourse: vi.fn(),
    files: vi.fn(async () => answer('live', 'ok', { items: [] as GcrFile[] })),
    setKind: vi.fn(), note: vi.fn(), original: vi.fn(), revokeOriginal: vi.fn(), openInProgram: vi.fn(), toPapers: vi.fn(),
    stopSync: vi.fn(async () => answer('waiting', 'Stopping after the file being fetched.', { job: RUNNING })),
    assignments: vi.fn(async () => answer('live', '2 open: 1 is due in the next 3 days.', { items: ITEMS, counts: { open: 3, turned_in: 1, late: 1, no_due_date: 1 }, read_at: '2026-11-25 09:00' })),
    openAssignment: vi.fn(async () => answer('live', 'Opened in your browser.', {})),
    remind: vi.fn(async (_id: string) => answer('live', 'I will remind you on 26 Nov at 18:00.', { reminder: { id: 'rem-1', due: '2026-11-26T18:00', text: 'Lab sheet 3 is due' } })),
    removeReminder: vi.fn(async () => answer('live', 'Reminder removed.', {})),
    announcements: vi.fn(async () => answer('live', 'ok', { items: [
      { id: 'n-1', course: 'c-a', course_name: 'Signals Studio', text: 'The lab moves to room 4.', posted: '2026-11-25T08:30:00Z', link: '' },
      { id: 'n-2', course: 'c-a', course_name: 'Signals Studio', text: 'Bring the kit.', posted: '2026-11-24T08:30:00Z', link: '' },
      { id: 'n-3', course: 'c-b', course_name: 'Applied Maths', text: 'Quiz on Friday.', posted: '2026-11-23', link: '' },
      { id: 'n-4', course: 'c-b', course_name: 'Applied Maths', text: 'Old note.', posted: '2026-11-22', link: '' },
    ] })),
    calendar: vi.fn(async () => answer('live', 'ok', { items: [{ id: 'e-1', title: 'Signals lab', start: '2026-11-27T10:00:00', end: '2026-11-27T12:00:00', all_day: false, calendar: 'Class', link: '' }, { id: 'e-2', title: 'Holiday', start: '2026-11-30', end: '2026-12-01', all_day: true, calendar: 'Class', link: '' }] })),
    ...over,
  }
}

async function openDue(c: GcrClient) {
  m = mount(<ClassroomShelf client={c} desk={nullIntakeDesk} />)
  await flush()
  click(qa('[role="radio"]').find((r) => r.textContent === 'Due')!)
  await flush()
}

describe('the pure words', () => {
  it('a day and a time read as one stamp; days past are "past", not a verdict; no due date draws no days', () => {
    expect(dueText(A1)).toBe('27 Nov 2026, 18:00')
    expect(dueText(A3)).toBe('No due date')
    expect(formatStamp('2026-11-26T18:00')).toBe('26 Nov 2026, 18:00')
    expect(formatStamp('not a stamp')).toBe('not a stamp')
    // the real engine writes UTC stamps ("...Z"): they are read on the viewer's own clock, not as written (seen against the seeded sandbox)
    const utc = new Date('2026-11-26T09:00:00Z')
    const p2 = (n: number) => String(n).padStart(2, '0')
    expect(formatStamp('2026-11-26T09:00:00Z')).toBe(`${utc.getDate()} Nov ${utc.getFullYear()}, ${p2(utc.getHours())}:${p2(utc.getMinutes())}`)
    expect(formatStamp('2026-11-29T10:00:00+05:30')).toMatch(/^\d+ Nov 2026, \d\d:\d\d$/)
    expect([daysText(0), daysText(1), daysText(3), daysText(-1), daysText(-4), daysText(null)]).toEqual(['today', '1 day left', '3 days left', '1 day past', '4 days past', ''])
  })
  it('Word files go to the paper desk beside PDFs; slides and pictures do not', () => {
    const f = (ext: string) => ({ ext } as GcrFile)
    expect(['pdf', 'docx', 'doc', 'DOCX', '.doc', 'pptx', 'png', 'txt'].map((e) => goesToPaperDesk(f(e)))).toEqual([true, true, true, true, true, false, false, false])
  })
})

describe('the switch and the Due view', () => {
  it('Files is what shows first; the switch has two options, Files and Due, and Due asks for nothing until it is pressed', async () => {
    const c = client()
    m = mount(<ClassroomShelf client={c} desk={nullIntakeDesk} />)
    await flush()
    expect(qa('[role="radiogroup"][aria-label="Classroom view"] [role="radio"]').map((r) => r.textContent)).toEqual(['Files', 'Due'])
    expect(c.assignments).not.toHaveBeenCalled()
    expect(c.announcements).not.toHaveBeenCalled()
    click(qa('[role="radio"]').find((r) => r.textContent === 'Due')!)
    await flush()
    expect(c.assignments).toHaveBeenCalledWith({ course: undefined, show: 'open' }, expect.anything())
    expect(qa('[data-component="classroom-due-list"]')).toHaveLength(1)
  })
  it('the list keeps the engine order and shows title, course, due, days, Classroom\'s work word and Late only where it says late', async () => {
    await openDue(client())
    const rows = qa('[data-assignment].cr-due-row')
    expect(rows.map((r) => r.querySelector('.cr-name')!.textContent)).toEqual(['Problem set 5', 'Lab sheet 3', 'Mock quiz', 'Reading notes'])
    expect(rows[0].textContent).toContain('Applied Maths')
    expect(rows[0].textContent).toContain('24 Nov 2026, 23:59')
    expect(rows[0].textContent).toContain('1 day past')
    expect(rows.map((r) => r.querySelector('.cr-due-work')!.textContent)).toEqual(['Turned in', 'Assigned', 'Returned', 'Unknown'])
    expect(rows.map((r) => r.querySelector('.cr-due-late') !== null)).toEqual([true, false, false, false])
    expect(rows[3].textContent).toContain('No due date')
    expect(rows[3].textContent).not.toContain('day')
    expect(rows[2].textContent).toContain('Reminder set')
  })
  it('the filter shows the four counts beside the state word, and when it was read', async () => {
    await openDue(client())
    const f = q('[data-component="classroom-due-filter"]')
    expect(f.textContent).toContain('LIVE')
    expect(f.textContent).toContain('2 open: 1 is due in the next 3 days.')
    expect(Array.from(f.querySelectorAll('[data-component="classroom-due-counts"] div')).map((d) => d.textContent)).toEqual(['open3', 'turned in1', 'late1', 'no due date1'])
    expect(q('[data-component="classroom-due-read"]').textContent).toBe('Read at 25 Nov 2026, 09:00')
  })
  it('the course and the open/all switch go to G-15 and G-18 as they are chosen', async () => {
    const c = client()
    await openDue(c)
    const sel = q('[data-component="classroom-due-filter"] select') as HTMLSelectElement
    act(() => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, 'c-b'); sel.dispatchEvent(new Event('change', { bubbles: true })) })
    await flush()
    expect(c.assignments).toHaveBeenLastCalledWith({ course: 'c-b', show: 'open' }, expect.anything())
    expect(c.announcements).toHaveBeenLastCalledWith('c-b', undefined, expect.anything())
    click(qa('[role="radio"]').find((r) => r.textContent === 'All')!)
    await flush()
    expect(c.assignments).toHaveBeenLastCalledWith({ course: 'c-b', show: 'all' }, expect.anything())
  })
  it('a list that is waiting says the engine\'s sentence and draws no count', async () => {
    await openDue(client({ assignments: vi.fn(async () => answer('waiting', 'No coursework read yet: run a sync.', null as never)) }))
    const t = q('[data-component="classroom-shelf"]').textContent ?? ''
    expect(t).toContain('WAITING')
    expect(t).toContain('No coursework read yet: run a sync.')
    expect(qa('[data-component="classroom-due-counts"]')).toHaveLength(0)
    expect(qa('[data-component="classroom-due-list"]')).toHaveLength(0)
  })
  it('a planned link asks for nothing: no list, no request', async () => {
    const c = client({ status: vi.fn(async () => answer('planned', 'The Google link is switched off in this instance.', null as never)) })
    await openDue(c)
    expect(c.assignments).not.toHaveBeenCalled()
    expect(q('[data-component="classroom-shelf"]').textContent).toContain('switched off in this instance')
  })
})

describe('the chosen assignment', () => {
  const choose = async (id: string, c: GcrClient = client()) => { await openDue(c); click(q(`[data-assignment="${id}"] .cr-pick`)); await flush(); return c }

  it('shows its facts, Open in Classroom, Remind me, the two lists, and says that turning in happens in Classroom; there is no turn-in key', async () => {
    await choose('a-1')
    const d = q('[data-component="classroom-due-detail"]')
    expect(d.textContent).toContain('Lab sheet 3')
    expect(d.textContent).toContain('27 Nov 2026, 18:00')
    expect(d.textContent).toContain('2 days left')
    expect(d.textContent).toContain('Assigned')
    expect(d.textContent).toContain(TURN_IN_NOTE)
    expect(qa('button').map((b) => (b.textContent ?? '').trim()).filter((t) => /turn.?in|submit|hand in/i.test(t))).toEqual([])
    expect(button(/Open in Classroom/)).toBeDefined()
    expect(button(/Remind me/)).toBeDefined()
    expect(button(/Remove reminder/)).toBeUndefined()
    const ann = q('[data-component="classroom-announcements"]')
    expect(ann.querySelectorAll('li')).toHaveLength(4)
    expect(ann.textContent).toContain('The lab moves to room 4.')
    expect(ann.textContent).toContain('and 1 more')
    expect(q('[data-component="classroom-calendar"]').textContent).toContain('27 Nov 2026, 10:00')
    expect(q('[data-component="classroom-calendar"]').textContent).toContain('30 Nov 2026, all day')
  })
  it('Open in Classroom calls G-16 for that id and prints the engine\'s sentence', async () => {
    const c = await choose('a-1')
    click(button(/Open in Classroom/)!)
    await flush()
    expect(c.openAssignment).toHaveBeenCalledWith('a-1', expect.anything())
    expect(q('[data-component="classroom-notice"]').textContent).toContain('Opened in your browser.')
  })
  it('nothing makes a reminder until Remind me is pressed; the press sends no time, and the reminder\'s due time and Remove reminder appear', async () => {
    const c = await choose('a-1')
    expect(c.remind).not.toHaveBeenCalled()
    click(button(/Remind me/)!)
    await flush()
    expect(c.remind).toHaveBeenCalledTimes(1)
    expect(c.remind).toHaveBeenCalledWith('a-1', undefined, expect.anything())
    expect(q('[data-component="classroom-notice"]').textContent).toContain('I will remind you on 26 Nov at 18:00.')
    expect(q('[data-component="classroom-reminder"]').textContent).toBe('Reminder due 26 Nov 2026, 18:00')
    expect(button(/Remind me/)).toBeUndefined()
    expect(button(/Remove reminder/)).toBeDefined()
    expect(q('[data-assignment="a-1"].cr-due-row').textContent).toContain('Reminder set')
  })
  it('Remove reminder deletes the reminder by its own id and the key goes back to Remind me', async () => {
    const c = await choose('a-4')
    expect(q('[data-component="classroom-reminder"]').textContent).toBe('Reminder due 26 Nov 2026, 18:00')
    click(button(/Remove reminder/)!)
    await flush()
    expect(c.removeReminder).toHaveBeenCalledWith('rem-9', expect.anything())
    expect(button(/Remind me/)).toBeDefined()
    expect(qa('[data-component="classroom-reminder"]')).toHaveLength(0)
    expect(q('[data-component="classroom-notice"]').textContent).toContain('Reminder removed.')
  })
  it('a reminder the list no longer has keeps the engine sentence and reads the list again', async () => {
    const c = client({ removeReminder: vi.fn(async () => answer('waiting', 'no such pending reminder', null as never, { status: 404 })) })
    await choose('a-4', c)
    const before = (c.assignments as ReturnType<typeof vi.fn>).mock.calls.length
    click(button(/Remove reminder/)!)
    await flush()
    expect(q('[data-component="classroom-notice"]').textContent).toContain('no such pending reminder')
    expect((c.assignments as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(before)
  })
  it('an assignment with no due date cannot be reminded by default: the key says why, and a refusal from the engine is printed as it is', async () => {
    const c = await choose('a-3')
    expect(button(/Remind me/)!.getAttribute('aria-disabled')).toBe('true')
    expect(q('[data-component="classroom-due-detail"]').textContent).toContain(NO_DATE_SENTENCE)
    expect(c.remind).not.toHaveBeenCalled()
    const refused = client({ remind: vi.fn(async () => answer('waiting', 'That time has passed.', null as never, { status: 400 })) })
    m?.unmount(); m = null; document.body.innerHTML = ''
    await choose('a-2', refused)
    click(button(/Remind me/)!)
    await flush()
    expect(q('[data-component="classroom-notice"]').textContent).toContain('That time has passed.')
    expect(button(/Remove reminder/)).toBeUndefined()
  })
  it('the calendar that was never read says the engine sentence, with its state word', async () => {
    await choose('a-1', client({ calendar: vi.fn(async () => answer('waiting', 'The calendar has not been read yet: run a sync.', null as never)) }))
    expect(q('[data-component="classroom-calendar"]').textContent).toContain('WAITING')
    expect(q('[data-component="classroom-calendar"]').textContent).toContain('The calendar has not been read yet: run a sync.')
  })
})

describe('Stop sync', () => {
  const running = (extra: Partial<GcrClient> = {}) => client({ status: vi.fn(async () => answer('live', 'Linked.', status(RUNNING))), ...extra })

  it('is offered only while the job runs, calls G-14, prints the engine\'s sentence and then holds still', async () => {
    const c = running()
    m = mount(<ClassroomShelf client={c} desk={nullIntakeDesk} />)
    await flush()
    expect(button(/Stop sync/)).toBeDefined()
    expect(button(/Sync now/)!.getAttribute('aria-disabled')).toBe('true')
    click(button(/Stop sync/)!)
    await flush()
    expect(c.stopSync).toHaveBeenCalledTimes(1)
    expect(q('[data-component="classroom-say"]').textContent).toContain('Stopping after the file being fetched.')
    expect(button(/Stop sync/)!.getAttribute('aria-disabled')).toBe('true')
  })
  it('is not drawn when no sync runs', async () => {
    m = mount(<ClassroomShelf client={client()} desk={nullIntakeDesk} />)
    await flush()
    expect(button(/Stop sync/)).toBeUndefined()
  })
  it('a refusal (none runs) prints the engine sentence and leaves the key usable', async () => {
    const c = running({ stopSync: vi.fn(async () => answer('waiting', 'No sync is running.', null as never, { status: 400 })) })
    m = mount(<ClassroomShelf client={c} desk={nullIntakeDesk} />)
    await flush()
    click(button(/Stop sync/)!)
    await flush()
    expect(q('[data-component="classroom-say"]').textContent).toContain('No sync is running.')
    expect(button(/Stop sync/)!.getAttribute('aria-disabled')).not.toBe('true')
  })
})

describe('Word files at the paper desk', () => {
  it.each([['docx', true], ['doc', true], ['pdf', true], ['pptx', false]] as const)('a .%s paper: Send to paper desk is offered %s', async (ext, offered) => {
    const f = { id: 'f-w', course: 'c-a', course_name: 'Signals Studio', subject: '', title: 'Mock paper W', ext, kind: 'paper', kind_source: 'engine', state: 'live', reason: '', note_state: 'live', note_reason: '', pages: 3, words: 100, scanned_pages: 0, size: 1, modified: '2026-11-20', post: { kind: 'material', title: 'x', topic: '' }, has_note: false, has_original: true, paper_id: null } as GcrFile
    const c = client({ files: vi.fn(async () => answer('live', 'ok', { items: [f] })), toPapers: vi.fn(async () => answer('live', 'Sent: printed by Word to 3 pages.', { paper_id: 'p-7' })) })
    m = mount(<ClassroomShelf client={c} desk={nullIntakeDesk} />)
    await flush()
    click(q('[data-file="f-w"] .cr-pick'))
    await flush()
    expect(button(/Send to paper desk/) !== undefined).toBe(offered)
    if (!offered) return
    click(button(/Send to paper desk/)!)
    await flush()
    expect(c.toPapers).toHaveBeenCalledWith('f-w', expect.anything())
    expect(q('[data-component="classroom-notice"]').textContent).toContain('Sent: printed by Word to 3 pages.')
  })
})
