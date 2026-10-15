import { describe, expect, it } from 'vitest'
import { describeSet, draftFrom, draftProblem, nextUnoPin, pinLabel, type Mode } from '../lib/limbs'

const devices = [{ id: 'light', name: 'Room light' }, { id: 'fan', name: 'Ceiling fan' }]
const focus: Mode = { id: 'focus', name: 'Deep focus', set: { light: true, fan: true }, resolved: { light: true, fan: true },
  detail: 'room light on · ceiling fan on', builtin: true }

describe('limbs modes are on/off sets', () => {
  it('describes a set in plain on/off words, never a level', () => {
    expect(describeSet({ light: true, fan: false }, devices)).toBe('room light on · ceiling fan off')
    expect(describeSet({ '*': false }, devices)).toBe('everything off')
    expect(describeSet({ light: true, '*': false }, devices)).toBe('room light on · the rest off')
    expect(describeSet({}, devices)).toBe('switches nothing')
  })
  it('drafts from what a mode resolves to, every device named', () => {
    expect(draftFrom(focus, devices)).toEqual({ light: true, fan: true })
    expect(draftFrom(null, [...devices, { id: 'lamp', name: 'Lamp' }])).toEqual({ light: false, fan: false, lamp: false })
  })
  it('refuses a nameless or duplicate mode', () => {
    expect(draftProblem('', { light: true }, [])).toMatch(/name/)
    expect(draftProblem('deep FOCUS', { light: true }, [focus])).toMatch(/already exists/)
    expect(draftProblem('Reading', {}, [])).toMatch(/at least one/)
    expect(draftProblem('Reading', { light: true }, [focus])).toBeNull()
  })
})

describe('relay pins', () => {
  it('labels Uno and ESP32 pins', () => {
    expect(pinLabel('uno', 4)).toBe('D4')
    expect(pinLabel('esp32', 21)).toBe('GPIO 21')
  })
  it('puts the next relay on D6, then D7', () => {
    expect(nextUnoPin([4, 5])).toBe(6)
    expect(nextUnoPin([4, 5, 6])).toBe(7)
    expect(nextUnoPin([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])).toBeNull()
  })
})
