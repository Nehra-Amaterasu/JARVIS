// Chunk 12: the four overlays this chunk owns, O1 Date sheet, O2 Phone, O6 Log minutes, O7 Confirm (plan 4.13, 8.1
// "Overlays and roadmap"). Routed fake fetch, fictional data. The registry/Roadmap half of that section is
// overlays-roadmap.test.tsx (chunk 5); this file adds what only exists once the real overlays do.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { mount, resetHtml } from './_stubs'
import { INPUTS, SUBJECT_A, byText, click, fakeFetch, field, settle, type } from './_setupFixtures'
import { PrimaryOwner } from '../../ww/kit'
import { OverlayHost } from '../../ww/frame/OverlayHost'
import { OVERLAYS, closeOverlay, openOverlay, registeredOverlay, useOverlay } from '../../ww/frame/overlayRegistry'
import { resetSetupModel, useSetup } from '../../ww/setup/saveModel'
import { countChanges } from '../../ww/overlays/DateSheet'
import { wwAddresses } from '../../ww/overlays/Phone'
import { usePlan } from '../../germoney/game/plan'
import '../../ww/overlays/setupOverlays'

let m: ReturnType<typeof mount> | null = null
const PHONE = { enabled: true, forced: null, saved_enabled: true, running: true, listening_on: [], error: null, port: 8778, bind: '', https: false, cert: '', key: '', urls: [], addresses: [], open_at: ['http://192.0.2.7:8778/phone'], devices: [], pairing: { active: false, expires_in: 0 }, firewall_cmd: 'netsh advfirewall ...', mic_ready: false }
const QR = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'

function routes(extra: Record<string, never> = {} as never) {
  return fakeFetch({
    'GET /api/mission/inputs': [200, INPUTS],
    'GET /api/mission/academics': [200, { subjects: [SUBJECT_A, { ...SUBJECT_A, id: 'subject-b', name: 'Subject B' }] }],
    'GET /api/mission/profile': [500, {}],
    'GET /api/remote': [200, PHONE],
    ...extra,
  })
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  resetSetupModel()
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

async function show(id: 'date' | 'phone' | 'log' | 'confirm', props = {}) {
  m = mount(<PrimaryOwner><button id="opener">Open</button><OverlayHost /></PrimaryOwner>)
  ;(document.getElementById('opener') as HTMLElement).focus()
  act(() => void openOverlay(id, props))
  await settle()
}
const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement
const esc = () => act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))

describe('registration', () => {
  it('importing setupOverlays replaces the stub for O1, O2, O6 and O7; O3, O4, O8 stay chunk 7 and 9', () => {
    for (const id of ['date', 'phone', 'log', 'confirm'] as const) expect(registeredOverlay(id), id).toBeTruthy()
    expect(OVERLAYS.filter((o) => o.chunk === 12).map((o) => o.id).sort()).toEqual(['confirm', 'date', 'log', 'phone'])
  })
})

describe('every chunk 12 overlay is a real dialog', () => {
  for (const id of ['date', 'phone', 'log', 'confirm'] as const) {
    it(`${id}: focus moves in, Tab stays inside, Esc closes it and focus returns to the opener`, async () => {
      routes()
      await show(id, id === 'confirm' ? { title: 'Sure?', onConfirm: () => {} } : {})
      const d = dialog()
      expect(d.getAttribute('aria-modal')).toBe('true')
      expect(d.contains(document.activeElement)).toBe(true)
      const tabbables = [...d.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, textarea, a[href], [tabindex="0"]')]
      expect(tabbables.length).toBeGreaterThan(0)
      tabbables[tabbables.length - 1].focus()
      act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
      expect(d.contains(document.activeElement)).toBe(true)
      esc()
      expect(useOverlay.getState().open).toBeNull()
      await act(async () => { await new Promise((r) => setTimeout(r, 260)) })
      expect(document.activeElement?.id).toBe('opener')
    })
  }

  it('opening a second overlay replaces the first: one deep, so one Esc has one thing to close', async () => {
    routes()
    await show('phone')
    act(() => void openOverlay('log'))
    await settle()
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(dialog().querySelector('[data-overlay="log"]')).not.toBeNull()
    esc()
    expect(useOverlay.getState().open).toBeNull()
  })

  it('no overlay string says a streak was lost, a session failed or that the owner missed anything', async () => {
    routes()
    for (const id of ['date', 'phone', 'log'] as const) {
      await show(id)
      expect(dialog().textContent ?? '').not.toMatch(/streak (lost|broken)|you missed|don't break|session (failed|lost)/i)
      closeOverlay()
      m?.unmount()
      document.body.innerHTML = ''
    }
  })
})

describe('O1 Date sheet', () => {
  it('shows one card per paper, each field labelled in words, with the tentative note', async () => {
    routes()
    await show('date')
    const cards = [...dialog().querySelectorAll('[data-paper]')]
    expect(cards).toHaveLength(2)
    expect(cards[0].getAttribute('aria-label')).toBe('Subject A End-sem')
    expect(cards[1].getAttribute('aria-label')).toBe('Subject B CIE')
    for (const label of ['Date', 'Aim for', 'Out of', 'Starts', 'Ends', 'Units covered', 'How hard']) expect(byText('label', label, cards[0] as HTMLElement), label).toBeTruthy()
    expect(cards[0].textContent).toContain('Tentative')
    expect(cards[1].textContent).toContain('I may not sit this paper')
    expect(dialog().textContent).toContain('2 papers, 1 with a tentative date')
    expect(dialog().textContent).not.toMatch(/\bSit\?|\bTarget\b/)
  })

  it('has no primary until something changes; then the primary reads "Save 1 change" and is the only one', async () => {
    routes()
    await show('date')
    expect(dialog().querySelector('[data-primary="true"]')).toBeNull()
    type(field('Date', dialog().querySelector('[data-paper="0"]') as HTMLElement), '2026-12-12')
    const p = dialog().querySelectorAll('[data-primary="true"]')
    expect(p).toHaveLength(1)
    expect(p[0].textContent).toBe('Save 1 change')
  })

  it('saves through the existing inputs route with every other field of the paper intact, then closes', async () => {
    const f = routes({ 'PUT /api/mission/inputs/exams': (b: unknown) => [200, { ok: true, raw: { ...INPUTS.raw, exams: b }, inputs: INPUTS.inputs }] } as never)
    await show('date')
    type(field('Date', dialog().querySelector('[data-paper="0"]') as HTMLElement), '2026-12-12')
    click(byText('button', 'Save 1 change', dialog())!)
    await settle(6)
    const put = f.calls.find((c) => c.method === 'PUT')
    expect(put, 'one PUT to an existing inputs route').toBeTruthy()
    expect(put!.path).toMatch(/^\/api\/mission\/inputs/)
    const body = JSON.stringify(put!.body)
    expect(body).toContain('2026-12-12')
    expect(body).toContain('"max":60') // the untouched fields of the paper went with it
    expect(body).toContain('"may_miss":true')
  })

  it('edits the same draft as Setup > Dates: one dirty fact, and Discard clears it', async () => {
    routes()
    await show('date')
    type(field('Date', dialog().querySelector('[data-paper="1"]') as HTMLElement), '2026-11-25')
    expect(useSetup.getState().draft.exams).toBeTruthy()
    click(byText('button', 'Discard changes', dialog())!)
    expect(useSetup.getState().draft.exams).toBeUndefined()
  })

  it('a paper can be added and removed, and countChanges counts each once', () => {
    const a = [{ subject: 'x', title: 'X', date: '2026-01-01', units: [] }] as never
    expect(countChanges(a, a)).toBe(0)
    expect(countChanges(a, [...(a as []), { subject: 'y', title: 'Y', date: '', units: [] }] as never)).toBe(1)
    expect(countChanges(a, [] as never)).toBe(1)
  })

  it('when the sheet does not load it says so and offers Retry; nothing is editable', async () => {
    routes({ 'GET /api/mission/inputs': [500, {}] } as never)
    await show('date')
    expect(dialog().textContent).toContain('did not load, so it is not editable')
    expect(byText('button', 'Retry', dialog())).toBeTruthy()
    expect(dialog().querySelector('input')).toBeNull()
  })
})

describe('O2 Phone', () => {
  it('shows the /phone/ww address built from the listener address, the steps, and what works there', async () => {
    routes()
    await show('phone')
    expect(dialog().querySelector('[data-phone-address]')!.textContent).toContain('http://192.0.2.7:8778/phone/ww')
    expect(dialog().textContent).toContain('Turn on the phone listener')
    expect(dialog().textContent).toContain('Scan the QR with the phone')
    expect(dialog().textContent).toContain('Taps that work there: topic, +min, class P/A/C, counters. Not there yet: papers, formulas.')
    expect(wwAddresses(null)).toEqual([])
    expect(wwAddresses(PHONE as never)).toEqual(['http://192.0.2.7:8778/phone/ww'])
  })

  it('Pair a phone is the primary while the listener runs, calls the existing pair route and shows the server QR as an image', async () => {
    const f = routes({ 'POST /api/remote/pair': [200, { code: '482913', url: 'http://192.0.2.7:8778/phone', link: '', qr_svg: QR, expires_in: 300 }] } as never)
    await show('phone')
    const pair = byText('button', 'Pair a phone', dialog())!
    expect(pair.getAttribute('data-primary')).toBe('true')
    click(pair)
    await settle()
    expect(f.calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/api/remote/pair'])
    const img = dialog().querySelector<HTMLImageElement>('img.ov-qr-img')!
    expect(img.src).toContain('data:image/svg+xml')
    expect(decodeURIComponent(img.src.split(',')[1])).toBe(QR)
    expect(dialog().querySelector('[aria-label="Pairing code"]')!.textContent).toBe('482913')
    expect(dialog().textContent).toContain('5:00 left')
    expect(dialog().querySelector('[data-primary="true"]')).toBeNull() // a code is showing: nothing left to press
  })

  it('with the listener off, pairing is disabled with its reason and nothing claims the primary', async () => {
    routes({ 'GET /api/remote': [200, { ...PHONE, enabled: false, running: false, open_at: [] }] } as never)
    await show('phone')
    const pair = byText('button', 'Pair a phone', dialog())!
    expect(pair.getAttribute('aria-disabled')).toBe('true')
    expect(dialog().textContent).toContain('Turn the listener on first.')
    expect(dialog().querySelector('[data-primary="true"]')).toBeNull()
  })

  it('adds no QR library: the QR is an image whose source is the server svg', async () => {
    const pkg = await import('../../../package.json')
    const deps = Object.keys({ ...(pkg as { dependencies?: object }).dependencies, ...(pkg as { devDependencies?: object }).devDependencies })
    expect(deps.filter((d) => /qr/i.test(d))).toEqual([])
  })

  it('when the listener does not answer it says so with Retry, and shows no pairing control', async () => {
    routes({ 'GET /api/remote': [500, {}] } as never)
    await show('phone')
    expect(dialog().textContent).toContain('did not answer')
    expect(byText('button', 'Retry', dialog())).toBeTruthy()
    expect(byText('button', 'Pair a phone', dialog())).toBeUndefined()
  })

  it('lists paired phones with a Remove button each', async () => {
    routes({ 'GET /api/remote': [200, { ...PHONE, devices: [{ id: 'd1', name: 'Test phone', created: 1, last_seen: Date.now() / 1000 }] }] } as never)
    await show('phone')
    expect(dialog().textContent).toContain('status: Paired')
    expect(byText('button', 'Remove Test phone', dialog())).toBeTruthy()
  })
})

describe('O6 Log minutes', () => {
  it('is the one composer: minutes, track, node, proof and note, with Log it as the primary', async () => {
    routes()
    await show('log')
    for (const l of ['Minutes', 'Track', 'For node', 'Proof link', 'Note']) expect(byText('label', l, dialog()), l).toBeTruthy()
    expect(dialog().querySelector('[data-primary="true"]')!.textContent).toBe('Log it')
  })

  it('opened with props it starts from them, and posts through the plan log route', async () => {
    const f = routes({ 'POST /api/mission/log': [200, { ok: true, say: 'Logged 30 min.' }], 'GET /api/mission/state': [200, {}] } as never)
    await show('log', { minutes: 30, track: 'deutsch' })
    expect((field('Minutes', dialog()) as HTMLInputElement).value).toBe('30')
    expect((field('Track', dialog()) as unknown as HTMLSelectElement).value).toBe('deutsch')
    type(field('Note', dialog()), 'wrote a page')
    click(byText('button', 'Log it', dialog())!)
    await settle(6)
    const post = f.calls.find((c) => c.method === 'POST' && c.path === '/api/mission/log')!
    expect(post.body).toMatchObject({ minutes: 30, track: 'deutsch', note: 'wrote a page' })
    expect(useOverlay.getState().open).toBeNull()
  })

  it('zero minutes is refused on the field and nothing is posted', async () => {
    const f = routes()
    await show('log')
    type(field('Minutes', dialog()), '0')
    expect(dialog().textContent).toContain('Enter a number of minutes above 0.')
    click(byText('button', 'Log it', dialog())!)
    await settle()
    expect(f.calls.some((c) => c.path === '/api/mission/log')).toBe(false)
    expect(useOverlay.getState().open).toBe('log')
  })
})

describe('O7 Confirm', () => {
  it('a plain confirm takes the primary, closes, and then runs its action', async () => {
    const onConfirm = vi.fn()
    routes()
    await show('confirm', { title: 'Do it?', body: 'It is small.', confirmLabel: 'Do it', onConfirm })
    expect(dialog().querySelector('[data-primary="true"]')!.textContent).toBe('Do it')
    click(byText('button', 'Do it', dialog())!)
    await settle()
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(useOverlay.getState().open).toBeNull()
  })

  it('a destructive confirm declares no primary and its button is the danger tone', async () => {
    routes()
    await show('confirm', { title: 'Wipe?', confirmLabel: 'Wipe', destructive: true, onConfirm: () => {} })
    expect(dialog().querySelector('[data-primary="true"]')).toBeNull()
    expect(byText('button', 'Wipe', dialog())!.className).toMatch(/danger/)
  })

  it('Cancel closes without running the action', async () => {
    const onConfirm = vi.fn()
    routes()
    await show('confirm', { title: 'Sure?', onConfirm })
    click(byText('button', 'Cancel', dialog())!)
    await settle()
    expect(onConfirm).not.toHaveBeenCalled()
    expect(useOverlay.getState().open).toBeNull()
  })

  it('a failing action reports itself in a toast instead of vanishing', async () => {
    routes()
    await show('confirm', { title: 'Sure?', onConfirm: () => { throw new Error('No luck') } })
    click(byText('button', 'Confirm', dialog())!)
    await settle()
    const { useStore } = await import('../../lib/store')
    expect(JSON.stringify(useStore.getState())).toContain('No luck')
  })
})
