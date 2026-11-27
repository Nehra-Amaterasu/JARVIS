// The OCR panel and the draft panel of the paper desk (package O), rendered against a scripted client: the key that starts OCR, a
// job that runs and is polled only while it runs, the end words, the engine's own 409 sentence, a poll that stops on unmount, and the
// drafts: required fields, the engine's checks as words, pending until accepted, marks needed, edit then accept, reject. Invented data.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '../../../../__tests__/ww/_stubs'
import type { ClientReply, DraftPatch, DraftRow, OcrJob, OcrStatus, PyqClient } from '../../adapters/types'
import type { PaperRow } from '../../ports'
import { OcrPanel, waitingPages } from '../OcrPanel'
import { DraftsPanel, checksText } from '../DraftsPanel'
import { PaperDesk, EMPTY_DATA, type DeskData } from '../PaperDesk'
import { NOW, fixtureCrop } from '../fixtures'
import { CropCard } from '../../review/CropCard'
import { ReviewDesk } from '../../review/ReviewDesk'
import type { QuestionRow } from '../../ports'

let m: ReturnType<typeof mount> | null = null
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { m?.unmount(); m = null; vi.useRealTimers() })

const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const click = async (el: Element | null | undefined) => { expect(el, 'element to click').toBeTruthy(); await act(async () => { (el as HTMLElement).click() }); await flush(0) }
const type = async (el: Element | null | undefined, v: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  const set = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  await act(async () => { set.call(el, v); el!.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })) })
}
const q = (sel: string) => m!.container.querySelector(sel) as HTMLElement | null
const text = () => (m!.container.textContent ?? '').replace(/\s+/g, ' ')
const byText = (sel: string, t: string) => Array.from(m!.container.querySelectorAll<HTMLElement>(sel)).find((e) => e.textContent?.trim() === t)

const SCAN: PaperRow = {
  id: 'p-scan', year: 2024, label: 'Mock paper A', examAt: null, questions: 0, reviewed: 0, pages: 7, subject: 'signals', method: 'text-layer',
  faults: ['p. 3: no text layer; run OCR on this paper', 'p. 4: no text layer; run OCR on this paper', 'p. 6: read at confidence 0.71, below 0.85; left as a picture'],
}
const job = (over: Partial<OcrJob> = {}): OcrJob => ({
  id: 'o-1', status: 'running', paperId: SCAN.id, pagesTotal: 2, pagesDone: 0, pageNow: 3, pagesRead: 0, pagesBelowGate: 0, questions: 0,
  started: '2026-11-27T10:00:00', finished: null, secondsPerPage: null, ...over,
})
const status = (j: OcrJob | null, waiting = { papers: 1, pages: 2 }): OcrStatus => ({ engine: { name: 'invented-ocr', version: '1', device: 'cpu', installed: true }, gate: 0.85, job: j, waiting })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rep = (state: ClientReply<unknown>["state"], reason: string, data: unknown): ClientReply<any> => ({ state, reason, since: 1, data })

/** A scripted client: each call answers the next scripted reply (the last one repeats), and every call is recorded. */
function fake(script: { status?: ClientReply<OcrStatus>[]; start?: ClientReply<OcrStatus>; stop?: ClientReply<OcrStatus>; make?: ClientReply<DraftRow[]>; list?: ClientReply<DraftRow[]>[]; decide?: (id: string, p: DraftPatch) => ClientReply<DraftRow> } = {}) {
  const calls: string[] = []
  const seq = <T,>(a: T[]) => { let i = 0; return () => a[Math.min(i++, a.length - 1)] }
  const nextStatus = seq(script.status ?? [rep('waiting', 'No page is waiting for OCR.', status(null, { papers: 0, pages: 0 }))])
  const nextList = seq(script.list ?? [rep('waiting', 'No draft on file.', null)])
  const client: PyqClient = {
    ocrStatus: async () => { calls.push('status'); return nextStatus() },
    ocrStart: async (id, pages) => { calls.push(`start:${id}:${pages?.join(',') ?? ''}`); return script.start ?? rep('live', 'Reading page 1 of 2.', status(job())) },
    ocrStop: async () => { calls.push('stop'); return script.stop ?? rep('waiting', 'Stopping after the page being read.', status(job())) },
    draftsMake: async (req) => { calls.push(`make:${JSON.stringify(req)}`); return script.make ?? rep('waiting', 'The local model is not running.', null) },
    draftsList: async () => { calls.push('list'); return nextList() },
    draftsDecide: async (id, p) => { calls.push(`decide:${id}:${JSON.stringify(p)}`); return script.decide ? script.decide(id, p) : rep('fault', 'not scripted', null) },
    abortAll: () => undefined,
  }
  return { client, calls }
}

describe('waitingPages', () => {
  it('reads the pages with no text layer from the fault lines and ignores the other lines', () => {
    expect(waitingPages(SCAN.faults)).toEqual([3, 4])
    expect(waitingPages(['p. 6: read at confidence 0.71, below 0.85; left as a picture', 'OCR found no text on this page'])).toEqual([])
    expect(waitingPages(undefined)).toEqual([])
  })
})

describe('OCR panel', () => {
  it('a scanned paper shows its fault lines, the confidence line of a page under the gate, and the Read with OCR key', async () => {
    const f = fake()
    m = mount(<OcrPanel client={f.client} paper={SCAN} />)
    await flush(0)
    // the pages with no text layer are one line beside the key, with their numbers; every other line is printed as the engine wrote it
    expect(text()).toContain('2 pages have no text layer: 3, 4.')
    expect(text()).toContain('p. 6: read at confidence 0.71, below 0.85; left as a picture')
    expect(byText('button', 'Read with OCR')).toBeTruthy()
    // the key comes before the lines
    expect(q('.pp-ocr')!.firstElementChild!.className).toBe('pp-ocr-act')
  })
  it('a paper with nothing to read and no job draws nothing', async () => {
    const f = fake()
    m = mount(<OcrPanel client={f.client} paper={{ ...SCAN, faults: [] }} />)
    await flush(0)
    expect(q('[data-component="ocr-panel"]')).toBeNull()
  })
  it('the key starts R-48 for this paper; the running job shows page N of M, pages read, pages under the gate, seconds per page and a Stop key', async () => {
    const running = job({ pagesDone: 1, pageNow: 4, pagesRead: 1, pagesBelowGate: 0, secondsPerPage: 13.8 })
    const f = fake({ start: rep('live', 'Reading page 2 of 2.', status(running)), status: [rep('waiting', '1 paper has 2 pages with no text layer.', status(null))] })
    m = mount(<OcrPanel client={f.client} paper={SCAN} />)
    await flush(0)
    await click(byText('button', 'Read with OCR'))
    expect(f.calls).toContain('start:p-scan:')
    expect(text()).toContain('Reading page 2 of 2')
    expect(text()).toContain('Pages read1 of 2')
    expect(text()).toContain('Below the 0.85 gate0')
    expect(text()).toContain('Time per page13.8 s')
    expect(text()).toContain('Paper page4')
    expect(byText('button', 'Stop')).toBeTruthy()
    expect(byText('button', 'Read with OCR')).toBeUndefined()
  })
  it('polls R-28 about every 2.5 s only while the job runs, then says Done with the counts and asks for the paper to be read again', async () => {
    const onFinished = vi.fn()
    const running = rep('live', 'Reading page 1 of 2.', status(job()))
    const done = rep('live', 'Read 1 of 2 pages: 4 drafts to review; 1 page was below 0.85 and is left as a picture.', status(job({ status: 'done', pagesDone: 2, pagesRead: 1, pagesBelowGate: 1, questions: 4, secondsPerPage: 14.1, pageNow: null, finished: '2026-11-27T10:01:00' })))
    const f = fake({ status: [running, running, done] })
    m = mount(<OcrPanel client={f.client} paper={SCAN} onFinished={onFinished} />)
    await flush(0)
    expect(f.calls.filter((c) => c === 'status')).toHaveLength(1)
    await flush(2400)
    expect(f.calls.filter((c) => c === 'status')).toHaveLength(1)
    await flush(200)
    expect(f.calls.filter((c) => c === 'status')).toHaveLength(2)
    expect(onFinished).not.toHaveBeenCalled()
    await flush(2600)
    expect(f.calls.filter((c) => c === 'status')).toHaveLength(3)
    expect(text()).toContain('Done')
    expect(text()).toContain('Pages read1 of 2')
    expect(text()).toContain('Below the 0.85 gate1')
    expect(text()).toContain('Drafts to review4')
    expect(text()).toContain('Read by OCR, check it')
    expect(onFinished).toHaveBeenCalledTimes(1)
    await flush(20_000)
    expect(f.calls.filter((c) => c === 'status')).toHaveLength(3)
    expect(onFinished).toHaveBeenCalledTimes(1)
  })
  it('a job that was already finished when the panel opened is shown but does not trigger a re-read', async () => {
    const onFinished = vi.fn()
    const f = fake({ status: [rep('live', 'Read 2 of 2 pages: 5 drafts to review.', status(job({ status: 'done', pagesDone: 2, pagesRead: 2, questions: 5 })))] })
    m = mount(<OcrPanel client={f.client} paper={SCAN} onFinished={onFinished} />)
    await flush(5000)
    expect(text()).toContain('Done')
    expect(onFinished).not.toHaveBeenCalled()
    expect(f.calls.filter((c) => c === 'status')).toHaveLength(1)
  })
  it('Stopped and Failed are named as the engine ended the job', async () => {
    for (const [st, word] of [['stopped', 'Stopped'], ['failed', 'Failed']] as const) {
      const f = fake({ status: [rep(st === 'failed' ? 'fault' : 'live', st === 'failed' ? 'The OCR engine stopped with an error.' : 'Read 1 of 3 pages: 2 drafts to review; stopped before the end.', status(job({ status: st, pagesTotal: 3, pagesDone: 1, pagesRead: 1, questions: 2 })))] })
      m = mount(<OcrPanel client={f.client} paper={SCAN} />)
      await flush(0)
      expect(q('.pp-ocr-head')?.textContent).toBe(word)
      m.unmount(); m = null
    }
  })
  it('Stop asks R-49 and shows the engine\'s own "Stopping after the page being read."', async () => {
    const f = fake({ status: [rep('live', 'Reading page 1 of 2.', status(job()))] })
    m = mount(<OcrPanel client={f.client} paper={SCAN} />)
    await flush(0)
    await click(byText('button', 'Stop'))
    expect(f.calls).toContain('stop')
    expect(text()).toContain('Stopping after the page being read.')
  })
  it('a 409 shows the engine\'s sentence and starts nothing', async () => {
    const f = fake({ start: rep('waiting', 'The paper desk is reading files; start OCR when it has finished.', null) })
    m = mount(<OcrPanel client={f.client} paper={SCAN} />)
    await flush(0)
    await click(byText('button', 'Read with OCR'))
    expect(text()).toContain('The paper desk is reading files; start OCR when it has finished.')
    expect(q('.pp-ocr-job')).toBeNull()
  })
  it('a job reading another paper is named, and this paper\'s key says why it waits', async () => {
    const f = fake({ status: [rep('live', 'Reading page 1 of 2.', status(job({ paperId: 'p-other' })))] })
    m = mount(<OcrPanel client={f.client} paper={SCAN} />)
    await flush(0)
    expect(text()).toContain('Another paper is being read')
    expect(text()).toContain('OCR is reading another paper.')
    expect(byText('button', 'Stop')).toBeUndefined()
  })
  it('polling stops when the panel unmounts', async () => {
    const f = fake({ status: [rep('live', 'Reading page 1 of 2.', status(job()))] })
    m = mount(<OcrPanel client={f.client} paper={SCAN} />)
    await flush(0)
    await flush(2600)
    const n = f.calls.filter((c) => c === 'status').length
    expect(n).toBeGreaterThanOrEqual(2)
    m.unmount(); m = null
    await flush(30_000)
    expect(f.calls.filter((c) => c === 'status')).toHaveLength(n)
  })
})

const DRAFT: DraftRow = {
  id: 'd-1', subject: 'signals', unit: 2, topic: 'Sampling', text: 'State the sampling theorem and one condition it needs.', marks: null, status: 'pending', origin: 'model-draft',
  sources: [{ fileId: 'f-1', title: 'Signals Studio notes 2' }, { fileId: 'f-2', title: 'Signals Studio notes 5' }], copied: false, similarity: 0.31, made: '2026-11-27T10:05:00', reason: '', questionId: null, edited: false,
}

describe('drafts panel', () => {
  const open = (f: ReturnType<typeof fake>, extra: Partial<Parameters<typeof DraftsPanel>[0]> = {}) => { m = mount(<DraftsPanel client={f.client} subject="signals" defaultOpen {...extra} />) }

  it('the checks read as plain words with the engine\'s numbers', () => {
    expect(checksText({ copied: false, similarity: 0.31 })).toBe('Copied from the notes: no; similarity 0.31')
    expect(checksText({ copied: true, similarity: 0.82 })).toBe('Copied from the notes: yes; similarity 0.82')
    expect(checksText({ copied: null, similarity: null })).toBe('Copied from the notes: not reported')
  })
  it('the Draft key waits for a topic and says so; with one it asks R-50 with only what was set', async () => {
    const f = fake()
    open(f)
    await flush(0)
    expect(text()).toContain('Say which topic first.')
    await type(q('input[list]'), 'Sampling')
    await type(q('select'), '2')
    await click(byText('button', 'Draft'))
    expect(f.calls.find((c) => c.startsWith('make:'))).toBe('make:{"subject":"signals","topic":"Sampling","count":2}')
  })
  it('waiting and planned answers show the engine\'s sentence and no draft', async () => {
    for (const [state, reason] of [['waiting', 'The local model is not running.'], ['planned', 'Drafting is off: rules only.']] as const) {
      const f = fake({ make: rep(state, reason, null) })
      open(f)
      await flush(0)
      await type(q('input[list]'), 'Sampling')
      await click(byText('button', 'Draft'))
      expect(text()).toContain(reason)
      expect(q('.pp-draft')).toBeNull()
      m!.unmount(); m = null
    }
  })
  it('a pending draft is labelled as written by the model and not checked, with its notes, its checks and no claim of being verified', async () => {
    const f = fake({ list: [rep('live', '1 draft is waiting for your review.', [DRAFT])] })
    open(f)
    await flush(0)
    const card = q('.pp-draft')!
    expect(card.dataset.status).toBe('pending')
    expect(card.textContent).toContain('written by the local model, not checked')
    expect(card.textContent).toContain('Signals Studio notes 2; Signals Studio notes 5')
    expect(card.textContent).toContain('Copied from the notes: no; similarity 0.31')
    expect(card.textContent).toContain('Sampling, unit 2')
    expect(text()).toContain('1 draft is waiting for your review.')
    expect(text()).not.toMatch(/(?<!un)verified/i)
    for (const k of ['Accept', 'Edit then accept', 'Reject']) expect(byText('button', k), k).toBeTruthy()
  })
  it('Accept needs marks, then sends only the status and the marks, and the card still says the model wrote it', async () => {
    const onAccepted = vi.fn()
    const f = fake({ list: [rep('live', '', [DRAFT])], decide: (id) => rep('live', 'Accepted.', { ...DRAFT, id, status: 'accepted', marks: 5, questionId: 'q-9' }) })
    open(f, { onAccepted })
    await flush(0)
    await click(byText('button', 'Accept'))
    expect(f.calls.some((c) => c.startsWith('decide:'))).toBe(false)
    expect(text()).toContain('Set the marks first.')
    await type(q('.pp-draft input[type="number"]'), '5')
    await click(byText('button', 'Accept'))
    expect(f.calls.find((c) => c.startsWith('decide:'))).toBe('decide:d-1:{"status":"accepted","marks":5}')
    const card = q('.pp-draft')!
    expect(card.dataset.status).toBe('accepted')
    expect(card.textContent).toContain('Accepted by you')
    expect(card.textContent).toContain('still says the local model wrote it')
    expect(card.textContent).not.toMatch(/(?<!un)verified/i)
    expect(onAccepted).toHaveBeenCalledTimes(1)
  })
  it('Edit then accept sends the edited text; Reject sends only the status', async () => {
    const f = fake({ list: [rep('live', '', [{ ...DRAFT, marks: 4 }])], decide: (id, p) => rep('live', 'ok', { ...DRAFT, id, status: p.status, marks: 4, edited: !!p.text }) })
    open(f)
    await flush(0)
    await click(byText('button', 'Edit then accept'))
    await type(q('.pp-draft textarea'), 'State the sampling theorem.')
    await click(byText('button', 'Accept edited'))
    expect(f.calls.find((c) => c.startsWith('decide:'))).toBe('decide:d-1:{"status":"accepted","marks":4,"text":"State the sampling theorem."}')
    m!.unmount(); m = null
    const g = fake({ list: [rep('live', '', [DRAFT])], decide: (id, p) => rep('live', 'ok', { ...DRAFT, id, status: p.status }) })
    open(g)
    await flush(0)
    await click(byText('button', 'Reject'))
    expect(g.calls.find((c) => c.startsWith('decide:'))).toBe('decide:d-1:{"status":"rejected"}')
    expect(q('.pp-draft')!.textContent).toContain('Rejected')
  })
  it('a draft the engine stored as rejected shows its reason and offers no key', async () => {
    const f = fake({ list: [rep('live', '', [{ ...DRAFT, status: 'rejected', reason: 'it copies its passage', copied: true, similarity: 0.82 }])] })
    open(f)
    await flush(0)
    expect(q('.pp-draft')!.textContent).toContain('Rejected: it copies its passage')
    expect(q('.pp-draft')!.textContent).toContain('Copied from the notes: yes; similarity 0.82')
    expect(byText('button', 'Accept')).toBeUndefined()
  })
})

describe('the desk wires both panels and the Word types', () => {
  const FIXDATA: DeskData = { ...EMPTY_DATA, state: 'live', reason: '', papers: [SCAN], lastRun: NOW }
  it('choosing a scanned paper shows the OCR key; the drafts fold is there before any paper is chosen; the import accepts Word', async () => {
    const f = fake()
    m = mount(<PaperDesk data={FIXDATA} client={f.client} classic={false} now={NOW} />)
    await flush(0)
    expect(q('[data-component="drafts-panel"]')).toBeTruthy()
    expect(byText('button', 'Draft questions from my notes')).toBeTruthy()
    expect(q('input[type="file"]')!.getAttribute('accept')).toMatch(/\.docx.*\.doc|\.doc.*\.docx/)
    expect(q('[data-component="ocr-panel"]')).toBeNull()
    await click(q('.pp-paper'))
    expect(byText('button', 'Read with OCR')).toBeTruthy()
  })
})

describe('what OCR returns is never shown as verified', () => {
  const ocrQ = (over: Partial<QuestionRow> = {}): QuestionRow => ({
    id: 'q-ocr', paperId: 'p-scan', number: 'Q2', year: 2024, topicId: '', type: 'short', marks: null, share: null, tag: 'RULE', margin: 0, status: 'pending',
    stem: 'Invented recognised words of a question.', crop: { img: fixtureCrop(3), textStatus: 'unverified', text: 'Invented recognised words of a question.' }, ocrConfidence: 0.91, ...over,
  })
  it('the crop card says read by OCR, check it, with the engine confidence and the state word, and keeps the text unverified', () => {
    m = mount(<CropCard img={fixtureCrop(1)} text="Invented words." textStatus="unverified" ocr={{ confidence: 0.91 }} />)
    expect(text()).toContain('Read by OCR, check it.')
    expect(text()).toContain('OCR confidence 0.91, text unverified.')
    expect(text()).toContain('TEXT unverified')
    expect(text()).not.toMatch(/(?<!un)verified/i)
  })
  it('a whole-page draft is labelled as a page to split by hand', () => {
    m = mount(<CropCard img={fixtureCrop(1)} text="Invented words of a page." textStatus="unverified" ocr={{ confidence: 0.95, wholePage: true }} />)
    expect(text()).toContain('A whole page: no question start was found, so split it by hand.')
  })
  it('a picture-only question shows its crop and says no text was read, not an empty text box', () => {
    m = mount(<CropCard img={fixtureCrop(2)} textStatus="crop-only" />)
    expect(q('.rv-crop-img img')).toBeTruthy()
    expect(q('.rv-crop-body')!.textContent).toBe('No text was read. The crop is all there is.')
    expect(m.container.querySelectorAll('textarea')).toHaveLength(0)
  })
  it('the Review Desk carries the confidence and the whole-page flag from the question to its card', () => {
    m = mount(<ReviewDesk modal questions={[ocrQ({ number: 'p3', wholePage: true, ocrConfidence: 0.95 }), ocrQ({ id: 'q-pic', number: 'Q5', stem: '', ocrConfidence: undefined, crop: { img: fixtureCrop(4), textStatus: 'crop-only' } })]} topics={[]} events={[]} state="live" reason="" onDecide={() => undefined} onClose={() => undefined} />)
    expect(text()).toContain('Read by OCR, check it.')
    expect(text()).toContain('OCR confidence 0.95')
    expect(text()).toContain('split it by hand')
  })
})
