/**
 * The study library panel: the pure helpers, then the real component rendered in
 * happy-dom against a stubbed /api/library (no server, no model).
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  answerTone, citeNumbers, docSummary, jobFraction, jobSummary, markTerms, splitCitations,
  type LibraryAnswer, type LibraryDoc, type LibraryView,
} from '../lib/library'

describe('citations', () => {
  it('splits an answer into text and chips, in order', () => {
    const s = splitCitations('Pin 7 is ground [1]. Pin 14 is Vcc [1][2].')
    expect(s.map((x) => (x.kind === 'cite' ? x.ns : x.text))).toEqual(['Pin 7 is ground ', [1], '. Pin 14 is Vcc ', [1], [2], '.'])
  })

  it('reads lists and ranges the way the server does', () => {
    expect(citeNumbers('1, 3')).toEqual([1, 3])
    expect(citeNumbers('2-4')).toEqual([2, 3, 4])
    expect(citeNumbers('2–3')).toEqual([2, 3])
    expect(citeNumbers('1 and 5')).toEqual([1, 5])
    expect(splitCitations('No citations here, and a[i] is code.')).toEqual([{ kind: 'text', text: 'No citations here, and a[i] is code.' }])
  })
})

const doc = (over: Partial<LibraryDoc> = {}): LibraryDoc => ({
  doc_id: '0123456789abcdef', file: 'DE_L4_Sequential.pdf', path: 'D:\\Notes\\DE_L4_Sequential.pdf', kind: 'pdf',
  title: 'Sequential circuits', pages: 5, chunks: 6, words: 900, scanned: [], blank: [], ocr: [], notes: [],
  embedder: 'BAAI/bge-small-en-v1.5', added: '', updated: '', ...over,
})

describe('documents and jobs', () => {
  it('says what JARVIS really holds, scanned pages included', () => {
    expect(docSummary(doc())).toBe('5 pages · 6 passages')
    expect(docSummary(doc({ scanned: [4], chunks: 1 }))).toBe('5 pages · 1 passage · 1 scanned, not read')
    expect(docSummary(doc({ kind: 'pptx', pages: 1 }))).toBe('1 slide · 6 passages')
    expect(docSummary(doc({ kind: 'md', pages: 0, chunks: 4 }))).toBe('4 passages')
  })

  it('reports ingest progress and results', () => {
    expect(jobFraction({ state: 'running', done: 3, total: 12 })).toBe(0.25)
    expect(jobFraction({ state: 'running', done: 0, total: null })).toBe(0)
    expect(jobSummary({ state: 'done', counts: { added: 7, updated: 2, unchanged: 3, skipped: 1 } }))
      .toBe('9 new or changed · 3 unchanged · 1 not read')
    expect(jobSummary({ state: 'done', counts: {} })).toBe('nothing to read there')
  })

  it('marks the question words worth highlighting', () => {
    expect(markTerms('What is the difference between setup time and hold time?')).toEqual(['setup', 'time', 'hold'])
  })
})

const source = (n: number, file: string, loc: string, text: string) => ({
  n, id: `abc:${n}`, doc_id: 'abc', file, kind: 'pdf', page: n, loc, heading: '', text, path: `D:\\Notes\\${file}`,
  title: null, distance: 0.2, bm25_rank: n, vector_rank: n,
})

const answer = (over: Partial<LibraryAnswer> = {}): LibraryAnswer => ({
  question: 'What is the difference between setup time and hold time?',
  answer: 'Setup time is how long data must be stable before the clock edge [1]. Hold time is after it [1][2].',
  abstained: false, reason: '', used: [1, 2], invalid: [], uncited: false,
  sources: [source(1, 'DE_L4_Sequential.pdf', 'p. 3', 'Setup time is the minimum time for which the data input must be held stable before the active clock edge.'),
            source(2, 'DE_L4_Sequential.pdf', 'p. 6', 'Clock skew eats into the hold margin.')],
  mode: 'hybrid', llm: 'qwen3:4b-instruct-2507-q4_K_M', took_ms: 2400, retrieval_ms: 40, best_distance: 0.22, coverage: 1,
  ...over,
})

describe('answer tone is provenance', () => {
  it('cyan only when every citation is real', () => {
    expect(answerTone(answer())).toBe('live')
    expect(answerTone(answer({ used: [], uncited: true }))).toBe('sim')
    expect(answerTone(answer({ invalid: [9] }))).toBe('fault')
    expect(answerTone(answer({ answer: null, used: [], llm_error: 'local model unreachable' }))).toBe('fault')
    expect(answerTone(answer({ abstained: true, used: [] }))).toBe('quiet')
  })
})

/* ------------------------------------------------------------------ the component */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const VIEW: LibraryView = {
  root: 'X:\\library', documents: 2, chunks: 9, pages: 5, scanned_pages: 1, mode: 'hybrid', ocr: false,
  embedder: { name: 'BAAI/bge-small-en-v1.5', ready: true, error: null },
  docs: [doc({ scanned: [5], notes: ['1 scanned page(s) not read: OCR not available (no local Tesseract)'] }),
         doc({ doc_id: 'fedcba9876543210', file: 'Lab_Manual.docx', kind: 'docx', pages: 0, chunks: 3 })],
  job: { state: 'idle' },
}

let routes: Record<string, unknown>
const calls: { url: string; method: string; body?: unknown }[] = []
vi.stubGlobal('fetch', async (url: string, init?: { method?: string; body?: string }) => {
  const method = init?.method ?? 'GET'
  calls.push({ url, method, body: init?.body ? JSON.parse(init.body) : undefined })
  const res = routes[`${method} ${url.split('?')[0]}`]
  if (res === undefined) return new Response(JSON.stringify({ detail: 'not stubbed' }), { status: 404 })
  return new Response(JSON.stringify(res), { status: 200, headers: { 'Content-Type': 'application/json' } })
})

const { LibraryPanel } = await import('../components/LibraryPanel')

let host: HTMLDivElement
let root: Root
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() }) }

async function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(createElement(LibraryPanel)) })
  await flush()
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('LibraryPanel', () => {
  beforeEach(() => {
    calls.length = 0
    routes = { 'GET /api/library': VIEW }
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('lists the documents with what was and was not read', async () => {
    await mount()
    const text = host.textContent ?? ''
    expect(text).toContain('DE_L4_Sequential.pdf')
    expect(text).toContain('Lab_Manual.docx')
    expect(text).toContain('5 pages · 6 passages · 1 scanned, not read')
    expect(host.querySelector('.lib-doc .pill.sim')?.textContent).toBe('scanned')       // amber, on the row
    expect(host.querySelector('.lib-stats .sim')?.textContent).toContain('scanned, unread')
    expect(host.querySelector('.card-head .pill.live')?.textContent).toBe('hybrid · offline')
    expect(host.querySelectorAll('.lib-doc.rise').length).toBe(2)
  })

  it('asks, shows clickable citations, and opens the cited passage', async () => {
    routes['POST /api/library/ask'] = answer()
    await mount()
    const input = host.querySelector('input[name=q]') as HTMLInputElement
    await act(async () => { type(input, 'What is the difference between setup time and hold time?') })
    await act(async () => { host.querySelector('.lib-ask')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await flush()
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ question: 'What is the difference between setup time and hold time?' })
    const chips = [...host.querySelectorAll('button.cite')].map((b) => b.textContent)
    expect(chips).toEqual(['1', '1', '2'])
    expect(host.querySelector('.lib-answer.tone-live')).not.toBeNull()
    // The first cited passage opens by itself, with its file, page and path.
    expect(host.querySelector('.lib-quote')?.textContent).toContain('[1] DE_L4_Sequential.pdf · p. 3')
    expect(host.querySelector('.lib-quote mark')?.textContent?.toLowerCase()).toBe('setup')
    await act(async () => { (host.querySelectorAll('button.cite')[2] as HTMLButtonElement).click() })
    expect(host.querySelector('.lib-quote')?.textContent).toContain('[2] DE_L4_Sequential.pdf · p. 6')
  })

  it('shows the caveat when the model cited and also said the notes fall short', async () => {
    routes['POST /api/library/ask'] = answer({ caveat: 'The model also said your notes do not fully cover this question.' })
    await mount()
    await act(async () => { type(host.querySelector('input[name=q]') as HTMLInputElement, 'setup time aur hold time mein kya farak hai?') })
    await act(async () => { host.querySelector('.lib-ask')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await flush()
    expect(host.querySelector('.lib-answer.tone-live')).not.toBeNull()
    expect(host.querySelector('.lib-caveat.sim')?.textContent).toContain('do not fully cover')
  })

  it('says "not in your notes" quietly, with no citations', async () => {
    routes['POST /api/library/ask'] = answer({ answer: "I don't know — your notes don't cover that.", abstained: true, used: [],
      reason: 'closest passage is too far (distance 0.59 > 0.4)', llm: null })
    await mount()
    await act(async () => { type(host.querySelector('input[name=q]') as HTMLInputElement, 'Who won the 2011 world cup?') })
    await act(async () => { host.querySelector('.lib-ask')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await flush()
    expect(host.querySelector('.lib-answer.tone-quiet')).not.toBeNull()
    expect(host.textContent).toContain('not in your notes')
    expect(host.textContent).toContain('Closest passages — not enough to answer')
    expect(host.querySelectorAll('button.cite').length).toBe(0)
  })

  it('shows a scanning skeleton and progress while notes are being read', async () => {
    routes['GET /api/library'] = { ...VIEW, job: { state: 'running', path: 'D:\\Notes', done: 3, total: 12, current: 'DE_L2.pdf' } }
    await mount()
    expect(host.querySelectorAll('.lib-job .skeleton.scan').length).toBe(3)
    expect(host.querySelector('.lib-job-line')?.textContent).toContain('Reading DE_L2.pdf')
    expect((host.querySelector('.lib-job .meter > i') as HTMLElement).style.width).toBe('25%')
    expect((host.querySelector('.lib-add button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('an empty library explains itself and cannot be asked', async () => {
    routes['GET /api/library'] = { ...VIEW, documents: 0, chunks: 0, pages: 0, scanned_pages: 0, docs: [], mode: 'keyword-only' }
    await mount()
    expect(host.textContent).toContain('No notes yet')
    expect((host.querySelector('input[name=q]') as HTMLInputElement).disabled).toBe(true)
    expect(host.querySelector('.card-head .pill.sim')?.textContent).toBe('keywords only')
  })

  it('adds a path and forgets a document only on the second click', async () => {
    routes['POST /api/library/ingest'] = { state: 'running', path: 'D:\\Notes', done: 0, total: null, current: null }
    routes['DELETE /api/library/doc/0123456789abcdef'] = { ok: true }
    await mount()
    await act(async () => { type(host.querySelector('input[name=path]') as HTMLInputElement, 'D:\\Notes') })
    await act(async () => { host.querySelector('.lib-add')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await flush()
    expect(calls.find((c) => c.url === '/api/library/ingest')?.body).toEqual({ path: 'D:\\Notes' })
    const forget = host.querySelector('button[aria-label="Forget DE_L4_Sequential.pdf"]') as HTMLButtonElement
    await act(async () => { forget.click() })
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    expect(forget.textContent).toBe('Forget?')
    await act(async () => { forget.click() })
    await flush()
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/library/doc/0123456789abcdef')).toBe(true)
  })
})
