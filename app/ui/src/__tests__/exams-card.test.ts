/**
 * The Internals card on Today (Exams.tsx): one tile per paper with coverage and the
 * forecast range, today's blocks with what to do, and a topic tap that cycles
 * none → learned → solid. Server answers are fictional.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExamsCard, type ExamPaper, type ExamsAnswer } from '../germoney/pages/Exams'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const paper = (id: string, extra: Partial<ExamPaper> = {}): ExamPaper => ({
  id, subject: `s-${id}`, title: `Paper ${id}`, code: '', date: '2026-11-02', start: '10:45', end: '11:45', units: [3, 4],
  may_miss: false, days_left: 3, coverage: 0.25, work_minutes: 300, planned_minutes: 240, logged_minutes: 0, paper_score: null,
  counts: { none: 1, learned: 1, solid: 0 },
  topics: [{ key: '3|t1', unit: 3, unit_title: 'Three', topic: 'Topic one', weight: 'high', state: 'none' },
           { key: '3|t2', unit: 3, unit_title: 'Three', topic: 'Topic two', weight: 'high', state: 'learned' }],
  forecast: { half_plan: 0.5, full_plan: 0.9, assumption: '' }, ...extra })

const ANSWER: ExamsAnswer = {
  status: 'ok', date: '2026-10-30', say: '', rule: 'the rule', risks: ['A and B on one day, so the day before is shared.'],
  papers: [paper('a'), paper('b', { may_miss: true, paper_score: { score: 14, max: 20, date: '2026-10-30' } })],
  days: [{ date: '2026-10-30', slots: [{ label: 'Study day', minutes: 240, light: false, reserved: false,
    blocks: [{ paper: 'a', title: 'Paper a', minutes: 90, focus: [{ kind: 'learn', title: 'Topic one', unit: 3, minutes: 45 }] }] }] }],
}

let host: HTMLDivElement
let root: Root
let calls: { url: string; body?: string }[]
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body as string | undefined })
    return new Response(JSON.stringify(ANSWER), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

async function render() {
  await act(async () => { root.render(createElement(ExamsCard)) })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

describe('<ExamsCard />', () => {
  it('shows each paper with coverage, the range, a measured score and the may-not-sit tag', async () => {
    await render()
    expect(host.querySelectorAll('.ex-paper').length).toBe(2)
    expect(host.textContent).toContain('25%')
    expect(host.textContent).toContain('on the day 50%–90%')
    expect(host.textContent).toContain('paper 14/20')
    expect(host.textContent).toContain('may not sit')
    expect(host.textContent).toContain('on one day')
  })

  it("lists today's block with its first task and logs minutes against the paper's subject", async () => {
    await render()
    expect(host.querySelector('.ex-block')?.textContent).toContain('Topic one')
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('30 min done'))!
    await act(async () => { btn.click() })
    expect(calls.at(-1)?.url).toContain('/api/mission/exams/s-a/minutes')
    expect(JSON.parse(calls.at(-1)!.body!)).toEqual({ minutes: 30 })
  })

  it('opens a paper and cycles a topic to its next state', async () => {
    await render()
    await act(async () => { (host.querySelector('.ex-paper') as HTMLButtonElement).click() })
    const topics = host.querySelectorAll<HTMLButtonElement>('.ex-topic')
    expect(topics.length).toBe(2)
    await act(async () => { topics[1].click() })                     // learned -> solid
    expect(JSON.parse(calls.at(-1)!.body!)).toEqual({ key: '3|t2', state: 'solid' })
  })
})
