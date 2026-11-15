// The Console's parts and views rendered on fixtures (A.J05): the honest states in the DOM (a bar fills only to a reported
// fraction, a dial with no reading is a dashed ring, FAULT is the word and its reason), the two-press guard, the command
// line's ask-once flow, the events filter, the flash gate in the Hardware view and the crew states.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { mount } from '../../../__tests__/ww/_stubs'
import { CommandDeck } from '../CommandDeck'
import { ConnectionsView } from '../Connections'
import { CrewView } from '../Crew'
import { EventsView } from '../Events'
import { HardwareView } from '../Hardware'
import { HealthView } from '../Health'
import { BOARD_USB, BOARD_WIFI, BRAIN, EVENTS, FEED, FIXED_NOW, INTEGRATIONS, LIMBS, PORTS, healthLive } from '../fixtures'
import { gpuModel } from '../model'
import { GuardKey, JobRow, RoutePlates, VramDial } from '../parts'
import { JARVIS_PLANNED } from '../../planned'
import type { CommandContext } from '../commands'
import { healthRows } from '../model'
import { LAT_ON, VITALS_ON } from '../fixtures'

let m: ReturnType<typeof mount> | null = null
beforeEach(() => { window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia })
afterEach(() => { m?.unmount(); m = null })

const click = (el: Element | null) => { act(() => { (el as HTMLElement).click() }) }
const keydown = (el: Element, key: string) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) })
const text = (root: ParentNode = document.body) => (root.textContent ?? '').replace(/\s+/g, ' ')

function typeInto(input: HTMLInputElement, value: string) {
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('JobRow: a bar fills only to a reported fraction', () => {
  it('a fraction fills the track and says the percent', () => {
    m = mount(<ul><JobRow label="compile" fraction={0.64} state="live" /></ul>)
    expect(m.container.querySelector('.jx-job')?.getAttribute('data-hollow')).toBeNull()
    expect(text(m.container)).toContain('64 %')
    expect(m.container.querySelector('.g-bar-track')?.getAttribute('aria-valuenow')).toBe('0.64')
  })
  it('no fraction is a hollow dashed track and no percent, whatever the state says', () => {
    m = mount(<ul><JobRow label="wake" state="live" /></ul>)
    expect(m.container.querySelector('.jx-job')?.getAttribute('data-hollow')).toBe('true')
    expect(text(m.container)).not.toMatch(/\d+ %/)
    expect(m.container.querySelector('.g-bar-track')?.getAttribute('aria-label')).toMatch(/no value/)
  })
  it('an out-of-range fraction is hollow too', () => {
    m = mount(<ul><JobRow label="odd" fraction={1.4} state="live" /></ul>)
    expect(m.container.querySelector('.jx-job')?.getAttribute('data-hollow')).toBe('true')
  })
  it('a failure is the triangle and its reason, no bar', () => {
    m = mount(<ul><JobRow label="flash" state="fault" reason="the board did not answer" /></ul>)
    expect(m.container.querySelector('.jx-job-fault')?.textContent).toContain('the board did not answer')
    expect(m.container.querySelector('.g-bar')).toBeNull()
  })
})

describe('VramDial', () => {
  it('draws the used arc for a reading and names it for a screen reader', () => {
    m = mount(<VramDial model={gpuModel(VITALS_ON)} />)
    expect(m.container.querySelector('.jx-dial-used')).not.toBeNull()
    expect(m.container.querySelector('[role="img"]')?.getAttribute('aria-label')).toMatch(/3\.8 of 6\.0 GB used, 64 percent/)
  })
  it('with no reading it is a dashed ring with no number and says WAITING', () => {
    m = mount(<VramDial model={gpuModel(null)} />)
    expect(m.container.querySelector('.jx-dial-used')).toBeNull()
    expect(m.container.querySelector('.jx-dial')?.getAttribute('data-hollow')).toBe('true')
    expect(m.container.querySelector('.jx-dial-num')?.textContent).toBe('--')
    expect(text(m.container)).toContain('WAITING')
  })
})

describe('GuardKey: the first press arms, the second runs, Esc disarms', () => {
  it('runs only on the second press', () => {
    const run = vi.fn()
    m = mount(<GuardKey label="Restart brain" armedLabel="Restart now?" onConfirm={run} />)
    const b = () => m!.container.querySelector('button')!
    click(b())
    expect(run).not.toHaveBeenCalled()
    expect(b().textContent).toBe('Restart now?')
    click(b())
    expect(run).toHaveBeenCalledTimes(1)
    expect(b().textContent).toBe('Restart brain')
  })
  it('Esc disarms without running', () => {
    const run = vi.fn()
    m = mount(<GuardKey label="Unload" onConfirm={run} />)
    click(m.container.querySelector('button'))
    keydown(m.container.querySelector('button')!, 'Escape')
    expect(m.container.querySelector('button')!.textContent).toBe('Unload')
    expect(run).not.toHaveBeenCalled()
  })
})

describe('RoutePlates', () => {
  it('draws one plate per entry with its state word and opens the card on a press', () => {
    const open = vi.fn()
    m = mount(<RoutePlates registry={JARVIS_PLANNED.slice(0, 4)} onOpen={open} />)
    const plates = [...m.container.querySelectorAll<HTMLElement>('[data-plate]')]
    expect(plates).toHaveLength(4)
    expect(plates[0].getAttribute('data-plate')).toBe(JARVIS_PLANNED[0].id)
    expect(plates[0].textContent).toContain('PLANNED')
    click(plates[1])
    expect(open).toHaveBeenCalledWith(JARVIS_PLANNED[1].id)
    expect(plates.filter((p) => p.tabIndex === 0)).toHaveLength(1) // one tab stop
  })
})

describe('CommandDeck: ask once, and only then run', () => {
  const rows = healthRows({ online: true, lat: LAT_ON, crew: null, vitals: VITALS_ON, now: FIXED_NOW })
  const mk = () => {
    const ctx: CommandContext = { rows: () => rows, jobs: () => [], plan: () => JARVIS_PLANNED, restartBrain: vi.fn(async () => 'restarting JARVIS'), freeGpu: vi.fn(async () => 'freed'), exportMemory: null }
    return ctx
  }
  const enter = (input: HTMLInputElement, v: string) => { typeInto(input, v); keydown(input, 'Enter') }

  it('a heavy verb shows its question and does not call the route until Run is pressed', async () => {
    const ctx = mk()
    m = mount(<CommandDeck ctx={ctx} />)
    const input = m.container.querySelector<HTMLInputElement>('.cl-input')!
    enter(input, 'restart brain')
    expect(m.container.querySelector('.jx-ask')).not.toBeNull()
    expect(text(m.container)).toContain('restart brain: stop and start the brain')
    expect(ctx.restartBrain).not.toHaveBeenCalled()
    await act(async () => { (m!.container.querySelector('.jx-ask button') as HTMLElement).click() })
    expect(ctx.restartBrain).toHaveBeenCalledTimes(1)
    expect(text(m.container)).toContain('restarting JARVIS')
    expect(m.container.querySelector('.jx-ask')).toBeNull()
  })

  it('Esc cancels the question and says nothing changed', () => {
    const ctx = mk()
    m = mount(<CommandDeck ctx={ctx} />)
    enter(m.container.querySelector<HTMLInputElement>('.cl-input')!, 'free gpu')
    keydown(m.container.querySelector('.jx-ask button')!, 'Escape')
    expect(m.container.querySelector('.jx-ask')).toBeNull()
    expect(text(m.container)).toContain('free gpu: cancelled, nothing changed')
    expect(ctx.freeGpu).not.toHaveBeenCalled()
  })

  it('an unknown word cannot be sent: the line says so and nothing is added to the answers', () => {
    m = mount(<CommandDeck ctx={mk()} />)
    const input = m.container.querySelector<HTMLInputElement>('.cl-input')!
    enter(input, 'rm -rf')
    expect(text(m.container.querySelector('.cl-say')!)).toContain('unknown verb; try help')
    expect(m.container.querySelectorAll('.jx-out')).toHaveLength(0)
  })

  it('a read verb answers at once; an argument is refused', () => {
    m = mount(<CommandDeck ctx={mk()} />)
    const input = m.container.querySelector<HTMLInputElement>('.cl-input')!
    enter(input, 'status')
    expect(m.container.querySelectorAll('.jx-out').length).toBeGreaterThan(1)
    enter(input, 'jobs now')
    expect(text(m.container)).toContain('jobs takes no argument')
  })

  it('Tab completes a verb prefix', () => {
    m = mount(<CommandDeck ctx={mk()} />)
    const input = m.container.querySelector<HTMLInputElement>('.cl-input')!
    typeInto(input, 'rest')
    keydown(input, 'Tab')
    expect(input.value).toBe('restart brain')
  })
})

describe('HealthView', () => {
  it('draws seven bracket-tagged rows each with a lamp, the dial and the keys', () => {
    m = mount(<HealthView live={healthLive('running')} simulated />)
    expect([...m.container.querySelectorAll('.jx-row')].map((r) => r.getAttribute('data-tag'))).toEqual(['HEA', 'WAK', 'TIM', 'BRN', 'GPU', 'STW', 'APP'])
    expect(m.container.querySelectorAll('.jx-row .lamp')).toHaveLength(7)
    expect(m.container.querySelector('.jx-dial')).not.toBeNull()
    expect(text(m.container)).toContain('FIXTURE, SIMULATED')
    expect(m.container.querySelectorAll('.jx-keys .jx-key')).toHaveLength(3)
  })
  it('first run: the dial and the job board and the log are hollow, with their reasons', () => {
    m = mount(<HealthView live={healthLive('first')} simulated />)
    expect(m.container.querySelector('.jx-dial')?.getAttribute('data-hollow')).toBe('true')
    expect(text(m.container)).toContain('asleep, nothing is listening')
    expect(text(m.container.querySelector('.jx-jobs-card')!)).toContain('nothing is running')
    expect(text(m.container.querySelector('.jx-ridges')!)).toContain('no timed reply yet')
    expect(text(m.container)).toContain('JARVIS has not run in this session')
    expect(text(m.container)).toContain('Start JARVIS')
  })
  it('a failure shows FAULT with the reason in the rows and in the job board', () => {
    m = mount(<HealthView live={healthLive('fault')} simulated />)
    const fault = [...m.container.querySelectorAll('.jx-row[data-state="fault"]')]
    expect(fault.length).toBeGreaterThan(0)
    expect(text(fault[0])).toContain('FAULT')
    expect(text(m.container.querySelector('.jx-jobs-card')!)).toContain('the unload route did not answer')
  })
  it('the log tail is the stream it was given, and says so when there is none', () => {
    m = mount(<HealthView live={{ ...healthLive('running'), logs: null }} simulated />)
    expect(text(m.container)).toContain('the log has not answered')
  })
  it('a restart key needs two presses and then calls the action once', async () => {
    const live = healthLive('running')
    const restart = vi.fn(async () => 'restarting JARVIS: x')
    m = mount(<HealthView live={{ ...live, actions: { ...live.actions, restartBrain: restart } }} simulated />)
    const key = () => m!.container.querySelector<HTMLElement>('.jx-keys .jx-key')!
    click(key())
    expect(restart).not.toHaveBeenCalled()
    await act(async () => { key().click() })
    expect(restart).toHaveBeenCalledTimes(1)
    expect(text(m.container.querySelector('.jx-note')!)).toContain('restarting JARVIS: x')
  })
})

describe('EventsView', () => {
  it('shows the newest last with its lamp and says SIMULATED on a generated line', () => {
    m = mount(<EventsView events={EVENTS} online now={FIXED_NOW} simulated />)
    const rows = [...m.container.querySelectorAll('.jx-ev')]
    expect(rows.length).toBeGreaterThan(5)
    expect(text(m.container)).toContain('SIMULATED')
    expect(rows.some((r) => r.getAttribute('data-state') === 'fault')).toBe(true)
  })
  it('the filter field narrows the list and says how many it shows', () => {
    m = mount(<EventsView events={EVENTS} online now={FIXED_NOW} />)
    typeInto(m.container.querySelector<HTMLInputElement>('#jx-filter')!, 'core !sim since:1h')
    expect(text(m.container.querySelector('.jx-filter-say')!)).toMatch(/showing 5 of 10/)
    expect([...m.container.querySelectorAll('.jx-ev .jx-tag')].every((t) => t.textContent === '[CORE]')).toBe(true)
  })
  it('a bad since: is named and the list is not guessed', () => {
    m = mount(<EventsView events={EVENTS} online now={FIXED_NOW} />)
    typeInto(m.container.querySelector<HTMLInputElement>('#jx-filter')!, 'since:soon')
    expect(text(m.container.querySelector('.jx-filter-say')!)).toContain('try since:30m')
  })
  it('an empty stream says nothing has happened and the stream is closed', () => {
    m = mount(<EventsView events={[]} online={false} now={FIXED_NOW} />)
    expect(text(m.container)).toContain('nothing has happened yet')
    expect(m.container.querySelector('[aria-label*="event stream closed"]')).not.toBeNull()
  })
  it('pressing a source adds its tag to the filter and pressing again removes it', () => {
    m = mount(<EventsView events={EVENTS} online now={FIXED_NOW} />)
    const src = () => m!.container.querySelector<HTMLElement>('.jx-source')!
    click(src())
    expect(m.container.querySelector<HTMLInputElement>('#jx-filter')!.value).toBe('core')
    click(src())
    expect(m.container.querySelector<HTMLInputElement>('#jx-filter')!.value).toBe('')
  })
})

describe('HardwareView: no flash while the app holds the port', () => {
  const open = (board: typeof BOARD_USB) => {
    m = mount(<HardwareView board={board} ports={PORTS} limbs={LIMBS} now={FIXED_NOW * 1000} initialTab="firmware" panels={{ firmware: <p id="classic-firmware">classic firmware card</p> }} />)
  }
  it('on the USB link the folder says flash is closed and never mounts the card that holds the flash keys', () => {
    open(BOARD_USB)
    expect(m!.container.querySelector('[data-flash="closed"]')).not.toBeNull()
    expect(m!.container.querySelector('#classic-firmware')).toBeNull()
    expect([...m!.container.querySelectorAll('button')].some((b) => /flash/i.test(b.textContent ?? ''))).toBe(false)
    expect(text(m!.container)).toContain('close the app to flash')
  })
  it('with the port free the firmware card is mounted', () => {
    open(BOARD_WIFI)
    expect(m!.container.querySelector('[data-flash="closed"]')).toBeNull()
    expect(m!.container.querySelector('#classic-firmware')).not.toBeNull()
  })
  it('a relay is confirmed only when the board said so; the unconfirmed one says sent, not acknowledged', () => {
    open(BOARD_WIFI)
    const rows = [...m!.container.querySelectorAll('.sp-rack-row')]
    expect(rows.map((r) => r.getAttribute('data-state'))).toEqual(['confirmed', 'confirmed', 'unconfirmed'])
  })
  it('the Scan key calls the port scan and is a 44 px key in the Ports head', () => {
    const scan = vi.fn()
    m = mount(<HardwareView board={BOARD_WIFI} ports={PORTS} limbs={LIMBS} onScan={scan} />)
    const key = [...m.container.querySelectorAll<HTMLElement>('.jx-head .jx-key')].find((k) => k.textContent === 'Scan')!
    click(key)
    expect(scan).toHaveBeenCalledTimes(1)
  })
  it('a board that has not answered draws WAITING rows, not zeros', () => {
    m = mount(<HardwareView board={null} ports={null} limbs={null} />)
    expect(m.container.querySelectorAll('.jx-board .jx-row[data-state="waiting"]').length).toBe(6)
    expect(text(m.container)).not.toMatch(/uptime 0/)
  })
})

describe('ConnectionsView', () => {
  it('lists each integration with its one status word and the counts', () => {
    m = mount(<ConnectionsView items={INTEGRATIONS} brain={BRAIN} onChoose={() => {}} onRestart={() => {}} />)
    expect(m.container.querySelectorAll('.jx-int')).toHaveLength(INTEGRATIONS.length)
    expect(text(m.container.querySelector('.jx-counts')!)).toContain('4 connected')
    expect(m.container.querySelector('[data-integration="mqtt"]')?.getAttribute('data-status')).toBe('missing')
  })
  it('choosing a brain model calls the action; a model with a reason is not chosen', () => {
    const choose = vi.fn()
    m = mount(<ConnectionsView items={INTEGRATIONS} brain={BRAIN} onChoose={choose} onRestart={() => {}} />)
    const radios = [...m.container.querySelectorAll<HTMLElement>('[role="radio"]')]
    expect(radios).toHaveLength(3)
    click(radios[2]) // too large for the GPU
    expect(choose).not.toHaveBeenCalled()
    click(radios[0])
    expect(choose).toHaveBeenCalledWith('fixture-brain:8b')
    expect(text(radios[2])).toContain('too large for a 6 GB GPU')
  })
  it('a pending restart offers the guarded restart key', () => {
    const restart = vi.fn()
    m = mount(<ConnectionsView items={INTEGRATIONS} brain={BRAIN} onChoose={() => {}} onRestart={restart} />)
    const key = m.container.querySelector<HTMLElement>('.jx-pending .jx-key')!
    click(key)
    expect(restart).not.toHaveBeenCalled()
    click(m.container.querySelector('.jx-pending .jx-key'))
    expect(restart).toHaveBeenCalledTimes(1)
  })
  it('pressing an integration opens its detail with the next step', () => {
    m = mount(<ConnectionsView items={INTEGRATIONS} brain={BRAIN} onChoose={() => {}} onRestart={() => {}} />)
    click(m.container.querySelector('[data-integration="mqtt"]'))
    expect(text(m.container.querySelector('.jx-detail')!)).toContain('winget install mosquitto')
  })
  it('a scan that has not answered is WAITING, not an empty list', () => {
    m = mount(<ConnectionsView items={null} loading brain={null} onChoose={() => {}} onRestart={() => {}} />)
    expect(text(m.container)).toContain('scanning ports')
    expect(m.container.querySelectorAll('.jx-int')).toHaveLength(0)
  })
})

describe('CrewView', () => {
  const load = { status: 'ok' as const, view: { agents: [
    { id: 'steward', name: 'Steward', role: 'checks', state: 'idle' as const, summary: 'ok', data: {}, health: { runs: 1, errors: 0, last_error: null, avg_ms: 1, last_tick: FIXED_NOW - 5, cadence_s: 60 } },
    { id: 'led', name: 'Ledger', role: 'counts', state: 'error' as const, summary: 'broke', data: {}, health: { runs: 1, errors: 1, last_error: 'locked', avg_ms: 1, last_tick: FIXED_NOW - 5, cadence_s: 60 } },
  ], events: [] } }
  it('an errored agent is FAULT with its last error; a running roster says LIVE', () => {
    m = mount(<CrewView load={load} feed={FEED} now={FIXED_NOW} onRun={() => {}} />)
    expect(m.container.querySelector('[data-agent="led"]')?.getAttribute('data-state')).toBe('fault')
    expect(m.container.querySelector('[data-agent="led"] .lamp')?.getAttribute('aria-label')).toContain('locked')
    expect(m.container.querySelector('[data-agent="steward"]')?.getAttribute('data-state')).toBe('live')
  })
  it('Run calls the route for that agent', () => {
    const run = vi.fn()
    m = mount(<CrewView load={load} feed={[]} now={FIXED_NOW} onRun={run} />)
    click(m.container.querySelector('[data-agent="steward"] .jx-key'))
    expect(run).toHaveBeenCalledWith('steward')
  })
  it('a staff that is not running is one WAITING line; one that cannot be reached is FAULT with the message', () => {
    m = mount(<CrewView load={{ status: 'absent' }} feed={[]} now={FIXED_NOW} />)
    expect(text(m.container)).toContain('the staff is not running yet')
    m.render(<CrewView load={{ status: 'error', message: 'refused' }} feed={[]} now={FIXED_NOW} />)
    expect(text(m.container)).toContain('the staff cannot be reached: refused')
    expect(text(m.container)).toContain('FAULT')
  })
  it('the route shows the planned registry and the built count', () => {
    m = mount(<CrewView load={{ status: 'absent' }} feed={[]} now={FIXED_NOW} onOpenPlate={() => {}} />)
    expect(m.container.querySelectorAll('[data-plate]').length).toBeGreaterThan(5)
    expect(text(m.container.querySelector('.jx-route-card')!)).toMatch(/\d+ of \d+ on the route/)
  })
})
