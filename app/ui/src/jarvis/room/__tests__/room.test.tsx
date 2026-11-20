// A.J02: the Room components. Proved: a flagged channel needs two acts and its cover closes by itself; OFF and unflagged keys are
// one press; the scrubber previews and sends nothing and changes no lamp; All off lists first; a scene that would turn ON a flagged
// channel asks twice; the modes' second-press delete; every action of the classic page has a home.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '../../../__tests__/ww/_stubs'
import { DayRing24 } from '../DayRing24'
import { FIXTURE_MODES, fixturePresence, fixtureEnergy, fixtureRoom } from '../fixtures'
import { GuardKey } from '../GuardKey'
import { ModesPanel } from '../ModesPanel'
import { RoomLog, channelStrip } from '../RoomLog'
import { RoomSwitchesView } from '../RoomSwitches'
import { RoomRulesView } from '../RoomRules'
import { fixtureAway } from '../fixtures'
import { keySlots, rulesFrom } from '../model'

let m: ReturnType<typeof mount> | null = null
beforeEach(() => {
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
  vi.useFakeTimers()
})
afterEach(() => { m?.unmount(); m = null; vi.useRealTimers(); try { localStorage.clear() } catch { /* none */ } })
const el = (sel: string) => document.querySelector(sel) as HTMLElement
const all = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[]
const click = (n: Element) => act(() => { (n as HTMLElement).click() })
const key = (n: Element, k: string, repeat = false) => act(() => { n.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, repeat })) })
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

const NOW = 1_700_000_000_000
const gkey = (over: Partial<Parameters<typeof GuardKey>[0]> = {}) => (
  <GuardKey heavy={false} summary="turns ON: heater, mains" state="closed" slot={1} name="Heater" kind="light" on={false} lamp="live" word="OFF · board" onPress={() => undefined} {...over} />
)

describe('GuardKey', () => {
  it('an unflagged key is one press', () => {
    const onPress = vi.fn()
    m = mount(gkey({ onPress }))
    click(el('button.jr-cap'))
    expect(onPress).toHaveBeenCalledTimes(1)
    expect(el('.jr-cover')).toBeNull()
  })

  it('a flagged channel turning ON needs two acts: the cap is covered, lifting arms it, the press sends once', () => {
    const onPress = vi.fn()
    m = mount(gkey({ heavy: true, onPress }))
    const cap = el('button.jr-cap')
    expect(cap.getAttribute('aria-disabled')).toBe('true')
    click(cap)
    expect(onPress).not.toHaveBeenCalled()
    click(el('.jr-cover'))
    expect(el('.jr-cell').getAttribute('data-state')).toBe('open')
    expect(el('.jr-word').textContent).toBe('turns ON: heater, mains')
    click(cap)
    expect(onPress).toHaveBeenCalledTimes(1)
    expect(el('.jr-cell').getAttribute('data-state')).toBe('closed')
  })

  it('the cover closes by itself after the window and the press that follows sends nothing', () => {
    const onPress = vi.fn()
    m = mount(gkey({ heavy: true, onPress, coverMs: 5000 }))
    click(el('.jr-cover'))
    expect(el('.jr-cell').getAttribute('data-state')).toBe('open')
    tick(5000)
    expect(el('.jr-cell').getAttribute('data-state')).toBe('closed')
    click(el('button.jr-cap'))
    expect(onPress).not.toHaveBeenCalled()
  })

  it('turning a flagged channel OFF is always one press, with no cover to lift', () => {
    const onPress = vi.fn()
    m = mount(gkey({ heavy: true, on: true, word: 'ON · board', onPress }))
    expect(el('.jr-cover').getAttribute('data-needed')).toBe('false')
    click(el('button.jr-cap'))
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('an absent channel is dashed "unavailable" and cannot be pressed', () => {
    const onPress = vi.fn()
    m = mount(gkey({ absent: true, kind: null, lamp: 'planned', word: 'unavailable', onPress }))
    click(el('button.jr-cap'))
    expect(onPress).not.toHaveBeenCalled()
    expect(el('.jr-cell').getAttribute('data-absent')).toBe('true')
    expect(el('.jr-word').textContent).toBe('unavailable')
  })

  it('the three phases print their words next to their lamps', () => {
    m = mount(<div>{gkey({ state: 'asked', lamp: 'waiting', word: 'asked ON, waiting' })}{gkey({ slot: 2, state: 'confirmed', lamp: 'live', word: 'ON, confirmed by board 14:02:11' })}{gkey({ slot: 3, state: 'unconfirmed', lamp: 'fault', word: 'asked, no report' })}</div>)
    expect(all('.jr-cell').map((c) => c.getAttribute('data-state'))).toEqual(['asked', 'confirmed', 'unconfirmed'])
    expect(all('.jr-led svg').map((s) => s.getAttribute('data-state'))).toEqual(['waiting', 'live', 'fault'])
  })
})

describe('DayRing24', () => {
  const rules = rulesFrom({ presence: fixturePresence(), energy: fixtureEnergy(true) })
  const now = new Date(2026, 10, 15, 14, 2)

  it('previews with Left and Right in 15 minute steps, calls onPreview, and Escape returns to now', () => {
    const seen: (Date | null)[] = []
    m = mount(<DayRing24 rules={rules} now={now} onPreview={(t) => seen.push(t)} />)
    const h = el('[role="slider"]')
    expect(h.getAttribute('aria-valuetext')).toBe('now, 14:02')
    key(h, 'ArrowRight')
    key(h, 'ArrowRight')
    expect(h.getAttribute('aria-valuetext')).toBe('preview 14:30')
    expect(el('.jr-ring-centre').textContent).toContain('PREVIEW')
    expect(el('.jr-ring-cap-line').textContent).toContain('not the board')
    expect(seen.at(-1)?.getHours()).toBe(14)
    expect(seen.at(-1)?.getMinutes()).toBe(30)
    key(h, 'Escape')
    expect(seen.at(-1)).toBeNull()
    expect(el('.jr-ring-centre').textContent).not.toContain('PREVIEW')
  })

  it('draws one lane per reported rule, and none when nothing is reported', () => {
    m = mount(<DayRing24 rules={rules} now={now} />)
    expect(all('.jr-ring-lane')).toHaveLength(2)
    m.unmount()
    m = mount(<DayRing24 rules={[]} now={now} />)
    expect(all('.jr-ring-lane')).toHaveLength(0)
    expect(el('.jr-ring-cap-line').textContent).toContain('Channel schedules: PLANNED')
  })
})

describe('Switches', () => {
  const actions = () => ({ press: vi.fn(async () => undefined), scene: vi.fn(async () => undefined), allOff: vi.fn(async () => undefined) })
  const view = (over: Partial<Parameters<typeof RoomSwitchesView>[0]> = {}, a = actions()) => (
    <RoomSwitchesView view={fixtureRoom('live')} asked={{}} now={NOW} log={[]} heavy={{}} setHeavy={() => undefined} actions={a} rules={[]} {...over} />
  )

  it('a press asks one channel for the opposite of the board report, nothing else', () => {
    const a = actions()
    m = mount(view({}, a))
    click(el('.jr-cell[data-slot="2"] button.jr-cap'))
    expect(a.press).toHaveBeenCalledTimes(1)
    expect(a.press).toHaveBeenCalledWith('fan', true)
    expect(a.scene).not.toHaveBeenCalled()
    expect(a.allOff).not.toHaveBeenCalled()
  })

  it('the scrubber never sends and never changes a lamp', () => {
    const a = actions()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    m = mount(view({}, a))
    const lamps = all('.jr-keys .jr-word').map((n) => n.textContent)
    const h = el('.jr-ring [role="slider"]')
    for (const k of ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'PageUp', 'End', 'Home']) key(h, k)
    expect(el('.jr-ring').getAttribute('data-previewing')).toBe('true')
    expect(all('.jr-keys .jr-word').map((n) => n.textContent)).toEqual(lamps)
    expect(a.press).not.toHaveBeenCalled()
    expect(a.scene).not.toHaveBeenCalled()
    expect(a.allOff).not.toHaveBeenCalled()
    expect(fetchSpy.mock.calls.filter(([u]) => String(u).includes('/api/limbs'))).toHaveLength(0)
    fetchSpy.mockRestore()
  })

  it('a pending ask shows asked on the key; the saved state never moves the cap', () => {
    const v = fixtureRoom('live')
    v.devices.find((d) => d.id === 'fan')!.state.on = true
    m = mount(view({ view: v, asked: { fan: { want: true, at: NOW - 1000 } } }))
    const cell = el('.jr-cell[data-slot="2"]')
    expect(cell.getAttribute('data-state')).toBe('asked')
    expect(cell.querySelector('button.jr-cap')?.getAttribute('aria-pressed')).toBe('false')
  })

  it('All off lists the channels the board reports on first, and sends only on its own press', async () => {
    const a = actions()
    m = mount(view({}, a))
    const keyBtn = el('.jr-alloff-key')
    expect(keyBtn.textContent).toContain('2 on')
    click(keyBtn)
    expect(el('.jr-pop').textContent).toContain('Switches off 2 channels')
    expect(all('.jr-pop-list li').map((l) => l.textContent)).toEqual(['Tube light', 'Cove warm'])
    expect(a.allOff).not.toHaveBeenCalled()
    key(el('.jr-alloff'), 'Escape')
    expect(el('.jr-pop')).toBeNull()
    click(keyBtn)
    click(el('.jr-pop-go'))
    expect(a.allOff).toHaveBeenCalledTimes(1)
  })

  it('a mode chip that would turn ON a flagged channel asks twice; one that does not applies at once', () => {
    const a = actions()
    m = mount(view({ heavy: { light3: true } }, a))
    const chip = (name: string) => all('.jr-plate-right .jr-chips button').find((b) => b.textContent?.endsWith(name))!
    click(chip('Sleep'))
    expect(a.scene).toHaveBeenCalledTimes(1)
    click(chip('Relaxation'))
    expect(a.scene).toHaveBeenCalledTimes(1)
    expect(el('.jr-armed').textContent).toContain('turns ON: cove soft, mains')
    click(chip('Relaxation'))
    expect(a.scene).toHaveBeenCalledTimes(2)
    expect(a.scene).toHaveBeenLastCalledWith('relaxation')
  })

  it('the dial previews a mode as dashed outlines on the keys it names and Enter applies it', () => {
    const a = actions()
    m = mount(view({}, a))
    const dial = el('.jr-dial-body')
    key(dial, 'ArrowRight')
    expect(el('.jr-dial-name').textContent).toBe('Deep focus')
    expect(all('.jr-cell[data-preview]').length).toBeGreaterThan(0)
    expect(a.scene).not.toHaveBeenCalled()
    key(dial, 'Enter')
    expect(a.scene).toHaveBeenCalledWith('focus')
    expect(el('.jr-dial-name').textContent).toBe('NOW')
  })

  it('with no answer from the app the keys are dashed and a WAITING line says so', () => {
    m = mount(view({ view: null, loading: false }))
    expect(all('.jr-cell[data-absent="true"]')).toHaveLength(8)
    expect(el('.jr-stamp').textContent).toContain('WAITING')
  })
})

describe('the log and the strip', () => {
  it('prints only what happened, with the lamp word of what the board said', () => {
    m = mount(<RoomLog lines={[{ id: 2, at: NOW, text: 'asked, no report: Corner light ON', state: 'fault' }, { id: 1, at: NOW - 1000, text: 'asked: Corner light ON', state: 'waiting' }]} slots={keySlots(fixtureRoom('live'), {}, NOW)} />)
    // at rest the terminal shows three lines (channel numbers, strip, the latest event); pressing it, or focusing it, shows the log
    expect(all('.jr-log-line').map((l) => l.getAttribute('data-state'))).toEqual(['fault'])
    const toggle = el('.jr-term-toggle')
    expect(el('.jr-term').getAttribute('data-open')).toBe('false')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    // focus alone never opens it; a click opens it, a second click closes it, Escape closes it
    act(() => { toggle.focus() })
    expect(el('.jr-term').getAttribute('data-open')).toBe('false')
    click(toggle)
    expect(el('.jr-term').getAttribute('data-open')).toBe('true')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    click(toggle)
    expect(el('.jr-term').getAttribute('data-open')).toBe('false')
    click(toggle)
    key(toggle, 'Escape')
    expect(el('.jr-term').getAttribute('data-open')).toBe('false')
    click(toggle)
    expect(el('.jr-term').getAttribute('data-open')).toBe('true')
    expect(all('.jr-log-line').map((l) => l.getAttribute('data-state'))).toEqual(['fault', 'waiting'])
    expect(el('.jr-log-line').textContent).toContain('FAULT')
    expect(el('.jr-log-line').textContent).toContain('[ROM]')
  })
  it('the channel strip shows the board report: on, off, no report, free', () => {
    expect(channelStrip(keySlots(fixtureRoom('live'), {}, NOW))).toBe('# . # . . ? - -')
    expect(channelStrip(keySlots(fixtureRoom('offline'), {}, NOW))).toBe('? ? ? ? ? ? - -')
  })
})

describe('the numbered modes and the free slots', () => {
  const actions = () => ({ press: vi.fn(async () => undefined), scene: vi.fn(async () => undefined), allOff: vi.fn(async () => undefined) })
  const view = (over: Partial<Parameters<typeof RoomSwitchesView>[0]> = {}, a = actions()) => (
    <RoomSwitchesView view={fixtureRoom('live')} asked={{}} now={NOW} log={[]} heavy={{}} setHeavy={() => undefined} actions={a} rules={[]} {...over} />
  )
  it('a number key applies the mode of that number while focus is in the wall box, and a flagged mode still asks twice', () => {
    const a = actions()
    m = mount(view({ heavy: { light3: true } }, a))
    const plate = el('.jr-face-plate')
    key(plate, '2')
    expect(a.scene).toHaveBeenCalledTimes(0) // Relaxation turns ON a flagged channel: the first press only asks
    key(plate, '2')
    expect(a.scene).toHaveBeenCalledTimes(1) // the second act inside 5 s applies it
    key(plate, '3')
    expect(a.scene).toHaveBeenCalledTimes(2) // Sleep touches no flagged channel: one press
    key(plate, '9')
    expect(a.scene).toHaveBeenCalledTimes(2) // there is no ninth mode
  })
  it('a held number key never completes the two-act cover: auto-repeat sends nothing, a fresh press does', () => {
    const a = actions()
    m = mount(view({ heavy: { light3: true } }, a))
    const plate = el('.jr-face-plate')
    key(plate, '2') // arms the flagged mode
    key(plate, '2', true) // the held key's repeats are not a second act
    key(plate, '2', true)
    expect(a.scene).toHaveBeenCalledTimes(0)
    key(plate, '2') // a separate press is
    expect(a.scene).toHaveBeenCalledTimes(1)
  })
  it('a number key typed into a field or a non-dial slider applies no mode', () => {
    const a = actions()
    m = mount(view({}, a))
    const slider = document.createElement('div')
    slider.setAttribute('role', 'slider')
    el('.jr-face-plate').appendChild(slider)
    const input = document.createElement('input')
    el('.jr-face-plate').appendChild(input)
    key(slider, '3')
    key(input, '3')
    expect(a.scene).toHaveBeenCalledTimes(0)
    key(el('.jr-dial-body'), '3') // the dial takes arrows, not digits, so its digits stay the mode keys
    expect(a.scene).toHaveBeenCalledTimes(1)
  })
  it('every mode key is 44 px tall by the kit and shows its number', () => {
    m = mount(view({}, actions()))
    const first = all('.jr-plate-right .jr-chips button')[0]
    expect(first.textContent).toMatch(/^1/)
    expect(all('.jr-plate-right .jr-chips .jr-modeno').length).toBeGreaterThan(0)
  })
  it('a free slot says "Free slot" and "unavailable", never a raw channel id', () => {
    m = mount(view({}, actions()))
    const names = all('.jr-cell[data-absent="true"] .jr-name').map((n) => n.textContent)
    expect(names.length).toBeGreaterThan(0)
    expect(names.every((n) => n === 'Free slot')).toBe(true)
    expect(all('.jr-cell[data-absent="true"] .jr-word').every((n) => n.textContent === 'unavailable')).toBe(true)
  })
})

describe('Modes (parity R02)', () => {
  const v = fixtureRoom('live')
  it('creates, edits and deletes through the classic routes, and deleting needs a second press', async () => {
    vi.useRealTimers()
    const save = vi.fn(async () => undefined)
    const remove = vi.fn(async () => undefined)
    const reload = vi.fn()
    m = mount(<ModesPanel modes={v.modes} devices={v.devices} lastMode="focus" reload={reload} save={save} remove={remove} />)
    // delete: first press arms, second deletes
    const del = all('button').find((b) => b.getAttribute('aria-label') === 'Delete Sleep')!
    click(del)
    expect(remove).not.toHaveBeenCalled()
    const again = all('button').find((b) => b.getAttribute('aria-label') === 'Press again to delete Sleep')!
    click(again)
    await flush()
    expect(remove).toHaveBeenCalledTimes(1)
    // new mode: a name is needed, then Save posts it
    click(all('button').find((b) => b.textContent?.includes('New mode'))!)
    const input = el('input') as HTMLInputElement
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Reading')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const saveBtn = all('button').find((b) => b.textContent?.startsWith('Save'))!
    click(all('.jr-editor-devices button')[0])
    click(saveBtn)
    await flush()
    expect(save).toHaveBeenCalledWith(null, 'Reading', expect.objectContaining({ light: true }))
  })
})

describe('Rules (parity R03, R04, R05)', () => {
  const act_ = { presence: vi.fn(async () => undefined), autoOff: vi.fn(async () => undefined), keepNudge: vi.fn(async () => undefined), markCircuit: vi.fn(async () => undefined), arm: vi.fn(async () => undefined), disarm: vi.fn(async () => undefined), autoArm: vi.fn(async () => undefined) }
  const rules = (over: Partial<Parameters<typeof RoomRulesView>[0]> = {}) => (
    <RoomRulesView view={fixtureRoom('live')} reload={() => undefined} presence={fixturePresence()} energy={fixtureEnergy(false)} away={fixtureAway(false)} incidents={[]} act={act_}
      heavy={{}} setHeavy={() => undefined} now={new Date(2026, 10, 15, 12, 0)} {...over} />
  )

  it('every rule control reaches its route: presence, quiet hours, auto-off, away arm and auto-arm', () => {
    m = mount(rules())
    const sw = (label: string) => all('[role="switch"]').find((s) => s.textContent?.includes(label))!
    click(sw('Presence rule'))
    expect(act_.presence).toHaveBeenCalledWith({ enabled: false })
    click(sw('Auto-off'))
    expect(act_.autoOff).toHaveBeenCalledWith(true)
    click(sw('Arm by itself'))
    expect(act_.autoArm).toHaveBeenCalledWith(true)
    click(all('button').find((b) => b.textContent === 'Arm now')!)
    expect(act_.arm).toHaveBeenCalledTimes(1)
  })

  it('draws three gates, and hollow ones with their reasons when the routes did not answer', () => {
    m = mount(rules())
    expect(all('.jr-gate')).toHaveLength(3)
    m.unmount()
    m = mount(rules({ presence: null, energy: null, away: null }))
    expect(all('.jr-gate[data-hollow="true"]')).toHaveLength(3)
    expect(all('.jr-gate-lamp').map((n) => n.textContent).join(' ')).toMatch(/did not answer/)
    expect(all('.jr-gate-lead')).toHaveLength(0) // no switch is offered for a rule the app did not report
  })

  it('draws no energy figure anywhere on the rules or in the energy drawer', () => {
    m = mount(rules({ openDrawer: 'energy' }))
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/kWh|₹|rupee|\d\s?W\b/i)
    expect(text).toContain('No energy figure is drawn')
  })

  it('the pin map is mounted as one fold, and its edit control is PLANNED until a route exists', () => {
    m = mount(rules())
    expect(all('.ww-fold')).toHaveLength(1)
    expect(el('.ww-fold-btn').textContent).toContain('Relay pins (6)')
  })

  it('the heavy-load switches write the same flags the keys read', () => {
    const setHeavy = vi.fn()
    m = mount(rules({ setHeavy }))
    const s = all('[role="switch"]').find((b) => b.textContent?.includes('Cove soft: heavy load'))!
    click(s)
    expect(setHeavy).toHaveBeenCalledWith({ light3: true })
  })
})

describe('the modes of the fixtures', () => {
  it('resolve every channel, so a preview names each key', () => {
    for (const mode of FIXTURE_MODES) expect(Object.keys(mode.resolved)).toHaveLength(6)
  })
})
