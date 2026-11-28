// The Prepare face (board requests 21 and 23), rendered against a scripted client: nothing writes on mount; the sentence on top built
// from the counts alone; every count beside its state word; a look sends apply false only; Run says what it will do before the press,
// polls R-73 only while running and stops on unmount; a 409 is the engine sentence; the model sentences are on screen before the
// switch and a refused change keeps the value on file; the policy switch; accept and take back; the model tick locked with R-64's
// reason. Every record is invented. The pure words are tested in prepModel at the bottom.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '../../../../__tests__/ww/_stubs'
import type { ClientReply } from '../../adapters/types'
import type { ModelInfo, PolicyInfo, PrepClient, PrepCounts, RunInfo } from '../../adapters/pyqPrep'
import { PrepFace, modelLock } from '../PrepFace'
import { missingSentence, providerSentence, runWords, totalRows } from '../prepModel'

let m: ReturnType<typeof mount> | null = null
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { m?.unmount(); m = null; vi.useRealTimers() })

const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const click = async (el: Element | null | undefined) => { expect(el, 'element to click').toBeTruthy(); await act(async () => { (el as HTMLElement).click() }); await flush(0) }
const q = (sel: string) => m!.container.querySelector(sel) as HTMLElement | null
const qa = (sel: string) => Array.from(m!.container.querySelectorAll<HTMLElement>(sel))
const text = () => (m!.container.textContent ?? '').replace(/\s+/g, ' ')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rep = (state: ClientReply<unknown>['state'], reason: string, data: unknown): ClientReply<any> => ({ state, reason, since: 1, data })

const SUBJ = { subject: 'fixture-signals', name: 'Fixture Signals', papers: 3, questions: 40, pending: 40, accepted: 0, withMarks: 12, tagged: 0, sheetReadyTopics: 0 }
const COUNTS = (over: Partial<PrepCounts> = {}): PrepCounts => ({
  papers: 4, withoutSubject: 1, questions: 52, pending: 52, accepted: 0, withMarks: 12, tagged: 0, sheetReadyTopics: 0, questionBanks: 1, notQuestions: 2,
  marksNotPrinted: 9, acceptedUnmarked: 0, solutions: { papers: 1, items: 6, paired: 0 }, courses: { mapped: 2, unmapped: 1, state: 'live', reason: '' }, bySubject: [SUBJ], ...over,
})
const MODEL = (over: Partial<ModelInfo> = {}): ModelInfo => ({ provider: 'off', claudeModel: 'sonnet', name: '', available: { local: false, claude: true }, sendsOut: false, ...over })
const JOB = (over: Partial<RunInfo> = {}): RunInfo => ({
  id: 'r-1', status: 'running', steps: ['subjects', 'tags'], step: 'tags', unit: 'subjects', done: 0, total: 1, countsBefore: COUNTS(), countsNow: COUNTS(), seconds: 1.2,
  failures: 0, notes: [], started: 'x', finished: '', subjects: ['fixture-signals'], model: '', error: '', ...over,
})

interface Script { counts?: ClientReply<PrepCounts>; model?: ClientReply<ModelInfo>; policy?: ClientReply<PolicyInfo>; run?: ClientReply<RunInfo | null>[]; start?: ClientReply<RunInfo | null>; setModel?: ClientReply<ModelInfo>; setPolicy?: ClientReply<PolicyInfo> }
function fake(s: Script = {}) {
  const calls: string[] = []
  let runI = 0
  const runs = s.run ?? [rep('waiting', 'No preparation run yet.', null)]
  const client: PrepClient = {
    model: vi.fn(async () => { calls.push('model'); return s.model ?? rep('live', 'Rules only: no model is asked, and nothing leaves this PC.', MODEL()) }),
    setModel: vi.fn(async (p, cm) => { calls.push(`setModel ${p} ${cm ?? ''}`); return s.setModel ?? rep('live', providerSentence(p, cm ?? 'sonnet'), MODEL({ provider: p, claudeModel: cm ?? 'sonnet', sendsOut: p === 'claude' })) }),
    counts: vi.fn(async () => { calls.push('counts'); return s.counts ?? rep('live', '52 questions on 4 papers: 0 accepted, 12 with marks, 0 with a topic, 1 paper without a subject; 0 topics are ready for an evening sheet.', COUNTS()) }),
    subjects: vi.fn(async (r) => { calls.push(`subjects apply=${r.apply} model=${r.useModel}`); return rep('live', 'Would set a subject on 1 paper by rule (0 by course, 1 by code, 0 by name); 0 still without one.', { items: [{ paper: 'p-9', title: 'Invented paper nine', subject: 'fixture-signals', rule: 'code', written: '', reason: "The subject's course code is on it." }], counts: {}, model: '', asked: 0, roles: [], pairs: 0 }) }),
    reread: vi.fn(async (r) => { calls.push(`reread apply=${r.apply} papers=${(r.papers ?? []).join(',')}`); return rep('live', 'Reading again would change 0 papers of 1; nothing was written.', { items: [], changed: 0 }) }),
    tags: vi.fn(async (r) => { calls.push(`tags ${r.subject} apply=${r.apply} model=${r.useModel}`); return rep('live', 'Would tag 5 by rule and 0 by the model; 0 fit none of the topics, 35 are still without a topic.', null) }),
    policy: vi.fn(async () => { calls.push('policy'); return s.policy ?? rep('live', 'Off: nothing enters the bank without your review.', { autoAccept: false }) }),
    setPolicy: vi.fn(async (on) => { calls.push(`setPolicy ${on}`); return s.setPolicy ?? rep('live', on ? 'Questions safe to trust may be accepted by rule; each says so.' : 'Off: nothing enters the bank without your review.', { autoAccept: on }) }),
    accept: vi.fn(async (sid) => { calls.push(`accept ${sid}`); return rep('live', 'Accepted 3 questions by rule; 37 left for your review.', { accepted: 3, returned: null, unmarked: 0, held: {}, counts: null, before: null }) }),
    unaccept: vi.fn(async (sid) => { calls.push(`unaccept ${sid}`); return rep('live', 'Returned 3 questions accepted by rule to pending.', { accepted: null, returned: 3, unmarked: null, held: {}, counts: null, before: null }) }),
    runStart: vi.fn(async (r) => { calls.push(`runStart ${r.steps.join('+')} model=${r.useModel} subjects=${(r.subjects ?? []).join(',')}`); return s.start ?? rep('live', 'Step subjects: 0 of 1 subjects done, 0 s so far.', JOB({ step: 'subjects' })) }),
    runStatus: vi.fn(async () => { calls.push('runStatus'); return runs[Math.min(runI++, runs.length - 1)] }),
    runStop: vi.fn(async () => { calls.push('runStop'); return rep('waiting', 'Stopping after the batch or paper in hand.', JOB()) }),
    setRole: vi.fn(),
    abortAll: vi.fn(),
  }
  return { client, calls, writes: () => calls.filter((c) => /^(setModel|subjects apply=true|reread apply=true|tags .* apply=true|setPolicy|accept|unaccept|runStart|runStop)/.test(c)) }
}
async function open(f: ReturnType<typeof fake>) {
  m = mount(<PrepFace client={f.client} pollMs={2500} papers={[{ id: 'p-1', year: 2024, label: 'Invented', examAt: null, questions: 3, reviewed: 0, pages: 2, subject: 'fixture-signals' }]} />)
  await flush(0)
}
const switchOf = (label: string) => qa('[role="switch"]').find((s) => (s.getAttribute('aria-label') ?? s.textContent ?? '').includes(label)) ?? null
const key = (k: string) => q(`[data-key="${k}"]`)

describe('WHERE IT STANDS', () => {
  it('reads four routes on mount and writes nothing', async () => {
    const f = fake()
    await open(f)
    expect(f.calls.sort()).toEqual(['counts', 'model', 'policy', 'runStatus'])
    expect(f.writes()).toEqual([])
  })
  it('one sentence from the counts alone, the engine reason beside its word, every count with the state word', async () => {
    const f = fake({ counts: rep('live', '880 questions on 89 papers: 0 accepted.', COUNTS({ questions: 880, pending: 880, papers: 89, withoutSubject: 0 })) })
    await open(f)
    expect(q('[data-lead]')!.textContent).toBe('880 questions, 0 accepted: nothing can be ranked or put on a sheet yet.')
    expect(q('[data-said="counts"]')!.textContent).toContain('880 questions on 89 papers: 0 accepted.')
    const rows = qa('[data-tray="standing"] .prp-count')
    expect(rows.length).toBeGreaterThan(12)
    for (const r of rows) expect(r.querySelector('.prp-word')?.textContent).toBe('LIVE')
    expect(q('[data-count="marks_not_printed"]')!.textContent).toContain('9')
    expect(q('[data-subject="fixture-signals"]')!.textContent).toContain('Fixture Signals')
  })
  it('a count the engine did not send is "not reported", never 0', async () => {
    const f = fake({ counts: rep('live', 'ok', COUNTS({ marksNotPrinted: null, questionBanks: null })) })
    await open(f)
    expect(q('[data-count="marks_not_printed"] .prp-num')!.textContent).toBe('not reported')
  })
})

describe('PREPARE', () => {
  it('a look asks the single-step routes with apply false only, and prints each answer; accept has no look and says so', async () => {
    const f = fake()
    await open(f)
    for (const label of ["Find each paper's subject", 'Read the papers again', 'Tag topics', 'Accept safe questions']) await click(switchOf(label))
    await click(key('look'))
    await flush(0)
    expect(f.calls).toContain('subjects apply=false model=false')
    expect(f.calls).toContain('reread apply=false papers=')
    expect(f.calls).toContain('tags fixture-signals apply=false model=false')
    expect(f.writes()).toEqual([])
    expect(qa('.prp-look').length).toBe(4)
    expect(text()).toContain('Invented paper nine: The subject\'s course code is on it.')
    expect(q('[data-look="accept"]')!.textContent).toContain('Accept has no look of its own: it writes when it runs. Off: nothing enters the bank without your review.')
  })
  it('Run says what it will do before the press, starts the job, polls only while it runs, and the end reads the counts again', async () => {
    const f = fake({ run: [rep('waiting', 'No preparation run yet.', null), rep('live', 'Step tags: 0 of 1 subjects done, 2.5 s so far.', JOB()), rep('live', 'Finished subjects, tags in 5 s: accepted 0 to 0, with a topic 0 to 5, papers without a subject 1 to 0; 1 failure.', JOB({ status: 'done', seconds: 5, failures: 1, notes: ['Fixture Signals: 1 batch of the model failed; its questions are as they were.'], countsNow: COUNTS({ tagged: 5, withoutSubject: 0 }) }))] })
    await open(f)
    expect(key('run')!.getAttribute('aria-disabled')).toBe('true')
    await click(switchOf("Find each paper's subject"))
    await click(switchOf('Tag topics'))
    expect(q('[data-run-words]')!.textContent).toBe("Run writes to your question store: find each paper's subject, then tag topics, on every subject and every paper, by rule only, no model asked. Every value it writes says who set it.")
    await click(key('run'))
    expect(f.calls).toContain('runStart subjects+tags model=false subjects=')
    expect(q('.prp-run')!.getAttribute('data-run')).toBe('running')
    expect(key('stop')).toBeTruthy()
    expect(text()).toContain('Stops after the batch in hand')
    const countsBefore = f.calls.filter((c) => c === 'counts').length
    await flush(2500)
    await flush(2500)
    expect(q('.prp-run')!.getAttribute('data-run')).toBe('done')
    expect(q('.prp-runhead')!.textContent).toBe('Done')
    expect(q('[data-bn="tagged"]')!.textContent).toBe('With a topic05')
    expect(text()).toContain('1 batch of the model failed')
    expect(f.calls.filter((c) => c === 'counts').length).toBe(countsBefore + 1)
    const polls = f.calls.filter((c) => c === 'runStatus').length
    await flush(10_000)
    expect(f.calls.filter((c) => c === 'runStatus').length, 'no polling after the run ended').toBe(polls)
  })
  it('Stop sends R-74 and shows the engine sentence; unmount stops the poll', async () => {
    const f = fake({ run: [rep('live', 'Step tags: 0 of 1 subjects done, 1.2 s so far.', JOB())] })
    await open(f)
    await click(key('stop'))
    expect(f.calls).toContain('runStop')
    expect(q('[data-said="run"]')!.textContent).toContain('Stopping after the batch or paper in hand.')
    m!.unmount(); m = null
    const n = f.calls.filter((c) => c === 'runStatus').length
    await flush(10_000)
    expect(f.calls.filter((c) => c === 'runStatus').length).toBe(n)
  })
  it('a 409 on Run is the engine sentence, and no run is drawn', async () => {
    const f = fake({ start: rep('waiting', 'The paper desk or OCR is reading; start the run when it has finished.', null) })
    await open(f)
    await click(switchOf('Tag topics'))
    await click(key('run'))
    expect(q('[data-said="run-said"]')!.textContent).toContain('The paper desk or OCR is reading; start the run when it has finished.')
    expect(q('.prp-run')).toBeNull()
  })
  it('the model tick is locked with the reason while no model can be asked', async () => {
    const f = fake()
    await open(f)
    expect(switchOf('Use the model')!.getAttribute('aria-disabled')).toBe('true')
    expect(text()).toContain('The model is off (rules only): choose one under Who decides first.')
    expect(modelLock(rep('waiting', 'The local model on this PC is chosen but not running now, so a request answers that no model is reachable.', MODEL({ provider: 'local' })))).toBe('The local model on this PC is chosen but not running now, so a request answers that no model is reachable.')
    expect(modelLock(rep('live', 'ok', MODEL({ provider: 'claude', available: { local: false, claude: true } })))).toBeUndefined()
  })
  it('Accept is locked while the policy is off; with it on, Accept and Take back show the engine answer', async () => {
    const f = fake({ policy: rep('live', 'Questions safe to trust may be accepted by rule; each says so.', { autoAccept: true }) })
    await open(f)
    await click(q('[data-accept="fixture-signals"] [data-key="accept"]'))
    expect(f.calls).toContain('accept fixture-signals')
    expect(q('[data-said="accept-fixture-signals"]')!.textContent).toContain('Accepted 3 questions by rule; 37 left for your review.')
    await click(q('[data-accept="fixture-signals"] [data-key="take-back"]'))
    expect(q('[data-said="accept-fixture-signals"]')!.textContent).toContain('Returned 3 questions accepted by rule to pending.')
    m!.unmount(); m = null
    const g = fake()
    await open(g)
    expect(q('[data-accept="fixture-signals"] [data-key="accept"]')!.getAttribute('aria-disabled')).toBe('true')
  })
})

describe('WHO DECIDES', () => {
  it('the three sentences are on screen before any press; Claude asks once more with its sentence, then switches', async () => {
    const f = fake()
    await open(f)
    const tray = q('[data-tray="deciders"]')!
    expect(tray.textContent).toContain('the text of your questions and notes leaves this PC and counts against your Claude usage')
    expect(tray.textContent).toContain('Rules only: no model is asked, and nothing leaves this PC.')
    expect(q('[data-count="sends_out"]')!.textContent).toContain('no')
    const claude = Array.from(tray.querySelectorAll<HTMLElement>('[role="radio"]')).find((r) => r.textContent === 'Claude')
    await click(claude)
    expect(f.writes()).toEqual([])
    expect(q('[data-claude-sentence]')!.textContent).toBe('Claude (sonnet) is asked through the Claude tool on this PC: the text of your questions and notes leaves this PC and counts against your Claude usage.')
    await click(key('switch-claude'))
    expect(f.calls).toContain('setModel claude sonnet')
    expect(q('[data-count="sends_out"]')!.textContent).toContain('yes')
  })
  it('a refused change keeps the value on file and prints the engine sentence', async () => {
    const f = fake({ setModel: rep('fault', 'The Claude tool is not found on this PC, so Claude cannot be chosen.', null) })
    await open(f)
    const claude = qa('[data-tray="deciders"] [role="radio"]').find((r) => r.textContent === 'Claude')
    await click(claude)
    await click(key('switch-claude'))
    expect(q('[data-said="model-said"]')!.textContent).toContain('The Claude tool is not found on this PC, so Claude cannot be chosen.')
    expect(qa('[data-tray="deciders"] [role="radio"][aria-checked="true"]')[0].textContent).toBe('Off (rules only)')
  })
  it('the policy: its sentence and what safe means stand before the switch; one press sends it', async () => {
    const f = fake()
    await open(f)
    expect(q('[data-policy-sentence]')!.textContent).toContain('Turning it on: Questions safe to trust may be accepted by rule; each says so.')
    await click(switchOf('Accept safe questions by rule'))
    expect(f.calls).toContain('setPolicy true')
    expect(q('[data-said="policy"]')!.textContent).toContain('Questions safe to trust may be accepted by rule; each says so.')
    expect(q('[data-said="policy-said"]'), 'said once, on the line of the policy on file').toBeNull()
  })
})

describe('the words', () => {
  it('the sentence on top follows the counts and judges nothing', () => {
    expect(missingSentence(COUNTS({ papers: 0, questions: 0, withoutSubject: 0 }))).toBe('No paper on file yet, so there is nothing to prepare.')
    expect(missingSentence(COUNTS({ accepted: 0, withoutSubject: 1 }))).toBe("52 questions, 0 accepted: nothing can be ranked or put on a sheet yet. 1 paper has no subject, so its questions are in no subject's count.")
    expect(missingSentence(COUNTS({ accepted: 94, withoutSubject: 0, sheetReadyTopics: 0 }))).toBe('94 questions accepted, and no topic has 3 accepted questions: no evening sheet can be built yet.')
    expect(missingSentence(COUNTS({ accepted: 94, pending: 10, withoutSubject: 0, sheetReadyTopics: 13 }))).toBe('13 topics are ready for an evening sheet; 10 of 52 questions still wait for review.')
    expect(missingSentence(null)).toContain('not been read')
  })
  it('the totals say solution sheets apart, and a model run says when text leaves the PC', () => {
    expect(totalRows(COUNTS()).find((r) => r.key === 'solutions')).toMatchObject({ value: 1, note: '6 items, never questions' })
    expect(runWords(['tags'], 'Fixture Signals', { on: true, name: 'Claude sonnet', sendsOut: true })).toBe('Run writes to your question store: tag topics, on the papers of Fixture Signals, with the model (Claude sonnet); the text of your questions leaves this PC and counts against your Claude usage. Every value it writes says who set it.')
    expect(runWords([], null, { on: false, name: '', sendsOut: false })).toBe('Tick at least one step first.')
  })
})
