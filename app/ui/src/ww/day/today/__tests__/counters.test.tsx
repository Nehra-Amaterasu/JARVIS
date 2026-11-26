// Day / Today counters (25 Nov): minus and plus on a tile, a yes or no as one tick, "+N more" in place, an undo that walks back through
// every tap of the visit, the engine's refusal shown, and the saved choice of counters. A small fake engine answers the two routes the
// way germoney.life_tap does (count 0 to 500, `value` sets, `delta` nudges, anything else is a 400 with a reason), so the tests prove the
// screen against the engine's own rules and not against a mock that agrees with it.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildToday } from '../model'
import { fixtureRaw } from '../fixtures'
import { TodayProvider, type TodayActions } from '../context'
import { callout } from '../callouts/counters.callout'
import { useLeft } from '../../../left/store'
import { arrange, isTick, PREFS_KEY, resetDeckForTests, useDeck } from '../../../life/counterDeck'
import { buttons, cleanup, click, render } from './dom'

interface Row { id: string; name: string; want: string; today: number | null }
let rows: Row[]
let calls: { path: string; body?: Record<string, unknown> }[]

const answer = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

function stubEngine() {
  vi.stubGlobal('fetch', vi.fn((path: string, init?: { method?: string; body?: string }) => {
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined
    calls.push({ path, body })
    if (path === '/api/mission/life' && (init?.method ?? 'GET') === 'GET') return answer({ status: 'ok', counters: rows })
    if (path === '/api/mission/life/count') {
      const r = rows.find((x) => x.id === body?.id)
      if (!r) return answer({ detail: 'no such counter' }, 400)
      const v = body && 'value' in body ? Number(body.value) : (r.today ?? 0) + Number(body?.delta)
      if (!(v >= 0 && v <= 500)) return answer({ detail: 'a count is 0 to 500' }, 400)
      r.today = v
      return answer({ status: 'ok', counters: rows })
    }
    return answer({}, 404)
  }))
}

const actions: TodayActions = { startBlock: () => {}, tapCount: () => {}, lastCount: null, openPlan: () => {}, go: vi.fn() }
const mount = () => {
  const raw = fixtureRaw('day')
  return render(<TodayProvider value={{ raw, model: buildToday(raw), actions }}><callout.Callout /></TodayProvider>)
}
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 25)) }) }
const tile = (c: HTMLElement, id: string) => c.querySelector(`[data-counter="${id}"]`) as HTMLElement
const n = (c: HTMLElement, id: string) => tile(c, id).querySelector('.td-ctile-n')?.textContent

beforeEach(() => {
  rows = [
    { id: 'college', name: 'Went to college', want: 'yes', today: 1 },
    { id: 'smokes', name: 'Cigarettes', want: 'less', today: 6 },
    { id: 'joints', name: 'Joints', want: 'less', today: 1 },
    { id: 'drinks', name: 'Drinks', want: 'less', today: null },
    { id: 'water', name: 'Water', want: 'more', today: 4 },
    { id: 'reels', name: 'Reels', want: 'less', today: 2 },
  ]
  calls = []
  localStorage.clear()
  resetDeckForTests()
  useLeft.setState({ loadSlice: vi.fn(async () => {}) }) // the left store's own re-read is not under test here
  stubEngine()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Counters', () => {
  it('"+N more" opens the rest in the plate and never leaves Today', async () => {
    const { container } = mount()
    await settle()
    expect(container.querySelectorAll('.td-ctile')).toHaveLength(4)
    click(buttons(container, '+2 more')[0])
    expect(container.querySelectorAll('.td-ctile')).toHaveLength(6)
    expect(actions.go).not.toHaveBeenCalled()
    expect(buttons(container, 'Show fewer')).toHaveLength(1)
    click(buttons(container, 'Show fewer')[0])
    expect(container.querySelectorAll('.td-ctile')).toHaveLength(4)
  })

  it('plus and minus move the count through the engine; minus on a counter with no count cannot be pressed', async () => {
    const { container } = mount()
    await settle()
    click(buttons(container, 'Cigarettes: one more')[0]); await settle()
    expect(n(container, 'smokes')).toBe('7')
    click(buttons(container, 'Cigarettes: one less')[0]); await settle()
    click(buttons(container, 'Cigarettes: one less')[0]); await settle()
    expect(n(container, 'smokes')).toBe('5')
    expect(calls.filter((c) => c.path.endsWith('/count')).map((c) => c.body)).toEqual([{ id: 'smokes', delta: 1 }, { id: 'smokes', delta: -1 }, { id: 'smokes', delta: -1 }])
    expect(buttons(container, 'Drinks: one less')[0].disabled).toBe(true)
  })

  it("shows the engine's own words when it refuses, and puts the number back", async () => {
    const { container } = mount()
    await settle()
    rows.find((r) => r.id === 'joints')!.today = 0 // the engine moved on (another window), the screen has not heard yet
    click(buttons(container, 'Joints: one less')[0]); await settle()
    expect(container.querySelector('[data-said]')?.textContent).toContain('a count is 0 to 500')
    expect(n(container, 'joints')).toBe('1')
  })

  it('went to college is one tick: pressed sets 1, pressed again sets 0, and it never shows a 2', async () => {
    rows.find((r) => r.id === 'college')!.today = 2 // an old double tap
    const { container } = mount()
    await settle()
    const tick = () => tile(container, 'college').querySelector('button.td-tick') as HTMLButtonElement
    expect(tick().getAttribute('aria-pressed')).toBe('true')
    expect(tile(container, 'college').textContent).not.toMatch(/\b2\b/)
    expect(tile(container, 'college').querySelector('.td-step')).toBeNull()
    click(tick()); await settle()
    expect(rows[0].today).toBe(0)
    expect(tick().getAttribute('aria-pressed')).toBe('false')
    click(tick()); await settle()
    expect(rows[0].today).toBe(1)
    expect(calls.filter((c) => c.path.endsWith('/count')).map((c) => c.body)).toEqual([{ id: 'college', value: 0 }, { id: 'college', value: 1 }])
  })

  it('Undo walks back through every tap of the visit, newest first, and then has nothing left', async () => {
    const { container } = mount()
    await settle()
    click(buttons(container, '+2 more')[0])
    click(buttons(container, 'Cigarettes: one more')[0]); await settle()
    click(buttons(container, 'Water: one more')[0]); await settle()
    click(buttons(container, 'Joints: one less')[0]); await settle()
    expect([n(container, 'smokes'), n(container, 'water'), n(container, 'joints')]).toEqual(['7', '5', '0'])
    const undo = () => container.querySelector('[data-act="undo-count"]') as HTMLButtonElement
    expect(undo().getAttribute('aria-label')).toContain('Joints')
    click(undo()); await settle()
    expect(n(container, 'joints')).toBe('1')
    click(undo()); await settle()
    expect(n(container, 'water')).toBe('4')
    click(undo()); await settle()
    expect(n(container, 'smokes')).toBe('6')
    expect(undo().disabled).toBe(true)
  })

  it('an undo of a tick puts the tick back', async () => {
    const { container } = mount()
    await settle()
    click(tile(container, 'college').querySelector('button.td-tick')); await settle()
    expect(rows[0].today).toBe(0)
    click(container.querySelector('[data-act="undo-count"]')); await settle()
    expect(rows[0].today).toBe(1)
  })

  it('the old stack forgets entries after 15 minutes', async () => {
    const { container } = mount()
    await settle()
    click(buttons(container, '+2 more')[0])
    click(buttons(container, 'Water: one more')[0]); await settle()
    const stale = useDeck.getState().undo.map((e) => ({ ...e, at: Date.now() - 16 * 60_000 }))
    act(() => useDeck.setState({ undo: stale }))
    expect((container.querySelector('[data-act="undo-count"]') as HTMLButtonElement).disabled).toBe(true)
  })

  it('Choose counters hides and orders them, and keeps the choice on this device', async () => {
    const { container } = mount()
    await settle()
    click(container.querySelector('[data-act="choose-counters"]'))
    const sheet = document.querySelector('.td-choose') as HTMLElement
    expect(sheet.textContent).toContain('Kept on this device')
    click(buttons(sheet, 'Move Water up')[0])
    const smokes = sheet.querySelector('[data-counter="smokes"]') as HTMLElement
    click(smokes.querySelector('button'))
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as { order: string[]; hidden: string[] }
    expect(saved.order.indexOf('water')).toBe(3)
    expect(saved.hidden).toEqual(['smokes'])
    const { shown } = arrange(useDeck.getState().counters!, useDeck.getState().prefs)
    expect(shown.map((c) => c.id)).not.toContain('smokes')
  })

  it('arrange: unknown counters follow in engine order; isTick is want yes or college', () => {
    const all = [{ id: 'a', name: 'A', want: 'less' as const, today: 0 }, { id: 'b', name: 'B', want: 'yes' as const, today: 0 }, { id: 'college', name: 'C', want: 'more' as const, today: 0 }]
    expect(arrange(all, { order: ['b'], hidden: [] }).shown.map((c) => c.id)).toEqual(['b', 'a', 'college'])
    expect(all.map(isTick)).toEqual([false, true, true])
  })
})
