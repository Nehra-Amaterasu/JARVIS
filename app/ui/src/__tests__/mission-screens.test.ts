/**
 * Every Mission screen renders against real-shaped server data, and a bug in one
 * shows a readable card instead of blanking the app.
 *
 * fixtures/mission-live.json is the real /api/mission/* responses of 2026-10-25
 * (applications, academics-driven today, campaigns, certificates, ladder, state)
 * with every free-text value replaced and lists cut to four: same keys, same
 * types, same nulls, no personal content.
 *
 * The regression: Road went black because `usePlan((s) => s.applications?.goals ?? [])`
 * returned a new array on every call while the applications were still loading;
 * zustand 5 + React 19 loop on that ("Maximum update depth exceeded", React #185).
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LIVE from './fixtures/mission-live.json'
import { errorDetails, MissionBoundary } from '../germoney/Boundary'
import { MissionRoot } from '../germoney/MissionRoot'
import { usePlan } from '../germoney/game/plan'
import { EMPTY } from '../germoney/ui'
import { useStore, type Tab } from '../lib/store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const live = LIVE as Record<string, unknown>
let slowApplications = false

function respond(body: unknown, status = 200) {
  return { ok: status < 400, status, statusText: status < 400 ? 'OK' : 'Not Found', json: async () => body, text: async () => JSON.stringify(body) }
}

vi.stubGlobal('fetch', async (url: string, init?: { method?: string }) => {
  const path = url.split('?')[0]
  const method = init?.method ?? 'GET'
  if (path.startsWith('/api/kv')) return respond(path === '/api/kv' ? { keys: [] } : { value: null })
  const m = path.match(/^\/api\/mission\/([a-z]+)$/)
  if (m && method === 'GET' && m[1] in live) {
    // The real app: Road mounts before /applications answers. Keep it pending a while.
    if (m[1] === 'applications' && slowApplications) await new Promise((r) => setTimeout(r, 30))
    return respond(live[m[1]])
  }
  return respond({ error: 'not in the fixture' }, 404)
})

const flush = async (n = 8) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)) }) }

let host: HTMLDivElement
let root: Root
const errors: unknown[] = []
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host, { onUncaughtError: (e) => errors.push(e), onCaughtError: (e) => errors.push(e) })
  errors.length = 0
  usePlan.setState({ applications: null, campaigns: null, certs: null, ladder: null })
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function show(tab: Tab) {
  useStore.setState({ tab })
  await act(async () => { root.render(createElement(MissionRoot)) })
  await flush()
}

describe('the Mission screens with real-shaped data', () => {
  it('Road renders while the applications are still loading, then with them (the 2026-10-25 blank screen)', async () => {
    slowApplications = true
    await show('campaign')
    slowApplications = false
    await flush(10)
    expect(errors).toEqual([])
    expect(host.querySelector('.crash-card')).toBeNull()
    expect(host.textContent).toContain('Road')
    expect(host.querySelector('.mission-page.road')).not.toBeNull()
  })

  it.each([['mission', 'today'], ['syllabus', 'tree'], ['crucible', 'focus'], ['drill', 'focus'], ['terminal', 'log'], ['proof', 'log'],
    ['trials', 'road'], ['armory', 'road']] as [Tab, string][])('%s opens %s without a crash', async (tab, page) => {
    await show(tab)
    expect(errors).toEqual([])
    expect(host.querySelector('.crash-card')).toBeNull()
    expect(host.querySelector(`.mission-page.${page}`)).not.toBeNull()
  })

  it('an empty fallback is one shared frozen list, so selectors stay stable', () => {
    expect(Object.isFrozen(EMPTY)).toBe(true)
    const pick = () => usePlan.getState().applications?.goals ?? EMPTY
    expect(pick()).toBe(pick())
  })
})

describe('the error boundary', () => {
  function Broken(): never { throw new Error('goals is not iterable') }

  it('shows a readable card with Copy details instead of a blank app', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await act(async () => { root.render(createElement(MissionBoundary, { name: 'Road' }, createElement(Broken))) })
    const card = host.querySelector('.crash-card')
    expect(card).not.toBeNull()
    expect(card!.textContent).toContain('Road hit a bug')
    expect(card!.textContent).toContain('goals is not iterable')
    expect([...card!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Copy details', 'Try again'])
    spy.mockRestore()
  })

  it('a section boundary keeps the rest of the screen', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await act(async () => {
      root.render(createElement('div', null, createElement('p', null, 'still here'),
        createElement(MissionBoundary, { name: 'Campaigns', small: true }, createElement(Broken))))
    })
    expect(host.textContent).toContain('still here')
    expect(host.textContent).toContain("Campaigns couldn't load")
    spy.mockRestore()
  })

  it('the copied details name the screen, the error and the components', () => {
    const t = errorDetails('Road', new TypeError('x is undefined'), '\n    at Goals\n    at RoadPage')
    expect(t).toContain('"Road" crashed')
    expect(t).toContain('TypeError: x is undefined')
    expect(t).toContain('at Goals')
  })
})
