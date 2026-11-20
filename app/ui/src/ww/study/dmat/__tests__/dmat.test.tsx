// Package Y03: the dMAT board. Every feature of the classic page keeps a home (kinds, length, level, timer, seed, rules, last set, start,
// the running set with Back / Next / Finish and the clock, the score), the kinds are one radio group with arrows, and the classic page and
// the board share one piece of logic (useDmat).
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { mount } from '../../../../__tests__/ww/_stubs'
import { PrimaryOwner } from '../../../kit'
import type { DmatSet } from '../../api'
import { DmatBoard, type DmatState } from '../DmatBoard'
import { KIND_LABEL, mmss } from '../useDmat'

let m: ReturnType<typeof mount> | null = null
afterEach(() => { m?.unmount(); m = null })
const q = (sel: string) => m!.container.querySelector(sel) as HTMLElement
const qa = (sel: string) => Array.from(m!.container.querySelectorAll<HTMLElement>(sel))
const key = (el: Element, k: string) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })) })
const noop = () => undefined

const eq = (i: number) => ({ i, kind: 'equation' as const, prompt: `Find A + ${i}B`, equations: ['B - 1 = 2', '2A = 6'], ask: 'A', options: [{ text: '3' }, { text: '5' }, { text: '8' }] })
const SET: DmatSet = { set_id: 's', kind: 'equation', label: 'Equations', seed: 7, level: 1, n: 4, seconds_per_item: 60, time_limit_s: 240, rules: '', items: [0, 1, 2, 3].map(eq) }
const state = (o: Partial<DmatState> = {}): DmatState => ({
  kind: 'figure', setKind: noop, n: '10', setN: noop, level: '1', setLevel: noop, timer: 'on', setTimer: noop, seedText: '', setSeedText: noop,
  hist: [], set: null, answers: [], at: 0, setAt: noop, left: null, result: null, err: null, busy: false, start: () => Promise.resolve(), finish: () => Promise.resolve(), pick: noop, last: null, ...o,
} as DmatState)
const board = (o: Partial<DmatState> = {}) => mount(<PrimaryOwner><DmatBoard d={state(o)} /></PrimaryOwner>)

describe('DmatBoard setup', () => {
  it('keeps the task kinds, length, level, timer, seed, the rule line and Start', () => {
    m = board()
    expect(qa('.dm-kind').map((e) => e.querySelector('.dm-kind-name')!.textContent)).toEqual(Object.values(KIND_LABEL))
    for (const name of ['Length', 'Level', 'Timer']) expect(q(`[role="radiogroup"][aria-label="${name}"]`), name).toBeTruthy()
    expect(m.container.querySelector('input[type="number"]')).toBeTruthy()
    expect(q('[data-dmat-rules]').textContent).toContain('uncalibrated practice steps')
    expect(qa('button').some((b) => b.textContent === 'Start set')).toBe(true)
    expect(qa('[data-primary="true"]')).toHaveLength(1)
  })
  it('the kinds are one radio group: one tab stop, arrows move and choose', () => {
    const chose: string[] = []
    m = board({ setKind: (k) => chose.push(k as string) })
    expect(qa('.dm-kind[tabindex="0"]')).toHaveLength(1)
    const first = qa('.dm-kind')[0]
    act(() => first.focus())
    key(first, 'ArrowRight')
    expect(chose).toEqual(['equation'])
    expect(document.activeElement).toBe(qa('.dm-kind')[1])
  })
  it('the last set is a dial and a line; with none it says so and draws no number', () => {
    m = board()
    expect(q('.dm-dial-num').textContent).toBe('--')
    expect(q('[data-dmat-last]').textContent).toBe('No set taken yet.')
    m.unmount()
    m = board({ last: { set_id: 'x', kind: 'latin', level: 2, n: 10, correct: 6, of: 10, seconds: 600, time_limit_s: 900, in_time: true, date: '' } })
    expect(q('[data-dmat-last]').textContent).toBe('Last set: 6 of 10 correct in 10 min (Latin squares, level 2).')
  })
})

describe('DmatBoard run and result', () => {
  it('a running set shows the task, the clock, one dot per task, Back, Next and Finish', () => {
    m = board({ set: SET, answers: [0, null, null, null], at: 1, left: 125 })
    expect(q('[data-dmat-run]')).toBeTruthy()
    expect(q('.dm-clock').textContent).toBe('2:05')
    expect(qa('.dm-dot')).toHaveLength(4)
    expect(qa('.dm-dot[data-on="true"]')).toHaveLength(1)
    expect(qa('.dm-dot[data-here="true"]')).toHaveLength(1)
    expect(['Back', 'Next', 'Finish and score'].every((t) => qa('button').some((b) => b.textContent === t))).toBe(true)
    expect(q('[data-dmat-item]')).toBeTruthy()
  })
  it('an untimed set says Untimed, not a clock', () => {
    m = board({ set: SET, answers: [null, null, null, null], left: null })
    expect(q('.dm-clock').textContent).toBe('Untimed')
  })
  it('choosing an option calls pick and the option is a radio that says it is chosen', () => {
    const picked: number[] = []
    m = board({ set: SET, answers: [1, null, null, null], pick: (i) => picked.push(i) })
    const opts = qa('.ww-dmat-opt')
    expect(opts[1].getAttribute('aria-checked')).toBe('true')
    act(() => opts[2].click())
    expect(picked).toEqual([2])
  })
  it('the score counts correct answers only and says it was saved', () => {
    m = board({ result: { set_id: 'x', kind: 'equation', correct: 7, of: 10, unanswered: 1, pct: 0, seconds: 125, time_limit_s: 600, in_time: true } })
    expect(q('[data-dmat-result]').textContent).toContain('7 of 10 correct, 1 not answered in 2:05.')
    expect(q('[data-dmat-result]').textContent).toContain('Inside the time limit. Saved to your history.')
  })
  it('no streak, no loss and no leaderboard anywhere on the board', () => {
    m = board({ set: SET, answers: [0, null, null, null], left: 100 })
    expect(m.container.textContent).not.toMatch(/streak|leaderboard|rank|lose|lost|hurry/i)
  })
})

describe('the shared logic', () => {
  it('formats the clock', () => {
    expect(mmss(125)).toBe('2:05')
    expect(mmss(0)).toBe('0:00')
  })
})
