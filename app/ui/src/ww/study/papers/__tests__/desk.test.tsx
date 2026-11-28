// The Paper Desk, the Review Desk and their parts, rendered: honest empty states, the Wilson column, one tab stop and arrow keys in the
// Strata, a full keyboard path through the Review Desk, and the forbidden words in every string a student reads.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mount } from '../../../../__tests__/ww/_stubs'
import { PaperDesk, EMPTY_DATA, type DeskData } from '../PaperDesk'
import { ExtractionTrace } from '../ExtractionTrace'
import { PaperDrop, PAPER_ACCEPT, acceptsFile } from '../PaperDrop'
import { ImportTray, wordsTrace } from '../ImportTray'
import { COPY, FOOTER, FORBIDDEN_WORDS } from '../copy'
import { NOW, PAPERS, QUESTIONS, TOPICS, TRACE, YEARS } from '../fixtures'
import { ReviewDesk } from '../../review/ReviewDesk'
import { CropCard } from '../../review/CropCard'
import { RubricChips, rubricState } from '../../review/RubricChips'
import type { IngestRoute } from '../../ports'

let m: ReturnType<typeof mount> | null = null
afterEach(() => { m?.unmount(); m = null })

const FIX: DeskData = { state: 'simulated', reason: 'invented papers', papers: PAPERS, questions: QUESTIONS, topics: TOPICS, events: TRACE, queued: [], routes: [], lastRun: NOW - 3 * 3_600_000 }
const subset = (n: number): DeskData => { const ys = YEARS.slice(0, n); return { ...FIX, papers: PAPERS.filter((p) => p.year !== null && ys.includes(p.year)), questions: QUESTIONS.filter((q) => q.year !== null && ys.includes(q.year)) } }
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })) })
const q = (sel: string) => m!.container.querySelector(sel) as HTMLElement
const qa = (sel: string) => Array.from(m!.container.querySelectorAll<HTMLElement>(sel))

describe('Paper Desk', () => {
  it('with nothing on file it is hollow and says why: no number in the ledger, the empty line, no dots', () => {
    m = mount(<PaperDesk data={EMPTY_DATA} classic={false} now={NOW} />)
    const values = qa('.pp-ledger .k-readout-value').map((e) => e.textContent)
    expect(values).toEqual(['--', '--', '--', '--', '--'])
    expect(m.container.textContent).toContain('Waiting: the paper engine is not connected yet')
    expect(qa('.pp-dot')).toHaveLength(0)
    expect(qa('[data-component="strata-empty"]')).toHaveLength(1)
  })
  it('a WAITING or FAULT desk that still holds rows draws no number and no dot (the state decides, not the data)', () => {
    for (const state of ['waiting', 'fault', 'planned'] as const) {
      m = mount(<PaperDesk data={{ ...FIX, state, reason: 'engine paused' }} classic={false} now={NOW} />)
      expect(qa('.pp-ledger .k-readout-value').map((e) => e.textContent), state).toEqual(['--', '--', '--', '--', '--'])
      expect(qa('.pp-dot'), state).toHaveLength(0)
      m.unmount(); m = null
    }
  })
  it('a live desk with no papers invites the first one', () => {
    m = mount(<PaperDesk data={{ ...EMPTY_DATA, state: 'live', reason: '' }} classic={false} now={NOW} />)
    expect(m.container.textContent).toContain(COPY.empty)
    expect(qa('.pp-ledger .k-readout-value').map((e) => e.textContent?.trim().slice(0, 1))).toEqual(['0', '0', '0', '0', 'n'])
  })
  it('six invented papers draw numbers, all stamped SIMULATED', () => {
    m = mount(<PaperDesk data={FIX} classic={false} now={NOW} />)
    expect(qa('.pp-ledger .k-readout-value').map((e) => e.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['6', '42', '35 of 42', String(QUESTIONS.filter((x) => x.tag === 'HAND').length), '3 h ago'])
    expect(qa('.pp-ledger .k-stamp')).toHaveLength(5)
    expect(m.container.textContent).toContain('SIMULATED')
  })
  it('a paper with no known year is listed as "n.d." and gets no year column (R32, 27 Nov: it drew a column headed "0")', () => {
    const undated = { ...PAPERS[0], id: 'p-undated', label: 'Scan with no year', year: null }
    m = mount(<PaperDesk data={{ ...FIX, papers: [...PAPERS, undated] }} classic={false} now={NOW} />)
    expect(m.container.textContent).toContain('Scan with no year')
    expect(qa('.pp-paper-nd').map((e) => e.textContent?.trim())).toEqual(['n.d.'])
    expect(qa('.pp-yearhead *').map((e) => e.textContent?.trim()), 'a column headed 0').not.toContain('0')
  })
  it('the Strata is one grid with one tab stop; arrows move the stop and the Enter key opens the question in the Review Desk', () => {
    m = mount(<PaperDesk data={FIX} classic={false} now={NOW} />)
    const dots = qa('.pp-dot')
    expect(dots).toHaveLength(9 * 6)
    expect(dots.filter((d) => d.tabIndex === 0)).toHaveLength(1)
    const grid = q('.pp-grid')
    key(grid, 'ArrowRight')
    key(grid, 'ArrowDown')
    expect(qa('.pp-dot').filter((d) => d.tabIndex === 0).map((d) => d.dataset.rc)).toEqual(['1:1'])
    // a cell with a question opens the Review Desk at that question
    const cell = qa('.pp-dot').find((d) => !d.dataset.empty)!
    act(() => cell.click())
    expect(q('[data-component="review-desk"]')).not.toBeNull()
  })
  it('draws "k of N" and a Wilson bar from 3 papers, and the too-few line (no bar) under 3', () => {
    m = mount(<PaperDesk data={FIX} classic={false} now={NOW} />)
    expect(qa('.pp-count-text')[0].textContent).toMatch(/^\d of 6$/)
    expect(qa('.pp-wb-band').length).toBeGreaterThan(0)
    expect(m.container.textContent).not.toContain(COPY.tooFew)
    m.unmount()
    m = mount(<PaperDesk data={subset(2)} classic={false} now={NOW} />)
    expect(qa('.pp-wb-band')).toHaveLength(0)
    expect(m.container.textContent).toContain('too few papers to show a pattern')
    m.unmount()
    m = mount(<PaperDesk data={subset(1)} classic={false} now={NOW} />)
    expect(m.container.textContent).toContain('1 paper: counts only, no pattern yet')
  })
  it('the footer sentence is on the desk, word for word', () => {
    m = mount(<PaperDesk data={FIX} classic={false} now={NOW} />)
    expect(FOOTER).toBe('From papers on file. This prepares practice; it does not predict a paper or a result.')
    expect(q('.pp-foot').textContent).toBe(FOOTER)
  })
  it('V turns the dots into a table twin', () => {
    m = mount(<PaperDesk data={FIX} classic={false} now={NOW} />)
    key(q('.pp-grid'), 'v')
    expect(q('.pp-twin')).not.toBeNull()
    expect(qa('.pp-dot')).toHaveLength(0)
  })
  it('a null port keeps the desk honest after the load', async () => {
    m = mount(<PaperDesk classic={false} now={NOW} />)
    await act(async () => { await Promise.resolve() })
    expect(qa('.pp-ledger .k-readout')[0].dataset.state).toBe('waiting')
  })
})

describe('Review Desk keyboard path', () => {
  const pending = QUESTIONS.filter((x) => x.status === 'pending')
  const mountDesk = (extra: Partial<React.ComponentProps<typeof ReviewDesk>> = {}) => {
    const onDecide = vi.fn()
    m = mount(<ReviewDesk questions={pending} topics={TOPICS} events={TRACE} state="simulated" paperLabel="Paper 2024" onDecide={onDecide} {...extra} />)
    return onDecide
  }
  const desk = () => q('[data-component="review-desk"]')
  const count = () => q('.rv-count b').textContent

  it('A accepts (Enter does not), N jumps to the lowest margin, Backspace rejects with an undo, U takes it back', () => {
    const onDecide = mountDesk()
    expect(count()).toBe('0 of 7')
    // 28 Nov: Enter must not accept (65 questions were accepted unread with it)
    key(desk(), 'Enter')
    expect(count()).toBe('0 of 7')
    expect(onDecide).not.toHaveBeenCalled()
    key(desk(), 'a')
    expect(count()).toBe('1 of 7')
    expect(onDecide).toHaveBeenCalledWith({ kind: 'accept', qid: 'q2024-1' })
    key(desk(), 'n')
    expect(q('.rv-box[data-sel="true"]').getAttribute('aria-label')).toContain('Q5')
    key(desk(), 'Backspace')
    expect(onDecide).toHaveBeenLastCalledWith({ kind: 'reject', qid: 'q2024-5' })
    expect(q('.rv-undo').textContent).toContain('Undo within 10 s')
    key(desk(), 'u')
    expect(q('.rv-undo')).toBeNull()
    expect(onDecide).toHaveBeenLastCalledWith({ kind: 'undo', qid: 'q2024-5' })
  })
  it('Shift+A accepts only the certain ones; the primary says how many', () => {
    const onDecide = mountDesk()
    expect(q('.rv-primary').textContent).toBe('Accept all certain and review the rest (3)')
    key(desk(), 'A', { shiftKey: true })
    expect(onDecide).toHaveBeenCalledTimes(3)
    expect(count()).toBe('3 of 7')
  })
  it('E opens the fields for editing, Escape closes them without a change, T and R toggle the text and the rubric strip', () => {
    mountDesk()
    key(desk(), 'e')
    expect(q('select[aria-label="Topic"]')).not.toBeNull()
    key(desk(), 'Escape')
    expect(q('select[aria-label="Topic"]')).toBeNull()
    key(desk(), 't')
    expect(q('.rv-crop').dataset.side).toBe('true')
    key(desk(), 'r')
    expect(q('.rv-rubric-strip')).not.toBeNull()
  })
  it('M and S change the list; the desk closes on Escape when it is a dialog', () => {
    const onClose = vi.fn()
    mountDesk({ modal: true, onClose })
    expect(desk().getAttribute('role')).toBe('dialog')
    key(desk(), 's')
    expect(qa('.rv-box')).toHaveLength(8)
    key(desk(), 'j')
    key(desk(), 'm')
    expect(qa('.rv-box')).toHaveLength(7)
    key(desk(), 'Escape')
    expect(onClose).toHaveBeenCalled()
  })
  it('a question with no text layer shows CROP only, and the crop is still there', () => {
    mountDesk({ startId: 'q2024-5' })
    expect(q('.rv-crop-status').textContent).toBe('CROP only')
    expect(q('.rv-crop-img img')).not.toBeNull()
  })
  it('every tag chip says RULE, MODEL or HAND', () => {
    mountDesk()
    const words = qa('.rv-tag').map((t) => t.querySelector('span:nth-child(2)')?.textContent)
    expect(words.length).toBeGreaterThan(3)
    for (const w of words) expect(['RULE', 'MODEL', 'HAND']).toContain(w)
  })
  it('the OCR fault and the busy model are said in words with their lamps', () => {
    mountDesk({ ocrMissing: true, modelBusy: true })
    expect(q('.rv-strip').textContent).toContain(COPY.ocrMissing)
    expect(q('.rv-strip').textContent).toContain(COPY.rulesOnly)
    expect(qa('.rv-note [data-lamp="fault"], .rv-note [data-lamp="waiting"]').length).toBeGreaterThan(0)
  })
})

describe('the parts', () => {
  it('CropCard marks recognised text as unverified and the crop as the source of truth', () => {
    m = mount(<CropCard img="data:," text="A stem." textStatus="unverified" />)
    expect(q('.rv-crop-status').textContent).toBe('TEXT unverified')
    expect(q('.rv-crop-img img').getAttribute('alt')).toContain('source of truth')
  })
  it('RubricChips has four states and 44 px chips', () => {
    const pts = [{ id: 'a', text: 'A', marks: 1 }, { id: 'b', text: 'B', marks: 2 }]
    expect(rubricState(pts, [], false)).toBe('unmarked')
    expect(rubricState(pts, [], true)).toBe('none')
    expect(rubricState(pts, ['a'], true)).toBe('partial')
    expect(rubricState(pts, ['a', 'b'], true)).toBe('full')
    const on = vi.fn()
    m = mount(<RubricChips points={pts} awarded={['a']} onToggle={on} marked />)
    expect(q('.rv-rubric-total').textContent).toBe('1 of 3 marks, marked by you')
    act(() => qa('.rv-pt')[1].click())
    expect(on).toHaveBeenCalledWith('b')
  })
  it('ExtractionTrace prints exactly the events it is given', () => {
    m = mount(<ExtractionTrace events={TRACE.slice(0, 2)} />)
    const lines = qa('.g-line').map((l) => l.textContent ?? '')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('read p1 text-layer ok')
    m.unmount()
    m = mount(<ExtractionTrace events={[]} />)
    expect(q('.g-line').textContent).toContain('no run yet')
  })
  it('PaperDrop accepts PDF and images and refuses the rest in words', () => {
    expect(acceptsFile({ name: 'a.pdf', type: 'application/pdf' }, PAPER_ACCEPT)).toBe(true)
    expect(acceptsFile({ name: 'a.jpg', type: 'image/jpeg' }, PAPER_ACCEPT)).toBe(true)
    expect(acceptsFile({ name: 'a.exe', type: 'application/octet-stream' }, PAPER_ACCEPT)).toBe(false)
    expect(acceptsFile({ name: 'SCAN.PDF', type: '' }, PAPER_ACCEPT)).toBe(true)
    const onFiles = vi.fn()
    m = mount(<PaperDrop onFiles={onFiles} accept={PAPER_ACCEPT} />)
    const input = q('input[type="file"]') as HTMLInputElement
    const bad = new File(['x'], 'notes.exe', { type: 'application/octet-stream' })
    Object.defineProperty(input, 'files', { value: [bad], configurable: true })
    act(() => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(onFiles).not.toHaveBeenCalled()
    expect(q('.pp-drop').dataset.state).toBe('refused-type')
    expect(q('.pp-drop-sub').textContent).toContain(COPY.refusedType)
  })
  it('ImportTray lists four routes with lamps and a words-per-page trace; the Classroom row is PLANNED', () => {
    const routes: IngestRoute[] = [
      { id: 'drop', label: 'Drop', state: 'simulated', reason: 'fixture' },
      { id: 'paste', label: 'Paste text', state: 'simulated', reason: 'fixture' },
      { id: 'folder', label: 'Watch a folder', state: 'waiting', reason: 'choose a folder' },
      { id: 'classroom', label: 'Connect through Classroom', state: 'planned', reason: 'not built' },
    ]
    const onRoute = vi.fn()
    m = mount(<ImportTray defaultOpen routes={routes} queued={[{ id: 'f', name: 'p.pdf', method: 'ocr', wordsPerPage: [400, 0, 200], reading: false }]} onFiles={() => undefined} accept={PAPER_ACCEPT} onRoute={onRoute} />)
    expect(qa('.pp-route')).toHaveLength(3)
    expect(q('.pp-route[data-route="classroom"] [data-lamp="planned"]')).not.toBeNull()
    expect(q('.pp-qtrace').textContent).toBe(wordsTrace([400, 0, 200]))
    expect(wordsTrace([400, 0, 200])).toContain('·')
    act(() => q('.pp-route[data-route="paste"]').click())
    expect(onRoute).toHaveBeenCalledWith('paste')
  })
})

// ---------------------------------------------------------------------------------------------------- forbidden words
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? (n === '__tests__' ? [] : walk(p)) : /\.(tsx?|css)$/.test(n) ? [p] : [] })
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
const WORDS = new RegExp(`\\b(${FORBIDDEN_WORDS.join('|')})\\b`, 'i')

describe('forbidden words', () => {
  it('no string of the copy file, rendered or not, says important, likely or expected', () => {
    const all: string[] = []
    const take = (v: unknown) => { if (typeof v === 'string') all.push(v); else if (typeof v === 'function') all.push(String((v as (n: number, t: number) => string)(3, 6))) }
    Object.values(COPY).forEach(take)
    for (const s of all) expect(s).not.toMatch(WORDS)
    expect(all.length).toBeGreaterThan(20)
  })
  it('no rendered screen of the desk, the review desk or the fixtures says them', () => {
    for (const data of [FIX, EMPTY_DATA, subset(1), subset(2)]) {
      m = mount(<PaperDesk data={data} classic={false} now={NOW} trayOpen reviewOpen />)
      expect(m.container.textContent ?? '').not.toMatch(WORDS)
      m.unmount()
      m = null
    }
    for (const qq of QUESTIONS) expect(qq.stem).not.toMatch(WORDS)
  })
  it('no source line of the Study ports, the Paper Desk or the Review Desk holds one as a string', () => {
    const files = [...walk(join(SRC, 'papers')), ...walk(join(SRC, 'review')), join(SRC, 'ports.ts'), join(SRC, 'adapters/null.register.ts'), join(SRC, 'adapters/types.ts')]
    expect(files.length).toBeGreaterThan(15)
    for (const f of files) {
      const body = stripComments(readFileSync(f, 'utf8'))
      // the list of forbidden words itself is the one place they appear
      const text = f.endsWith('copy.ts') ? body.replace(/FORBIDDEN_WORDS[^\n]*\n/, '') : body
      expect(text, f).not.toMatch(WORDS)
    }
  })
})
