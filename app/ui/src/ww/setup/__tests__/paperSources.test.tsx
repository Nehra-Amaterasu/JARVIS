// Past-paper sources on the harvester screen: the rules more than the layout. Invented sources (example.org), a routed fake fetch, no network.
// What it proves: the terms note is on screen before any switch, an off source asks nobody and shows no count, the local copy waits for the
// source, the engine's own sentences are printed on a refusal, and a count appears only under the engine's live state.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, resetHtml } from '../../../__tests__/ww/_stubs'
import { byText, click, fakeFetch, settle, type } from '../../../__tests__/ww/_setupFixtures'
import { PrimaryOwner } from '../../kit'
import { PaperSources, itemMeta, sourceWord, type PaperSource } from '../PaperSources'
import { useState } from 'react'

let m: ReturnType<typeof mount> | null = null

const SRC = (o: Partial<PaperSource> = {}): PaperSource => ({
  id: 'board_papers', name: 'Invented board papers', kind: 'papers', rights: 'All rights reserved by the publisher',
  terms_note: 'Links to the papers are allowed; copying them elsewhere is not.', hosts: ['papers.example.org'], needs_address: false, address: null,
  on: false, local_copy: false, reason: 'Off: nothing is asked of papers.example.org.', ...o,
})
const TABLE = SRC({ id: 'table_papers', name: 'Invented table', needs_address: true })

function Host({ first }: { first: PaperSource[] }) {
  const [s, set] = useState(first)
  return <PaperSources sources={s} pdfNote={{ available: true, note: 'PDF text is read with PyMuPDF.' }} onChange={(n) => set((p) => p.map((x) => (x.id === n.id ? n : x)))} />
}
async function open(first: PaperSource[]) {
  m = mount(<PrimaryOwner><Host first={first} /></PrimaryOwner>)
  await settle()
}
const ITEMS = [
  { key: 'a', title: 'Invented Paper A', code: 'IA100', year: 2025, kind: 'paper', url: 'https://papers.example.org/a.pdf', on_file: false },
  { key: 'b', title: 'Invented Paper B', code: 'IB200', year: null, kind: 'key', url: 'https://papers.example.org/b.pdf', on_file: true },
]

beforeEach(() => { vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} }) })
afterEach(() => { m?.unmount(); m = null; vi.unstubAllGlobals(); resetHtml(); document.body.innerHTML = '' })

describe('past-paper sources', () => {
  it('prints the terms note, rights and hosts with both switches off, and asks nobody', async () => {
    const f = fakeFetch({})
    await open([SRC()])
    const card = document.querySelector('[data-paper-source="board_papers"]')!
    expect(card.querySelector('[data-terms]')!.textContent).toContain('copying them elsewhere is not')
    expect(card.querySelector('[data-rights]')!.textContent).toContain('All rights reserved')
    expect(card.querySelector('[data-hosts]')!.textContent).toContain('papers.example.org')
    const [use, keep] = [...card.querySelectorAll('[role="switch"]')]
    expect(use.getAttribute('aria-checked')).toBe('false')
    expect(keep.getAttribute('aria-disabled')).toBe('true')
    expect(card.textContent).toContain('Switch "Use this source" on first.')
    expect(card.textContent).not.toMatch(/\b0 (papers|shown)/)
    click(keep)
    click(byText('button', 'Read the listing')!)
    await settle()
    expect(f.calls).toHaveLength(0)
  })

  it('a switch press sends only that switch and takes the source from the engine answer', async () => {
    const f = fakeFetch({ 'PUT /api/mission/harvest/sources/board_papers': (b) => [200, { paper_source: SRC({ on: true, reason: 'On: papers are links.', ...(b as object) }) }] })
    await open([SRC()])
    click(document.querySelector('[role="switch"]')!)
    await settle()
    expect(f.calls.map((c) => [c.method, c.body])).toEqual([['PUT', { on: true }]])
    const card = document.querySelector('[data-paper-source]')!
    expect(card.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('true')
    expect(card.textContent).toContain('On, links only')
    expect(card.textContent).toContain('On: papers are links.')
    expect(card.querySelectorAll('[role="switch"]')[1].getAttribute('aria-disabled')).toBeNull()
  })

  it('prints the engine sentence on a refusal and a 404, word for word', async () => {
    fakeFetch({ 'PUT /api/mission/harvest/sources/board_papers': [400, { detail: 'Switch the source on before its local copy.' }] })
    await open([SRC({ on: true })])
    click(document.querySelectorAll('[role="switch"]')[1])
    await settle()
    expect(document.querySelector('[data-say]')!.textContent).toBe('Refused: Switch the source on before its local copy.')
    m!.unmount()
    fakeFetch({ 'PUT /api/mission/harvest/sources/board_papers': [404, { detail: 'No such source on this engine.' }] })
    await open([SRC()])
    click(document.querySelector('[role="switch"]')!)
    await settle()
    expect(document.querySelector('[data-say]')!.textContent).toBe('Refused: No such source on this engine.')
    expect(document.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('false')
  })

  it('a source that needs an address keeps its Read key blocked until the engine has saved one', async () => {
    const f = fakeFetch({
      'PUT /api/mission/harvest/sources/table_papers': (b) => {
        const a = (b as { address: string }).address
        return /^https?:\/\//.test(a) ? [200, { paper_source: { ...TABLE, on: true, address: a, reason: 'On.' } }] : [400, { detail: 'An address begins with http:// or https://.' }]
      },
    })
    await open([{ ...TABLE, on: true }])
    expect(byText('button', 'Read the listing')!.getAttribute('aria-disabled')).toBe('true')
    expect(document.body.textContent).toContain('Save the listing address first.')
    const input = document.querySelector<HTMLInputElement>('.su-ps-address input')!
    type(input, 'nowhere')
    click(byText('button', 'Save the address')!)
    await settle()
    expect(document.querySelector('[data-say]')!.textContent).toBe('Refused: An address begins with http:// or https://.')
    type(input, 'https://archive.example.org/list')
    click(byText('button', 'Save the address')!)
    await settle()
    expect(f.calls.map((c) => (c.body as { address: string }).address)).toEqual(['nowhere', 'https://archive.example.org/list'])
    expect(byText('button', 'Read the listing')!.getAttribute('aria-disabled')).toBeNull()
  })

  it('lists found papers under the engine state; a count only when live; Fetch only with the local copy on', async () => {
    const f = fakeFetch({
      'GET /api/mission/harvest/sources/board_papers/index': [200, { state: 'live', reason: '2 of the 41 listed.', items: ITEMS, count: 2, listed: 41, read_at: new Date(2026, 10, 27, 9, 5).toISOString(), note: '' }],
      'POST /api/mission/harvest/sources/board_papers/fetch': [200, { state: 'live', reason: 'A pointer is on record; the site was not asked.', entry: { url: ITEMS[0].url, sha256: null }, job: null }],
    })
    const opened = vi.fn()
    vi.stubGlobal('open', opened)
    await open([SRC({ on: true })])
    expect(f.calls).toHaveLength(0) // nothing is read until he presses the key
    click(byText('button', 'Read the listing')!)
    await settle()
    expect(document.querySelector('[data-index-reason]')!.textContent).toBe('2 shown of the 41 listed, read 27 Nov 2026, 09:05.') // R32, 27 Nov: the engine's UTC stamp is shown in the viewer's clock, not raw
    expect(byText('button', /^Fetch/)).toBeUndefined()
    expect(document.body.textContent).toContain('IB200, year not stated, answer key, on file')
    click(byText('button', 'Open the link')!)
    await settle()
    expect(opened).toHaveBeenCalledWith('https://papers.example.org/a.pdf', '_blank', 'noopener')
    expect(document.querySelector('[data-paper-key="a"]')!.textContent).toContain('A pointer is on record; the site was not asked.')
    expect(f.calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([{ key: 'a' }])
  })

  it('a listing the engine answers as planned or waiting shows its sentence and no count', async () => {
    fakeFetch({ 'GET /api/mission/harvest/sources/board_papers/index': [200, { state: 'waiting', reason: 'Give the address of the listing page first.', items: [], count: 0, listed: 0, read_at: null, note: '' }] })
    await open([SRC({ on: true })])
    click(byText('button', 'Read the listing')!)
    await settle()
    expect(document.querySelector('[data-index-reason]')!.textContent).toBe('Give the address of the listing page first.')
    expect(document.querySelector('[data-paper-key]')).toBeNull()
    expect(document.body.textContent).not.toMatch(/\b0 (papers|shown)/)
  })

  it('names the state of a source in words', () => {
    expect(sourceWord(SRC())).toBe('Off')
    expect(sourceWord(SRC({ on: true }))).toBe('On, links only')
    expect(sourceWord(SRC({ on: true, local_copy: true }))).toBe('On, keeps local copies')
    expect(itemMeta({ ...ITEMS[0], kind: 'paper' } as never)).toBe('IA100, 2025, paper')
  })
})
