// The Manual Intake desk, rendered: an honest hollow desk on the null adapters, a fixture desk with invented rows, every press his
// (nothing accepted by itself, an ambiguous date needs a choice, a file is taken and never fetched), the four doors, the
// keyboard, and the words no student reads here.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { mount } from '../../../../__tests__/ww/_stubs'
import { nullStudyPort } from '../../adapters/null.register'
import type { StudyPort } from '../../ports'
import { COPY, FORBIDDEN_WORDS } from '../copy'
import { NOW, makeFixtureDesk, manyRows } from '../fixtures'
import entries from '../../../../gallery/entries/C03'
import { C03_LABELS } from '../gallery'
import { IntakeDesk } from '../IntakeDesk'
import { TRAY_FRAMES, TRAY_STEP_MS, trayFrame } from '../TrayArt'
import { nullIntakeDesk } from '../port'
import { registeredView } from '../../../../shell/views'

let m: ReturnType<typeof mount> | null = null
const reset = () => { m?.unmount(); m = null; document.body.innerHTML = '' }
afterEach(reset)

const STUDY: StudyPort = { ...nullStudyPort, intake: async () => ({ state: 'simulated', reason: 'invented folder', since: NOW, data: { files: 2, folderChosen: true } }) }
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() }) }
const q = (sel: string) => document.body.querySelector(sel) as HTMLElement
const qa = (sel: string) => Array.from(document.body.querySelectorAll<HTMLElement>(sel))
const button = (re: RegExp) => qa('button').find((b) => re.test(b.textContent ?? ''))!
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })) })
const type = (el: HTMLTextAreaElement, v: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const start = async (props: Partial<Parameters<typeof IntakeDesk>[0]> = {}) => {
  m = mount(<IntakeDesk study={STUDY} now={NOW} {...props} />)
  await flush()
}
const rowTitles = () => qa('.ik-row-title').map((e) => e.textContent)

describe('on the null adapters', () => {
  it('the desk is hollow and says why: no number, the reason, the Classroom plate PLANNED', async () => {
    await start({ desk: nullIntakeDesk, study: nullStudyPort })
    expect(q('.ik-count-n').textContent).toBe('--')
    expect(q('[data-component="intake-empty"]').textContent).toContain('Waiting: the intake store has not answered yet')
    expect(qa('.ik-row')).toHaveLength(0)
    expect(q('[data-door="classroom"]').textContent).toContain('PLANNED')
    expect(q('[data-door="classroom"]').tagName).not.toBe('BUTTON')
    expect(qa('[data-door]:not([data-door="classroom"])').map((d) => d.textContent).every((t) => /WAITING/.test(t ?? ''))).toBe(true)
  })
  it('a pasted list is not read: the press answers with the reason, and nothing is invented', async () => {
    await start({ desk: nullIntakeDesk, study: nullStudyPort })
    click(q('[data-door="paste"]'))
    await flush()
    type(q('#ik-paste') as HTMLTextAreaElement, 'Maths Assignment 3 - due 18 Nov 5pm')
    click(button(/Read these lines/))
    await flush()
    expect(q('[data-component="paste-reading"]').textContent).toContain('Not read: reading a list needs the intake store')
    expect(qa('.ik-row')).toHaveLength(0)
  })
  it('no control anywhere says connected, and no copy holds a forbidden word', async () => {
    await start({ desk: nullIntakeDesk, study: nullStudyPort })
    const all = document.body.textContent ?? ''
    for (const w of FORBIDDEN_WORDS) expect(all.toLowerCase()).not.toContain(w)
    for (const v of Object.values(COPY)) for (const w of FORBIDDEN_WORDS) expect(v.toLowerCase()).not.toContain(w)
  })
})

describe('the empty tray picture', () => {
  it('a WAITING desk shows the tray still; a LIVE empty desk moves it, and Calm stops it', async () => {
    vi.useFakeTimers()
    try {
      await start({ desk: nullIntakeDesk, study: nullStudyPort })
      expect(q('[data-component="tray-art"]').dataset.form).toBe('still')
      reset()
      await start({ desk: makeFixtureDesk({ rows: [] }) })
      const tray = q('[data-component="tray-art"]')
      expect(tray.dataset.form).toBe('moving')
      const first = tray.textContent
      await act(async () => { vi.advanceTimersByTime(TRAY_STEP_MS * 2) })
      expect(q('[data-component="tray-art"]').textContent).not.toBe(first)
      expect(q('[data-component="tray-art"]').getAttribute('aria-hidden')).toBe('true')
      reset()
      document.documentElement.setAttribute('data-motion', 'calm')
      await start({ desk: makeFixtureDesk({ rows: [] }) })
      expect(q('[data-component="tray-art"]').dataset.form).toBe('still')
    } finally {
      document.documentElement.removeAttribute('data-motion')
      vi.useRealTimers()
    }
  })
  it('every frame is the same size, plain ASCII, and the sheet ends inside the tray', () => {
    const frames = TRAY_FRAMES.map(trayFrame)
    expect(new Set(frames.map((f) => f.split('\n').length)).size).toBe(1)
    for (const f of frames) expect(/^[ -~\n]+$/.test(f)).toBe(true)
    expect(frames.at(-1)).toBe(trayFrame(null))
  })
})

describe('with the fixture desk (invented rows, SIMULATED)', () => {
  it('lists the new rows under headers with counts, every row with the door it came through, and the lamp reads SIMULATED', async () => {
    await start({ desk: makeFixtureDesk() })
    expect(q('.ik-count-n').textContent).toBe('10 new')
    expect(q('[data-component="intake-count"]').textContent).toContain('SIMULATED')
    expect(qa('.ik-ghead').map((h) => h.textContent)).toEqual(['This week4', 'Later2', 'No date3'])
    expect(qa('.ik-row')).toHaveLength(7)
    expect(qa('.ik-row .ik-prov').every((p) => /Source: (Pasted|Calendar file|Folder|Archive)/.test(p.getAttribute('aria-label') ?? ''))).toBe(true)
    expect(q('.ik-foot-line').textContent).toContain('SIMULATED')
  })
  it('nothing is accepted by itself: loading, selecting and pasting never call decide, and a pasted deadline adds only NEW rows', async () => {
    const desk = makeFixtureDesk()
    const decide = vi.spyOn(desk, 'decide')
    await start({ desk })
    click(qa('.ik-row')[1])
    key(q('[data-component="intake-desk"]'), 'p')
    await flush()
    type(q('#ik-paste') as HTMLTextAreaElement, 'Maths Assignment 4 - due 25 Nov 5pm\nSignals Lab 3 - due 2 Dec\nCircuits viva on Thursday')
    click(button(/Read these lines/))
    await flush()
    expect(q('[data-component="paste-reading"]').textContent).toContain('2 lines read, 1 not read')
    expect(q('[data-component="paste-reading"]').textContent).toContain('Circuits viva on Thursday')
    expect(decide).not.toHaveBeenCalled()
    expect(q('.ik-count-n').textContent).toBe('12 new')
    const list = await desk.list()
    expect(list.data!.filter((r) => r.state === 'accepted')).toHaveLength(1) // only the one the fixture started with
  })
  it('Accept is his press: the row leaves the New list, the next is chosen, a toast offers Undo and Undo brings it back', async () => {
    const desk = makeFixtureDesk()
    const decide = vi.spyOn(desk, 'decide')
    await start({ desk, initialSel: 'r1' })
    expect(q('.ik-detail h2').textContent).toBe('Assignment 3')
    expect(q('.ik-detail').textContent).toContain('Read from a pasted line')
    click(qa('.ik-keys button').find((b) => /^Accept/.test(b.textContent ?? ''))!)
    await flush()
    expect(decide).toHaveBeenCalledWith('r1', { state: 'accepted', subject: '' })
    expect(rowTitles()).not.toContain('Assignment 3')
    expect(q('.ik-count-n').textContent).toBe('9 new')
    expect(q('.ww-toast').textContent).toContain('Accepted “Assignment 3”')
    click(Array.from(q('.ww-toast').querySelectorAll('button')).find((b) => b.textContent === 'Undo')!)
    await flush()
    expect(decide).toHaveBeenLastCalledWith('r1', { state: 'new' })
    expect(q('.ik-count-n').textContent).toBe('10 new')
  })
  it('an ambiguous date cannot be accepted until a reading is chosen, and the choice goes with the press', async () => {
    const desk = makeFixtureDesk()
    const decide = vi.spyOn(desk, 'decide')
    await start({ desk, initialSel: 'r4' })
    const accept = () => qa('.ik-keys button').find((b) => /^Accept/.test(b.textContent ?? ''))!
    expect(accept().getAttribute('aria-disabled')).toBe('true')
    click(accept())
    expect(decide).not.toHaveBeenCalled()
    click(button(/^3 Dec$/))
    expect(accept().getAttribute('aria-disabled')).toBeNull()
    click(accept())
    await flush()
    expect(decide).toHaveBeenCalledWith('r4', { state: 'accepted', date: '2026-12-03', subject: '' })
  })
  it('a file row is taken to Papers or Notes, never accepted, and shows its ladder and that the app never downloads for him', async () => {
    const desk = makeFixtureDesk()
    const take = vi.spyOn(desk, 'take')
    await start({ desk, initialSel: 'r6' })
    expect(qa('.ik-keys button').some((b) => /^Accept/.test(b.textContent ?? ''))).toBe(false)
    expect(qa('[data-component="attachment-ladder"] li').map((l) => l.getAttribute('data-state'))).toEqual(['skipped', 'skipped', 'done', 'next', 'later'])
    expect(q('[data-component="attachment-ladder"]').textContent).toContain('never downloads a file for you')
    click(button(/Take to Papers/))
    await flush()
    expect(take).toHaveBeenCalledWith('r6', 'papers')
  })
  it('the keyboard: arrows walk the list, a accepts, d declines, u undoes, and a door key opens its sheet', async () => {
    const desk = makeFixtureDesk()
    const decide = vi.spyOn(desk, 'decide')
    await start({ desk, initialSel: 'r1' })
    key(q('.ik-ledger'), 'ArrowDown')
    await flush()
    expect(q('.ik-detail h2').textContent).toBe('Lab report 2')
    const root = q('[data-component="intake-desk"]')
    key(root, 'd')
    await flush()
    expect(decide).toHaveBeenLastCalledWith('r2', { state: 'declined' })
    key(root, 'a')
    await flush()
    expect(decide).toHaveBeenLastCalledWith('r3', { state: 'accepted', subject: '' })
    key(root, 'c')
    await flush()
    expect(q('[data-component="ics-preview"]')).not.toBeNull()
  })
  it('the roving tab stop: exactly one row is tabbable', async () => {
    await start({ desk: makeFixtureDesk(), initialSel: 'r2' })
    expect(qa('.ik-row').filter((r) => r.tabIndex === 0)).toHaveLength(1)
    expect(qa('.ik-row').find((r) => r.tabIndex === 0)!.getAttribute('data-row')).toBe('r2')
  })
  it('forty new rows: seven rows and at most three headers on the first screen, a pager, and Shift+A accepts only the rows that have a subject and a clear date', async () => {
    const rows = manyRows(40)
    const desk = makeFixtureDesk({ rows })
    const decide = vi.spyOn(desk, 'decide')
    await start({ desk })
    expect(qa('.ik-row')).toHaveLength(7)
    expect(qa('.ik-ghead').length).toBeLessThanOrEqual(3)
    expect(q('.ik-pager').textContent).toContain('1 of 6')
    const want = rows.filter((r) => r.subject !== '' && r.date).length
    key(q('[data-component="intake-desk"]'), 'A', { shiftKey: true })
    await flush()
    expect(decide).toHaveBeenCalledTimes(want)
    expect(decide.mock.calls.every(([id, p]) => p.state === 'accepted' && rows.find((r) => r.id === id)!.subject === '')).toBe(false)
    expect(decide.mock.calls.every(([id, p]) => p.state === 'accepted' && rows.find((r) => r.id === id)!.subject !== '')).toBe(true)
  })
  it('a row left alone for 14 days folds into one line that counts it and never deletes it', async () => {
    await start({ desk: makeFixtureDesk() })
    expect(rowTitles()).not.toContain('Assignment 1')
    expect(q('.ik-older').textContent).toContain('1 older item')
    click(q('.ik-older'))
    expect(rowTitles()).toContain('Assignment 1')
  })
  it('the calendar-file door lists each event with a keep switch, and Done declines the ones switched off', async () => {
    const desk = makeFixtureDesk()
    const decide = vi.spyOn(desk, 'decide')
    await start({ desk, open: 'ics', demo: true })
    await flush()
    const body = q('[data-component="ics-preview"]')
    expect(body.textContent).toContain('2 events read, 1 skipped')
    expect(body.textContent).toContain('repeats, not expanded')
    const sw = Array.from(body.querySelectorAll<HTMLElement>('[role="switch"]'))
    expect(sw).toHaveLength(2)
    click(sw[1])
    click(Array.from(body.querySelectorAll('button')).find((b) => /^Done/.test(b.textContent ?? ''))!)
    await flush()
    expect(decide).toHaveBeenCalledTimes(1)
    expect(decide.mock.calls[0][1]).toEqual({ state: 'declined' })
  })
  it('the archive door lists the files inside before anything is sent, refuses a path that leaves the archive, and sends one entry per press', async () => {
    const desk = makeFixtureDesk()
    const queue = vi.spyOn(desk, 'queueArchive')
    await start({ desk, open: 'archive', demo: true })
    await flush()
    const body = q('[data-component="archive-listing"]')
    expect(body.textContent).toContain('5 files in classroom-export.zip')
    expect(body.textContent).toContain('refused: a path that leaves the archive is refused')
    expect(body.textContent).toContain('not a .pdf or .pptx; only those are read')
    expect(queue).not.toHaveBeenCalled()
    // a key for each entry the paper desk reads; none for the refused one or the video
    const keys = qa('[data-entry] button').filter((b) => /Send to paper desk/.test(b.textContent ?? ''))
    expect(keys).toHaveLength(3)
    expect(q('[data-entry="recording.mp4"] button')).toBeNull()
    click(keys[1])
    await flush()
    expect(queue).toHaveBeenCalledTimes(1)
    expect(queue).toHaveBeenCalledWith('a1', ['week2-slides.pptx'])
    expect(q('[data-entry="week2-slides.pptx"]').textContent).toContain('Sent')
    expect(q('[data-entry="week1-slides.pdf"]').textContent).toContain('Send to paper desk')
  })
  it('a path is listed on his press only; the engine decides whether it is a .zip', async () => {
    const desk = makeFixtureDesk()
    const byPath = vi.spyOn(desk, 'archivePath')
    await start({ desk, open: 'archive' })
    await flush()
    expect(byPath).not.toHaveBeenCalled()
    const input = q('#ik-zip-path') as HTMLInputElement
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'D:\Exports\classroom.zip')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    click(button(/^List it$/))
    await flush()
    expect(byPath).toHaveBeenCalledWith('D:\Exports\classroom.zip')
    expect(qa('[data-entry]')).toHaveLength(5)
  })
  it('a store that keeps a decision draws no Undo, no Back to new and no U key; a declined row can be accepted instead', async () => {
    const desk = { ...makeFixtureDesk(), noUndo: 'The store keeps a decision.' }
    const decide = vi.spyOn(desk, 'decide')
    await start({ desk, initialFilter: 'declined' })
    expect(button(/Back to new/)).toBeUndefined()
    click(button(/Accept instead/))
    await flush()
    expect(decide.mock.calls[0][1]).toMatchObject({ state: 'accepted' })
    expect(Array.from(q('.ww-toast').querySelectorAll('button')).some((b) => b.textContent === 'Undo')).toBe(false)
  })
  it('a fault prints the lines the store set aside, and the desk is not drawn as empty', async () => {
    const lines = ['rows.json could not be parsed; kept beside it as rows.json.1.corrupt.']
    const desk = { ...nullIntakeDesk, list: async () => ({ state: 'fault' as const, reason: lines[0], since: NOW, data: null }), problems: () => lines }
    await start({ desk })
    const empty = q('[data-component="intake-empty"]').textContent ?? ''
    expect(empty).toContain('Fault: rows.json could not be parsed')
    expect(q('[data-component="intake-problems"]').textContent).toContain('kept beside it as rows.json.1.corrupt')
    expect(q('.ik-count-n').textContent).toBe('--')
  })
  it('the course mapper keeps a long name whole on focus, draws announcements PLANNED, has no auto-accept, and a suggestion is a chip he presses', async () => {
    const desk = makeFixtureDesk()
    const map = vi.spyOn(desk, 'mapCourse')
    await start({ desk, open: 'courses' })
    await flush()
    const mapper = q('[data-component="course-mapper"]')
    expect(mapper.textContent).not.toMatch(/auto-accept/i)
    const long = qa('.ik-course-name').find((e) => (e.getAttribute('title') ?? '').startsWith('Workshop'))!
    expect(long.getAttribute('aria-label')).toContain('the longer name that the mapper truncates')
    expect(long.textContent!.length).toBeLessThanOrEqual(36)
    expect(qa('[data-component="course-mapper"] [role="switch"]').length).toBe(1)
    expect(qa('[data-component="course-mapper"] [role="switch"]').every((s) => s.getAttribute('data-state') === 'planned')).toBe(true)
    expect(map).not.toHaveBeenCalled()
    click(button(/Suggested: Signals/))
    await flush()
    expect(map).toHaveBeenCalledWith('c2', 'signals')
  })
})

describe('registration and the gallery', () => {
  it('the view is registered for study.library and the entry carries the same labels as its lazy states', () => {
    expect(registeredView('study.library')?.product).toBe('ww')
    expect(entries[0].states.map((s) => s.label)).toEqual([...C03_LABELS])
  })
})
