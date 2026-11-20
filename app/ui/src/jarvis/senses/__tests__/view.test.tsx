// The three Senses views on fixtures (A.J03 accept list): at most one canvas per view, the amber stamp on simulated frames,
// every form hollow with no frames, no digit in the arc before the held-out check, the twin only when 3D is selected, and
// no forbidden word anywhere in the rendered text.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, type ComponentProps } from 'react'
import { mount } from '../../../__tests__/ww/_stubs'
import { SENSES_SENTENCE, copyProblems, splitHow } from '../model'
import { SensesFrame, SensesSelect } from '../parts'
import type { SensesState } from '../store'
import type { FrameMsg } from '../../../twin/SpatialTwin'
import { FIXTURE_NOW, fixtureState, fixtureStore, type FixtureKind } from '../fixtures'
import { PresenceView } from '../PresenceView'
import { SignalView } from '../SignalView'
import { TeachView } from '../TeachView'

// the twin pulls WebGL in, which the test does not need: a stand-in marks where it would be
vi.mock('../TwinStage', () => ({ default: () => <div data-testid="twin-host" /> }))

let m: ReturnType<typeof mount> | null = null
// no server in a unit test: every call the desk makes on mount fails quietly, as it does with the app closed
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') })) })
afterEach(() => { m?.unmount(); m = null; vi.unstubAllGlobals() })

const store = fixtureStore()
const view = (v: 'presence' | 'signal' | 'teach', kind: FixtureKind, fixture = true) => {
  const props = { state: fixtureState(kind), store, fixture }
  return v === 'presence' ? <PresenceView {...props} /> : v === 'signal' ? <SignalView {...props} /> : <TeachView {...props} />
}
const text = (c: HTMLElement) => (c.textContent ?? '').replace(/\s+/g, ' ')

describe('Presence', () => {
  it('holds one canvas, stamps simulated frames and draws the arc without a digit before the held-out check', () => {
    m = mount(view('presence', 'simulated'))
    const c = m.container
    expect(c.querySelectorAll('canvas')).toHaveLength(1)
    expect(c.querySelector('.js-stamp-sim')?.textContent).toBe('SIMULATED')
    expect(c.querySelector('.js-arc')?.getAttribute('data-trusted')).toBe('false')
    const core = text(c.querySelector('.js-core')!)
    expect(core).toContain('PREDICTING')
    expect(core).toContain('signal estimate, 3 of 7 drill days')
    expect(core).not.toMatch(/\d+ ?%/)
    expect(c.querySelector('.js-terrain-legend')).toBeNull()
  })
  it('prints the one honest sentence once, in the frame slot, and the view itself prints none', () => {
    m = mount(view('presence', 'simulated'))
    expect(m.container.querySelector('[data-testid="senses-sentence"]')).toBeNull()
    m.unmount()
    for (const v of ['presence', 'signal', 'teach'] as const) {
      m = mount(<SensesFrame text={SENSES_SENTENCE}>{view(v, 'simulated')}</SensesFrame>)
      const slots = m.container.querySelectorAll('.js-frame > [data-testid="senses-sentence"]')
      expect(slots).toHaveLength(1)
      expect(m.container.querySelectorAll('[data-testid="senses-sentence"]')).toHaveLength(1)
      expect(slots[0].textContent).toBe('Detects motion of anyone in range, identifies no one. One link, no pose.')
      m.unmount()
    }
    m = null
  })
  it('only the source key is a warm fill, and the lists are the kit-style select, not the system one', () => {
    m = mount(view('presence', 'none'))
    const c = m.container
    expect(c.querySelectorAll('select')).toHaveLength(0)
    expect(c.querySelectorAll('.js-primary')).toHaveLength(1)
    expect(c.querySelector('.js-start')?.textContent).toBe('Start ESP32')
    expect(c.querySelector('[aria-label="Simulated scenario"]')?.getAttribute('role')).toBe('combobox')
    expect(c.querySelector('[aria-label="Predicting"]')).not.toBeNull()
    expect(c.querySelector('[aria-label="Corrections"] [aria-label="Right"]')).not.toBeNull()
    expect(c.querySelector('[aria-label="Corrections"] [role="combobox"]')).not.toBeNull()
    expect([...c.querySelectorAll('.js-ctl-label')].map((e) => e.textContent)).toEqual(['Sensing', 'Fan'])
  })
  it('the scenario list opens opaque with its options and closes on Escape', async () => {
    m = mount(view('presence', 'simulated'))
    const c = m.container
    const trigger = c.querySelector<HTMLElement>('button[aria-label="Simulated scenario"]')!
    await act(async () => { trigger.click() })
    const list = document.body.querySelector<HTMLElement>('[role="listbox"]')!
    expect(list).not.toBeNull()
    expect([...list.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toEqual(['evening', 'walk', 'still', 'quiet'])
    await act(async () => { list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(document.body.querySelector('[role="listbox"]')).toBeNull()
  })
  it('with no frames every form is hollow, with the reason in words, and no stamp', () => {
    m = mount(view('presence', 'none'))
    const c = m.container
    expect(c.querySelector('.js-terrain-legend')?.textContent).toBe('NO SIGNAL: shape is a placeholder')
    expect(c.querySelector('.js-stamp-sim')).toBeNull()
    expect(c.querySelectorAll('.js-dot-hollow')).toHaveLength(51)
    expect(text(c.querySelector('.js-core')!)).toContain('NO SIGNAL')
    expect(c.querySelector('.js-terrain')?.getAttribute('data-source')).toBe('none')
    // the Start key is the one accent fill while no source runs
    expect(c.querySelectorAll('.js-primary')).toHaveLength(1)
  })
  it('after the held-out day the number appears, as a model estimate', () => {
    m = mount(view('presence', 'trusted'))
    const core = text(m.container.querySelector('.js-core')!)
    expect(core).toContain('74 %')
    expect(core).toContain('model estimate, held-out day passed')
    expect(core).not.toContain('PREDICTING')
  })
  it('a server that does not answer is a FAULT lamp and draws no source', () => {
    m = mount(view('presence', 'offline'))
    expect(m.container.querySelector('.js-core [data-lamp="fault"]')).not.toBeNull()
    expect(m.container.querySelector('.js-presence')?.getAttribute('data-source')).toBe('none')
  })
  it('the tape is hatched for paused and blank is not proof: its caption says so', () => {
    m = mount(view('presence', 'simulated'))
    const c = m.container
    act(() => { [...c.querySelectorAll<HTMLElement>('.js-choice-sm button')].find((b) => b.textContent === 'Tape')!.click() })
    expect(c.querySelector('[data-testid="motion-tape"]')).not.toBeNull()
    expect(c.querySelector('.js-tape-seen')).not.toBeNull()
    expect(c.querySelector('.js-tape-paused')).not.toBeNull()
    expect(text(c.querySelector('.js-tape-caption')!)).toContain('Blank means nothing was seen, not that no one was there.')
  })
  it('the 3D twin mounts only when 3D is pressed, and the terrain canvas goes first', async () => {
    m = mount(view('presence', 'simulated', false))
    const c = m.container
    expect(c.querySelector('[data-testid="twin-host"]')).toBeNull()
    expect(c.querySelectorAll('canvas')).toHaveLength(1)
    const key = [...c.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === '3D')!
    await act(async () => { key.click(); await new Promise((r) => setTimeout(r, 20)) })
    expect(c.querySelectorAll('canvas')).toHaveLength(0)
    expect(c.querySelector('[data-testid="twin-host"]')).not.toBeNull()
    await act(async () => { key.click() })
    expect(c.querySelectorAll('canvas')).toHaveLength(1)
  })
  it('in a specimen the 3D key says why it does nothing', () => {
    m = mount(view('presence', 'simulated'))
    const key = [...m.container.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === '3D')!
    expect(key.getAttribute('aria-disabled')).toBe('true')
    expect(key.getAttribute('title')).toMatch(/not drawn in a specimen/)
  })
  it('every control is a real button, select or switch with a name', () => {
    m = mount(view('presence', 'simulated'))
    const unnamed = [...m.container.querySelectorAll<HTMLElement>('button, select, [role="radio"]')].filter((e) => !(e.getAttribute('aria-label') || e.textContent?.trim() || e.getAttribute('title')))
    expect(unnamed).toHaveLength(0)
  })
})

describe('Signal', () => {
  it('is SVG only: no canvas, 51 bars, the narration and the sentence', () => {
    m = mount(view('signal', 'simulated'))
    const c = m.container
    expect(c.querySelectorAll('canvas')).toHaveLength(0)
    expect(c.querySelectorAll('.js-bar')).toHaveLength(51)
    expect(c.querySelector('.js-narration')?.textContent).toContain('Simulated: Motion score 3.2x against a threshold of 1.8x')
    expect(c.querySelector('[data-testid="senses-sentence"]')).toBeNull()
    expect(c.querySelector('[data-testid="motion-score"]')?.textContent).toBe('3.2x')
  })
  it('draws the motion score as a dial with its threshold tick, and Sensors and Events as one ledger', () => {
    m = mount(view('signal', 'simulated'))
    const c = m.container
    expect(c.querySelector('.js-dial-value')).not.toBeNull()
    expect(c.querySelector('.js-dial-thr')).not.toBeNull()
    expect(c.querySelector('.js-dial svg')?.getAttribute('aria-label')).toContain('threshold 1.80x')
    expect(c.querySelectorAll('.js-p-ledger')).toHaveLength(1)
    expect([...c.querySelectorAll('.js-p-ledger .js-eyebrow')].map((e) => e.textContent?.replace(/SIMULATED/i, '').trim())).toEqual(['Sensors', 'Events'])
    expect(c.querySelector('.js-p-events')).toBeNull()
    expect([...c.querySelectorAll('.js-axis-lab span')].map((e) => e.textContent)).toEqual(['1', '26', '51'])
  })
  it('with no frames the dial is hollow with a dash at the hub, the sine says no frames, and the ledger rows are ruled and say why', () => {
    m = mount(view('signal', 'none'))
    const c = m.container
    expect(c.querySelector('.js-dial')?.getAttribute('data-hollow')).toBe('true')
    expect(c.querySelector('.js-dial-value')).toBeNull()
    expect(c.querySelector('.js-dial-thr')).toBeNull()
    expect(c.querySelector('.js-trace-wrap .js-hollow-label')?.textContent).toBe('no frames')
    expect(c.querySelector('.js-spec-wrap .js-hollow-label')?.textContent).toBe('no frames')
    expect(c.querySelectorAll('.js-ledger-empty')).toHaveLength(2)
    expect(text(c.querySelector('.js-thr')!)).toBe('threshold --')
  })
  it('Go to Presence is a key that goes through onGo', () => {
    const onGo = vi.fn()
    m = mount(<SignalView state={fixtureState('none')} store={store} fixture onGo={onGo} />)
    const key = m.container.querySelector<HTMLElement>('.js-go button')!
    expect(key.textContent).toBe('Go to Presence')
    act(() => { key.click() })
    expect(onGo).toHaveBeenCalledWith('presence')
  })
  it('with no frames the bars are hollow, the number is a dash and nothing is invented', () => {
    m = mount(view('signal', 'none'))
    const c = m.container
    expect(c.querySelectorAll('.js-bar[data-hollow="true"]')).toHaveLength(51)
    expect(c.querySelector('[data-testid="motion-score"]')?.textContent).toBe('--')
    expect(c.querySelector('.js-narration')?.textContent).toContain('No frames are arriving')
    expect(c.querySelector('.js-trace-hollow')).not.toBeNull()
  })
})

describe('Teach', () => {
  it('shows four rings with a real fraction each and says predicting until the last is lit', () => {
    m = mount(view('teach', 'simulated'))
    const c = m.container
    const rings = [...c.querySelectorAll('.js-ring')]
    expect(rings.map((r) => r.getAttribute('data-ring'))).toEqual(['room', 'quiet', 'drill', 'heldout'])
    expect(rings[2].querySelectorAll('.js-ring-seg')).toHaveLength(7)
    expect(rings[2].querySelectorAll('.js-ring-seg[data-on="true"]')).toHaveLength(3)
    expect(text(c)).toContain('Until the last ring is lit it says predicting.')
    expect(c.querySelectorAll('canvas')).toHaveLength(0)
  })
  it('counts the steps as n of 4 and stays WAITING until all four are lit', () => {
    m = mount(view('teach', 'simulated'))
    const c = m.container
    expect(c.querySelector('[data-testid="steps-count"]')?.textContent).toBe('0 of 4')
    expect(c.querySelector('.js-p-rings .js-panel-head [data-lamp]')?.getAttribute('data-lamp')).toBe('waiting')
    m.unmount()
    m = mount(view('teach', 'trusted'))
    expect(m.container.querySelector('[data-testid="steps-count"]')?.textContent).toBe('4 of 4')
    expect(m.container.querySelector('.js-p-rings .js-panel-head [data-lamp]')?.getAttribute('data-lamp')).toBe('simulated')
  })
  it('each ring has a one-line caption, and each step is a sentence with its command behind a copy key', () => {
    m = mount(view('teach', 'simulated'))
    const c = m.container
    expect([...c.querySelectorAll('.js-ring-word')].map((e) => e.textContent)).toEqual(['not measured', '1 of 2', '3 of 7 days', 'not passed'])
    const rows = [...c.querySelectorAll('.js-todo li')]
    expect(rows.length).toBeGreaterThan(0)
    const withCmd = rows.filter((x) => x.querySelector('.js-copy'))
    expect(withCmd.length).toBeGreaterThan(0)
    for (const r of withCmd) {
      expect(r.querySelector('small')?.textContent).not.toMatch(/python/)
      expect(r.querySelector('.js-copy')?.getAttribute('title')).toMatch(/^python -m aankhen/)
    }
  })
  it('the mini-drill tiles are a fixed four-column grid whose last tile spans the free cells; Start has its reason beside it', () => {
    m = mount(view('teach', 'simulated'))
    const c = m.container
    const tiles = [...c.querySelectorAll<HTMLElement>('.js-tiles')[0].querySelectorAll<HTMLElement>('.js-tile')]
    expect(tiles.length).toBe(2)
    expect(tiles[1].style.gridColumn).toBe('span 3')
    expect(tiles[0].style.gridColumn).toBe('')
    expect(text(c.querySelector('[data-testid="mini-reason"]')!)).toContain('a mini drill records the real board')
    expect(c.querySelector('.js-p-desk .js-panel-head [data-lamp]')?.getAttribute('data-lamp')).toBe('simulated')
  })
  it('with the readiness unread every ring is hollow and says so', () => {
    m = mount(view('teach', 'unread'))
    const c = m.container
    expect([...c.querySelectorAll('.js-ring')].every((r) => r.getAttribute('data-known') === 'false')).toBe(true)
    expect(c.querySelectorAll('.js-ring-seg[data-on="true"]')).toHaveLength(0)
  })
  it('has the teach desk, the spatial model and one accent key', () => {
    m = mount(view('teach', 'simulated'))
    const c = m.container
    expect(c.querySelector('.js-p-desk')).not.toBeNull()
    expect(c.querySelector('.js-p-learned')).not.toBeNull()
    expect(c.querySelectorAll('.js-primary')).toHaveLength(1)
    // predicting: the learned rows carry no digit
    expect(text(c.querySelector('.js-p-learned')!)).not.toMatch(/\d+ ?%/)
  })
})

describe('splitHow', () => {
  it('splits a sentence from the command behind it, and leaves plain text whole', () => {
    expect(splitHow('Leave the room empty, fan off: python -m aankhen calibrate --seconds 120')).toEqual({ sentence: 'Leave the room empty, fan off.', command: 'python -m aankhen calibrate --seconds 120' })
    expect(splitHow('After day 7: python -m aankhen evaluate --json data/x/lodo.json')).toEqual({ sentence: 'After day 7.', command: 'python -m aankhen evaluate --json data/x/lodo.json' })
    expect(splitHow('Open Measure my room and enter the walls.')).toEqual({ sentence: 'Open Measure my room and enter the walls.', command: null })
  })
  it('does not take a tool named in prose for a command: only "sentence: command" splits', () => {
    expect(splitHow('Use python 3.11 or newer for this step')).toEqual({ sentence: 'Use python 3.11 or newer for this step', command: null })
    expect(splitHow('Run npm install first')).toEqual({ sentence: 'Run npm install first', command: null })
    expect(splitHow('Open the python docs')).toEqual({ sentence: 'Open the python docs', command: null })
    expect(splitHow(': python -m aankhen drill')).toEqual({ sentence: ': python -m aankhen drill', command: null })
    expect(splitHow('')).toEqual({ sentence: '', command: null })
  })
})

describe('the words on screen', () => {
  const cases: ['presence' | 'signal' | 'teach', FixtureKind][] = [
    ['presence', 'simulated'], ['presence', 'none'], ['presence', 'trusted'], ['presence', 'offline'],
    ['signal', 'simulated'], ['signal', 'none'], ['teach', 'simulated'], ['teach', 'unread'],
  ]
  it.each(cases)('%s (%s) says no forbidden word and no pose', (v, kind) => {
    m = mount(view(v, kind))
    const t = text(m.container)
    expect(copyProblems(t)).toEqual([])
    expect(t).not.toMatch(/\b(face|skeleton|pose estimate|silhouette)\b/i)
  })
})

/* ------------------------------------------------------------------ review fixes (EL-SENSES, round 2) */

const live = (): SensesState => { const s = fixtureState('simulated'); return { ...s, latest: { ...s.latest!, source: 'hardware' } as FrameMsg } }
const lampOf = (c: HTMLElement, sel: string) => c.querySelector(`${sel} .js-panel-head [data-lamp]`)?.getAttribute('data-lamp')

describe('the desk lamp follows the source, never the server alone', () => {
  const desk = (state: SensesState, fixture = false) => <TeachView state={state} store={store} fixture={fixture} />
  it('WAITING with no source, with or without a running training job (a job keeps its own reading)', () => {
    m = mount(desk(fixtureState('none')))
    expect(lampOf(m.container, '.js-p-desk')).toBe('waiting')
    m.unmount()
    const job = { ...fixtureState('none').train!.job, state: 'running' as const, fraction: 0.4 }
    m = mount(desk({ ...fixtureState('none'), train: { ...fixtureState('none').train!, job } }))
    expect(lampOf(m.container, '.js-p-desk')).toBe('live')
  })
  it('SIMULATED when the only source is the simulation, even without the fixture flag', () => {
    m = mount(desk(fixtureState('simulated'), false))
    expect(lampOf(m.container, '.js-p-desk')).toBe('simulated')
  })
  it('LIVE only for the board, WAITING again once the frames go silent', () => {
    m = mount(desk(live()))
    expect(lampOf(m.container, '.js-p-desk')).toBe('live')
    m.unmount()
    m = mount(desk({ ...live(), lastAt: FIXTURE_NOW - 60000 }))
    expect(lampOf(m.container, '.js-p-desk')).toBe('waiting')
  })
})

describe('the Signal ledger and the baseline text follow the source', () => {
  it('a silent source is WAITING with a dash for the baseline, although the last frame is still held', () => {
    m = mount(<SignalView state={{ ...fixtureState('simulated'), lastAt: FIXTURE_NOW - 60000 }} store={store} fixture />)
    expect(lampOf(m.container, '.js-p-ledger')).toBe('waiting')
    const band = text(m.container.querySelector('.js-band .js-readline')!)
    expect(band).toContain('baseline --')
    expect(band).not.toContain('fixture')
  })
  it('SIMULATED with the simulation and LIVE with the board', () => {
    m = mount(<SignalView state={fixtureState('simulated')} store={store} fixture />)
    expect(lampOf(m.container, '.js-p-ledger')).toBe('simulated')
    expect(text(m.container.querySelector('.js-band .js-readline')!)).toContain('baseline fixture')
    m.unmount()
    m = mount(<SignalView state={live()} store={store} />)
    expect(lampOf(m.container, '.js-p-ledger')).toBe('live')
  })
})

describe('SensesSelect', () => {
  const OPTS = [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Bravo' }, { id: 'c', label: 'Charlie' }]
  const key = (el: Element, k: string) => act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })) })
  const open = async (props: Partial<ComponentProps<typeof SensesSelect>> = {}) => {
    const onChange = vi.fn()
    m = mount(<SensesSelect options={OPTS} value="a" onChange={onChange} label="Pick" placeholder="Pick one" {...props} />)
    const trigger = m.container.querySelector<HTMLButtonElement>('button[role="combobox"]')!
    await act(async () => { trigger.click() })
    return { onChange, trigger }
  }
  it('draws the list on the page body, not inside the clipping card', async () => {
    const { trigger } = await open()
    const list = document.body.querySelector('[role="listbox"]')!
    expect(list).not.toBeNull()
    expect(m!.container.contains(list)).toBe(false)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
  })
  it('arrow, Enter picks the option, closes the list and returns focus to the trigger', async () => {
    const { onChange, trigger } = await open()
    const list = document.body.querySelector('[role="listbox"]')!
    await key(list, 'ArrowDown')
    await key(list, 'Enter')
    expect(onChange).toHaveBeenCalledWith('b')
    expect(document.body.querySelector('[role="listbox"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
  it('End and Home move the cursor, a letter jumps to its option, Tab closes', async () => {
    const { onChange } = await open()
    const list = () => document.body.querySelector('[role="listbox"]')!
    await key(list(), 'End')
    await key(list(), 'Enter')
    expect(onChange).toHaveBeenLastCalledWith('c')
    await act(async () => { m!.container.querySelector<HTMLButtonElement>('button[role="combobox"]')!.click() })
    await key(list(), 'b')
    await key(list(), 'Enter')
    expect(onChange).toHaveBeenLastCalledWith('b')
    await act(async () => { m!.container.querySelector<HTMLButtonElement>('button[role="combobox"]')!.click() })
    await key(list(), 'Tab')
    expect(document.body.querySelector('[role="listbox"]')).toBeNull()
  })
  it('a click on an option picks it', async () => {
    const { onChange } = await open()
    await act(async () => { document.body.querySelectorAll<HTMLElement>('[role="option"]')[2].click() })
    expect(onChange).toHaveBeenCalledWith('c')
  })
  it('a disabled select opens nothing and says why, in its name as well as its title', async () => {
    const { onChange, trigger } = await open({ disabledReason: 'Needs frames from the board' })
    expect(document.body.querySelector('[role="listbox"]')).toBeNull()
    expect(trigger.getAttribute('aria-disabled')).toBe('true')
    expect(trigger.textContent).toContain('Needs frames from the board')
    expect(onChange).not.toHaveBeenCalled()
  })
  it('the cursor never points past the end when the options shrink while open', async () => {
    const { onChange } = await open()
    const list = () => document.body.querySelector('[role="listbox"]')!
    await key(list(), 'End')
    await act(async () => { m!.render(<SensesSelect options={OPTS.slice(0, 1)} value="a" onChange={onChange} label="Pick" placeholder="Pick one" />) })
    await key(list(), 'Enter')
    expect(onChange).toHaveBeenLastCalledWith('a')
  })
})

describe('Copy command', () => {
  const rig = (writeText: (s: string) => Promise<void>) => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const toast = vi.fn()
    m = mount(<TeachView state={fixtureState('simulated')} store={store} fixture toast={toast} />)
    return { toast, chip: m.container.querySelector<HTMLButtonElement>('.js-copy')! }
  }
  it('puts the command on the clipboard and says so', async () => {
    const writeText = vi.fn(async () => {})
    const { toast, chip } = rig(writeText)
    expect(chip.getAttribute('aria-label')).toMatch(/^Copy command, /)
    await act(async () => { chip.click() })
    expect(writeText).toHaveBeenCalledWith(chip.getAttribute('title'))
    expect(toast).toHaveBeenCalledWith('Command copied', 'info')
  })
  it('a refused clipboard is a fault toast that prints the command so it can be copied by hand', async () => {
    const { toast, chip } = rig(async () => { throw new Error('denied') })
    await act(async () => { chip.click() })
    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast.mock.calls[0][1]).toBe('fault')
    expect(toast.mock.calls[0][0]).toContain(chip.getAttribute('title'))
  })
})

describe('the mini-drill grid spans the free cells for any number of places', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])('%i places end on a full row', (n) => {
    const zones = Array.from({ length: n }, (_, i) => ({ id: `z${i}`, name: `Place ${i}`, dwell_s: 30 }))
    m = mount(<TeachView state={{ ...fixtureState('simulated'), zones }} store={store} fixture />)
    const tiles = [...m.container.querySelectorAll<HTMLElement>('.js-tiles')[0].querySelectorAll<HTMLElement>('.js-tile')]
    expect(tiles).toHaveLength(n)
    const spans = tiles.map((t) => Number(/span (\d)/.exec(t.style.gridColumn)?.[1] ?? 1))
    expect(spans.reduce((a, b) => a + b, 0) % 4).toBe(0)
    expect(spans.slice(0, -1).every((s) => s === 1)).toBe(true)
  })
})

describe('one warm fill per view, whatever the source', () => {
  const kinds: FixtureKind[] = ['none', 'simulated', 'trusted', 'offline', 'unread']
  it.each([['presence' as const], ['signal' as const], ['teach' as const]].flatMap(([v]) => kinds.map((k) => [v, k] as const)))('%s (%s)', (v, k) => {
    m = mount(view(v, k))
    expect(m.container.querySelectorAll('.js-primary:not([aria-disabled="true"])').length).toBeLessThanOrEqual(1)
  })
})
