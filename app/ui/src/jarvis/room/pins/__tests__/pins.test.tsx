// RW1: the pin map's model and its two-press confirm. Nothing is sent to the board before the second press; with no
// adapter the edit control is PLANNED with its reason and the pins are read-only.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '../../../../__tests__/ww/_stubs'
import { fixtureView } from '../fixtures'
import { PinMap } from '../PinMap'
import { CONFIRM_LINE, NO_SAVE_ROUTE, changedPins, pinRows, validateDrafts } from '../pinModel'

let m: ReturnType<typeof mount> | null = null
beforeEach(() => { window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia })
afterEach(() => { m?.unmount(); m = null })
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const el = (sel: string) => document.querySelector(sel) as HTMLElement
const press = (n: Element) => act(() => { (n as HTMLElement).click() })
const type = (input: HTMLInputElement, value: string) => act(() => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true }))
})
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.startsWith(text)) as HTMLButtonElement

describe('the model', () => {
  it('draws one row per relay with a lamp that tells the truth', () => {
    expect(pinRows(fixtureView()).map((r) => [r.id, r.pin, r.lamp])).toEqual([
      ['r1', 4, 'live'], ['r2', 5, 'live'], ['r3', 6, 'live'], ['r4', 7, 'live'], ['r5', 15, 'live'], ['r6', 16, 'live']])
    expect(pinRows(fixtureView({ connected: false }))[0]).toMatchObject({ lamp: 'waiting', testable: false })
    expect(pinRows(fixtureView({ virtual: true }))[0].lamp).toBe('simulated')
    expect(pinRows(fixtureView({ missing: ['r3'] }))[2]).toMatchObject({ lamp: 'fault', reason: 'not on the flashed board' })
    expect(pinRows(fixtureView({ mismatch: true }))[1].reason).toContain('GPIO 9')
    expect(pinRows(null)).toEqual([])
  })
  it('refuses a pin outside the chip, a flash line and a repeated pin', () => {
    const rows = pinRows(fixtureView())
    expect(validateDrafts(rows, { r1: '49' }).r1).toContain('Error')
    expect(validateDrafts(rows, { r1: 'ab' }).r1).toContain('Error')
    expect(validateDrafts(rows, { r1: '27' }).r1).toContain('flash')
    expect(validateDrafts(rows, { r1: '5' }).r1).toContain('same pin')
    expect(validateDrafts(rows, { r1: '8' })).toEqual({})
    expect(changedPins(rows, { r1: '8', r2: '5' })).toEqual({ r1: 8 })
  })
})

describe('the planned form (no save route)', () => {
  it('shows read-only pins and a PLANNED lamp with the reason, and sends nothing', () => {
    m = mount(<PinMap v={fixtureView()} defaultOpen />)
    expect(document.querySelectorAll('.pp-row')).toHaveLength(6)
    expect(document.querySelector('input')).toBeNull()
    expect(el('.pp-pin').textContent).toBe('GPIO 4')
    expect(el('.pp-foot').textContent).toContain('PLANNED')
    expect(el('.pp-foot').textContent).toContain(NO_SAVE_ROUTE)
    expect(button('Apply')).toBeUndefined()
  })
  it('collapses to its one key and opens it', () => {
    m = mount(<PinMap v={fixtureView()} />)
    expect(el('.ww-fold-body').hidden).toBe(true)
    press(el('.ww-fold-btn'))
    expect(el('.ww-fold-body').hidden).toBe(false)
  })
})

describe('the two-press confirm', () => {
  it('sends nothing until the second press, then sends only the changed pin', async () => {
    const save = vi.fn(async () => {})
    m = mount(<PinMap v={fixtureView()} adapter={{ save }} defaultOpen />)
    expect(button('Apply').getAttribute('aria-disabled')).toBe('true')
    type(document.querySelector('input') as HTMLInputElement, '8')
    press(button('Apply'))
    expect(save).not.toHaveBeenCalled()
    expect(el('.pp-say').textContent).toBe(CONFIRM_LINE)
    expect(button('Apply again')).toBeDefined()
    press(button('Apply again'))
    await flush()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ r1: 8 })
  })
  it('a further edit cancels the armed press', () => {
    const save = vi.fn(async () => {})
    m = mount(<PinMap v={fixtureView()} adapter={{ save }} defaultOpen />)
    const input = document.querySelector('input') as HTMLInputElement
    type(input, '8'); press(button('Apply'))
    expect(el('.pp-say').textContent).toBe(CONFIRM_LINE)
    type(input, '9')
    expect(el('.pp-say').textContent).not.toBe(CONFIRM_LINE)
    expect(save).not.toHaveBeenCalled()
  })
  it('a bad pin blocks Apply and says why; a failed save is shown as words', async () => {
    const save = vi.fn(async () => { throw new Error('the board did not answer') })
    m = mount(<PinMap v={fixtureView()} adapter={{ save }} defaultOpen />)
    const input = document.querySelector('input') as HTMLInputElement
    type(input, '99')
    press(button('Apply'))
    expect(save).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Error: 0 to 48.')
    type(input, '8'); press(button('Apply')); press(button('Apply again')); await flush()
    expect(el('.pp-say').textContent).toBe('Error: the board did not answer')
  })
})

describe('the test key', () => {
  it('needs two presses and is blocked, with its reason, when the board is not linked', async () => {
    const test = vi.fn(async () => ({ ok: true, text: 'clicked' }))
    m = mount(<PinMap v={fixtureView()} test={test} defaultOpen />)
    const key = document.querySelector('.pp-test') as HTMLButtonElement
    press(key); expect(test).not.toHaveBeenCalled()
    press(key); await flush()
    expect(test).toHaveBeenCalledWith('r1')
    m.unmount()
    m = mount(<PinMap v={fixtureView({ connected: false })} test={test} defaultOpen />)
    press(document.querySelector('.pp-test')!); press(document.querySelector('.pp-test')!); await flush()
    expect(test).toHaveBeenCalledTimes(1)
  })
})

describe('the classic page', () => {
  it('RelayWiring draws the same rows with the classic classes and no kit', async () => {
    const { RelayWiring } = await import('../../../../components/RelayWiring')
    m = mount(<RelayWiring v={fixtureView()} onTested={() => {}} />)
    expect(document.querySelectorAll('.wiring-table tbody tr')).toHaveLength(6)
    expect(document.querySelector('.wiring-table')!.textContent).toContain('GPIO 15')
    expect(document.querySelector('.pill.live')!.textContent).toBe('LIVE')
    expect(document.body.textContent).not.toContain('Arduino')
    expect(document.body.textContent).toContain('PLANNED')
    expect(document.querySelector('.ww-fold')).toBeNull()
  })
})
