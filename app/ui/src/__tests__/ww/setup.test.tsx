// Chunk 12: the Setup workspace (plan 8.1 "Setup (setup.test.tsx)").
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { mount, resetHtml } from './_stubs'
import { INPUTS, SUBJECT_A, byText, click, fakeFetch, field, settle, type } from './_setupFixtures'
import { PrimaryOwner } from '../../ww/kit'
import { SetupPage, INDEX } from '../../ww/setup/SetupPage'
import { resetSetupModel, useSetup } from '../../ww/setup/saveModel'
import { useView } from '../../ww/setup/view'
import { useFrame, resetFrameStore } from '../../ww/frame/frameStore'
import { OverlayHost } from '../../ww/frame/OverlayHost'
import { closeOverlay, useOverlay } from '../../ww/frame/overlayRegistry'
import { usePlan } from '../../germoney/game/plan'
import '../../ww/overlays/setupOverlays'

let m: ReturnType<typeof mount> | null = null
const PHONE_OFF = { enabled: false, forced: null, saved_enabled: false, running: false, listening_on: [], error: null, port: 8778, bind: '', https: false, cert: '', key: '', urls: [], addresses: [], open_at: [], devices: [], pairing: { active: false, expires_in: 0 }, firewall_cmd: 'netsh ...', mic_ready: false }
const HARVEST_ABSENT = {}

function routes(extra: Record<string, never> = {} as never) {
  return fakeFetch({
    'GET /api/mission/inputs': [200, INPUTS],
    'GET /api/mission/academics': [200, { subjects: [SUBJECT_A] }],
    'GET /api/mission/profile': [500, {}],
    'GET /api/remote': [200, PHONE_OFF],
    ...HARVEST_ABSENT,
    ...extra,
  })
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  resetSetupModel()
  useView.setState({ view: 'rotation', focusTick: 0 })
  resetFrameStore()
  usePlan.setState({ academics: null, state: null, profile: null })
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
  m = mount(<PrimaryOwner><SetupPage /><OverlayHost /></PrimaryOwner>)
  await settle()
}

describe('Setup', () => {
  it('mounts with academics null and the harvest routes absent without a crash', async () => {
    routes({ 'GET /api/mission/academics': [500, {}] } as never)
    await open()
    expect(usePlan.getState().academics).toBeNull()
    expect(document.querySelector('[data-page="setup"]')).not.toBeNull()
    expect(document.querySelector('[data-card="su-subjects"]')).not.toBeNull()
  })

  it('the index lists the sections in the plan order, and clicking one scrolls to it and focuses it', async () => {
    routes()
    await open()
    const labels = [...document.querySelectorAll('.su-index-btn')].map((b) => b.textContent)
    expect(labels).toEqual(INDEX.map(([, l]) => l))
    expect(labels.indexOf('Question harvester')).toBe(labels.indexOf('Appearance') + 1)
    const scroll = vi.fn()
    const target = document.getElementById('su-goals')!
    target.scrollIntoView = scroll
    click(document.querySelector('[data-index="goals"]')!)
    expect(scroll).toHaveBeenCalled()
    expect(document.activeElement).toBe(target)
    // the page really holds the sections in that order
    const onPage = [...document.querySelectorAll('.su-anchor')].map((e) => e.getAttribute('data-su'))
    expect(onPage).toEqual(INDEX.map(([a]) => a))
  })

  it('one save model: an edit marks its section and the bar says Save 1 change; nothing is sent until Save; leaving asks', async () => {
    const f = routes({ 'PUT /api/mission/inputs/study': [200, { saved: 'study', dropped: [] }] } as never)
    await open()
    expect(document.querySelector('[data-save-state="clean"]')!.textContent).toBe('Save: nothing to save')
    // nothing unsaved and no phone paired: the one fill is Pair phone (plan 3.3), not a Save that has nothing to save
    expect(document.querySelector('[data-primary]')!.textContent).toBe('Pair phone')
    const card = document.getElementById('su-study')!
    type(field('Weekday', card), '200')
    expect(document.querySelector('[data-dirty="study"]')!.textContent).toContain('Unsaved')
    expect(document.querySelector('[data-index="study"] .su-dot')).not.toBeNull()
    const save = byText('button', 'Save 1 change')!
    expect(save.getAttribute('data-primary')).toBe('true')
    expect(document.querySelectorAll('[data-primary]')).toHaveLength(1)
    expect(f.calls.filter((c) => c.method === 'PUT')).toHaveLength(0)
    expect(useFrame.getState().dirty.setup).toBe(true)
    const ev = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    click(save)
    await settle()
    const puts = f.calls.filter((c) => c.method === 'PUT')
    expect(puts).toHaveLength(1)
    expect(puts[0].path).toBe('/api/mission/inputs/study')
    expect((puts[0].body as { value: { weekday_minutes: number } }).value.weekday_minutes).toBe(200)
    expect(document.querySelector('[data-save-report]')!.textContent).toContain('Saved: Study time')
    expect(useSetup.getState().draft).toEqual({})
    expect(useFrame.getState().dirty.setup).toBe(false)
    const after = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
  })

  it('typing a value back to what is saved is not a change, and Discard drops the draft', async () => {
    routes()
    await open()
    const card = document.getElementById('su-study')!
    type(field('Weekday', card), '200')
    expect(useSetup.getState().draft.study).toBeDefined()
    type(field('Weekday', card), '240')
    expect(useSetup.getState().draft.study).toBeUndefined()
    type(field('Weekend day', card), '10')
    click(byText('button', 'Discard', card)!)
    expect(useSetup.getState().draft).toEqual({})
  })

  it('a server that ignores part of a section says so, word for word', async () => {
    routes({ 'PUT /api/mission/inputs/study': [200, { saved: 'study', dropped: ['weekday_minutes: not a number'] }] } as never)
    await open()
    type(field('Weekday', document.getElementById('su-study')!), '200')
    click(byText('button', 'Save 1 change')!)
    await settle()
    expect(document.querySelector('[data-save-report]')!.textContent).toContain('Study time: weekday_minutes: not a number')
  })

  it('timetable, goals, subjects and attendance rule render as forms; Advanced: JSON is closed; no 44 px textarea', async () => {
    routes()
    await open()
    for (const [id, label] of [['timetable', 'Class 1'], ['goals', 'Goal'], ['subjects', 'Subject'], ['attendance', 'Required attendance']] as const) {
      const card = document.getElementById(`su-${id}`)!
      expect(card.querySelector('input,select'), id).not.toBeNull()
      expect(card.querySelector('.su-json-text'), `${id} json is closed`).toBeNull()
      expect(byText('[aria-expanded]', 'Advanced: JSON', card)!.getAttribute('aria-expanded'), `${id} ${label}`).toBe('false')
    }
    expect(field('Subject name', document.getElementById('su-subjects')!).value).toBe('Subject A')
    expect(field('Required attendance', document.getElementById('su-attendance')!).value).toBe('75')
    // opened, the JSON textarea is at least 6 rows
    click(byText('[aria-expanded]', 'Advanced: JSON', document.getElementById('su-goals')!)!)
    expect(Number(document.querySelector('#su-goals .su-json-text')!.getAttribute('rows'))).toBeGreaterThanOrEqual(6)
    // no <textarea rows=1..2> anywhere in the open page
    for (const t of document.querySelectorAll('textarea')) expect(Number(t.getAttribute('rows'))).toBeGreaterThanOrEqual(3)
  })

  it('Advanced: JSON applies to the draft, not to the server, and a parse error stays on screen', async () => {
    const f = routes()
    await open()
    const card = document.getElementById('su-goals')!
    click(byText('[aria-expanded]', 'Advanced: JSON', card)!)
    const area = card.querySelector('.su-json-text') as HTMLTextAreaElement
    type(area, '[{"id":"x","horizon":"year","metric":"m"}')
    click(byText('button', 'Apply to the form', card)!)
    expect(card.querySelector('.su-err')!.textContent).toContain('Not valid JSON')
    type(area, '[{"id":"x","horizon":"year","metric":"m"}]')
    click(byText('button', 'Apply to the form', card)!)
    expect((useSetup.getState().draft.goals as { id: string }[])[0].id).toBe('x')
    expect(f.calls.filter((c) => c.method === 'PUT')).toHaveLength(0)
  })

  it('the Dates row is a link row with one button that opens the Date sheet', async () => {
    routes()
    await open()
    const row = document.getElementById('su-dates')!
    expect(row.querySelector('[data-card]')).toBeNull()
    expect(row.textContent).toContain('2 papers, 1 tentative')
    click(byText('button', 'Edit the date sheet', row)!)
    expect(useOverlay.getState().open).toBe('date')
  })

  it('the Phone row is one status line and a button that opens the Phone overlay; the steps and /phone/ww live only there', async () => {
    routes()
    await open()
    const row = document.getElementById('su-phone')!
    expect(row.textContent).toContain('Not paired.')
    expect(row.querySelectorAll('button')).toHaveLength(1)
    expect(document.querySelector('[data-page="setup"]')!.textContent).not.toContain('/phone/ww')
    const pair = byText('button', 'Pair phone', row)!
    expect(pair.getAttribute('data-primary')).toBe('true') // nothing unsaved, no phone paired: Pair phone takes the fill
    click(pair)
    expect(useOverlay.getState().open).toBe('phone')
  })

  it('Pair phone gives the fill back to Save while there is something unsaved, and nothing holds it once a phone is paired', async () => {
    routes()
    await open()
    type(field('Weekday', document.getElementById('su-study')!), '200')
    expect(document.querySelector('[data-primary]')!.textContent).toBe('Save 1 change')
    expect(byText('button', 'Pair phone')!.getAttribute('data-primary')).toBeNull()
  })

  it('a paired phone is named in the status line and the button no longer claims the fill', async () => {
    routes({ 'GET /api/remote': [200, { ...PHONE_OFF, enabled: true, running: true, port: 8778, open_at: ['http://192.0.2.7:8778/phone'], devices: [{ id: 'd1', name: 'Test phone', created: 1, last_seen: 1 }] }] } as never)
    await open()
    const row = document.getElementById('su-phone')!
    expect(row.textContent).toContain('Paired: Test phone')
    expect(document.querySelector('[data-primary]')).toBeNull()
  })

  it('Connections rows are disabled with their reasons', async () => {
    routes()
    await open()
    const rows = [...document.querySelectorAll('#su-connections .su-connection')]
    expect(rows).toHaveLength(3)
    for (const r of rows) {
      const b = r.querySelector('button')!
      expect(b.getAttribute('aria-disabled')).toBe('true')
      expect(r.textContent!.length).toBeGreaterThan(40)
    }
  })

  it('when engine-inputs.json does not load, the input sections are not editable and nothing can overwrite the file', async () => {
    routes({ 'GET /api/mission/inputs': [500, {}] } as never)
    await open()
    expect(document.querySelector('[data-su-gate="unavailable"]')).not.toBeNull()
    expect(document.getElementById('su-goals')).toBeNull()
    expect(document.getElementById('su-appearance')).not.toBeNull()
  })

  it('the question harvester section is in the index, after Appearance, and shows its placeholders when the harvest routes answer 404', async () => {
    routes()
    await open()
    const idx = INDEX.map(([a]) => a)
    expect(idx.indexOf('harvester')).toBe(idx.indexOf('appearance') + 1)
    const card = document.getElementById('su-harvester')!
    expect(card.querySelector('[data-planned="harvester"]')).not.toBeNull()
    expect(card.textContent).toContain('Nothing fetched yet')
    expect(card.querySelector('button.primary, [data-primary]')).toBeNull()
  })

  it('Appearance: the theme choice applies at once and is kept; Glass and Contrast say why they are off', async () => {
    routes()
    await open()
    const card = document.getElementById('su-appearance')!
    click(byText('[role=radio]', 'Calm', card)!)
    expect(document.documentElement.getAttribute('data-motion')).toBe('calm')
    expect(localStorage.getItem('ww.motion')).toBe('calm')
    click(byText('[role=radio]', 'Auto', card)!)
    expect(document.documentElement.hasAttribute('data-motion')).toBe(false)
    expect(byText('button', 'Glass', card)!.getAttribute('aria-disabled')).toBe('true')
    expect(byText('button', 'Contrast', card)!.getAttribute('aria-disabled')).toBe('true')
  })

  it('rotation: a plan-side section saves through the plan route and is believed only once it reads back', async () => {
    const state = { rotation: { '1': { track: 'digital', label: 'Digital', match: [] } }, schedule: { library: { start: '10:00', minutes: 60 } }, budget: { cert_inr_month: 500, cert_stretch_inr: 1000 }, career: null, xp: 0, events: [], wip: [] }
    const f = routes({
      'GET /api/mission/state': [200, state], 'GET /api/mission/today': [200, { contracts: [] }],
      'PUT /api/mission/settings': [200, {}], 'GET /api/mission/road': [200, {}],
    } as never)
    usePlan.setState({ state: state as never })
    await open()
    expect(document.getElementById('su-rotation')!.textContent).toContain('Monday')
    type(field('Monday track', document.getElementById('su-rotation')!), 'Maths')
    expect(useSetup.getState().draft.rotation).toBeDefined()
    click(byText('button', 'Save 1 change')!)
    await settle()
    expect(f.calls.some((c) => c.method === 'PUT' && c.path === '/api/mission/settings')).toBe(true)
    // the fake server did not keep it (state reads back unchanged): the draft stays and the bar says so
    expect(useSetup.getState().draft.rotation).toBeDefined()
    expect(document.querySelector('[data-save-report]')!.textContent).toContain('Error: Rotation was not saved')
  })
})


describe('no-scroll rule: one view at a time, lists paged', () => {
  it('shows one section at a time: the index changes the view, the others stay mounted but hidden', async () => {
    routes()
    await open()
    const shown = () => [...document.querySelectorAll<HTMLElement>('.su-view')].filter((v) => !v.hidden).map((v) => v.getAttribute('data-view-of'))
    expect(shown()).toEqual(['rotation'])
    click(document.querySelector('[data-index="goals"]')!)
    expect(shown()).toEqual(['goals'])
    expect(document.querySelector('.su-page')!.getAttribute('data-view')).toBe('goals')
    expect(document.querySelector('[data-index="goals"]')!.getAttribute('aria-current')).toBe('true')
    expect(document.getElementById('su-rotation')).not.toBeNull() // hidden, not unmounted: a draft survives a visit elsewhere
  })

  it('a long list is paged: two goals a page, Next shows the others, nothing is lost from the draft', async () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ id: `g${i}`, horizon: 'quarter', metric: `m${i}`, target: 1, deadline: null }))
    routes({ 'GET /api/mission/inputs': [200, { ...INPUTS, raw: { ...INPUTS.raw, goals: six } }] } as never)
    await open()
    click(document.querySelector('[data-index="goals"]')!)
    const card = document.getElementById('su-goals')!
    expect(card.querySelectorAll('[role="group"][aria-label^="goal "]')).toHaveLength(2)
    expect(card.textContent).toContain('goals 1 to 2 of 6')
    click(card.querySelector<HTMLElement>('[aria-label="Next goals"]')!)
    expect(card.textContent).toContain('goals 3 to 4 of 6')
    type(field('What is measured', card), 'edited')
    expect((useSetup.getState().draft.goals as { metric: string }[])[2].metric).toBe('edited')
    expect((useSetup.getState().draft.goals as unknown[]).length).toBe(6)
  })

  it('Advanced: JSON replaces the form while it is open, and the form comes back with its edit', async () => {
    routes()
    await open()
    click(document.querySelector('[data-index="goals"]')!)
    const card = document.getElementById('su-goals')!
    const part = card.querySelector<HTMLElement>('.su-formpart')!
    expect(part.hidden).toBe(false)
    click(byText('[aria-expanded]', 'Advanced: JSON', card)!)
    expect(part.hidden).toBe(true)
    expect(card.querySelector('.su-json-text')).not.toBeNull()
    click(byText('[aria-expanded]', 'Advanced: JSON', card)!)
    expect(part.hidden).toBe(false)
  })

  it('the pager keeps focus on the pressed button at the end of the list (aria-disabled, not disabled)', async () => {
    const three = Array.from({ length: 3 }, (_, i) => ({ id: `g${i}`, horizon: 'quarter', metric: `m${i}`, target: 1, deadline: null }))
    routes({ 'GET /api/mission/inputs': [200, { ...INPUTS, raw: { ...INPUTS.raw, goals: three } }] } as never)
    await open()
    click(document.querySelector('[data-index="goals"]')!)
    const card = document.getElementById('su-goals')!
    const next = card.querySelector<HTMLElement>('[aria-label="Next goals"]')!
    next.focus()
    click(next)
    expect(next.getAttribute('aria-disabled')).toBe('true')
    expect(next.hasAttribute('disabled')).toBe(false)
    expect(document.activeElement).toBe(next)
  })
})

// keep act imported for the helpers' sake
void act
