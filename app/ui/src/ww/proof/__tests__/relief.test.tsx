// L04 Proof relief: honest statistics, dashed where there is no count, the drill-down, and the forbidden words.
import { afterEach, describe, expect, it } from 'vitest'
import { ProofRelief } from '../ProofRelief'
import { ProofPins } from '../ProofStrip'
import { FORBIDDEN, daysLogged, drillOf, proofStats, reliefBars, type ProofStat } from '../relief'
import type { ProofData, StatusV2 } from '../proofData'
import { cleanup, click, render } from '../../day/today/__tests__/dom'

afterEach(cleanup)

const v2 = (over: Partial<StatusV2> = {}): StatusV2 => ({
  date: '2026-11-12',
  series: [{ id: 'water', name: 'Water', want: 'more', weeks: [{ start: '', end: '', days_logged: 5, mean: 3 }, { start: '', end: '', days_logged: 6, mean: 5 }], points: [], weeks_with_data: 2, enough_for_line: true }],
  weeks_note: '',
  consistency: { window_days: 7, counters: [{ id: 'water', name: 'Water', logged: 6, asked: 7, hit: 5, ratio: 0.7, need: 0 }], hit: 13, asked: 21, ratio: 0.62, rule: '' },
  rank: { rank: '', next: null, target: '', top: false, requirements: [], met: 0, of: 0 },
  suggestions: [],
  recent: [{ date: '2026-11-12', count: 2, xp: 0, minutes: 65, rows: [], more: 0, zero_xp: { count: 0, minutes: 0, kinds: [] } }, { date: '2026-11-10', count: 1, xp: 0, minutes: 40, rows: [], more: 0, zero_xp: { count: 0, minutes: 0, kinds: [] } }, { date: '2026-10-01', count: 3, xp: 0, minutes: 90, rows: [], more: 0, zero_xp: { count: 0, minutes: 0, kinds: [] } }],
  wins: [],
  advice: [],
  ...over,
})
const slot = <T,>(data: T | null, state: 'ok' | 'loading' | 'error' = 'ok') => ({ state, data, error: null })
const dataOf = (s: StatusV2 | null, state: 'ok' | 'loading' | 'error' = 'ok'): ProofData =>
  ({ status: slot(null, 'loading'), v2: slot(s, state), weekly: slot(null, 'loading'), sessions: slot(null, 'loading'), github: slot(null, 'loading') }) as ProofData

const words = (text: string) => FORBIDDEN.filter((w) => (/^\W+$/.test(w) ? text.includes(w) : new RegExp(`\\b${w}\\b`, 'i').test(text)))

describe('the statistics', () => {
  it('stands each bar on its own count and window; what has no source yet is PLANNED and dashed', () => {
    const st = proofStats(dataOf(v2()))
    expect(st.map((s) => s.id)).toEqual(['kept', 'days', 'recall', 'practice', 'papers'])
    expect(st[0]).toMatchObject({ n: 21, state: 'live', caption: '13 of 21 · 7 d' })
    expect(st[1]).toMatchObject({ n: 14, caption: '2 of 14 · 14 d' }) // the October day is outside the window
    expect(st.slice(2).every((s) => s.state === 'planned' && s.n === 0)).toBe(true)
    expect(reliefBars(st).map((b) => b.dashed)).toEqual([false, false, true, true, true])
    expect(daysLogged([{ date: '2026-11-12', count: 0 }], '2026-11-12')).toBe(0)
  })

  it('says WAITING while reading and FAULT when the read failed, never a number', () => {
    expect(proofStats(dataOf(null, 'loading'))[0]).toMatchObject({ state: 'waiting', n: 0 })
    expect(proofStats(dataOf(null, 'error'))[0]).toMatchObject({ state: 'fault', n: 0 })
    expect(proofStats(dataOf(v2()), true)[0].state).toBe('simulated')
  })

  it('level 2 compares him with his own first week and lists the observations under the bar', () => {
    const d = drillOf('kept', dataOf(v2()))
    expect(d?.rows).toEqual([{ label: 'Water', before: 3, after: 5 }])
    expect(d?.values).toEqual([5])
    expect(drillOf('recall', dataOf(v2()))).toBeNull()
  })
})

describe('the drawing', () => {
  const stats: ProofStat[] = proofStats(dataOf(v2()))

  it('prints a caption on every bar, no total, and no forbidden word, open or drilled', () => {
    const { container } = render(<ProofRelief stats={stats} state="live" drill={(id) => drillOf(id, dataOf(v2()))} />)
    expect(container.querySelectorAll('.pr-cap')).toHaveLength(stats.length)
    expect(container.querySelectorAll('.pr-bar[data-dashed]')).toHaveLength(3)
    expect(words(container.textContent ?? '')).toEqual([])
    click(container.querySelector('.pr-row'))
    expect(container.querySelector('.pr-drill')).not.toBeNull()
    expect(words(container.textContent ?? '')).toEqual([])
    expect(words(container.querySelector('title')?.textContent ?? '')).toEqual([])
  })

  it('the rail: one small ring of all five measures, three figures each with its lamp and its word, hollow ones say why, no total', () => {
    const { container } = render(<ProofPins stats={stats} open={false} onOpen={() => {}} />)
    expect(container.querySelectorAll('.ps-ring .pr-bar')).toHaveLength(5)
    expect(container.querySelectorAll('.ps-ring .pr-bar[data-dashed]')).toHaveLength(3)
    const figs = [...container.querySelectorAll('.ps-figs li')]
    expect(figs).toHaveLength(3)
    // a lamp WORD beside every figure (the lamp rule), and the word is the state's own
    expect(figs.map((f) => f.querySelector('.lw-w')?.textContent)).toEqual(['LIVE', 'LIVE', 'PLANNED'])
    expect(figs.every((f) => f.querySelector('.lamp-glyph') !== null)).toBe(true)
    // the figure without a count is dashed, prints no number and says why
    const hollow = figs.filter((f) => f.hasAttribute('data-dashed'))
    expect(hollow).toHaveLength(1)
    expect(hollow[0].querySelector('.ps-why')?.textContent).toBe('not built yet')
    expect(hollow[0].querySelector('.ps-n')?.textContent).not.toMatch(/\d/)
    expect(figs[0].querySelector('.ps-n')?.textContent).toBe('13 of 21')
    const key = container.querySelector('button') as HTMLButtonElement
    expect(key.getAttribute('aria-label')).toContain('13 of 21')
    expect(key.getAttribute('aria-label')).toContain('planned')
    expect(container.querySelector('.ps-foot')?.textContent).toMatch(/no total/)
    expect(words(container.textContent ?? '')).toEqual([])
  })

  it('fixture rows carry SIMULATED beside every figure, never LIVE', () => {
    const sim = stats.map((s) => (s.state === 'live' ? { ...s, state: 'simulated' as const } : s))
    const { container } = render(<ProofPins stats={sim} open={false} onOpen={() => {}} />)
    expect([...container.querySelectorAll('.ps-figs li .lw-w')].map((w) => w.textContent)).toEqual(['SIMULATED', 'SIMULATED', 'PLANNED'])
  })

  it('the forbidden-word check itself catches the words it is for', () => {
    expect(words('your readiness score is 80%')).toEqual(['score', 'readiness', '%'])
    expect(words('already passed')).toEqual([]) // whole words only
  })
})
