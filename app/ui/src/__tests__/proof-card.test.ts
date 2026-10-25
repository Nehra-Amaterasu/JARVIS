/**
 * The Proof of work card on Today: 30 squares from the proof engine, today's
 * suggestion when the day is still open, and a plain message when no GitHub
 * username is set. Server answers are fictional.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LearnCard, ProofCard, type LearnAnswer, type ProofAnswer } from '../germoney/pages/Today'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const strip = Array.from({ length: 30 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, commits: i % 3 === 0 ? 1 : 0 }))

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

async function render(answer: ProofAnswer | LearnAnswer, card: () => unknown = ProofCard) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } })))
  await act(async () => { root.render(createElement(card as () => null)) })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

describe('<ProofCard />', () => {
  it('draws 30 squares, lights the active ones and shows today\'s idea', async () => {
    await render({ status: 'ok', configured: true, say: '', current_streak: 2, today_done: false, active_last_30: 10, strip,
      suggestion: { kind: 'problem', text: 'Solve one problem and commit it.' } })
    expect(host.querySelectorAll('.proof-strip i').length).toBe(30)
    expect(host.querySelectorAll('.proof-strip i.on').length).toBe(10)
    expect(host.textContent).toContain('2 day streak')
    expect(host.textContent).toContain('Solve one problem')
  })

  it('Knowledge of the day shows the new concept and each due recall with two answers', async () => {
    await render({ status: 'ok', say: '', source: 'example', progress: { seen: 1, total: 2 },
      new: { id: 'c2', title: 'Big-O notation', body: 'How work grows.', quiz: [] },
      due: [{ id: 'c1', title: "Ohm's law", question: 'What is V when I = 2 A and R = 5 ohm?', box: 0 }] }, LearnCard)
    expect(host.textContent).toContain('Big-O notation')
    expect(host.textContent).toContain('What is V when')
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Read it', 'I knew it', "I didn't"])
    expect(host.textContent).toContain('Example concepts')
  })

  it('says how to set it up when no username is known', async () => {
    await render({ status: 'ok', configured: false, say: "I don't know your GitHub username yet." })
    expect(host.textContent).toContain('username')
    expect(host.querySelector('.proof-strip')).toBeNull()
  })
})
