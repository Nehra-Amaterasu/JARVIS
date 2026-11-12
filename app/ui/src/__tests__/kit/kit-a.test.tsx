// Kit family A and the readings (spec 7.1, 7.2, 6.6): for every component a states test (default, planned,
// error, disabled-with-a-reason) and a keyboard test. The forced-colours side is kit-css.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { mount } from '../ww/_stubs'
import {
  Key, Knob, LAMP_SHAPE, LAMP_STATES, LAMP_WORD, Lamp, Numerals, Plate, ProgressBar, Readout, ReadoutLines, Rocker, Switch, TelemetryRail, TickSlider, lampText, showsValue, readingText,
} from '../../shared/kit'

let m: ReturnType<typeof mount> | null = null
afterEach(() => {
  m?.unmount()
  m = null
})
const q = <T extends Element = HTMLElement>(sel: string) => m!.container.querySelector<T>(sel)!
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })))
const click = (el: Element) => act(() => (el as HTMLElement).click())

describe('Lamp (component 11)', () => {
  it('has five states, each with its own shape and its own word, so none relies on colour', () => {
    expect(LAMP_STATES).toHaveLength(5)
    expect(new Set(LAMP_STATES.map((s) => LAMP_SHAPE[s])).size).toBe(5)
    expect(new Set(LAMP_STATES.map((s) => LAMP_WORD[s])).size).toBe(5)
    expect(LAMP_SHAPE).toEqual({ live: 'disc', waiting: 'half-disc', simulated: 'diamond', planned: 'dashed-ring', fault: 'triangle' })
  })
  it('prints the word and names the full state for assistive technology', () => {
    m = mount(<Lamp state="fault" reason="relay did not answer" />)
    const l = q('.k-lamp')
    expect(l.getAttribute('role')).toBe('img')
    expect(l.getAttribute('aria-label')).toBe('FAULT: relay did not answer')
    expect(l.textContent).toBe('FAULT')
    expect(q('svg').getAttribute('data-shape')).toBe('triangle')
    expect(q('svg').getAttribute('aria-hidden')).toBe('true')
  })
  it('bare hides the word but keeps the accessible name; it is never focusable (read-only)', () => {
    m = mount(<Lamp state="waiting" bare />)
    expect(q('.k-lamp-word')).toBeNull()
    expect(q('.k-lamp').getAttribute('aria-label')).toBe('WAITING')
    expect(q('.k-lamp').getAttribute('tabindex')).toBeNull()
  })
  it('only LIVE and SIMULATED may show a value', () => {
    expect(LAMP_STATES.filter(showsValue)).toEqual(['live', 'simulated'])
    expect(lampText('planned')).toBe('PLANNED')
  })
})

describe('Readout and Numerals (components 6 and 7): no number without a state', () => {
  it('LIVE shows the value and unit in an <output>, in a group named by the label', () => {
    m = mount(<Readout label="Room temperature" value={24.5} unit="C" state="live" />)
    const g = q('[role=group]')
    expect(g.getAttribute('aria-labelledby')).toBe(q('.k-readout-label').id)
    expect(q('output').textContent).toBe('24.5 C')
  })
  it.each(['waiting', 'planned', 'fault'] as const)('%s shows "--" and never the number it was handed', (state) => {
    m = mount(<Readout label="Temp" value={99} state={state} reason={state === 'fault' ? 'sensor error' : undefined} />)
    expect(q('output').textContent).toBe('--')
    expect(m.container.textContent).not.toContain('99')
    expect(q('.k-readout-why').textContent).toContain(state === 'fault' ? 'FAULT: sensor error' : state.toUpperCase())
  })
  it('WAITING with no reason says "no report"', () => {
    m = mount(<Readout label="Temp" state="waiting" />)
    expect(q('.k-readout-why').textContent).toBe('WAITING: no report')
  })
  it('SIMULATED stamps the diamond word next to the value', () => {
    m = mount(<Readout label="Temp" value={3} state="simulated" />)
    expect(q('.k-stamp').textContent).toBe('SIMULATED')
    expect(q('output').textContent).toBe('3')
  })
  it('a LIVE value older than 30 s adds "last seen"', () => {
    m = mount(<Readout label="Temp" value={3} state="live" ageS={95} />)
    expect(q('.k-readout-why').textContent).toBe('last seen 95 s ago')
    expect(q('.k-readout').getAttribute('data-stale')).toBe('true')
  })
  it('readingText is the single gate: an empty value is "--" even when LIVE', () => {
    expect(readingText('live', null)).toBe('--')
    expect(readingText('live', 0)).toBe('0')
    expect(readingText('simulated', '')).toBe('--')
  })
  it('Numerals draws the value as real text with a static colon (no animation class), "--" when not reported', () => {
    m = mount(<Numerals label="Clock" value="12:30" state="live" size={72} />)
    expect(q('output').textContent).toBe('12:30')
    expect(q('.k-numerals').getAttribute('data-size')).toBe('72')
    m.render(<Numerals label="Clock" value="12:30" state="waiting" />)
    expect(q('output').textContent).toBe('--')
  })
})

describe('ReadoutLines, TelemetryRail, ProgressBar (14, 18, 19)', () => {
  it('ReadoutLines marks simulated and fault lines and hides the value of any other non-live state; role=status only when asked', () => {
    m = mount(<ReadoutLines lines={[{ key: 'a', value: 1, state: 'live' }, { key: 'b', value: 2, state: 'simulated' }, { key: 'c', value: 3, state: 'fault', reason: 'x' }, { key: 'd', value: 4, state: 'planned' }]} />)
    const rows = [...m.container.querySelectorAll('.k-line-row')]
    expect(rows.map((r) => r.querySelector('.k-line-value')!.textContent)).toEqual(['1', '2', '--', '--'])
    expect(rows[1].querySelector('svg')!.getAttribute('data-shape')).toBe('diamond')
    expect(rows[2].querySelector('svg')!.getAttribute('data-shape')).toBe('triangle')
    expect(q('.k-lines').getAttribute('role')).toBeNull()
    m.render(<ReadoutLines announce lines={[]} />)
    expect(q('.k-lines').getAttribute('role')).toBe('status')
  })
  it('TelemetryRail: every row carries a lamp and a state; WAITING shows "--"; only an actionable row is a button', () => {
    const on = vi.fn()
    m = mount(<TelemetryRail label="Links" rows={[{ id: 'a', label: 'Voice', value: 'ok', state: 'live', onPress: on }, { id: 'b', label: 'Eyes', value: 'x', state: 'waiting' }, { id: 'c', label: 'Relay', state: 'planned' }]} />)
    const rows = [...m.container.querySelectorAll('.k-rail-row')]
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.querySelector('.k-lamp'))).toBe(true)
    expect(rows[1].querySelector('.k-rail-value')!.textContent).toBe('--')
    expect(m.container.querySelectorAll('button')).toHaveLength(1)
    click(q('button'))
    expect(on).toHaveBeenCalledTimes(1)
    expect(rows[2].getAttribute('data-state')).toBe('planned')
  })
  it('ProgressBar: a real value sets aria-valuenow; an unknown one draws no bar and says "working", never a fake percent', () => {
    m = mount(<ProgressBar label="Copy" value={42} />)
    expect(q('[role=progressbar]').getAttribute('aria-valuenow')).toBe('42')
    expect(q('.k-progress-fill').getAttribute('style')).toContain('42%')
    expect(m.container.querySelectorAll('.k-progress-ticks i')).toHaveLength(11)
    m.render(<ProgressBar label="Model load" />)
    expect(q('[role=progressbar]').hasAttribute('aria-valuenow')).toBe(false)
    expect(q('.k-progress-fill')).toBeNull()
    expect(q('.k-progress-value').textContent).toBe('working')
    expect(q('[role=progressbar]').getAttribute('aria-busy')).toBe('true')
  })
  it('ProgressBar clamps to 0..100', () => {
    m = mount(<ProgressBar label="x" value={250} />)
    expect(q('[role=progressbar]').getAttribute('aria-valuenow')).toBe('100')
  })
})

describe('Switch (component 2)', () => {
  it('default, on and off: role=switch, aria-checked, the word ON or OFF, Space toggles, Enter does not', () => {
    const on = vi.fn()
    m = mount(<Switch checked={false} onChange={on} label="Fan" />)
    const s = q('[role=switch]')
    expect(s.getAttribute('aria-checked')).toBe('false')
    expect(q('.k-switch-word').textContent).toBe('OFF')
    key(s, 'Enter')
    expect(on).not.toHaveBeenCalled()
    key(s, ' ')
    expect(on).toHaveBeenLastCalledWith(true)
    click(s)
    expect(on).toHaveBeenCalledTimes(2)
    m.render(<Switch checked label="Fan" onChange={on} />)
    expect(q('.k-switch-word').textContent).toBe('ON')
  })
  it('the confirmed lamp shows only after the board reports', () => {
    m = mount(<Switch checked label="Fan" onChange={() => {}} />)
    expect(q('.k-confirmed')).toBeNull()
    m.render(<Switch checked label="Fan" onChange={() => {}} confirmed />)
    expect(q('.k-confirmed svg').getAttribute('data-shape')).toBe('disc')
  })
  it('planned: aria-disabled (never disabled), dashed state, a press opens the explanation and does not toggle', () => {
    const on = vi.fn()
    const pl = vi.fn()
    m = mount(<Switch checked={false} onChange={on} label="Relay 7" planned onPlanned={pl} />)
    const s = q<HTMLButtonElement>('[role=switch]')
    expect(s.disabled).toBe(false)
    expect(s.getAttribute('aria-disabled')).toBe('true')
    expect(s.dataset.state).toBe('planned')
    click(s)
    key(s, ' ')
    expect(on).not.toHaveBeenCalled()
    expect(pl).toHaveBeenCalledTimes(2)
  })
  it('disabled with a reason stays focusable and prints the reason; error shows a triangle and the reason', () => {
    const on = vi.fn()
    m = mount(<Switch checked={false} onChange={on} label="Fan" disabledReason="Board offline" />)
    expect(q('.k-reason').textContent).toBe('Board offline')
    click(q('[role=switch]'))
    expect(on).not.toHaveBeenCalled()
    m.render(<Switch checked={false} onChange={on} label="Fan" error="Board refused" />)
    expect(q('[role=switch]').dataset.state).toBe('error')
    expect(q('.k-err').textContent).toContain('Board refused')
    expect(q('.k-err svg').getAttribute('data-shape')).toBe('triangle')
    expect(q('[role=switch]').getAttribute('aria-describedby')).toBe(q('.k-err').id)
  })
})

describe('Rocker (component 3)', () => {
  it('is a two-item radiogroup, I on the left; Left and Right move, Space toggles, the roving tab stop follows', () => {
    const on = vi.fn()
    m = mount(<Rocker on={false} onChange={on} label="Lights" />)
    const [i, o] = [...m.container.querySelectorAll<HTMLElement>('[role=radio]')]
    expect(i.textContent).toContain('ON')
    expect([i.tabIndex, o.tabIndex]).toEqual([-1, 0])
    expect(o.getAttribute('aria-checked')).toBe('true')
    key(o, 'ArrowLeft')
    expect(on).toHaveBeenLastCalledWith(true)
    key(i, 'ArrowRight')
    expect(on).toHaveBeenLastCalledWith(false)
    key(o, ' ')
    expect(on).toHaveBeenLastCalledWith(true)
  })
  it('planned and error forms', () => {
    const pl = vi.fn()
    const on = vi.fn()
    m = mount(<Rocker on={false} onChange={on} label="L" planned onPlanned={pl} />)
    click(q('[role=radio]'))
    expect(pl).toHaveBeenCalledTimes(1)
    expect(on).not.toHaveBeenCalled()
    expect(q('[role=radiogroup]').getAttribute('aria-disabled')).toBe('true')
    m.render(<Rocker on label="L" onChange={on} error="No answer" />)
    expect(q('.k-err').textContent).toContain('No answer')
  })
})

describe('Key (component 4)', () => {
  it('a plain key is a button named by its label; a toggle key has aria-pressed and an indicator', () => {
    const on = vi.fn()
    m = mount(<Key label="All off" icon={<i />} onPress={on} />)
    expect(q('button').getAttribute('aria-label')).toBe('All off')
    expect(q('button').hasAttribute('aria-pressed')).toBe(false)
    click(q('button'))
    expect(on).toHaveBeenCalledTimes(1)
    m.render(<Key label="Quiet" onPress={on} pressed />)
    expect(q('button').getAttribute('aria-pressed')).toBe('true')
    expect(q('.k-key-ind')).not.toBeNull()
  })
  it('loading swaps the caption for a mono verb and sets aria-busy; planned and disabled never act', () => {
    const on = vi.fn()
    m = mount(<Key label="Save" caption loading onPress={on} />)
    expect(q('.k-key-cap').textContent).toBe('saving')
    expect(q('button').getAttribute('aria-busy')).toBe('true')
    click(q('button'))
    m.render(<Key label="Save" onPress={on} disabledReason="no board" />)
    click(q('button'))
    expect(on).not.toHaveBeenCalled()
    expect(q('button').dataset.state).toBe('disabled')
  })
})

describe('Knob (component 1)', () => {
  it('role=slider with value, min, max and text; arrows step, PageUp and PageDown 10 steps, Home and End the ends, Shift fine', () => {
    const on = vi.fn()
    m = mount(<Knob label="Volume" value={50} onChange={on} unit="%" />)
    const k = q('[role=slider]')
    expect(['aria-valuenow', 'aria-valuemin', 'aria-valuemax', 'aria-valuetext'].map((a) => k.getAttribute(a))).toEqual(['50', '0', '100', '50 %'])
    key(k, 'ArrowUp')
    expect(on).toHaveBeenLastCalledWith(51)
    key(k, 'ArrowDown')
    expect(on).toHaveBeenLastCalledWith(49)
    key(k, 'PageUp')
    expect(on).toHaveBeenLastCalledWith(60)
    key(k, 'PageDown')
    expect(on).toHaveBeenLastCalledWith(40)
    key(k, 'Home')
    expect(on).toHaveBeenLastCalledWith(0)
    key(k, 'End')
    expect(on).toHaveBeenLastCalledWith(100)
    key(k, 'ArrowUp', { shiftKey: true })
    expect(on).toHaveBeenLastCalledWith(50.1)
  })
  it('draws 24 ticks with every 5th major, flags the ends, and never goes past them', () => {
    const on = vi.fn()
    m = mount(<Knob label="V" value={100} onChange={on} />)
    expect(m.container.querySelectorAll('.k-tick')).toHaveLength(24)
    expect(m.container.querySelectorAll('.k-tick[data-major=true]')).toHaveLength(5)
    expect(q('[role=slider]').getAttribute('data-at')).toBe('max')
    key(q('[role=slider]'), 'ArrowUp')
    expect(on).toHaveBeenLastCalledWith(100)
  })
  it('planned: no notch, dashed state, aria-disabled, the key opens the explanation instead', () => {
    const on = vi.fn()
    const pl = vi.fn()
    m = mount(<Knob label="V" value={5} onChange={on} planned onPlanned={pl} />)
    expect(q('.k-knob-notch')).toBeNull()
    key(q('[role=slider]'), 'ArrowUp')
    expect(on).not.toHaveBeenCalled()
    expect(pl).toHaveBeenCalled()
    expect(q('[role=slider]').dataset.state).toBe('planned')
  })
})

describe('TickSlider (component 8)', () => {
  it('is a native range with a tick row (11 ticks, majors every 5th) and a paired number field for fine control', () => {
    const on = vi.fn()
    m = mount(<TickSlider label="Brightness" value={30} onChange={on} unit="%" withNumber />)
    const r = q<HTMLInputElement>('input[type=range]')
    expect(r.value).toBe('30')
    expect(r.getAttribute('aria-valuetext')).toBe('30 %')
    expect(m.container.querySelectorAll('.k-ticks i')).toHaveLength(11)
    expect(m.container.querySelectorAll('.k-ticks i[data-major=true]')).toHaveLength(3)
    const n = q<HTMLInputElement>('input[type=number]')
    expect(n.getAttribute('aria-label')).toBe('Brightness, exact value')
  })
  it('planned and disabled do not change the value; planned opens the explanation', () => {
    const on = vi.fn()
    const pl = vi.fn()
    m = mount(<TickSlider label="B" value={3} onChange={on} planned onPlanned={pl} />)
    const r = q<HTMLInputElement>('input[type=range]')
    expect(r.getAttribute('aria-disabled')).toBe('true')
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(r, '9')
      r.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(on).not.toHaveBeenCalled()
    expect(pl).toHaveBeenCalled()
  })
})

describe('Plate (component 10)', () => {
  it('is static text; a status plate carries a lamp; a planned plate is dashed; a link plate is a link; the barcode is decorative', () => {
    m = mount(
      <div>
        <Plate serial="SN 0042" barcode state="live">Core</Plate>
        <Plate planned>Relay</Plate>
        <Plate href="#x">Open</Plate>
      </div>,
    )
    const [a, b, c] = [...m.container.querySelectorAll('.k-plate')]
    expect(a.querySelector('svg')!.getAttribute('data-shape')).toBe('disc')
    expect(a.querySelector('.k-barcode')!.getAttribute('aria-hidden')).toBe('true')
    expect(b.getAttribute('data-state')).toBe('planned')
    expect(c.tagName).toBe('A')
  })
})
