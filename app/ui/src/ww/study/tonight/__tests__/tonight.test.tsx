// The tonight sheet and the ledger, rendered against a fake client (package N2): the sheet or the reason there is none, Build, the marks
// form (typed marks kept after a refusal, cleared after a save), the settings, print, and the ledger with a hole, an opened topic and a
// pace that is waiting. Every record is invented. The routes themselves are tested in adapters/__tests__/pyqTonight.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { mount } from '../../../../__tests__/ww/_stubs'
import type { Sheet, TonightClient, TonightSettings, TonightView } from '../../adapters/pyqTonight'
import type { ClientReply } from '../../adapters/types'
import { usePlan } from '../../../../germoney/game/plan'
import { LedgerFace, holeWord } from '../../ledger/LedgerView'
import { TonightFace, whyLine } from '../TonightView'

let m: ReturnType<typeof mount> | null = null
afterEach(() => { m?.unmount(); m = null; usePlan.setState({ academics: null }); vi.restoreAllMocks() })

const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve() }) }
const q = (sel: string) => m!.container.querySelector(sel) as HTMLElement
const qa = (sel: string) => Array.from(m!.container.querySelectorAll<HTMLElement>(sel))
const click = (el: Element | null) => act(() => { (el as HTMLElement).click() })
const type = (el: HTMLInputElement, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const submit = (form: Element) => act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })

const reply = <T,>(state: ClientReply<T>['state'], reason: string, data: T | null): ClientReply<T> => ({ state, reason, since: 1, data })
const WHY = { daysLeft: 4, marksWeight: 8.5, share: 0.6, proficiency: 0.5, syllabusWeight: 3 }
const item = (n: number, id: string, marks: number, over: Record<string, unknown> = {}) => ({ n, questionId: id, marks, unit: 2, topic: n === 1 ? 'Sampling' : 'Aliasing', topicKey: `2|T${n}`, text: `Invented question ${n}.`, crop: null, why: WHY, mark: null, ...over })
const SHEET: Sheet = { id: '2026-11-27-fixture-signals', date: '2026-11-27', subject: 'fixture-signals', builtAt: '2026-11-27T19:00:00', items: [item(1, 'q1', 5), item(2, 'q2', 10)], unmarked: 2 }
const SETTINGS: TonightSettings = { on: true, hour: '19:00', count: 6, horizonDays: 21 }
const VIEW = (over: Partial<TonightView> = {}): TonightView => ({ sheet: null, awaiting: [], settings: SETTINGS, nextPapers: [], ...over })

function fake(over: Partial<TonightClient> = {}): TonightClient {
  return {
    tonight: vi.fn(async () => reply('waiting', 'No paper on the date sheet in the next 21 days.', VIEW())),
    saveSettings: vi.fn(async () => reply('live', 'Each day at 19:00: 6 questions.', SETTINGS)),
    build: vi.fn(async () => reply('live', "Tonight's sheet: 2 questions, Fixture Signals.", SHEET)),
    saveMarks: vi.fn(async () => reply('live', 'Saved marks for 1 question: 3 of 5. 1 question is still unmarked.', { sheet: { ...SHEET, unmarked: 1, items: [item(1, 'q1', 5, { mark: { got: 3, max: 5, minutes: null, at: 'x' } }), item(2, 'q2', 10)] }, saved: 1, total: { got: 3, max: 5 }, markedBy: 'you' })),
    printHtml: vi.fn(async () => reply('live', 'ok', '<!doctype html><title>t</title>')),
    ledger: vi.fn(), attempts: vi.fn(), pace: vi.fn(), abortAll: vi.fn(),
    ...over,
  }
}

async function tonight(client: TonightClient) {
  usePlan.setState({ academics: { subjects: [{ id: 'fixture-signals', name: 'Fixture Signals', kind: 'course', exam_date: null, days_left: null, strategy: '', units: [] }] } })
  m = mount(<TonightFace client={client} />)
  await settle()
}

describe('R-21 the tonight sheet', () => {
  it('with no sheet: the engine reason beside WAITING and a Build key, nothing built on its own', async () => {
    const c = fake()
    await tonight(c)
    expect(q('[data-tray="tonight"] [data-said="state"]').textContent).toContain('No paper on the date sheet in the next 21 days.')
    expect(q('[data-tray="tonight"] .k-lamp-word, [data-tray="tonight"] [data-state="waiting"]')).toBeTruthy()
    expect(q('[data-key="build"]').textContent).toBe("Build tonight's sheet")
    expect(c.build).not.toHaveBeenCalled()
    expect(c.saveSettings).not.toHaveBeenCalled()
  })
  it('Build sends nothing but his press, then reads the sheet again; a 409 sentence is printed as sent', async () => {
    const c = fake({ build: vi.fn(async () => reply('waiting', 'The paper desk is reading files; try again when it has finished.', null)) })
    await tonight(c)
    await click(q('[data-key="build"]'))
    await settle()
    expect(c.build).toHaveBeenCalledWith({})
    expect(q('[data-said="action"]').textContent).toContain('The paper desk is reading files; try again when it has finished.')
  })
  it('a built sheet: the subject, each question with its marks, its words and the terms the engine printed', async () => {
    await tonight(fake({ tonight: vi.fn(async () => reply('live', "Tonight's sheet: 2 questions, Fixture Signals, paper in 4 days.", VIEW({ sheet: SHEET }))) }))
    expect(q('.tsh-title').textContent).toBe('Fixture Signals, 2026-11-27')
    const items = qa('.tsh-item')
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('Q1')
    expect(items[0].textContent).toContain('5 marks')
    expect(items[0].textContent).toContain('Invented question 1.')
    expect(items[0].textContent).toContain('Why this one: paper in 4 days, syllabus weight 3 (high), marks weight 8.5, seen share 0.6, proficiency 0.5.')
    expect(q('[data-key="build"]')).toBeNull()
    expect(q('[data-key="print"]').textContent).toBe('Print this sheet')
  })
  it('a question with neither words nor picture says so', async () => {
    await tonight(fake({ tonight: vi.fn(async () => reply('live', 'x', VIEW({ sheet: { ...SHEET, items: [item(1, 'q1', 5, { text: '' })] } }))) }))
    expect(q('.tsh-item').textContent).toContain('The engine sent no words or picture for this question.')
  })
  it('whyLine words only the terms that came', () => {
    expect(whyLine({ daysLeft: 0, marksWeight: null, share: null, proficiency: null, syllabusWeight: 1 })).toBe('paper today, syllabus weight 1 (low)')
    expect(whyLine({ daysLeft: null, marksWeight: null, share: null, proficiency: null, syllabusWeight: null })).toBe('')
  })
})

describe('R-21 marks', () => {
  it('a field per question from 0 to its maximum, 44 px class, empty until he types; nothing is sent by typing', async () => {
    const c = fake({ tonight: vi.fn(async () => reply('live', 'x', VIEW({ sheet: SHEET }))) })
    await tonight(c)
    const fields = qa('[data-tray="marks"] input.tsh-num')
    expect(fields).toHaveLength(2)
    expect(fields.map((f) => [f.getAttribute('min'), f.getAttribute('max'), (f as HTMLInputElement).value])).toEqual([['0', '5', ''], ['0', '10', '']])
    type(fields[0] as HTMLInputElement, '3')
    expect(c.saveMarks).not.toHaveBeenCalled()
  })
  it('Save marks sends only the typed fields; the engine answer is shown with "typed by you"; typed text is cleared once kept', async () => {
    // the engine answers the sheet with the mark on it from then on, as R-55 does
    let current: Sheet = SHEET
    const c = fake({
      tonight: vi.fn(async () => reply('live', 'x', VIEW({ sheet: current }))),
      saveMarks: vi.fn(async () => {
        current = { ...SHEET, unmarked: 1, items: [item(1, 'q1', 5, { mark: { got: 3, max: 5, minutes: null, at: 'x' } }), item(2, 'q2', 10)] }
        return reply('live', 'Saved marks for 1 question: 3 of 5. 1 question is still unmarked.', { sheet: current, saved: 1, total: { got: 3, max: 5 }, markedBy: 'you' })
      }),
    })
    await tonight(c)
    type(q('[data-tray="marks"] input.tsh-num') as HTMLInputElement, '3')
    await submit(q('[data-tray="marks"] form'))
    await settle()
    expect(c.saveMarks).toHaveBeenCalledWith(SHEET.id, [{ questionId: 'q1', got: 3 }])
    const said = q('[data-said="marks"]').textContent!
    expect(said).toContain('Saved marks for 1 question: 3 of 5. 1 question is still unmarked.')
    expect(said).toContain('Marked by you')
    expect(q('[data-tray="tonight"] [data-got]').textContent).toBe('Your mark, typed by you: 3 of 5.')
  })
  it('a refusal prints the engine sentence and keeps what he typed', async () => {
    const c = fake({
      tonight: vi.fn(async () => reply('live', 'x', VIEW({ sheet: SHEET }))),
      saveMarks: vi.fn(async () => reply('fault', 'Marks for a 5-mark question are from 0 to 5.', null)) as never,
    })
    await tonight(c)
    const f = q('[data-tray="marks"] input.tsh-num') as HTMLInputElement
    type(f, '9')
    await submit(q('[data-tray="marks"] form'))
    await settle()
    expect(q('[data-said="marks"]').textContent).toContain('Marks for a 5-mark question are from 0 to 5.')
    expect((q('[data-tray="marks"] input.tsh-num') as HTMLInputElement).value).toBe('9')
  })
  it('a mark that is not a number is refused here, in words, and nothing is sent', async () => {
    const c = fake({ tonight: vi.fn(async () => reply('live', 'x', VIEW({ sheet: SHEET }))) })
    await tonight(c)
    type(q('[data-tray="marks"] input.tsh-num') as HTMLInputElement, '3/5')
    await submit(q('[data-tray="marks"] form'))
    await settle()
    expect(c.saveMarks).not.toHaveBeenCalled()
    expect(q('[data-said="marks"]').textContent).toContain('type the mark as a number')
  })
  it('an earlier sheet is listed, newest first, and opens through the stored sheet of its day and subject', async () => {
    const old: Sheet = { ...SHEET, id: '2026-11-25-fixture-signals', date: '2026-11-25', unmarked: 2 }
    const c = fake({
      tonight: vi.fn(async () => reply('live', 'x', VIEW({ awaiting: [{ id: '2026-11-24-fixture-signals', date: '2026-11-24', subject: 'fixture-signals', unmarked: 1 }, { id: old.id, date: old.date, subject: old.subject, unmarked: 2 }] }))),
      build: vi.fn(async () => reply('live', 'The sheet of 2026-11-25', old)),
    })
    await tonight(c)
    const keys = qa('.tsh-sheetkey')
    expect(q('[data-empty="choose"]').textContent).toBe('Choose a sheet to type its marks.')
    expect(qa('[data-tray="marks"] input')).toHaveLength(0)
    expect(keys.map((k) => k.textContent)).toEqual([expect.stringContaining('2026-11-25'), expect.stringContaining('2026-11-24')])
    await click(keys[0])
    await settle()
    expect(c.build).toHaveBeenCalledWith({ date: '2026-11-25', subject: 'fixture-signals' })
    expect(qa('[data-tray="marks"] input.tsh-num')).toHaveLength(2)
    expect(keys[0].getAttribute('aria-current')).toBe('true')
  })
  it('says plainly that the marks are his and that the order moves only after 5 marks on a topic', async () => {
    await tonight(fake())
    const t = q('[data-tray="marks"]').textContent!
    expect(t).toContain('Typed by you')
    expect(t).toContain('The order of topics moves only after 5 marks on a topic.')
    expect(t).not.toMatch(/grade:|will pass|predict/i)
  })
})

describe('R-21 settings and print', () => {
  it('shows the settings as on file and saves them only on his press', async () => {
    const c = fake({ tonight: vi.fn(async () => reply('planned', 'The evening sheet is off.', VIEW({ settings: { ...SETTINGS, on: false } }))) })
    await tonight(c)
    expect(q('#tsh-hour')).toBeTruthy()
    expect((q('#tsh-hour') as HTMLInputElement).value).toBe('19:00')
    expect((q('#tsh-count') as HTMLInputElement).value).toBe('6')
    expect((q('#tsh-horizon') as HTMLInputElement).value).toBe('21')
    expect(qa('[data-tray="settings"] [role="radio"]').find((r) => r.getAttribute('aria-checked') === 'true')!.textContent).toBe('Off')
    type(q('#tsh-count') as HTMLInputElement, '8')
    expect(c.saveSettings).not.toHaveBeenCalled()
    await submit(q('[data-tray="settings"]'))
    await settle()
    expect(c.saveSettings).toHaveBeenCalledWith({ on: false, hour: '19:00', count: 8, horizonDays: 21 })
    expect(q('[data-said="settings"]').textContent).toContain('Each day at 19:00: 6 questions.')
  })
  it('a refused settings save prints the engine sentence and keeps the typed number', async () => {
    const c = fake({ saveSettings: vi.fn(async () => reply('fault', 'Questions are from 3 to 12.', null)) as never })
    await tonight(c)
    type(q('#tsh-count') as HTMLInputElement, '40')
    await submit(q('[data-tray="settings"]'))
    await settle()
    expect(q('[data-said="settings"]').textContent).toContain('Questions are from 3 to 12.')
    expect((q('#tsh-count') as HTMLInputElement).value).toBe('40')
  })
  it('Print asks the engine for its A4 sheet of this id and says where it went', async () => {
    const c = fake({ tonight: vi.fn(async () => reply('live', 'x', VIEW({ sheet: SHEET }))) })
    await tonight(c)
    const print = vi.fn()
    // happy-dom gives a frame no real window to print from; the key's own sentence is what is asserted
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue({ focus: () => undefined, print } as unknown as Window)
    await click(q('[data-tray="tonight"] [data-key="print"]'))
    await settle()
    expect(c.printHtml).toHaveBeenCalledWith(SHEET.id)
    const frame = document.querySelector<HTMLIFrameElement>('iframe.tsh-printframe')
    expect(frame).toBeTruthy()
    act(() => { frame!.onload?.(new Event('load')) })
    await settle()
    expect(print).toHaveBeenCalled()
    expect(q('[data-said="action"]').textContent).toContain('Sent to the print dialog')
    frame!.remove()
  })
})

describe('R-22 the ledger', () => {
  const ROWS = [
    { key: '1|Basics', unit: 1, topic: 'Basics', syllabusWeight: 2, notes: 2, pastQuestions: 3, pastMarks: 20, papersSeen: 3, families: 2, attempts: 2, got: 7, max: 12, minutes: 30, lastPractised: '2026-11-26', questionIds: ['qa', 'qb', 'qc'], noteFiles: ['fa', 'fb'] },
    { key: '2|Sampling', unit: 2, topic: 'Sampling', syllabusWeight: 3, notes: 0, pastQuestions: 1, pastMarks: 8, papersSeen: 1, families: 1, attempts: 0, got: 0, max: 0, minutes: null, lastPractised: null, questionIds: ['qd'], noteFiles: [] },
  ]
  const ledger = (over: Partial<TonightClient> = {}) => fake({
    ledger: vi.fn(async () => reply('live', '2 topics: 1 in your notes, 2 with a past question, 1 practised; 2 holes.', { items: ROWS, holes: [{ key: '2|Sampling', kind: 'no_notes', sentence: 'No note of yours mentions Sampling.' }, { key: '2|Sampling', kind: 'never_practised', sentence: 'No mark on file for Sampling.' }], totals: { topics: 2, withNotes: 1, withPastQuestion: 2, practised: 1, attempts: 2, got: 7, max: 12 }, skipped: [] })),
    attempts: vi.fn(async () => reply('live', '2 marks on file: 7 of 12.', [
      { at: '2026-11-26T20:00:00', source: 'sheet', sourceId: '2026-11-26-fixture-signals', questionId: 'qa', topicKey: '1|Basics', got: 4, max: 5, minutes: 9 },
      { at: '2026-11-20T10:00:00', source: 'paper', sourceId: 'g-aaaaaaaaaaaa', questionId: 'qb', topicKey: '1|Basics', got: 3, max: 7, minutes: null },
    ])),
    pace: vi.fn(async () => reply('waiting', 'No mark on file for this subject yet; the pace is counted from your marks.', { paperDate: null, daysLeft: null, topics: 2, practised: 0, left: 2, daysCounted: 0, practisedInDays: null, perDay: null, daysNeeded: null, from: null, to: null, sentence: 'No mark on file for this subject yet; the pace is counted from your marks.' })),
    ...over,
  })
  async function open(c: TonightClient) {
    usePlan.setState({ academics: { subjects: [{ id: 'fixture-signals', name: 'Fixture Signals', kind: 'course', exam_date: null, days_left: null, strategy: '', units: [] }] } })
    m = mount(<LedgerFace client={c} />)
    await settle()
  }
  it('one row per topic in the engine order with its counts; a hole is the engine word; no row is coloured for being weak', async () => {
    await open(ledger())
    const rows = qa('.cld-row')
    expect(rows.map((r) => r.getAttribute('data-topic'))).toEqual(['1|Basics', '2|Sampling'])
    expect(rows[0].textContent).toContain('Unit 1, Basics')
    expect(rows[0].textContent).toContain('Syllabus weight 2 (middle)')
    expect(rows[0].textContent).toContain('7 of 12')
    expect(rows[1].textContent).toContain('Syllabus weight 3 (high)')
    expect(rows[1].textContent).toContain('none yet')
    expect(rows[1].querySelector('[data-holes]')!.textContent).toBe('no notesnever practised')
    expect(rows[0].querySelector('[data-holes]')).toBeNull()
    expect(q('[data-said="ledger"]').textContent).toContain('2 topics: 1 in your notes')
    expect(holeWord('no_past_question')).toBe('no past question')
  })
  it('opening a topic lists every mark on file with its source, got of max, and the engine sentence of its hole', async () => {
    const c = ledger()
    await open(c)
    await click(qa('.cld-row')[0])
    await settle()
    expect(c.attempts).toHaveBeenCalledWith('fixture-signals', '1|Basics')
    const marks = qa('[data-marks] .cld-mark').map((x) => x.textContent)
    expect(marks[0]).toContain('2026-11-26')
    expect(marks[0]).toContain('a tonight sheet')
    expect(marks[0]).toContain('4 of 5, 9 min')
    expect(marks[1]).toContain('a generated paper')
    expect(qa('.cld-row')[0].getAttribute('aria-current')).toBe('true')
    await click(qa('.cld-row')[1])
    await settle()
    expect(q('[data-tray="topic-marks"]').textContent).toContain('No note of yours mentions Sampling.')
  })
  it('a pace that is waiting prints the engine sentence and no number at all', async () => {
    await open(ledger())
    const t = q('[data-tray="pace"]')
    expect(t.querySelector('[data-said="pace"]')!.textContent).toContain('No mark on file for this subject yet')
    expect(t.querySelector('[data-pace]')).toBeNull()
    expect(t.textContent).not.toMatch(/\b0\b/)
  })
  it('a live pace prints the numbers the engine counted beside its sentence', async () => {
    const sentence = 'Counted over your last 3 days with a mark (2026-11-24 to 2026-11-27): 2 topics marked for the first time, 0.67 a day.'
    await open(ledger({ pace: vi.fn(async () => reply('live', sentence, { paperDate: '2026-12-01', daysLeft: 4, topics: 6, practised: 2, left: 4, daysCounted: 3, practisedInDays: 2, perDay: 0.67, daysNeeded: 6, from: '2026-11-24', to: '2026-11-27', sentence })) }))
    const t = q('[data-tray="pace"]')
    expect(t.querySelector('[data-said="pace"]')!.textContent).toContain(sentence)
    expect(t.querySelector('[data-pace]')!.textContent).toContain('0.67')
    expect(t.querySelector('[data-pace]')!.textContent).toContain('2026-12-01, 4 days away')
  })
  it('the rows behind a count are listed under the opened topic', async () => {
    await open(ledger())
    await click(qa('.cld-row')[0])
    await settle()
    expect(q('[data-ids="notes"]').textContent).toBe('fa, fb')
    expect(q('[data-ids="questions"]').textContent).toBe('qa, qb, qc')
  })
  it('an unknown subject or an engine refusal is the engine sentence, with no rows', async () => {
    await open(ledger({ ledger: vi.fn(async () => reply('fault', 'No such subject.', null)) as never }))
    expect(q('[data-said="ledger"]').textContent).toContain('No such subject.')
    expect(qa('.cld-row')).toHaveLength(0)
  })
})
