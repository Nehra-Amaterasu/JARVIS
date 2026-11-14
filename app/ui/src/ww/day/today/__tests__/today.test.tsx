// L04 Today: the pure day model, the arc's geometry, the minute clock, the glob hosts and the composed page on fixtures.
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DayArc } from '../DayArc'
import { FIX_NOW, fixtureRaw } from '../fixtures'
import {
  arcFrac, arcGeometry, arcPoint, buildToday, classBlocks, doneBlocks, minutesByDay, msToNextMinute, onArc, ownMedian, toMin, FIRST_BLOCK_MIN,
} from '../model'
import { CALLOUTS, MODES, collectCallouts, collectModes } from '../registry'
import { useMinute } from '../Today'
import { PHONE_BELOW, TodayView, anchorsFor, todayGeometry } from '../TodayView'
import type { TodayActions, TodayCtx } from '../context'
import { buttons, cleanup, click, keyDown, render, renderHook } from './dom'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const noop = () => {}
const actions = (over: Partial<TodayActions> = {}): TodayActions => ({ startBlock: noop, tapCount: noop, lastCount: null, openPlan: noop, go: noop, ...over })
const ctxOf = (kind: 'day' | 'first' | 'waiting', over: Partial<TodayActions> = {}): TodayCtx => {
  const raw = fixtureRaw(kind)
  return { raw, model: buildToday(raw), actions: actions(over) }
}

describe('the day model', () => {
  it('reads times loosely and places them on the 06:00 to 24:00 arc', () => {
    expect(toMin('09:30')).toBe(570)
    expect(toMin('2026-11-12T07:05:00')).toBe(425)
    expect(toMin('later')).toBeNull()
    expect(arcFrac(6 * 60)).toBe(0)
    expect(arcFrac(24 * 60)).toBe(1)
    expect(arcFrac(15 * 60)).toBe(0.5)
    expect(arcFrac(3 * 60)).toBe(0) // before the arc: clamped, never off the drawing
    const g = arcGeometry(528, 310)
    const top = arcPoint(g.cx, g.cy, 100, 0.5)
    expect(top.x).toBe(g.cx)
    expect(top.y).toBe(g.cy - 100)
  })

  it('draws a class without an end time as one hour, drops a cancelled class, and times a logged block back from its end', () => {
    const c = classBlocks([{ id: 'a', start: '09:00', name: 'X', status: null }, { id: 'b', start: '11:00', name: 'Y', status: 'cancelled' }])
    expect(c).toEqual([{ id: 'c-a', from: '09:00', to: '10:00', kind: 'class', label: 'X' }])
    const d = doneBlocks([{ t: new Date(2026, 10, 12, 13, 50).getTime(), date: '2026-11-12', minutes: 25, kind: 'log' }], '2026-11-12')
    expect(d[0]).toMatchObject({ from: '13:25', to: '13:50', kind: 'done' })
    expect(onArc([{ id: 'n', from: '01:00', to: '02:00', kind: 'class', label: 'night' }])).toEqual([])
  })

  it('sums minutes per day and takes his own median only from three logged days up', () => {
    const logs = [{ t: 0, date: '2026-11-12', minutes: 30, kind: 'log' }, { t: 0, date: '2026-11-12', minutes: 15, kind: 'log' }, { t: 0, date: '2026-11-11', minutes: 99, kind: 'note' }]
    const week = minutesByDay(logs, FIX_NOW, 7)
    expect(week).toHaveLength(7)
    expect(week[6]).toEqual({ date: '2026-11-12', minutes: 45 })
    expect(week[5].minutes).toBe(0) // a note is not a block
    expect(ownMedian([{ minutes: 10 }, { minutes: 20 }])).toBeNull()
    expect(ownMedian([{ minutes: 10 }, { minutes: 20 }, { minutes: 0 }, { minutes: 40 }])).toBe(20)
  })

  it('first run: the log was read and holds nothing, so Now offers one short block', () => {
    const m = buildToday(fixtureRaw('first'))
    expect(m.firstRun).toBe(true)
    expect(m.now.action).toBe(`Start a ${FIRST_BLOCK_MIN}-minute block`)
    expect(m.noClasses).toBe(true)
  })

  it('nothing read: every number is WAITING and says why, none is invented', () => {
    const m = buildToday(fixtureRaw('waiting'))
    expect(m.state).toBe('waiting')
    expect(m.minutes).toBeNull()
    expect(m.minutesState).toBe('waiting')
    expect(m.ahead.state).toBe('waiting')
    expect(m.countersState).toBe('waiting')
  })

  it('a fixture day is SIMULATED everywhere and Now names the planned block at 14:20', () => {
    const m = buildToday(fixtureRaw('day'))
    expect(m.minutesState).toBe('simulated')
    expect(m.now.line).toContain('Library block')
    expect(m.minutes).toBe(65)
    expect(m.ahead).toMatchObject({ days: 12, more: 2 })
  })
})

describe('the arc and the minute clock', () => {
  it('waits for the next minute with one timeout and steps exactly on it; no animation frame at idle', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 12, 14, 20, 30))
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    const interval = vi.spyOn(window, 'setInterval')
    expect(msToNextMinute(new Date(2026, 10, 12, 14, 20, 30))).toBe(30_000)
    const { result } = renderHook(() => useMinute())
    expect(result.current.getMinutes()).toBe(20)
    act(() => void vi.advanceTimersByTime(29_000))
    expect(result.current.getMinutes()).toBe(20)
    act(() => void vi.advanceTimersByTime(1_000))
    expect(result.current.getMinutes()).toBe(21)
    act(() => void vi.advanceTimersByTime(60_000))
    expect(result.current.getMinutes()).toBe(22)
    expect(raf).not.toHaveBeenCalled()
    expect(interval).not.toHaveBeenCalled()
  })

  it('draws the notch at now, a title twin in words, and a dashed class track when no class was entered', () => {
    const m = buildToday(fixtureRaw('day'))
    const { container } = render(<DayArc blocks={m.classes} planned={m.planned} done={m.done} now={FIX_NOW} state="simulated" />)
    expect(container.querySelector('[data-now="14:20"]')).not.toBeNull()
    expect(container.querySelector('title')?.textContent).toContain('Class: 09:00 to 10:00, Signals')
    expect(container.querySelectorAll('.td-block[data-kind="planned"]')).toHaveLength(2)
    cleanup()
    const { container: c2 } = render(<DayArc blocks={[]} planned={[]} done={[]} now={FIX_NOW} state="live" dashed />)
    expect(c2.querySelector('.td-groove[data-track="class"][data-dashed]')).not.toBeNull()
  })
})

describe('the glob hosts', () => {
  it('collects the four callouts in order and the day mode first', () => {
    expect(CALLOUTS.errors).toEqual([])
    expect(CALLOUTS.list.map((c) => c.id)).toEqual(['now', 'ahead', 'counters', 'reminders'])
    expect(MODES.errors).toEqual([])
    expect(MODES.list[0].id).toBe('day')
  })

  it('refuses a malformed file and a duplicate id with a reason, never throws', () => {
    const C = () => null
    const r = collectCallouts({ './a.callout.tsx': { callout: { id: 'x', order: 2, Callout: C } }, './b.callout.tsx': { default: { id: 'x', order: 1, Callout: C } }, './c.callout.tsx': {} })
    expect(r.list.map((x) => x.id)).toEqual(['x'])
    expect(r.errors).toHaveLength(2)
    const m = collectModes({ './z.mode.tsx': { mode: { id: 'exam', label: 'Exam', Specimen: C } }, './day.mode.tsx': { mode: { id: 'day', label: 'Day', Specimen: C } } })
    expect(m.list.map((x) => x.id)).toEqual(['day', 'exam'])
  })
})

describe('the composed page', () => {
  it('fits the 1302 x 664 canvas: four plates inside the body, the margin wide enough for its keys', () => {
    const g = todayGeometry(1302, 664, 4, { left: true, right: true })
    expect(g.phone).toBe(false)
    const last = g.plates[3]
    expect(last.y + last.h).toBeLessThanOrEqual(g.spec.h)
    expect(g.margin.w).toBeGreaterThanOrEqual(300)
    expect(g.main.h).toBe(632)
    const a = anchorsFor(['now', 'ahead', 'counters', 'reminders'], g, FIX_NOW)
    for (const p of a) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(g.spec.w)
      expect(p.y).toBeLessThanOrEqual(g.spec.h)
    }
    expect(todayGeometry(358, 700, 4, { left: true, right: true }).phone).toBe(358 < PHONE_BELOW)
  })

  it('every plate carries a lamp and a reason; the fixture is stamped SIMULATED; one accent key', () => {
    const { container } = render(<TodayView ctx={ctxOf('day')} size={{ w: 1302, h: 664 }} />)
    const plates = container.querySelectorAll('.td-plate')
    expect(plates).toHaveLength(4)
    plates.forEach((p) => {
      expect(p.querySelector('.lamp-glyph')).not.toBeNull()
      expect(p.querySelector('.td-plate-why')?.textContent?.trim()).not.toBe('')
    })
    expect(container.textContent).toContain('SIMULATED')
    expect(container.querySelectorAll('[data-primary]')).toHaveLength(1)
  })

  it('first run shows one primary, "Start a 10-minute block", and n starts it unless typing', () => {
    const start = vi.fn()
    const { container } = render(<TodayView ctx={ctxOf('first', { startBlock: start })} size={{ w: 1302, h: 664 }} />)
    const prim = container.querySelectorAll('[data-primary]')
    expect(prim).toHaveLength(1)
    expect(prim[0].textContent).toBe('Start a 10-minute block')
    keyDown(window, 'n')
    expect(start).toHaveBeenCalledTimes(1)
    const input = container.querySelector('input') as HTMLInputElement
    keyDown(input, 'n')
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('waiting: numbers are hollow and say why', () => {
    const { container } = render(<TodayView ctx={ctxOf('waiting')} size={{ w: 1302, h: 664 }} />)
    expect(container.textContent).toContain('Waiting for the date sheet.')
    expect(container.textContent).toContain('Waiting for the counters.')
    expect(container.querySelector('.td-num[data-hollow]')).not.toBeNull()
  })

  it('counter keys add one and Undo takes the last back; the phone form puts Now first', () => {
    const tap = vi.fn()
    const { container } = render(<TodayView ctx={ctxOf('day', { tapCount: tap, lastCount: 'water' })} size={{ w: 1302, h: 664 }} />)
    click(buttons(container, /^Water: 4 today/)[0])
    expect(tap).toHaveBeenLastCalledWith('water', 1)
    click(buttons(container, 'Undo the last tap on Water')[0])
    expect(tap).toHaveBeenLastCalledWith('water', -1)
    expect(container.querySelectorAll('.td-key').length).toBeLessThanOrEqual(5)
    cleanup()
    const { container: ph } = render(<TodayView ctx={ctxOf('day')} size={{ w: 358, h: 700 }} />)
    const first = ph.querySelector('.td[data-form="phone"] .td-plate')
    expect(first?.getAttribute('data-callout')).toBe('now')
    expect(ph.querySelector('.td-spine-list')).not.toBeNull()
  })
})
