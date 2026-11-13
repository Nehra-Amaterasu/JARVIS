// A.N02 (c): the keyboard-reach spec was flaky because the two-way frame bridge could move the place with no key
// pressed. The loop, reproduced here with a fake frame that behaves like the real one under rapid keys: the real
// Frame runs each workspace switch inside a view transition, and a second switch within 600 ms skips the first
// (shared/motion/transition.ts) but the skipped transition's update callback still runs LATER, so the frame
// lands on the older target. The frame then reports that stale place, the shell's frame -> shell subscription
// followed it, and the shell's own place moved back without a key.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { mount } from '../ww/_stubs'
import { resetShellForTests, useShell } from '../../shell/store'
import { resetPortsForTests } from '../../shell/ports'

type Fn = (ws: string, view: string | null) => void

/** A frame whose cross-workspace switch commits late, after any switch that followed it (the skipped-VT order). */
const fake = vi.hoisted(() => {
  const state = { ws: 'life', view: 'today' as string | null }
  const listeners = new Set<Fn>()
  let stale: (() => void)[] = []
  const set = (ws: string, view: string | null) => {
    if (state.ws === ws && state.view === view) return
    state.ws = ws
    state.view = view
    for (const l of listeners) l(ws, view)
  }
  return {
    state,
    calls: [] as string[],
    reset() {
      state.ws = 'life'
      state.view = 'today'
      stale = []
      listeners.clear()
      this.calls.length = 0
    },
    /** the late callbacks of transitions a newer switch skipped */
    flushStale() {
      const run = stale
      stale = []
      for (const f of run) f()
    },
    /** a jump made inside the frame (Tree's "Study this node"), no shell key involved */
    jump(ws: string, view: string | null) {
      set(ws, view)
    },
    bridge: {
      registry: { entries: [], byId: () => undefined, forHome: () => [] },
      switchTo(ws: string, view: string | null) {
        fake.calls.push(`${ws}/${view}`)
        // same workspace, or a second switch inside 600 ms (the rapid path: the change runs at once, and the
        // transition it skipped keeps its late callback)
        if (ws === state.ws || stale.length > 0) {
          set(ws, view)
          return Promise.resolve()
        }
        // a view transition: the change waits for the next frame; if another switch comes first, this one is
        // skipped and its change still runs afterwards (the stale order)
        return new Promise<void>((done) => {
          stale.push(() => {
            set(ws, view)
            done()
          })
        })
      },
      current: () => ({ ws: state.ws, view: state.view }),
      subscribe(fn: Fn) {
        listeners.add(fn)
        return () => void listeners.delete(fn)
      },
    },
  }
})

vi.mock('../../pageLoaders', () => ({
  loadJarvisRegistry: null,
  loadWwShell: () => Promise.resolve(fake.bridge),
}))

const { default: ShellV2 } = await import('../../shell/ShellV2')

let m: ReturnType<typeof mount> | null = null
const view = () => m!.container.querySelector<HTMLElement>('.s2-page')!.dataset
const key = (k: string, init: KeyboardEventInit = {}) =>
  act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })))
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('shell.product', 'ww')
  fake.reset()
  resetShellForTests()
  resetPortsForTests()
  m = mount(createElement(ShellV2, { pages: {}, wwRoot: () => createElement('div', { 'data-stub': 'ww' }), verbs: [], serverUp: true }))
  await settle() // the lazy bridge arrives
})
afterEach(() => {
  m?.unmount()
  m = null
})

describe('the frame bridge never moves the place without a key', () => {
  it('rapid ] through Study: the late commit of a skipped switch does not pull the shell back', async () => {
    key('3', { ctrlKey: true }) // study.papers: the frame starts a cross-workspace switch to study
    expect(view().view).toBe('papers')
    key(']') // study.practice: focus / drill
    key(']') // study.plan: study / plan
    expect(view().view).toBe('plan')
    // the skipped transitions commit now, in the stale order
    await act(async () => {
      fake.flushStale()
      await Promise.resolve()
    })
    await settle()
    await act(async () => {
      fake.flushStale()
      await Promise.resolve()
    })
    await settle()
    expect(view().section).toBe('study')
    expect(view().view).toBe('plan')
    // and the frame is put back where the last key asked for
    expect(fake.state).toEqual({ ws: 'study', view: 'plan' })
  })

  it('a jump made inside the frame, with no shell request in flight, still moves the rail', async () => {
    key('3', { ctrlKey: true })
    await act(async () => {
      fake.flushStale()
      await Promise.resolve()
    })
    await settle()
    expect(fake.state).toEqual({ ws: 'study', view: 'papers' })
    act(() => fake.jump('study', 'library'))
    expect(view().view).toBe('library')
    act(() => fake.jump('tree', null))
    expect(view().section).toBe('tree')
  })

  it('a key always lands on its own place, whatever the frame reports in between', async () => {
    for (const k of ['3', '2', '5', '1', '3']) key(k, { ctrlKey: true })
    expect(useShell.getState().places.ww.section).toBe('study')
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        fake.flushStale()
        await Promise.resolve()
      })
      await settle()
    }
    expect(useShell.getState().places.ww).toMatchObject({ section: 'study', view: 'papers' })
    expect(fake.state).toEqual({ ws: 'study', view: 'papers' })
  })
})
