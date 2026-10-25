/** Learned lately: the Keep / Wrong helpers, and the card against a stubbed API. */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { afterVerdict, ago, kindLabel, verdictSay, type LearnedItem, type LearnedQueue } from '../lib/learned'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NOW = 1_790_000_000
const item = (id: string, over: Partial<LearnedItem> = {}): LearnedItem => ({
  id, kind: 'fact', text: `memory ${id}`, confidence: 0.7, support: 1, first_seen: NOW - 3600, last_seen: NOW - 3600,
  by: 'rules', evidence: 1, ...over,
})
const queue = (): LearnedQueue => ({ items: [item('a'), item('b', { kind: 'instruction', support: 3 })], pending: 5, kept: 1, wrong: 0 })

describe('learned helpers', () => {
  it('ago reads like speech', () => {
    expect(ago(NOW - 10, NOW)).toBe('just now')
    expect(ago(NOW - 40 * 60, NOW)).toBe('40 min ago')
    expect(ago(NOW - 5 * 3600, NOW)).toBe('5 h ago')
    expect(ago(NOW - 86400, NOW)).toBe('yesterday')
    expect(ago(NOW - 3 * 86400, NOW)).toBe('3 days ago')
    expect(ago(NOW + 100, NOW)).toBe('just now')            // a clock a little ahead is not "in the future"
  })

  it('a verdict takes the item off and moves the right count', () => {
    const k = afterVerdict(queue(), 'a', 'keep')
    expect(k.items.map((i) => i.id)).toEqual(['b'])
    expect(k).toMatchObject({ pending: 4, kept: 2, wrong: 0 })
    const w = afterVerdict(queue(), 'b', 'wrong')
    expect(w).toMatchObject({ pending: 4, kept: 1, wrong: 1 })
    const q = queue()
    expect(afterVerdict(q, 'nope', 'keep')).toBe(q)          // unknown id: nothing moves
  })

  it('labels and toasts', () => {
    expect(kindLabel('instruction')).toBe('standing instruction')
    expect(kindLabel('dont')).toBe("don't")
    expect(kindLabel('other')).toBe('other')
    expect(verdictSay('wrong')).toMatch(/not use it/)
  })
})

describe('<LearnedReviewCard />', () => {
  const calls: { url: string; method: string; body?: string }[] = []
  let status = 200

  beforeEach(() => {
    calls.length = 0
    status = 200
    vi.stubGlobal('fetch', async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body })
      const body = String(url).startsWith('/api/memory/learned/') ? (status === 200 ? { ok: true } : { detail: 'no such learned memory' }) : queue()
      return new Response(JSON.stringify(body), { status: String(url).includes('/learned/') ? status : 200, headers: { 'Content-Type': 'application/json' } })
    })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  async function mount() {
    const { LearnedReviewCard } = await import('../components/LearnedReviewCard')
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(createElement(LearnedReviewCard)) })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    return { host, root }
  }
  const button = (host: HTMLElement, label: string) =>
    [...host.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label) as HTMLButtonElement

  it('lists what was learned with its kind and the counts', async () => {
    const { host, root } = await mount()
    const text = host.textContent ?? ''
    expect(calls[0].url).toBe('/api/memory/learned?n=6')
    expect(text).toContain('memory a')
    expect(text).toContain('standing instruction')
    expect(text).toContain('said 3 times')
    expect(text).toContain('5 to check · 1 kept · 0 wrong')
    act(() => root.unmount())
  })

  it('Wrong posts the verdict and takes the memory off the card', async () => {
    const { host, root } = await mount()
    await act(async () => { button(host, 'Wrong: memory a').click() })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    const p = calls.find((c) => c.method === 'POST')!
    expect(p.url).toBe('/api/memory/learned/a')
    expect(JSON.parse(p.body!)).toEqual({ verdict: 'wrong' })
    expect(host.textContent).not.toContain('memory a')
    expect(host.textContent).toContain('4 to check · 1 kept · 1 wrong')
    act(() => root.unmount())
  })

  it('a failed verdict leaves the memory where it was', async () => {
    status = 404
    const { host, root } = await mount()
    await act(async () => { button(host, 'Keep: memory b').click() })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(host.textContent).toContain('memory b')
    expect(host.textContent).toContain('5 to check')
    act(() => root.unmount())
  })
})
