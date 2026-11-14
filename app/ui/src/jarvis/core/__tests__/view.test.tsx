// The Core Talk surface on fixtures (A.J01 accept list): one accent key, hollow everything while asleep, every row with a
// tag and a lamp, no number without LIVE or SIMULATED, the hand-off chip's two forms, J/K/F in the transcript, and no
// timer left running at idle or after unmount.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { mount } from '../../../__tests__/ww/_stubs'
import { CoreFixture } from '../fixtures'
import { HandoffChip } from '../../handoff'
import { PipelineRibbon } from '../PipelineRibbon'
import { OrganStrip } from '../OrganStrip'
import type { Organ } from '../model'

let m: ReturnType<typeof mount> | null = null
afterEach(() => {
  m?.unmount()
  m = null
  vi.useRealTimers()
})

const digits = /\d/

describe('CoreTalkView, asleep', () => {
  it('has exactly one accent key, the Wake key, and it comes first in the tab order', () => {
    m = mount(<CoreFixture kind="asleep" />)
    const c = m.container
    expect(c.querySelectorAll('.jc-wake')).toHaveLength(1)
    const focusables = [...c.querySelectorAll<HTMLElement>('button, input, a[href], [tabindex]:not([tabindex="-1"])')].filter((e) => !e.closest('dialog'))
    expect(focusables[0].classList.contains('jc-wake')).toBe(true)
  })
  it('every ribbon node is hollow and prints OFF; the ring is hollow; no digit in the ribbon', () => {
    m = mount(<CoreFixture kind="asleep" />)
    const c = m.container
    const steps = [...c.querySelectorAll('.jc-rib-step')]
    expect(steps).toHaveLength(4)
    expect(steps.every((s) => s.getAttribute('data-state') === 'waiting')).toBe(true)
    expect(steps.map((s) => s.querySelector('.jc-rib-val')!.textContent)).toEqual(['OFF', 'OFF', 'OFF', 'OFF'])
    expect(digits.test(c.querySelector('.jc-ribbon')!.textContent ?? '')).toBe(false)
    expect(c.querySelector('.jc-sigil')!.getAttribute('data-lit')).toBe('0')
    expect(c.querySelector('.jc-asleep')!.textContent).toContain('Wake JARVIS, or type')
  })
  it('the art slot is there, aria-hidden, and says the private track is off on the default track', () => {
    m = mount(<CoreFixture kind="asleep" />)
    const art = m.container.querySelector('.jc-art')!
    expect(art.getAttribute('aria-hidden')).toBe('true')
    expect(art.querySelector('[data-art-id="art.core.hill-ring"]')).not.toBeNull()
  })
})

describe('CoreTalkView, awake (fixture)', () => {
  it('no accent key once awake; the sleep key is a plain key', () => {
    m = mount(<CoreFixture kind="thinking" />)
    expect(m.container.querySelectorAll('.jc-wake')).toHaveLength(0)
    expect(m.container.querySelector('.jc-sleep')).not.toBeNull()
  })
  it('every transcript row carries a [YOU] or [JRV] tag and a lamp; fixtures are SIMULATED, never LIVE', () => {
    m = mount(<CoreFixture kind="thinking" />)
    const rows = [...m.container.querySelectorAll('.jc-strata .jc-turn')]
    expect(rows).toHaveLength(4)
    for (const r of rows) {
      expect(r.querySelector('.jc-tag')!.textContent).toMatch(/^\[(YOU|JRV)\]$/)
      expect(r.querySelector('.lamp')).not.toBeNull()
      expect(r.getAttribute('data-state')).toBe('simulated')
    }
    expect(m.container.querySelector('[data-lamp="live"]')).toBeNull()
  })
  it('a ribbon number shows only in a LIVE or SIMULATED node; the track without a median is dashed', () => {
    m = mount(<CoreFixture kind="thinking" />)
    for (const s of m.container.querySelectorAll('.jc-rib-step')) {
      const v = s.querySelector('.jc-rib-val')!.textContent ?? ''
      const st = s.getAttribute('data-state')
      if (digits.test(v)) expect(['live', 'simulated']).toContain(st)
    }
    const say = m.container.querySelector('.jc-rib-step[data-stage="say"] .jc-rib-track')!
    expect(say.getAttribute('data-track')).toBe('dashed')
    const think = m.container.querySelector('.jc-rib-step[data-stage="think"] .jc-rib-track')!
    expect(think.getAttribute('data-track')).toBe('fill')
  })
  it('J and K move between turns; F opens the flag dock; Esc closes it', () => {
    m = mount(<CoreFixture kind="thinking" />)
    const list = m.container.querySelector<HTMLElement>('.jc-strata .jc-turns')!
    const rows = () => [...list.querySelectorAll<HTMLElement>('.jc-turn')]
    act(() => rows()[3].focus())
    act(() => { list.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true })) })
    expect(document.activeElement).toBe(rows()[2])
    act(() => { list.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true })) })
    expect(document.activeElement).toBe(rows()[3])
    act(() => { list.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true })) })
    const dock = m.container.querySelector<HTMLElement>('.jc-dock')!
    expect(dock).not.toBeNull()
    expect(dock.textContent).toMatch(/\[(YOU|JRV)\]/)
    act(() => { dock.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(m.container.querySelector('.jc-dock')).toBeNull()
  })
  it('the turn that wrote into Well Wisher carries a hand-off link to the shell route', () => {
    m = mount(<CoreFixture kind="thinking" />)
    const a = m.container.querySelector<HTMLAnchorElement>('a.hc')!
    expect(a.getAttribute('href')).toBe('#/day/today')
    expect(a.textContent).toContain('[WW]')
  })
})

describe('HandoffChip', () => {
  it('without the notify port it is text that says why, never a link', () => {
    m = mount(<HandoffChip product="ww" target="ww/day.today" label="Day 3 Dec 18:00" notifyPresent={false} />)
    expect(m.container.querySelector('a')).toBeNull()
    expect(m.container.textContent).toContain('the day planner is not here')
  })
  it('a target outside the Well Wisher table is refused', () => {
    m = mount(<HandoffChip product="ww" target="ww/core.talk" label="x" />)
    expect(m.container.querySelector('a')).toBeNull()
    expect(m.container.querySelector('[data-state="unavailable"]')).not.toBeNull()
  })
  it('calls onOpen with the shell place instead of following the href', () => {
    const got: unknown[] = []
    m = mount(<HandoffChip product="ww" target="ww/day.today" label="Day" onOpen={(p) => got.push(p)} />)
    act(() => m!.container.querySelector('a')!.click())
    expect(got).toEqual([{ product: 'ww', section: 'day', view: 'today' }])
  })
})

describe('ribbon and organ keyboard', () => {
  it('the ribbon is one tab stop; arrows move', () => {
    m = mount(<PipelineRibbon stages={(['hear', 'write', 'think', 'say'] as const).map((id) => ({ id, state: 'waiting' as const }))} />)
    const nodes = [...m.container.querySelectorAll<HTMLElement>('[data-rib-node]')]
    expect(nodes.filter((n) => n.tabIndex === 0)).toHaveLength(1)
    act(() => nodes[0].focus())
    act(() => { m!.container.querySelector('ol')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
    expect(document.activeElement).toBe(nodes[1])
  })
  it('Enter on an organ opens Anatomy on it', () => {
    const organs: Organ[] = ['brain', 'voice', 'room', 'sense', 'mem'].map((id) => ({ id: id as Organ['id'], name: id.toUpperCase(), reading: { state: 'waiting', since: null, reason: 'not tested' }, source: 't' }))
    const opened: string[] = []
    m = mount(<OrganStrip organs={organs} onOpen={(id) => opened.push(id)} />)
    act(() => m!.container.querySelectorAll<HTMLButtonElement>('.jc-organ')[2].click())
    expect(opened).toEqual(['room'])
    expect(m.container.querySelectorAll('.jc-organ-word')[0].textContent).toBe('not tested')
  })
})

describe('timers', () => {
  it('asleep and idle: no timer runs; unmount leaves none', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    m = mount(<CoreFixture kind="asleep" />)
    expect(vi.getTimerCount()).toBe(0)
    m.unmount()
    m = null
    expect(vi.getTimerCount()).toBe(0)
  })
})
