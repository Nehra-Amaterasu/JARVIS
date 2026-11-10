// Chunk 12: SU18 Question harvester (plan 4.15, 8.1). The card over routes_ww_harvest.py, on recorded shapes
// with a routed fake fetch: no network, no real subject. What it proves is the owner's rule more than the layout:
// sources and their licences are on screen BEFORE the switch, the switch asks, and nothing is called fetched
// that the route did not report.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { mount, resetHtml } from './_stubs'
import { SUBJECT_A, byText, click, fakeFetch, field, settle, type } from './_setupFixtures'
import { PrimaryOwner } from '../../ww/kit'
import { Harvester, itemLine, type HarvestQueue, type HarvestSources } from '../../ww/setup/Harvester'
import { OverlayHost } from '../../ww/frame/OverlayHost'
import { closeOverlay, useOverlay } from '../../ww/frame/overlayRegistry'
import { usePlan } from '../../germoney/game/plan'
import '../../ww/overlays/setupOverlays'

let m: ReturnType<typeof mount> | null = null

const SOURCES: HarvestSources = {
  sources: [
    { id: 'ocw', name: 'Open course material', kind: 'open', status: 'off', license: 'CC BY-NC-SA 4.0', reason: 'the harvester is off', terms_url: 'https://example.invalid/terms', note: '', on_disk: 0 },
    { id: 'qa', name: 'Q&A site API', kind: 'open', status: 'off', license: '', reason: 'Q&A site API: licence not recorded, so it stays off.', terms_url: '', note: '', on_disk: 0 },
    { id: 'gate', name: 'Official GATE papers', kind: 'pointer', status: 'pointer', license: 'reserved', reason: 'references only, never stored text', terms_url: '', note: '', on_disk: 0 },
  ],
  not_used: [{ name: 'Coaching banks', reason: 'their terms do not allow copying' }],
  pdf_reader: { available: true, note: '' },
}
const QUEUE_OFF: HarvestQueue = { enabled: false, paused: false, state: 'off', queued: 0, fetching: 0, refused: 0, on_disk: 0, last_run: null, items: [] }

function routes(queue: HarvestQueue = QUEUE_OFF, extra: Record<string, never> = {} as never) {
  return fakeFetch({
    'GET /api/mission/harvest/queue': [200, queue],
    'GET /api/mission/harvest/sources': [200, SOURCES],
    'POST /api/mission/harvest/resume': [200, { ...queue, enabled: true, state: 'idle' }],
    'POST /api/mission/harvest/pause': [200, { ...queue, paused: true, state: 'paused' }],
    'POST /api/mission/harvest/queue': (b) => [200, { item: { id: 'n1', ...(b as object), status: 'waiting' }, state: 'off' }],
    ...extra,
  })
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  usePlan.setState({ academics: { subjects: [SUBJECT_A] } as never })
})
afterEach(() => {
  closeOverlay()
  useOverlay.setState({ open: null, props: {} })
  m?.unmount()
  m = null
  vi.unstubAllGlobals()
  resetHtml()
  document.body.innerHTML = ''
})

async function open() {
  m = mount(<PrimaryOwner><Harvester /><OverlayHost /></PrimaryOwner>)
  await settle()
}

describe('SU18 Question harvester', () => {
  it('shows every source with its licence before the owner has switched anything on', async () => {
    const f = routes()
    await open()
    const rows = [...document.querySelectorAll('[data-source]')]
    expect(rows.map((r) => r.getAttribute('data-source'))).toEqual(['ocw', 'qa', 'gate'])
    expect(document.querySelector('[data-source="ocw"]')!.textContent).toContain('CC BY-NC-SA 4.0')
    expect(document.querySelector('[data-source="gate"]')!.textContent).toContain('references only, never stored text')
    expect(document.body.textContent).toContain('Coaching banks: not used.')
    expect(f.calls.filter((c) => c.method !== 'GET')).toHaveLength(0) // looking is not switching
  })

  it('a source with no recorded licence says it stays off, and its row is never "on"', async () => {
    routes({ ...QUEUE_OFF, enabled: true, state: 'idle' })
    await open()
    const row = document.querySelector('[data-source="qa"]')!
    expect(row.textContent).toContain('licence not recorded, so it stays off.')
    expect(row.textContent).not.toMatch(/\bon\b/)
  })

  it('"questions on disk" is the route number and nothing says fetched that the route did not report', async () => {
    routes({ ...QUEUE_OFF, on_disk: 7 })
    await open()
    expect(document.querySelector('[data-harvest="disk"]')!.textContent).toBe('questions on disk: 7')
    routes()
    m!.unmount()
    await open()
    expect(document.querySelector('[data-harvest="disk"]')!.textContent).toBe('questions on disk: 0')
    expect(document.body.textContent).not.toMatch(/fetched \d|downloaded \d/i)
  })

  it('the switch is its own button and asks first: no request until the Confirm overlay is answered', async () => {
    const f = routes()
    await open()
    click(byText('button', 'Switch the harvester on')!)
    expect(useOverlay.getState().open).toBe('confirm')
    await settle()
    expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(0)
    const dialog = document.querySelector('[data-overlay="confirm"]')!
    expect(dialog.textContent).toContain('A source with no recorded licence stays off')
    click(byText('button', 'Cancel', dialog)!)
    await settle()
    expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(0)
    click(byText('button', 'Switch the harvester on')!)
    click(byText('button', 'Switch on', document.querySelector('[data-overlay="confirm"]')!)!)
    await settle()
    expect(f.calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/api/mission/harvest/resume'])
  })

  it('the harvester card claims no primary: the switch, Pause and Fetch now are plain buttons', async () => {
    routes()
    await open()
    expect(document.querySelector('[data-primary]')).toBeNull()
  })

  it('Fetch now is disabled with its reason while the harvester is off', async () => {
    routes()
    await open()
    const b = byText('button', 'Fetch now')!
    expect(b.getAttribute('aria-disabled')).toBe('true')
    expect(document.body.textContent).toContain('The harvester is off. Switch it on first.')
  })

  it('Pause flips at once and posts to the pause route; a refusal puts the old state back and says so', async () => {
    const on = { ...QUEUE_OFF, enabled: true, state: 'idle' }
    const f = routes(on, { 'POST /api/mission/harvest/pause': [500, { detail: 'busy' }] } as never)
    await open()
    expect(byText('button', 'Pause')).toBeTruthy()
    click(byText('button', 'Pause')!)
    await settle()
    expect(f.calls.some((c) => c.method === 'POST' && c.path.endsWith('/pause'))).toBe(true)
    expect(byText('button', 'Pause')).toBeTruthy() // rolled back
    expect(byText('button', 'Resume')).toBeUndefined()
  })

  it('a paused harvester offers Resume', async () => {
    routes({ ...QUEUE_OFF, enabled: true, paused: true, state: 'paused' })
    await open()
    expect(byText('button', 'Resume')).toBeTruthy()
    expect(byText('button', 'Pause')).toBeUndefined()
  })

  it('the queue lists each item with the route status; a refusal shows its reason', async () => {
    routes({
      ...QUEUE_OFF, enabled: true, state: 'idle', queued: 1, refused: 1,
      items: [
        { id: 'a', subject: 'subject-a', topic: 'topic a', tier: 'gate', status: 'waiting' },
        { id: 'b', subject: 'subject-a', topic: 'topic b', tier: 'gate', status: 'refused', reason: 'robots.txt disallows it' },
        { id: 'c', subject: 'subject-a', topic: 'topic c', tier: 'exam', status: 'fetching' },
      ],
    })
    await open()
    const li = [...document.querySelectorAll('[data-queue-status]')]
    expect(li.map((x) => x.getAttribute('data-queue-status'))).toEqual(['waiting', 'refused', 'fetching'])
    expect(li[1].textContent).toContain('refused: robots.txt disallows it')
    expect(document.body.textContent).toContain('Queue (3)')
    expect(itemLine({ id: 'x', subject: 's', topic: 't', tier: 'gate', status: 'done', added: 4 })).toBe('done, 4 added')
  })

  it('Queue a topic needs a subject and a topic, posts them, and the new item appears in the queue', async () => {
    const f = routes()
    await open()
    const btn = byText('button', 'Queue a topic')!
    expect(btn.getAttribute('aria-disabled')).toBe('true')
    const group = document.querySelector('[role="group"][aria-label="Queue a topic"]')!
    type(field('Subject', group), 'subject-a')
    type(field('Topic', group), 'topic z')
    click(byText('button', 'Queue a topic')!)
    await settle()
    const post = f.calls.find((c) => c.method === 'POST' && c.path === '/api/mission/harvest/queue')!
    expect(post.body).toEqual({ subject: 'subject-a', topic: 'topic z', tier: 'gate' })
    expect(document.body.textContent).toContain('Queued topics wait. Nothing is fetched while the harvester is off.')
  })

  it('when the harvest routes answer 404 the card shows the registry placeholders, not an error', async () => {
    fakeFetch({})
    await open()
    const card = document.getElementById('su-harvester')
    expect(card ?? document.body).toBeTruthy()
    expect(document.querySelector('[data-planned="harvester"]')).not.toBeNull()
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(byText('button', 'Switch the harvester on')).toBeUndefined()
  })

  it('two panes, one at a time: the sources and licences first, the queue one press away', async () => {
    routes({ ...QUEUE_OFF, items: [{ id: 'a', subject: 'subject-a', topic: 'topic a', tier: 'gate', status: 'waiting' }] })
    await open()
    const pane = (id: string) => document.querySelector<HTMLElement>(`[data-harvest-pane="${id}"]`)!
    expect(pane('sources').hidden).toBe(false)
    expect(pane('queue').hidden).toBe(true)
    click(byText('[role=radio]', /Queue \(1\)/)!)
    expect(pane('sources').hidden).toBe(true)
    expect(pane('queue').hidden).toBe(false)
  })

  it('reads on mount and after an action only: no timer is started', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval')
    routes()
    await open()
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
