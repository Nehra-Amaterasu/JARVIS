// The v3 Core Talk stage (owner, 25 Nov): the orb's mode comes from the core's own state word, the waves follow a level only
// from a real frame, the engine's own sentence is shown under the orb, and the conversation is plain readable lines.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import type { CoreInfo } from '../../../lib/api'
import { mount } from '../../../__tests__/ww/_stubs'
import { LOOK_KEY, resetLookForTests } from '../../../shell/look'
import { VoiceSignal } from '../../voice'
import { CoreFixture, pulse, useFixture } from '../fixtures'
import { CoreTalkView } from '../CoreTalk'
import { WAVE_MODE, orbLevel, orbLine, orbModeOf, wavePath, waveTarget } from '../orb'
import { coreViewOf } from '../model'

const core = (over: Partial<CoreInfo>): CoreInfo => ({
  running: true, mode: 'voice', state: 'listening', boot_step: null, pid: 1, started_at: 0, ready_at: 0, uptime_s: 10, last_error: null,
  exit_code: null, timings: {}, room: {}, mqtt: null, ...over,
})

describe('orbModeOf: the core says the mode', () => {
  it('maps every state word the core emits', () => {
    expect(orbModeOf(null)).toBe('asleep')
    expect(orbModeOf(core({ running: false, state: 'offline' }))).toBe('asleep')
    expect(orbModeOf(core({ running: false, state: 'offline', last_error: 'exited with code 1' }))).toBe('fault')
    const map: Record<string, string> = {
      booting: 'waking', listening: 'listening', followup: 'listening', transcribing: 'writing', thinking: 'thinking',
      replying: 'thinking', speaking: 'speaking', idle: 'ready', sleeping: 'ready',
    }
    for (const [state, mode] of Object.entries(map)) expect(orbModeOf(core({ state: state as CoreInfo['state'] })), state).toBe(mode)
  })
  it('shows the engine sentence: last_error when stopped, status_line when it says more than Offline, the press error first', () => {
    const dead = core({ running: false, state: 'offline', last_error: 'voice process exited: microphone not found' })
    expect(orbLine('fault', dead)).toEqual({ text: 'voice process exited: microphone not found', fault: true })
    expect(orbLine('asleep', core({ running: false, status_line: 'Offline: restarting in 15 s' })).text).toBe('Offline: restarting in 15 s')
    expect(orbLine('asleep', core({ running: false, status_line: 'Offline' })).text).toBe('Wake JARVIS to talk or type')
    expect(orbLine('waking', core({ state: 'booting', boot_step: 'loading whisper' })).text).toBe('Starting: loading whisper')
    expect(orbLine('asleep', null, 'Could not wake: no microphone')).toEqual({ text: 'Could not wake: no microphone', fault: true })
  })
})

describe('orbLevel and the waves: a height that follows sound only from a real frame', () => {
  it('no frame: not measured, the plain words, and the wave target is the fixed loop height', () => {
    const s = new VoiceSignal()
    const cv = coreViewOf(core({ state: 'listening' }), Date.now() - 1000)
    const lv = orbLevel(s, cv, Date.now(), 'listening')
    expect(lv.measured).toBe(false)
    expect(lv.text).toBe('MIC no level yet')
    expect(waveTarget('listening', lv)).toBe(WAVE_MODE.listening.amp)
    // a not-measured level never moves the waves, whatever value is passed in
    expect(waveTarget('speaking', { measured: false, value: 1 })).toBe(waveTarget('speaking', { measured: false, value: 0 }))
  })
  it('a fresh frame on the channel the mode reads: measured, a value, the dB as text', () => {
    const s = new VoiceSignal()
    const now = Date.now()
    pulse(s, 'out', 1, now)
    const cv = coreViewOf(core({ state: 'speaking' }), now - 2000)
    const lv = orbLevel(s, cv, now + 60, 'speaking')
    expect(lv.measured).toBe(true)
    expect(lv.channel).toBe('out')
    expect(lv.value).toBeGreaterThan(0)
    expect(lv.text).toBe('SPEAKER -21 dB')
    expect(waveTarget('speaking', lv)).toBeGreaterThan(WAVE_MODE.speaking.amp * 0.5)
    // the same frame read 600 ms later is stale: back to the words, no level
    expect(orbLevel(s, cv, now + 600, 'speaking').measured).toBe(false)
  })
  it('thinking never reads a level, even with frames on the wire', () => {
    const s = new VoiceSignal()
    const now = Date.now()
    pulse(s, 'in', 1, now)
    const lv = orbLevel(s, coreViewOf(core({ state: 'thinking' }), now - 500), now + 10, 'thinking')
    expect(lv.measured).toBe(false)
    expect(lv.text).toBe('no level while thinking')
  })
  it('a wave path spans the field and stays inside it at the largest real height', () => {
    const d = wavePath(0, 1.2, WAVE_MODE.speaking.amp + WAVE_MODE.speaking.live, 0.5, 1)
    const ys = [...d.matchAll(/[ML][\d.]+ ([\d.-]+)/g)].map((m) => Number(m[1]))
    expect(ys.length).toBe(57)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...ys)).toBeLessThanOrEqual(240)
  })
})

describe('CoreTalkView under the v3 look: one stage', () => {
  let m: ReturnType<typeof mount> | null = null
  beforeEach(() => {
    localStorage.setItem(LOOK_KEY, 'v3')
    resetLookForTests()
  })
  afterEach(() => {
    m?.unmount()
    m = null
    localStorage.removeItem(LOOK_KEY)
    resetLookForTests()
  })

  it('asleep: the orb is a wake key with a name, the ONE accent key, the plain line, no terminal brackets', () => {
    m = mount(<CoreFixture kind="asleep" />)
    const c = m.container
    expect(c.querySelector('.jc3')).not.toBeNull()
    const orb = c.querySelector<HTMLButtonElement>('button.jc3-orb')!
    expect(orb.getAttribute('aria-label')).toMatch(/^Wake JARVIS/)
    expect(c.querySelectorAll('.jc-wake')).toHaveLength(1)
    expect(c.querySelector('[data-testid="orb-word"]')!.textContent).toBe('Asleep')
    expect(c.querySelector('[data-testid="orb-line"]')!.textContent).toBe('Wake JARVIS to talk or type')
    expect(c.querySelector('.jc3-hero')!.getAttribute('data-form')).toBe('still') // the fixture holds the still pose
    expect(c.querySelector('.jc3-talk')!.textContent).not.toMatch(/\[(YOU|JRV)\]|you>/)
    // the earlier exchange is named for what it is (a fixture here; "from an earlier run" in the app)
    expect(c.querySelector('.jc3-log .jc3-turns')!.getAttribute('aria-label')).toBe('A fixture exchange, not a recording')
  })

  it('thinking: the word, every turn in one log (newest last), You and Jarvis labels, the four lamps with THINK lit', () => {
    m = mount(<CoreFixture kind="thinking" />)
    const c = m.container
    expect(c.querySelector('[data-testid="orb-word"]')!.textContent).toBe('Thinking')
    expect(c.querySelector('[data-testid="orb-level"]')!.textContent).toContain('no level while thinking')
    const rows = [...c.querySelectorAll('.jc3-log .jc3-turn')]
    expect(rows).toHaveLength(7)
    expect(rows[0].querySelector('.jc3-who')!.textContent).toBe('You')
    expect(rows[1].querySelector('.jc3-who')!.textContent).toBe('Jarvis')
    expect(rows[6].getAttribute('aria-label')).toMatch(/stopping voltage/)
    const lit = [...c.querySelectorAll('.jc3-path-step[data-on]')].map((s) => s.getAttribute('data-stage'))
    expect(lit).toEqual(['think'])
    expect(c.querySelectorAll('.jc-wake')).toHaveLength(0)
    expect(c.querySelector('.jc-sleep')).not.toBeNull()
  })

  it('stopped: the engine sentence is under the orb with the FAULT word, and the orb still wakes', () => {
    m = mount(<CoreFixture kind="fault" />)
    const c = m.container
    expect(c.querySelector('[data-testid="orb-word"]')!.textContent).toBe('Stopped')
    const line = c.querySelector('[data-testid="orb-line"]')!
    expect(line.getAttribute('data-fault')).toBe('true')
    expect(line.textContent).toContain('microphone not found')
    expect(line.textContent).toContain('FAULT')
    expect(c.querySelector('button.jc3-orb')).not.toBeNull()
  })

  it('a Wake press that fails shows the engine answer under the orb, not only in a toast', async () => {
    function Failing() {
      const f = useFixture('asleep')
      return <CoreTalkView {...f} simulated motion="none" actions={{ ...f.actions, wake: async () => { throw new Error('mode must be voice or text') } }} />
    }
    m = mount(<Failing />)
    await act(async () => { m!.container.querySelector<HTMLButtonElement>('.jc-wake')!.click() })
    expect(m.container.querySelector('[data-testid="orb-line"]')!.textContent).toContain('Could not wake: mode must be voice or text')
  })

  it('pressing the orb calls the same wake as the key, with the chosen mode', async () => {
    const calls: string[] = []
    function Spy() {
      const f = useFixture('asleep')
      return <CoreTalkView {...f} simulated motion="none" actions={{ ...f.actions, wake: async (mode) => { calls.push(mode) } }} />
    }
    m = mount(<Spy />)
    const c = m.container
    act(() => c.querySelector<HTMLButtonElement>('.jc3-mode [data-mode="text"]')!.click())
    await act(async () => { c.querySelector<HTMLButtonElement>('button.jc3-orb')!.click() })
    expect(calls).toEqual(['text'])
  })
})
