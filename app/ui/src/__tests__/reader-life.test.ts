/**
 * The in-app reader's Markdown renderer (no HTML injection) and the Life card's
 * one-tap counters. Fictional content only.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DayCard, type LifeAnswer } from '../germoney/pages/Life'
import { renderMarkdown } from '../germoney/Reader'

const md = (s: string) => renderToStaticMarkup(createElement('div', null, ...renderMarkdown(s)))

describe('renderMarkdown', () => {
  it('renders headings, lists, tables and inline marks', () => {
    const h = md('# Title\n\nSome **bold** and `code`.\n\n- one\n  - two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n')
    expect(h).toContain('<h2>Title</h2>')
    expect(h).toContain('<b>bold</b>')
    expect(h).toContain('<code>code</code>')
    expect(h).toContain('<li class="sub">two</li>')
    expect(h).toContain('<th>a</th>')
    expect(h).toContain('<td>2</td>')
  })
  it('renders fenced code verbatim, quotes and rules', () => {
    const h = md('Intro\n\n```\nfor i in range(3):\n    print(**i**)\n```\n\n> a quoted *line*\n\n---\n\nafter')
    expect(h).toContain('<pre class="rd-code"><code>for i in range(3):\n    print(**i**)</code></pre>')
    expect(h).toContain('<blockquote>a quoted <i>line</i></blockquote>')
    expect(h).toContain('<hr/>')
    expect(h).toContain('<p>after</p>')
  })
  it('never turns text into HTML', () => {
    expect(md('<img src=x onerror=alert(1)>')).toContain('&lt;img')
    expect(md('```\n<script>alert(1)</script>\n```')).toContain('&lt;script&gt;')
    expect(md('> <b onclick=x>hi</b>')).not.toContain('<b onclick')
    expect(md('| <i>x</i> |\n|---|\n| y |')).toContain('&lt;i&gt;')
  })
})

let host: HTMLDivElement
let root: Root
let calls: { url: string; body: string }[]
const ANSWER: LifeAnswer = {
  status: 'ok', say: '', rule: 'r', points_today: 1, items: [], reels_to_explain: [],
  weeks: [{ ends: '2026-10-30', points: 4, logged: 3 }],
  counters: [{ id: 'snacks', name: 'Junk snacks', want: 'less', today: 3, line: 4, on_line: true, last7: [5, 5, 5] },
             { id: 'college', name: 'Went to college', want: 'yes', today: null, line: null, on_line: null, last7: [] }],
}
beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: String(init?.body ?? '') })
    return new Response(JSON.stringify(ANSWER), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

describe('<DayCard />', () => {
  it('shows each counter with its line and taps +1 and yes', async () => {
    await act(async () => { root.render(createElement(DayCard)) })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(host.querySelectorAll('.tap').length).toBe(2)
    expect(host.querySelector('.tap.ok')?.textContent).toContain('≤ 4')
    await act(async () => { (host.querySelector('[aria-label="Junk snacks plus one"]') as HTMLButtonElement).click() })
    expect(calls.at(-1)!.url).toContain('/api/mission/life/count')
    expect(JSON.parse(calls.at(-1)!.body)).toEqual({ id: 'snacks', delta: 1 })
    await act(async () => { (host.querySelector('.tap-yes') as HTMLButtonElement).click() })
    expect(JSON.parse(calls.at(-1)!.body)).toEqual({ id: 'college', value: 1 })
  })
})
