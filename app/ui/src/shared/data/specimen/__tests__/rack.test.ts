// RackRow's rule: the confirmed lamp lights only after a report. A prop alone never makes a row confirmed.
import { describe, expect, it } from 'vitest'
import { PULSE, PULSE_WINDOW_MS, RACK_LAMP, effectiveRackState, lastSeenText, showsPulse } from '../rack'

const NOW = 1_700_000_000_000

describe('effectiveRackState', () => {
  it('never shows confirmed from the state prop alone', () => {
    for (const r of [undefined, null, 0, -5, NaN, Infinity, '12' as unknown as number]) expect(effectiveRackState('confirmed', r)).toBe('unconfirmed')
  })
  it('shows confirmed once a report time exists', () => {
    expect(effectiveRackState('confirmed', NOW)).toBe('confirmed')
  })
  it('leaves the other three states as they are, with or without a report', () => {
    for (const s of ['unconfirmed', 'fault', 'planned'] as const) {
      expect(effectiveRackState(s, undefined)).toBe(s)
      expect(effectiveRackState(s, NOW)).toBe(s)
    }
  })
  it('uses the shared lamp shapes: confirmed is the live disc, unconfirmed the half disc, fault the triangle', () => {
    expect(RACK_LAMP).toEqual({ unconfirmed: 'waiting', confirmed: 'live', fault: 'fault', planned: 'planned' })
  })
})

describe('the pulse', () => {
  it('appears only while the last report is under a minute old', () => {
    expect(PULSE).toBe('▁▂▁')
    expect(showsPulse('confirmed', NOW - 1_000, NOW)).toBe(true)
    expect(showsPulse('confirmed', NOW - PULSE_WINDOW_MS, NOW)).toBe(true)
    expect(showsPulse('confirmed', NOW - PULSE_WINDOW_MS - 1, NOW)).toBe(false)
  })
  it('never appears without a report, in the future, or on a planned or faulted unit', () => {
    expect(showsPulse('confirmed', undefined, NOW)).toBe(false)
    expect(showsPulse('confirmed', NOW + 5_000, NOW)).toBe(false)
    expect(showsPulse('planned', NOW - 1_000, NOW)).toBe(false)
    expect(showsPulse('fault', NOW - 1_000, NOW)).toBe(false)
  })
})

describe('lastSeenText', () => {
  it('prefers the caller text, then the age of the report, then says never', () => {
    expect(lastSeenText('14:03', NOW - 5_000, NOW)).toBe('14:03')
    expect(lastSeenText(undefined, NOW - 20_000, NOW)).toBe('20 s ago')
    expect(lastSeenText(undefined, NOW - 14 * 60_000, NOW)).toBe('14 min ago')
    expect(lastSeenText(undefined, undefined, NOW)).toBe('never reported')
  })
})
