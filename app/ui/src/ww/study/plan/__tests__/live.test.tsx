// Package Y03: the live wiring. useRetention turns what the Study port says into a lamp and a count (live answer, rejected route, an
// unmounted view, no engine), and the Library face carries one lamp per panel that follows what the app answered. A wrong hook would
// pass every drawing test, so these read the lamp states themselves.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { mount } from '../../../../__tests__/ww/_stubs'
import type { StudyPort } from '../../ports'

const apiMock = vi.hoisted(() => ({ api: vi.fn(), post: vi.fn() }))
vi.mock('../../../../lib/api', () => ({ api: apiMock.api, post: apiMock.post }))

import { useRetention } from '../PlanView'
import { Library } from '../../Library'

let m: ReturnType<typeof mount> | null = null
beforeEach(() => { apiMock.api.mockReset(); apiMock.post.mockReset() })
afterEach(() => { m?.unmount(); m = null; document.querySelectorAll('[data-shell]').forEach((n) => n.remove()) })

const port = (readiness: unknown) => ({ readiness }) as unknown as StudyPort
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

function Probe({ p, out }: { p: StudyPort; out: { last?: ReturnType<typeof useRetention> } }) {
  out.last = useRetention(p)
  return null
}
const run = (p: StudyPort) => {
  const out: { last?: ReturnType<typeof useRetention> } = {}
  m = mount(<Probe p={p} out={out} />)
  return out
}

describe('useRetention', () => {
  it('starts WAITING with the reason, before the port answers', () => {
    const out = run(port(() => new Promise(() => undefined)))
    expect(out.last).toMatchObject({ state: 'waiting', dueCount: null, topics: [] })
    expect(out.last!.reason).toMatch(/paper engine/)
  })
  it('a live answer gives the due count and no bands', async () => {
    const out = run(port(() => Promise.resolve({ state: 'live', reason: 'read', data: { practisedWeight: 0, timedPapers: 0, markedQuestions: 0, cardsDue: 9 } })))
    await flush()
    expect(out.last).toMatchObject({ state: 'live', dueCount: 9, topics: [], dueIds: [] })
  })
  it('a waiting answer keeps the count empty and passes its reason on', async () => {
    const out = run(port(() => Promise.resolve({ state: 'waiting', reason: 'no readiness yet', data: null })))
    await flush()
    expect(out.last).toMatchObject({ state: 'waiting', dueCount: null, reason: 'no readiness yet' })
  })
  it('a rejected route is a FAULT with its reason', async () => {
    const out = run(port(() => Promise.reject(new Error('down'))))
    await flush()
    expect(out.last).toMatchObject({ state: 'fault', dueCount: null })
    expect(out.last!.reason).toMatch(/did not answer/)
  })
  it('a view unmounted before the answer sets no state', async () => {
    let done: (v: unknown) => void = () => undefined
    const out = run(port(() => new Promise((r) => { done = r })))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    m!.unmount(); m = null
    await act(async () => { done({ state: 'live', reason: 'x', data: { cardsDue: 3 } }); await Promise.resolve() })
    expect(out.last).toMatchObject({ state: 'waiting', dueCount: null })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('Library lamps', () => {
  const lamp = (id: string) => document.querySelector(`[data-card="${id}"] .k-lamp`)?.getAttribute('data-state')
  const shell = () => { const d = document.createElement('div'); d.setAttribute('data-shell', 'v2'); document.body.appendChild(d) }
  it('the concept panel is WAITING while the app has not answered', () => {
    shell()
    apiMock.api.mockImplementation(() => new Promise(() => undefined))
    m = mount(<Library />)
    expect(lamp('study-concept')).toBe('waiting')
  })
  it('a rejected route is a FAULT, not an empty page', async () => {
    shell()
    apiMock.api.mockImplementation(() => Promise.reject(new Error('down')))
    m = mount(<Library />)
    await flush(); await flush()
    expect(lamp('study-concept')).toBe('fault')
  })
  it('an answered route is LIVE', async () => {
    shell()
    apiMock.api.mockImplementation((u: string) => Promise.resolve(/learn/.test(u) ? { status: 'ok', say: 'Nothing new today.', new: null, due: [], progress: { seen: 1, total: 9 }, source: 'example' } : /study\//.test(u) ? { status: 'ok', stage: 'study', say: '', node: { id: 'n', name: 'Node', branch: 'b', outcomes: [], hours_est: 10 }, next: null, primary: null, backups: [], contracts: [], entries: [], follow_ups: [], progress: { minutes: 0, hours_est: 10, share: 0, notes: 0, contracts_done: 0, contracts: 0 } } : { nodes: [] }))
    m = mount(<Library />)
    await flush(); await flush()
    expect(lamp('study-concept')).toBe('live')
  })
})
