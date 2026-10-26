/** Teach / train / correct: the wording rules, the place buttons, the fan, and the
 *  prediction bar and panel against a stubbed API (routes_aankhen_train.py). */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fanView, placeButtons, predictionWording, secondsOf, type TrainView, type ZoneLite } from '../lib/teachTrain'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ZONES: ZoneLite[] = [
  { id: 'at_desk_chair', name: 'Sitting at the desk', dwell_s: 1800 },
  { id: 'beside_bed_desk_side', name: 'Beside the bed, desk side', dwell_s: 4 },
  { id: 'bed_lying', name: 'Lying in bed', dwell_s: 3600 },
]

describe('teachTrain helpers', () => {
  it('says Predicting until the backend says answering', () => {
    expect(predictionWording('predicting', 'Lying in bed')).toBe('Predicting: Lying in bed')
    expect(predictionWording(undefined, 'Lying in bed')).toBe('Predicting: Lying in bed')
    expect(predictionWording('predicting', null)).toBe('Predicting: —')
    expect(predictionWording('answering', 'Lying in bed')).toBe("You're at: Lying in bed")
    // never the strong words before it has earned them
    expect(predictionWording('predicting', 'x')).not.toMatch(/answering|is at|you're at/i)
  })

  it('splits places from the zones he walks through', () => {
    const { places, transit } = placeButtons(ZONES)
    expect(places.map((z) => z.id)).toEqual(['at_desk_chair', 'bed_lying'])
    expect(transit.map((z) => z.id)).toEqual(['beside_bed_desk_side'])
    expect(placeButtons([{ id: 'x', name: 'x' }]).places).toHaveLength(1)   // no dwell: a place
  })

  it('reads the fan the engine reports, detected first', () => {
    expect(fanView({ detected: true, confidence: 0.87, relay: false })).toMatchObject({ on: true, source: 'detected', text: 'Fan on (detected · 87 %)' })
    expect(fanView({ auto: { on: false } })).toMatchObject({ on: false, source: 'detected' })
    expect(fanView({ relay: true, board: null, on: true })).toMatchObject({ on: true, source: 'relay' })
    expect(fanView({ board: false })).toMatchObject({ on: false, source: 'board' })
    expect(fanView(undefined)).toMatchObject({ on: null, text: 'Fan: not known' })
  })

  it('writes seconds the way he asked', () => {
    expect(secondsOf('desk', 12.4, 30)).toBe('desk 12 s of 30 s')
  })
})

/* ------------------------------------------------------------------ components */
const calls: { url: string; method: string; body?: unknown }[] = []
let trainView: TrainView
let miniOn = false
const belief = {
  state: 'in_room', confidence: 0.6, motion: 0.1, activity: null, updated: 1, zones_trusted: false,
  experimental: 'fingerprint CNN', zones: [{ id: 'bed_lying', name: 'Lying in bed', p: 0.7, x: 1, y: 1, r: 0.5 }],
}

function respond(url: string, method: string): unknown {
  if (url === '/api/aankhen/correct') return { ok: true, name: 'Lying in bed', seconds: 10, source: 'x' }
  if (url === '/api/aankhen/train2') return trainView
  if (url === '/api/aankhen/zones') return { zones: ZONES }
  if (url.startsWith('/api/aankhen/minidrill')) {
    if (method === 'POST') miniOn = !url.endsWith('/stop')
    return { recording: miniOn ? 'raw.akr' : null, started: 1, fan: null, open: url.endsWith('/tap') ? { zone: 'bed_lying', name: 'Lying in bed', t0: 1, seconds: 0 } : null, spans: [], dropped: [], seconds: {} }
  }
  if (url === '/api/aankhen/drill/fan') return { ok: true }
  return {}
}

beforeEach(() => {
  calls.length = 0
  miniOn = false
  trainView = {
    status: 'predicting', model: { status: 'predicting', days: 2 },
    job: { name: 'train', state: 'idle', stage: '', fraction: 0, error: null, started: null, finished: null },
    available: { train_job: true, add_span: true, missing: [] },
    report: {
      status: 'predicting', model: 'cnn', balanced: 0.42, baseline: 0.25, interval: [0.31, 0.55], clears_baseline: true,
      recall: [{ place: 'bed_lying', name: 'Lying in bed', recall: 0.7 }],
      seconds: [{ place: 'at_desk_chair', name: 'desk', have: 12, need: 30, missing: 18 }],
      per_place_s: 30, days: 2, sessions: 3, last_trained: null, error: null,
      lines: ['Balanced accuracy 42 % (95 % interval 31 % to 55 %), against 25 % for always saying the commonest place.'],
    },
  }
  vi.stubGlobal('fetch', async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET'
    calls.push({ url: String(url), method, body: init?.body ? JSON.parse(init.body) : undefined })
    return new Response(JSON.stringify(respond(String(url), method)), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
})
afterEach(() => { vi.unstubAllGlobals() })

async function mount(el: ReturnType<typeof createElement>) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(el) })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  return { host, root }
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const btn = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label) as HTMLButtonElement

describe('<PredictionBar />', () => {
  it('says Predicting, confirms with ✓ and corrects with the picker', async () => {
    const { PredictionBar } = await import('../components/PredictionBar')
    const toast = vi.fn()
    const { host, root } = await mount(createElement(PredictionBar, { belief, fan: { detected: false }, live: true, zones: ZONES, status: 'predicting', toast }))
    expect(host.textContent).toContain('Predicting: Lying in bed')
    expect(host.textContent).toContain('Fan off (detected)')
    await act(async () => { btn(host, 'Right').click() })
    await flush()
    expect(calls.at(-1)).toMatchObject({ url: '/api/aankhen/correct', method: 'POST', body: { zone: 'bed_lying', confirmed: true, seconds: 10 } })
    const sel = host.querySelector('select') as HTMLSelectElement
    await act(async () => {
      sel.value = 'at_desk_chair'
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    expect(calls.at(-1)).toMatchObject({ url: '/api/aankhen/correct', body: { zone: 'at_desk_chair', confirmed: false } })
    await act(async () => { btn(host, 'Fan on').click() })
    await flush()
    expect(calls.at(-1)).toMatchObject({ url: '/api/aankhen/drill/fan', body: { on: true } })
    expect(toast).toHaveBeenCalled()
    act(() => root.unmount())
  })

  it('cannot confirm a simulation', async () => {
    const { PredictionBar } = await import('../components/PredictionBar')
    const { host, root } = await mount(createElement(PredictionBar, { belief, fan: null, live: false, zones: ZONES, status: 'answering', toast: vi.fn() }))
    expect(host.textContent).toContain("You're at: Lying in bed")
    expect(btn(host, 'Right').disabled).toBe(true)
    act(() => root.unmount())
  })
})

describe('<TeachTrainPanel />', () => {
  async function panel() {
    const { TeachTrainPanel, useTrain } = await import('../components/TeachTrainPanel')
    function Host() {
      const train = useTrain(true)
      return createElement(TeachTrainPanel, { zones: ZONES, train, live: true, toast: vi.fn(), onClose: () => {} })
    }
    return mount(createElement(Host))
  }

  it('the mini drill starts, then a tap posts the place', async () => {
    const { host, root } = await panel()
    expect(host.textContent).toContain('on the way')               // the transit row
    await act(async () => { btn(host, 'Start').click() })
    await flush()
    expect(calls.some((c) => c.url === '/api/aankhen/minidrill/start' && c.method === 'POST')).toBe(true)
    await act(async () => { btn(host, 'Lying in bed0 s').click() })
    await flush()
    expect(calls.filter((c) => c.url === '/api/aankhen/minidrill/tap').map((c) => c.body)).toEqual([{ zone: 'bed_lying' }])
    act(() => root.unmount())
  })

  it('the Train tab shows the report in plain words and starts the job', async () => {
    const { host, root } = await panel()
    await act(async () => { btn(host, 'Train').click() })        // the tab
    await flush()
    const text = host.textContent ?? ''
    expect(text).toContain('42 %')
    expect(text).toContain('25 %')
    expect(text).toContain('desk 12 s of 30 s')
    expect(text).toContain('predicting')
    const trainBtn = [...host.querySelectorAll('button.primary')].find((b) => b.textContent?.includes('Train')) as HTMLButtonElement
    await act(async () => { trainBtn.click() })
    await flush()
    expect(calls.some((c) => c.url === '/api/aankhen/train2' && c.method === 'POST' && (c.body as { per_place_s: number }).per_place_s === 30)).toBe(true)
    act(() => root.unmount())
  })
})
