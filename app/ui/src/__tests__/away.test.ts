import { describe, expect, it } from 'vitest'
import type { BusEvent } from '../lib/api'
import { activeAlert, countdown, fmtAgo, normMac, phaseView, phoneProblem, traceBars, type AwayStatus } from '../lib/away'

const base: AwayStatus = {
  phase: 'disarmed', armed: false, armed_by: null, armed_at: null, watch_from: null,
  exit_left_s: null, entry_left_s: null, disarmed_at: null, disarmed_by: null,
  auto_arm: { enabled: true, ready: false, reason: 'no family phones are listed', paused: false, arms_in_s: null },
  phones: [], phones_home: [], check: null, incident: null, tamper: null, sensor: { source: null },
  warnings: [], limits: [], now: 0, aankhen: { running: false, mode: null },
  config: {
    phones: [], auto_arm: true, away_after_min: 15, return_gap_s: 120, exit_delay_s: 60, entry_delay_s: 30,
    confirm_k: 4, confirm_n: 8, clear_after_s: 30, tamper_after_s: 30, check_every_s: 30, ping: true, warning: 'w',
  },
  config_problem: null,
}
const st = (o: Partial<AwayStatus>): AwayStatus => ({ ...base, ...o })

let nextId = 1
const ev = (kind: string, extra: Record<string, unknown> = {}): BusEvent =>
  ({ id: nextId++, ts: 0, source: 'security', kind, text: kind, ...extra }) as BusEvent

describe('phaseView', () => {
  it('explains why a disarmed house will not arm itself', () => {
    expect(phaseView(st({})).line).toBe("Won't arm itself: no family phones are listed.")
    expect(phaseView(st({ auto_arm: { ...base.auto_arm, arms_in_s: 600 } })).line).toBe('Arms itself in 10 min if no family phone is seen.')
    expect(phaseView(st({ auto_arm: { ...base.auto_arm, enabled: false } })).line).toMatch(/Auto-arm is off/)
  })

  it('colours an armed house by what is really watching it', () => {
    expect(phaseView(st({ phase: 'armed', armed: true, armed_by: 'auto', sensor: { source: 'hardware' } })).tone).toBe('live')
    const sim = phaseView(st({ phase: 'armed', armed: true, armed_by: 'app', sensor: { source: 'simulation' } }))
    expect(sim.tone).toBe('sim')
    expect(sim.line).toMatch(/real house is not watched/)
    expect(phaseView(st({ phase: 'armed', armed: true, sensor: { source: null } })).tone).toBe('fault')
  })

  it('never shows a simulated alarm in the colour of a real one', () => {
    const inc = { id: 'x', stage: 'alarm' as const, started_at: 0, confirmed_at: 0, source: 'simulation', actions: {} }
    const real = phaseView(st({ phase: 'alarm', armed: true, incident: { ...inc, label: null, simulated: false } }))
    const fake = phaseView(st({ phase: 'alarm', armed: true, incident: { ...inc, label: 'SIMULATED', simulated: true } }))
    expect(real.tone).toBe('fault')
    expect(fake.tone).toBe('sim')
    expect(fake.label).toMatch(/simulated/)
  })

  it('counts down the exit and entry delays', () => {
    const a = st({ phase: 'arming', armed: true, exit_left_s: 15 })
    expect(phaseView(a).line).toBe('Watching starts in 15 s — time to leave.')
    expect(countdown(a)).toEqual({ left: 15, total: 60, frac: 0.75 })
    const p = st({ phase: 'pending', armed: true, entry_left_s: 10 })
    expect(countdown(p)?.frac).toBeCloseTo(2 / 3)
    expect(countdown(st({ phase: 'armed', armed: true }))).toBeNull()
  })
})

describe('adding a phone', () => {
  it('normalises MAC addresses the way Windows prints them', () => {
    expect(normMac('3A:11:22:33:44:55')).toBe('3a-11-22-33-44-55')
    expect(normMac('3a1122334455')).toBe('3a-11-22-33-44-55')
    expect(normMac('3a-11:22-33-44-55')).toBeNull()
  })

  it('catches the usual mistakes before the server does', () => {
    expect(phoneProblem({ name: '', mac: '3a-11-22-33-44-55', ip: '' })).toMatch(/name/)
    expect(phoneProblem({ name: 'Papa', mac: '', ip: '' })).toMatch(/MAC address, its IP/)
    expect(phoneProblem({ name: 'Papa', mac: '01-00-5e-00-00-16', ip: '' })).toMatch(/multicast/)
    expect(phoneProblem({ name: 'Papa', mac: '', ip: '8.8.8.8' })).toMatch(/home-network/)
    expect(phoneProblem({ name: 'Papa', mac: '', ip: '192.168.1.23' })).toBeNull()
    expect(phoneProblem({ name: 'Papa', mac: '3a-11-22-33-44-55', ip: '10.0.0.4' })).toBeNull()
  })
})

describe('activeAlert', () => {
  it('shows the newest alert and keeps an ended alarm up until dismissed', () => {
    const p = ev('alert', { level: 'pending', incident: 'i1' })
    const a = ev('alert', { level: 'alarm', incident: 'i1' })
    expect(activeAlert([p])?.level).toBe('pending')
    expect(activeAlert([p, a])?.level).toBe('alarm')
    const closed = ev('incident', { incident: 'i1' })
    const shown = activeAlert([p, a, closed])
    expect(shown?.ended).toBe(true)
    expect(activeAlert([p, a, closed], closed.id)).toBeNull()
  })

  it('is cleared by disarming, and a warning by Aankhen watching again', () => {
    expect(activeAlert([ev('alert', { level: 'alarm', incident: 'i2' }), ev('disarmed')])).toBeNull()
    expect(activeAlert([ev('alert', { level: 'warning' }), ev('watching')])).toBeNull()
    const t = ev('alert', { level: 'tamper', incident: 't1' })
    expect(activeAlert([t])?.tone).toBe('fault')
    expect(activeAlert([t, ev('incident', { incident: 't1' })])).toBeNull()
  })

  it('paints simulated alerts amber and ignores other sources', () => {
    expect(activeAlert([ev('alert', { level: 'alarm', sim: true, incident: 's' })])?.tone).toBe('sim')
    expect(activeAlert([{ id: 999, ts: 0, source: 'aankhen', kind: 'alert', text: 'x' }])).toBeNull()
  })
})

describe('trace and time', () => {
  it('draws one bar per second with the threshold at a third of the height', () => {
    const rows = [-2, -1, 0, 1].map((t, i) => ({ t, wifi: 'motion', score: i * 1.8, thr: 1.8, moving: 0, still: 0, presence: null, pos: i > 0 }))
    const { bars, zeroX, thrY } = traceBars(rows, 102, 30)
    expect(bars).toHaveLength(4)
    expect(bars[0].x).toBe(1)
    expect(bars[3].x).toBe(101)
    expect(bars[3].h).toBe(30)            // 3x the threshold fills it
    expect(bars[1].h).toBe(10)            // 1x sits at the threshold line
    expect(zeroX).toBeCloseTo(1 + (2 / 3) * 100)
    expect(thrY).toBe(20)
    expect(traceBars([], 10, 10).bars).toEqual([])
  })

  it('formats last-seen times', () => {
    expect(fmtAgo(null)).toBe('not seen yet')
    expect(fmtAgo(2)).toBe('just now')
    expect(fmtAgo(42)).toBe('42 s ago')
    expect(fmtAgo(900)).toBe('15 min ago')
    expect(fmtAgo(5400)).toBe('1.5 h ago')
  })
})
