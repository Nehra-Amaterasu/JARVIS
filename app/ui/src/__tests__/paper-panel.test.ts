/**
 * The practice-paper panel on the Exams card (Exams.tsx PaperPanel): the button fetches a
 * paper with a seed, the questions render with a marks box each, "Save marks" posts only the
 * answered ones with the seed, and the card is asked to reload. Server answers are fictional.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaperPanel, type ExamPaper, type GeneratedPaper } from '../germoney/pages/Exams'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const EXAM: ExamPaper = {
  id: 'see-x', subject: 'x', title: 'X', code: '', date: '2026-12-08', start: '10:00', end: '13:00', units: [], may_miss: false, days_left: 29,
  coverage: 0.2, topics: [], work_minutes: 0, planned_minutes: 0, logged_minutes: 0, paper_score: null, counts: { none: 0, learned: 0, solid: 0 },
  forecast: { half_plan: 0.2, full_plan: 0.4, assumption: '' }, max: 60, target: 40,
}
const PAPER: GeneratedPaper = {
  exam: 'see-x', subject: 'x', title: 'X', seed: 11, tier: 'exam', total_marks: 60, bank_size: 20, pattern_source: 'JSS SEE', shortfall: [], rule: 'the rule', markdown: '# X',
  sections: [{ name: 'A', marks: 2, attempt: 2, set: 2, questions: [
    { id: 'q1', n: 1, text: 'First question', marks: 2, unit: 1, topic: 't1', key: '1|t1', p: 0.1, source: 'Jun 2026' },
    { id: 'q2', n: 2, text: 'Second question', marks: 2, unit: 2, topic: 't2', key: '2|t2', p: 0.8, source: '' }] }],
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
    const body = url.includes('/marks') ? { score: 2, max: 2, say: 'Marked 1 answers: 2 of 2.' } : PAPER
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

describe('<PaperPanel />', () => {
  it('fetches a seeded paper, renders a marks box per question, and posts only the answered marks', async () => {
    const onSaved = vi.fn()
    await act(async () => { root.render(createElement(PaperPanel, { exam: EXAM, onSaved })) })
    const open = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Practice paper'))!
    await act(async () => { open.click() })
    await tick()
    expect(calls[0].url).toMatch(/^\/api\/mission\/paper\/see-x\?seed=\d+$/)
    expect(host.textContent).toContain('First question')
    expect(host.textContent).toContain('p 10%')
    const boxes = host.querySelectorAll<HTMLInputElement>('.ex-gen-mark')
    expect(boxes.length).toBe(2)
    expect(boxes[0].max).toBe('2')
    const save = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Save marks'))!
    expect(save.disabled).toBe(true)                                   // nothing answered yet
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(boxes[0], '2')
      boxes[0].dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(save.disabled).toBe(false)
    await act(async () => { save.click() })
    await tick()
    const posted = calls.find((c) => c.url.endsWith('/marks'))!
    expect(JSON.parse(posted.body!)).toEqual({ items: [{ id: 'q1', got: 2, max: 2 }], seed: 11 })   // max = the marks the paper showed
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.ex-gen-open')).toBeNull()               // back to the button after saving
  })

  it('a new seed fetches a different seed', async () => {
    await act(async () => { root.render(createElement(PaperPanel, { exam: EXAM, onSaved: () => undefined })) })
    await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Practice paper'))!.click() })
    await tick()
    await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('New seed'))!.click() })
    await tick()
    const seeds = calls.map((c) => Number(c.url.split('seed=')[1]))
    expect(seeds[1]).toBe(seeds[0] + 1)
  })
})
