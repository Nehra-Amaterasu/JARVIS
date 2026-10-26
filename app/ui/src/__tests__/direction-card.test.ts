/**
 * Direction (ww_director.py) and Building (ww_sessions.py) cards on Today: the
 * ordered steps with the exam-week note, and the building hours with the button
 * that logs new sessions. Server answers are fictional.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DirectionCard, SessionsCard, type DirectorAnswer, type SessionsAnswer } from '../germoney/pages/Direction'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DIR: DirectorAnswer = {
  status: 'ok', mode: 'exam', say: 'Exam week: 2 h of study left today.', note: '2 h 30 of building today, past the 60 min exam-week cap.',
  rule: 'r', split: { study: 120, build: 0, built_today: 150 },
  steps: [{ kind: 'study', title: 'Alpha: topic a', minutes: 90, why: 'Alpha in 3 days' }, { kind: 'recall', title: 'Recall: Ohm', minutes: 5, why: 'V?' }],
}
const SES: SessionsAnswer = {
  status: 'ok', say: '', today_minutes: 150, week_minutes: 600, week_areas: { aankhen: 400, 'well-wisher': 200 }, pending: ['ws-1'],
  days: Array.from({ length: 14 }, (_, i) => ({ date: `2026-10-${String(i + 10).padStart(2, '0')}`, minutes: i % 2 ? 60 : 0 })),
  sessions: [{ id: 'ws-1', date: '2026-10-23', start: '10:00', end: '12:00', minutes: 150, commits: 4, main_area: 'aankhen', subjects: ['x'], imported: false }],
  model: { explain: 'Commits less than 90 min apart are one session.' },
}

let host: HTMLDivElement
let root: Root
let urls: string[]
beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); urls = []
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

async function render(answer: unknown, card: () => unknown) {
  vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(u); return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } }) }))
  await act(async () => { root.render(createElement(card as () => null)) })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

describe('Direction and Building', () => {
  it('lists the steps in order with the exam-week note', async () => {
    await render(DIR, DirectionCard)
    expect([...host.querySelectorAll('.dir-step')].map((l) => l.className)).toEqual(['dir-step study', 'dir-step recall'])
    expect(host.textContent).toContain('past the 60 min exam-week cap')
    expect(host.textContent).toContain('Exam week')
  })

  it('draws 14 day bars, the area split, and logs pending sessions', async () => {
    await render(SES, SessionsCard)
    expect(host.querySelectorAll('.ses-bars i').length).toBe(14)
    expect(host.textContent).toContain('aankhen67%')
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Log 1 session'))!
    await act(async () => { btn.click() })
    expect(urls.at(-1)).toContain('/api/mission/sessions/import')
  })
})
