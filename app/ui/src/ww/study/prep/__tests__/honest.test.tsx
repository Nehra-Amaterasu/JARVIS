// The small honest edits of wave EW11 on the screens that already exist (board request 23, item 3 of package P): marks not printed on
// the review desk, the strata and the tonight sheet (with his "out of" and keep), a paper's role and who set it, a solution offered no
// OCR and no review, a not-a-question item with no Accept, who set a tag and who accepted it, R-17's marks basis in words, and the two
// empty poses of Papers. Every record is invented.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '../../../../__tests__/ww/_stubs'
import { resetLookForTests } from '../../../../shell/look'
import { marksWords, paperRow, provenanceWords, questionRow, termsText } from '../../adapters/pyqMap'
import { sheetOf, type Sheet, type TonightClient } from '../../adapters/pyqTonight'
import type { ClientReply } from '../../adapters/types'
import type { PrepClient } from '../../adapters/pyqPrep'
import { usePlan } from '../../../../germoney/game/plan'
import { EMPTY_DATA, EMPTY_NONE, EMPTY_UNREADY, PaperDesk, type DeskData } from '../../papers/PaperDesk'
import type { PaperRow, QuestionRow } from '../../ports'
import { ReviewDesk } from '../../review/ReviewDesk'
import { TonightFace } from '../../tonight/TonightView'

let m: ReturnType<typeof mount> | null = null
afterEach(() => { m?.unmount(); m = null; usePlan.setState({ academics: null }); vi.restoreAllMocks() })
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve() }) }
const q = (sel: string) => m!.container.querySelector(sel) as HTMLElement | null
const qa = (sel: string) => Array.from(m!.container.querySelectorAll<HTMLElement>(sel))
const text = () => (m!.container.textContent ?? '').replace(/\s+/g, ' ')
const click = (el: Element | null) => act(() => { (el as HTMLElement).click() })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rep = (state: ClientReply<unknown>['state'], reason: string, data: unknown): ClientReply<any> => ({ state, reason, since: 1, data })

const EQ = { id: 'q-1', paper_id: 'p-qb', label: '3', text: 'Explain the time constant of an invented first order network.', text_status: 'verified', marks: null, type: 'descriptive', status: 'accepted', unit: 2, topic: 'time constant', tag_source: 'model', tag_model: 'claude sonnet', tag_margin: null, accepted_by: 'rule', status_by: 'rule', marks_source: 'not printed' }

describe('the mappers', () => {
  it('marks not printed stays null and says so; never 0', () => {
    const r = questionRow(EQ as never, { id: 'p-qb', year: 2025, total_marks: 60 } as never)
    expect(r.marks).toBeNull()
    expect(r.share).toBeNull()
    expect(r.marksNotPrinted).toBe(true)
    expect(marksWords(r)).toBe('marks not printed')
    expect(marksWords({ marks: null })).toBe('marks not found')
    expect(marksWords({ marks: 5 })).toBe('5 marks')
  })
  it('a model tag names the model and is never his; a rule acceptance is never his either', () => {
    const r = questionRow(EQ as never, undefined)
    expect(r).toMatchObject({ tag: 'MODEL', tagModel: 'claude sonnet', acceptedBy: 'rule' })
    expect(provenanceWords(r)).toBe('Topic set by the model claude sonnet, not checked by you; accepted by the rule, not by you')
    const his = questionRow({ ...EQ, tag_source: 'hand', accepted_by: 'rule', status_by: 'hand' } as never, undefined)
    expect(provenanceWords(his)).toBe('Topic set by you; accepted by you')
  })
  it('not a question carries who judged it', () => {
    expect(questionRow({ ...EQ, status: 'pending', not_question: true, not_question_source: 'model', not_question_model: 'claude haiku' } as never, undefined)).toMatchObject({ notQuestion: true, notQuestionBy: 'claude haiku' })
    expect(questionRow({ ...EQ, not_question: true, not_question_source: 'rule' } as never, undefined).notQuestionBy).toBe('rule')
  })
  it('a paper keeps its role and who set it; an unknown role is left out', () => {
    expect(paperRow({ id: 'p', title: 'Invented QB unit 2', role: 'question_bank', role_source: 'rule' })).toMatchObject({ role: 'question_bank', roleSource: 'rule' })
    expect(paperRow({ id: 'p', role: 'exam' }).role).toBeUndefined()
  })
  it("R-17's marks basis: assumed and mixed are said; printed adds nothing", () => {
    expect(termsText({ marks_weight: 0.3, marks_basis: 'assumed' })).toBe('marks weight 0.30; weighed on assumed marks (the median of the marks printed in this subject)')
    expect(termsText({ marks_weight: 0.3, marks_basis: 'mixed' })).toContain('weighed partly on assumed marks')
    expect(termsText({ marks_weight: 0.3, marks_basis: 'printed' })).toBe('marks weight 0.30')
  })
  it('a tonight item with marks null is kept only when the engine says the marks are not printed', () => {
    const base = { n: 1, question_id: 'q-1', unit: 2, topic: 'T', topic_key: '2|T', text: 'x', crop: null, why: null, mark: null }
    const s = sheetOf({ id: 's', items: [{ ...base, marks: null, marks_note: 'marks not printed' }, { ...base, question_id: 'q-2', marks: null, marks_note: '' }] })!
    expect(s.items.map((i) => [i.questionId, i.marks, i.marksNotPrinted])).toEqual([['q-1', null, true]])
  })
})

const Q = (over: Partial<QuestionRow> = {}): QuestionRow => ({
  id: 'q-1', paperId: 'p-qb', number: 'Q3', year: 2025, topicId: '2|time constant', type: 'derivation', marks: null, share: null, tag: 'MODEL', margin: 0, status: 'pending',
  stem: 'Explain the time constant of an invented first order network.', crop: { textStatus: 'verified', text: 'Explain the time constant of an invented first order network.' }, ...over,
})

describe('the review desk', () => {
  it('marks not printed, who set the topic, and a not-a-question item has no Accept', async () => {
    const onDecide = vi.fn()
    m = mount(<ReviewDesk questions={[Q({ marksNotPrinted: true, tagModel: 'claude sonnet' }), Q({ id: 'q-2', number: 'Q4', notQuestion: true, notQuestionBy: 'rule', tag: 'RULE', margin: 0.9, marks: 5 })]} topics={[{ id: '2|time constant', label: 'time constant', unit: 'Unit 2' }]} events={[]} onDecide={onDecide} />)
    await settle()
    expect(q('[data-marks="not-printed"]')!.textContent).toBe('marks not printed')
    expect(q('[data-prov]')!.textContent).toContain('Topic set by the model claude sonnet, not checked by you')
    expect(text()).not.toMatch(/\b0 marks\b|None/)
    // step to the not-a-question item: its Accept is locked with a reason and Enter does nothing
    await act(async () => { (q('.rv-desk') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true })) })
    expect(q('[data-notq]')!.textContent).toContain('Not a question, judged by the rule')
    const accept = qa('.rv-actions button').find((b) => b.textContent?.includes('Accept'))!
    expect(accept.getAttribute('aria-disabled')).toBe('true')
    await act(async () => { (q('.rv-desk') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(onDecide).not.toHaveBeenCalledWith({ kind: 'accept', qid: 'q-2' })
  })
})

describe('the paper desk under v3', () => {
  beforeEach(() => { localStorage.setItem('app.look', 'v3'); resetLookForTests() })
  afterEach(() => { localStorage.removeItem('app.look'); resetLookForTests() })
  const paper = (over: Partial<PaperRow> = {}): PaperRow => ({ id: 'p-qb', year: 2025, label: 'Invented question bank unit 2', examAt: null, questions: 2, reviewed: 0, pages: 3, subject: 'fixture-signals', ...over })
  const desk = (papers: PaperRow[], questions: QuestionRow[]): DeskData => ({ ...EMPTY_DATA, state: 'live', reason: '2 papers on file.', papers, questions })
  const prep = { setRole: vi.fn(async (id: string, role: string) => rep('live', 'Paper updated.', { id, role, roleSource: 'hand' })) } as unknown as PrepClient

  it('no paper: one line and one key', async () => {
    m = mount(<PaperDesk data={desk([], [])} prep={prep} />)
    await settle()
    expect(q('[data-pose="none"]')!.textContent).toContain(EMPTY_NONE)
    expect(q('[data-key="pose-drop"]')).toBeTruthy()
  })
  it('papers, none accepted: "Open Prepare" opens the Prepare face', async () => {
    m = mount(<PaperDesk data={desk([paper()], [Q()])} prep={{ ...prep, counts: vi.fn(async () => rep('waiting', 'x', null)), model: vi.fn(async () => rep('waiting', 'x', null)), policy: vi.fn(async () => rep('waiting', 'x', null)), runStatus: vi.fn(async () => rep('waiting', 'No preparation run yet.', null)), abortAll: vi.fn() } as unknown as PrepClient} />)
    await settle()
    expect(q('[data-pose="unready"]')!.textContent).toContain(EMPTY_UNREADY)
    await click(q('[data-key="pose-prepare"]'))
    await settle()
    expect(q('[data-component="prep-face"]')).toBeTruthy()
  })
  it("a paper's role and who set it on its row and in its facts; a change goes through R-04", async () => {
    m = mount(<PaperDesk data={desk([paper({ role: 'question_bank', roleSource: 'rule' })], [Q({ status: 'accepted' })])} prep={prep} />)
    await settle()
    expect(q('.pp-paper')!.textContent).toContain('question bank, set by the rule')
    await click(q('.pp-paper'))
    expect(q('[data-fact="role"]')!.textContent).toContain('question bank, set by the rule')
    const sel = q('[data-role-select]') as unknown as HTMLSelectElement
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, 'solution'); sel.dispatchEvent(new Event('change', { bubbles: true })) })
    await settle()
    expect(prep.setRole).toHaveBeenCalledWith('p-qb', 'solution')
    expect(q('[data-role-said]')!.textContent).toContain('Role set to solution sheet by you.')
  })
  it('a solution sheet is never offered OCR or "to review"', async () => {
    m = mount(<PaperDesk data={desk([paper({ role: 'solution', roleSource: 'hand', faults: ['p. 2: no text layer; run OCR on this paper'] })], [Q({ status: 'accepted' })])} prep={prep} />)
    await settle()
    expect(q('.pp-paper')!.textContent).not.toContain('to review')
    expect(q('.pp-paper')!.textContent).toContain('solution sheet')
    await click(q('.pp-paper'))
    expect(q('[data-component="ocr-panel"]')).toBeNull()
    expect(q('[data-solution]')).toBeTruthy()
  })
})

describe('the tonight sheet', () => {
  const ITEM = (n: number, id: string, marks: number | null, over: Record<string, unknown> = {}) => ({ n, questionId: id, marks, marksNotPrinted: marks === null, unit: 2, topic: `Topic ${n}`, topicKey: `2|T${n}`, text: `Invented question ${n}.`, crop: null, why: null, mark: null, ...over })
  const SHEET: Sheet = { id: '2026-11-28-fixture-signals', date: '2026-11-28', subject: 'fixture-signals', builtAt: 'x', items: [ITEM(1, 'q1', null), ITEM(2, 'q2', 5)], unmarked: 2 }
  function client(save: TonightClient['saveMarks']): TonightClient {
    return {
      tonight: vi.fn(async () => rep('live', "Tonight's sheet: 2 questions.", { sheet: SHEET, awaiting: [], settings: { on: true, hour: '19:00', count: 6, horizonDays: 21 }, nextPapers: [] })),
      saveSettings: vi.fn(), build: vi.fn(), saveMarks: save, printHtml: vi.fn(), ledger: vi.fn(), attempts: vi.fn(), pace: vi.fn(), abortAll: vi.fn(),
    }
  }
  beforeEach(() => { usePlan.setState({ academics: { subjects: [{ id: 'fixture-signals', name: 'Fixture Signals', kind: 'course', exam_date: null, days_left: null, strategy: '', units: [] }] } } as never) })
  const typeIn = (el: HTMLInputElement, v: string) => act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) })

  it('says "marks not printed", asks out of for that question only, and sends out_of with keep only when he ticks it', async () => {
    const save = vi.fn(async () => rep('live', 'Saved marks for 1 question: 6 of 10. 1 question is kept as the marks of 1 question.', { sheet: SHEET, saved: 1, total: { got: 6, max: 10 }, markedBy: 'you', keptMarks: ['q1'] }))
    m = mount(<TonightFace client={client(save)} />)
    await settle()
    expect(q('[data-tray="tonight"] [data-marks="not-printed"]')!.textContent).toBe('marks not printed')
    expect(qa('[data-out-of]').map((e) => e.getAttribute('data-out-of'))).toEqual(['q1'])
    await typeIn(q('input[data-q="q1"]') as HTMLInputElement, '6')
    await typeIn(q('[data-out-of="q1"]') as HTMLInputElement, '10')
    await click(qa('[data-notprinted="q1"] [role="switch"]')[0])
    await act(async () => { q('form[data-form]')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await settle()
    expect(save).toHaveBeenCalledWith(SHEET.id, [{ questionId: 'q1', got: 6, outOf: 10, keep: true }])
  })
  it('without out of the mark is sent as typed and the engine 400 sentence is shown', async () => {
    const save = vi.fn(async () => rep('fault', "This question's marks are not printed: give out_of, your own number from 1 to 100.", null))
    m = mount(<TonightFace client={client(save)} />)
    await settle()
    await typeIn(q('input[data-q="q1"]') as HTMLInputElement, '6')
    await act(async () => { q('form[data-form]')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await settle()
    expect(save).toHaveBeenCalledWith(SHEET.id, [{ questionId: 'q1', got: 6 }])
    expect(q('[data-said="marks"]')!.textContent).toContain("This question's marks are not printed: give out_of, your own number from 1 to 100.")
  })
})
