// A.N02 (g), 15.6 rule 2: the three globbed folders. A later package adds one file and never edits hosts.ts,
// ShellV2.tsx or ids.ts. The collectors are pure functions over the module record `import.meta.glob` returns, so a
// fixture record with the same keys stands in for a file on disk; the real folders must load with no error.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { mount } from '../ww/_stubs'
import { collectViews, setViewsForTests, VIEWS, type ViewRegistration } from '../../shell/views'
import { collectSlots, Slot, SLOTS } from '../../shell/slots'
import { collectModes, modeOf, MODES, type ShellMode } from '../../shell/modes'
import ShellV2 from '../../shell/ShellV2'
import { resetShellForTests, useShell } from '../../shell/store'
import { resetPortsForTests } from '../../shell/ports'

const page = (id: string) => () => createElement('section', { 'data-registered': id }, `registered ${id}`)
const reg = (id: string, product: 'jarvis' | 'ww' = 'jarvis'): ViewRegistration => ({ id, product, load: async () => ({ default: page(id) }) })

describe('the real folders load with no refused file (the merge test of 20.14)', () => {
  it('views, slots and modes', () => {
    expect(VIEWS.errors).toEqual([])
    expect(SLOTS.errors).toEqual([])
    expect(MODES.errors).toEqual([])
  })
})

describe('shell/views/*.view.ts', () => {
  it('indexes a default or a named `view` export and refuses what is not a view of the table', () => {
    const got = collectViews({
      './core.view.ts': { default: reg('core.talk') },
      './day-month.view.ts': { view: reg('day.month', 'ww') },
      './ghost.view.ts': { default: reg('core.ghost') },
      './wrong.view.ts': { default: reg('room.rules', 'ww') },
      './twice.view.ts': { default: reg('core.talk') },
      './empty.view.ts': {},
    })
    expect([...got.byId.keys()].sort()).toEqual(['core.talk', 'day.month'])
    expect(got.errors).toEqual([
      './empty.view.ts: exports no ViewRegistration',
      './ghost.view.ts: core.ghost is not a view of the id table',
      './twice.view.ts: core.talk is already registered',
      './wrong.view.ts: room.rules belongs to jarvis, not ww',
    ])
  })

  describe('a registered view mounts in the canvas with no other edit', () => {
    let m: ReturnType<typeof mount> | null = null
    beforeEach(() => {
      localStorage.clear()
      resetShellForTests()
      resetPortsForTests()
    })
    afterEach(() => {
      m?.unmount()
      m = null
      setViewsForTests(null)
    })

    it('replaces the legacy host and the PLANNED plate, lazily', async () => {
      setViewsForTests(collectViews({ './room.view.ts': { default: reg('room.switches') }, './x.view.ts': { default: reg('day.month', 'ww') } }).byId.size ? [reg('room.switches'), reg('day.month', 'ww')] : [])
      const stub = () => createElement('div', { 'data-stub': 'legacy' })
      m = mount(createElement(ShellV2, { pages: { limbs: stub, core: stub }, wwRoot: stub, verbs: [], serverUp: true }))
      await act(async () => useShell.getState().go({ product: 'jarvis', section: 'room', view: 'switches' }))
      await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
      expect(m.container.querySelector('[data-registered="room.switches"]')).not.toBeNull()
      expect(m.container.querySelector('[data-stub="legacy"]')).toBeNull()
      await act(async () => useShell.getState().go({ product: 'ww', section: 'day', view: 'month' }))
      await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
      expect(m.container.querySelector('[data-registered="day.month"]')).not.toBeNull()
      expect(m.container.querySelector('[data-notbuilt]')).toBeNull()
    })

    it('an id with no registration and no host shows the PLANNED plate', () => {
      m = mount(createElement(ShellV2, { pages: {}, wwRoot: null, verbs: [], serverUp: true }))
      act(() => useShell.getState().go({ product: 'ww', section: 'day', view: 'month' }))
      const plate = m.container.querySelector('[data-notbuilt="day.month"]')
      expect(plate).not.toBeNull()
      expect(plate!.querySelector('[data-lamp="planned"], .lamp')).not.toBeNull()
    })
  })
})

describe('shell/slots/<slot>.<name>.tsx', () => {
  it('groups by slot in path order and refuses an unknown slot or a file with no component', () => {
    const A = () => createElement('i', { 'data-a': '' })
    const B = () => createElement('i', { 'data-b': '' })
    const got = collectSlots({ './titlebar-sigil.b.tsx': { default: B }, './titlebar-sigil.a.tsx': { default: A }, './sidebar.x.tsx': { default: A }, './notify.y.tsx': {} })
    expect(got.bySlot['titlebar-sigil'].map((x) => x.path)).toEqual(['./titlebar-sigil.a.tsx', './titlebar-sigil.b.tsx'])
    expect(got.errors).toHaveLength(2)
    const m = mount(createElement('div', null, createElement(Slot, { name: 'titlebar-sigil', from: got }), createElement(Slot, { name: 'boot', from: got })))
    expect(m.container.innerHTML).toBe('<div><i data-a=""></i><i data-b=""></i></div>')
    m.unmount()
  })
})

describe('shell/modes/*.mode.ts', () => {
  const mode = (id: string, prefix: string): ShellMode => ({ id, prefix, run: (q) => [{ id: `${id}.${q}`, group: 'Do', label: `${id}: ${q}` }] })
  it('a prefix is punctuation only and unique; the longer prefix wins; an ordinary query opens no mode', () => {
    const got = collectModes({ './a.mode.ts': { default: mode('settings', ':') }, './b.mode.ts': { mode: mode('deep', '::') }, './c.mode.ts': { default: mode('word', 'go') }, './d.mode.ts': { default: mode('again', ':') } })
    expect(got.list.map((m) => m.id)).toEqual(['deep', 'settings'])
    expect(got.errors).toHaveLength(2)
    expect(modeOf(':theme', got)?.mode.id).toBe('settings')
    expect(modeOf(':theme', got)?.rest).toBe('theme')
    expect(modeOf('::x', got)?.mode.id).toBe('deep')
    expect(modeOf('console', got)).toBeNull()
  })
})
