import { describe, expect, it } from 'vitest'
import type { BusEvent } from '../lib/api'
import {
  alertsFrom, countdown, firingTone, fmtClock, fmtDue, fmtRepeat, lastReminderEvent, title, type Reminder,
} from '../lib/reminders'

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime() / 1000
const NOW = at(12, 19)                               // Monday 12 October 2026, 7 pm (local)

const rem = (over: Partial<Reminder> = {}): Reminder => ({
  id: 'r_1', kind: 'reminder', text: 'call Mum', due: at(12, 21), repeat: null, interval_min: null, action: null,
  status: 'pending', fired: [], last_fired: null, acked: null, ...over,
})

const ev = (id: number, kind: string, extra: Record<string, unknown> = {}): BusEvent =>
  ({ id, ts: NOW, source: 'reminders', kind, text: `event ${id}`, ...extra })

describe('times read the way JARVIS says them', () => {
  it('clock', () => {
    expect(fmtClock(at(12, 21))).toBe('9 pm')
    expect(fmtClock(at(13, 6, 30))).toBe('6:30 am')
    expect(fmtClock(at(12, 12))).toBe('12 noon')
    expect(fmtClock(at(13, 0))).toBe('midnight')
  })
  it('day', () => {
    expect(fmtDue(at(12, 21), NOW)).toBe('9 pm today')
    expect(fmtDue(at(13, 6, 30), NOW)).toBe('6:30 am tomorrow')
    expect(fmtDue(at(16, 17), NOW)).toBe('5 pm Fri')
    expect(fmtDue(at(25, 9), NOW)).toBe('9 am 25 Oct')
  })
  it('repeats', () => {
    expect(fmtRepeat(rem({ repeat: 'daily' }))).toBe('every day')
    expect(fmtRepeat(rem({ interval_min: 480 }))).toBe('every 8 hours')
    expect(fmtRepeat(rem({ interval_min: 90 }))).toBe('every 90 min')
    expect(fmtRepeat(rem({ repeat: 'weekly', due: at(16, 17) }))).toBe('every Friday')
    expect(fmtRepeat(rem())).toBe('')
  })
  it('countdown', () => {
    expect(countdown(NOW + 299.2, NOW)).toBe('5:00')
    expect(countdown(NOW + 3723, NOW)).toBe('1:02:03')
    expect(countdown(NOW - 5, NOW)).toBe('0:00')
  })
})

describe('rows', () => {
  it('a timed switch names the switch; an empty reminder says what it is', () => {
    expect(title(rem({ kind: 'action', action: { device: 'fan', action: 'off', value: null } }))).toBe('fan off')
    expect(title(rem({ kind: 'action', action: { device: 'light', action: 'set', value: 30 } }))).toBe('light to 30%')
    expect(title(rem({ kind: 'action', action: { device: 'environment', action: 'sleep', value: 'sleep' } }))).toBe('sleep scene')
    expect(title(rem({ kind: 'timer', text: '' }))).toBe('Timer')
    expect(title(rem())).toBe('call Mum')
  })
})

describe('alerts carry provenance', () => {
  it('spoken is confirmed, missed is a fault, a virtual switch is simulated', () => {
    expect(firingTone({ kind: 'due', spoken: true })).toBe('live')
    expect(firingTone({ kind: 'due', spoken: false })).toBe('info')
    expect(firingTone({ kind: 'missed', spoken: false })).toBe('fault')
    expect(firingTone({ kind: 'skipped' })).toBe('fault')
    expect(firingTone({ kind: 'due', outcome: { usb: false } })).toBe('sim')
    expect(firingTone({ kind: 'due', outcome: { error: 'board gone' } })).toBe('fault')
  })
  it('only new firings become alerts', () => {
    const events = [ev(1, 'created'), ev(2, 'due', { spoken: true, reminder: { id: 'r_a' } }),
      ev(3, 'due', { reminder: { id: 'r_b' } }), { ...ev(4, 'due'), source: 'core' }, ev(5, 'missed')]
    const got = alertsFrom(events, 2)
    expect(got.map((a) => a.id)).toEqual([3, 5])
    expect(got[0]).toMatchObject({ rid: 'r_b', spoken: false, tone: 'info' })
    expect(got[1].tone).toBe('fault')
    expect(lastReminderEvent(events)).toBe(5)
  })
})
