/** The Energy card: estimates are labelled as estimates, refused relays show red,
 * and the card renders, switches period and keeps a nudge through the API. */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  barRows, canKeep, energyTone, fmtKwh, fmtMinutes, fmtRupees, nudgeBadge, relayLabel, seriesHeights, sourceNote,
  type Circuit, type CircuitRow, type EnergyView, type Nudge, type Report,
} from '../lib/energy'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const row = (id: string, kwh: number, extra: Partial<CircuitRow> = {}): CircuitRow => ({
  id, name: `${id} name`, room: 'bedroom', kind: 'light', rated_w: 20, relay: 1, switchable: true, refused: null,
  on_s: 3600, kwh, rupees: kwh * 3, virtual_kwh: 0, manual_kwh: 0, ...extra,
})

const circuit = (id: string, extra: Partial<Circuit> = {}): Circuit => ({
  id, name: `${id} name`, room: 'bedroom', kind: 'light', rated_w: 20, relay: 1, safe_7a: true, alias: null,
  must_not_auto_off: false, speed_steps: 0, refused: null, requested_relay: null, current_a: 0.11, relay_safe: true,
  relay_reason: null, never_on_relay: false, switchable: true, note: '', ...extra,
})

const nudge = (extra: Partial<Nudge> = {}): Nudge => ({
  id: 'n3', ts: 1_760_000_000, kind: 'empty_room', room: 'bedroom', circuits: ['L1'], empty_min: 20, sim: false,
  text: 'The bedroom has been empty for 20 minutes and the bedroom tube light is still on.',
  spoken: true, spoken_at: 1_760_000_000, status: 'open', night: false,
  auto_off: { will_auto_off: true, targets: ['L1'], after_min: 45, why_not: [] }, ...extra,
})

function report(extra: Partial<Report> = {}): Report {
  return {
    period: 'day', start: 0, end: 86400, now: 3600 * 20, estimate: true,
    basis: 'estimated: rated watts from circuits.json x the time each circuit was on; not a meter reading',
    kwh: 2.068, rupees: 6.2, virtual_kwh: 0.068, manual_kwh: 2.0, virtual_share: 0.033,
    circuits: [row('G1', 2.0, { kind: 'geyser', relay: null, switchable: false, manual_kwh: 2 }), row('L1', 0.04), row('AC1', 0, { kind: 'ac', relay: null })],
    series: Array.from({ length: 24 }, (_, h) => ({ t: h * 3600, label: String(h).padStart(2, '0'), kwh: h === 18 ? 1.5 : h === 19 ? 0.5 : 0, rupees: 0, future: h > 20 })),
    waste: { minutes: 49, kwh: 0.0555, rupees: 0.17, sim_minutes: 0, sim_kwh: 0, by_circuit_min: { L1: 49 } },
    gaps: [], month_kwh_to_date: 2.068,
    tariff: { name: 'EXAMPLE slabs - replace with your DISCOM\'s domestic tariff', example: true, telescopic: true, base_kwh_month: 0, currency: 'INR', note: '', marginal_rate: 3, slabs: [] },
    excludes: 'fixed charges, electricity duty and taxes',
    ...extra,
  }
}

function view(extra: Partial<EnergyView> = {}): EnergyView {
  return {
    now: 3600 * 20, estimate: true, meter: null, report: report(),
    circuits: {
      source: 'example', example: true, relay_channels: 12, problems: [], relay_rating_a: 7, safe_current_a: 5.6,
      circuits: [
        circuit('L1', { alias: 'light' }),
        circuit('G1', { kind: 'geyser', rated_w: 2000, relay: null, never_on_relay: true, switchable: false, relay_safe: false, relay_reason: 'G1 is a geyser: a geyser never goes on a relay' }),
        circuit('AC1', { kind: 'ac', relay: null, refused: 'AC1 is an AC: an AC never goes on a relay', requested_relay: 10, never_on_relay: true, switchable: false }),
      ],
    },
    states: {
      L1: { on: true, watts: 20, since: 0, link: 'virtual', origin: 'app' },
      G1: { on: true, watts: 2000, since: 0, link: 'manual', origin: 'you' },
      AC1: { on: false, watts: 0, since: null, link: null, origin: null },
    },
    waste: {
      status: { state: 'wasting', text: 'Room empty 49 min with the bedroom tube light on.', sim: false },
      config: { sensed_room: 'bedroom', grace_min: 5, nudge_after_min: 20, auto_off_enabled: false, auto_off_after_min: 45, min_after_nudge_min: 10, night: { start: '23:00', end: '07:00' }, notes: [] },
      nudges: [nudge()],
    },
    presence: { state: 'empty', source: 'hardware', learned: null, sim: false },
    auto_off: false, core_running: true, relay_board: false, problems: [],
    ...extra,
  }
}

describe('energy helpers', () => {
  it('numbers are amber estimates until a meter measures them', () => {
    expect(energyTone({ meter: null, estimate: true })).toBe('sim')
    expect(energyTone({ meter: { kind: 'pzem' }, estimate: false })).toBe('live')
  })

  it('formats kWh by size and rupees the Indian way', () => {
    expect(fmtKwh(0)).toBe('0')
    expect(fmtKwh(0.0004)).toBe('<0.001')
    expect(fmtKwh(0.0876)).toBe('0.088')
    expect(fmtKwh(2.068)).toBe('2.07')
    expect(fmtKwh(123.46)).toBe('123.5')
    expect(fmtKwh(null)).toBe('—')
    expect(fmtRupees(123456.5)).toBe('1,23,456.50')
    expect(fmtMinutes(49)).toBe('49 min')
    expect(fmtMinutes(400)).toBe('6 h 40 min')
  })

  it('bars are relative to the biggest consumer, and a tiny one is still visible', () => {
    const b = barRows([row('A', 2), row('B', 0.001), row('C', 0)])
    expect(b.map((r) => r.pct)).toEqual([100, 2, 0])
    expect(barRows([row('A', 0)])[0].pct).toBe(0)
  })

  it('spark bars leave the future empty', () => {
    const h = seriesHeights(report().series)
    expect(h[18]).toBe(100)
    expect(h[19]).toBeCloseTo(33.33, 1)
    expect(h[22]).toBe(0)
  })

  it('a refused relay is red with the reason; an AC or geyser says it never goes on one', () => {
    const refused = relayLabel(circuit('AC1', { refused: 'AC1 is an AC', requested_relay: 10, never_on_relay: true }))
    expect(refused).toEqual({ text: 'relay 10 refused', tone: 'fault', title: 'AC1 is an AC' })
    expect(relayLabel(circuit('G1', { never_on_relay: true, relay: null })).text).toBe('never on a relay')
    expect(relayLabel(circuit('L2', { switchable: false, relay: 2 })).text).toBe('relay 2 · not wired yet')
    expect(relayLabel(circuit('L1')).title).toBe('0.11 A of a safe 5.6 A')
  })

  it('says how much of the total is the virtual room, reported loads and app-closed gaps', () => {
    const n = sourceNote(report({ gaps: [{ t0: 0, t1: 10 }] }))!
    expect(n).toContain('3% of this is the virtual room')
    expect(n).toContain('2.00 kWh is from loads you reported')
    expect(n).toContain('1 stretch with the app closed is not counted')
    expect(sourceNote(report({ kwh: 0, virtual_share: 0, manual_kwh: 0 }))).toBeNull()
  })

  it('nudge badges never claim more than happened', () => {
    expect(nudgeBadge(nudge()).text).toBe('spoken')
    expect(nudgeBadge(nudge({ spoken: false, not_spoken: 'JARVIS is not running' })).text).toBe('not spoken · JARVIS is not running')
    expect(nudgeBadge(nudge({ sim: true, spoken: false, not_spoken: 'simulated presence' }))).toEqual({ text: 'not spoken', tone: 'sim' })
    expect(nudgeBadge(nudge({ status: 'auto_off' }))).toEqual({ text: 'switched off', tone: 'live' })
    expect(canKeep(nudge())).toBe(true)
    expect(canKeep(nudge({ status: 'kept' }))).toBe(false)
    expect(canKeep(nudge({ auto_off: { will_auto_off: false, targets: [], why_not: ['auto-off is off'] } }))).toBe(false)
  })
})

describe('<EnergyCard />', () => {
  const calls: { url: string; method: string; body?: string }[] = []
  let payload: EnergyView = view()

  beforeEach(() => {
    calls.length = 0
    payload = view()
    vi.stubGlobal('fetch', async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body })
      const body = String(url).startsWith('/api/energy/nudges/') ? { ...nudge(), status: 'kept' } : payload
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  async function mount() {
    const { EnergyCard } = await import('../components/EnergyCard')
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(createElement(EnergyCard)) })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    return { host, root }
  }

  it('renders the estimate label, the numbers, the rows and the nudge', async () => {
    const { host, root } = await mount()
    const text = host.textContent ?? ''
    expect(host.querySelector('.pill.sim')?.textContent).toContain('estimate')
    expect(text).toContain('Estimate.')
    expect(text).toContain('not a meter reading')
    expect(text).toContain('example tariff')
    expect(host.querySelectorAll('.estat-num.sim').length).toBe(3)        // all three numbers amber
    expect(host.querySelectorAll('.erow').length).toBe(3)
    expect(host.querySelector('.erow-chip.fault')?.textContent).toContain('relay 10 refused')
    expect(text).toContain('mark off')                                     // the geyser: recorded, not switched
    expect(host.querySelectorAll('.espark i').length).toBe(24)
    expect(text).toContain('The bedroom has been empty for 20 minutes')
    expect(host.querySelector('.ewatch-status .pill.live')?.textContent).toContain('sensed · empty')
    await act(async () => { root.unmount() })
  })

  it('switches period and keeps a nudge on through the API', async () => {
    const { host, root } = await mount()
    const week = [...host.querySelectorAll('.seg button')].find((b) => b.textContent === 'Week') as HTMLButtonElement
    await act(async () => { week.click() })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(calls.some((c) => c.url === '/api/energy?period=week')).toBe(true)
    const keep = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Keep it on')) as HTMLButtonElement
    await act(async () => { keep.click() })
    expect(calls.some((c) => c.url === '/api/energy/nudges/n3/keep' && c.method === 'POST')).toBe(true)
    await act(async () => { root.unmount() })
  })

  it('shows simulated presence in amber and an error with a retry', async () => {
    payload = view({ presence: { state: 'empty', source: 'simulation', learned: null, sim: true } })
    const a = await mount()
    expect(a.host.querySelector('.ewatch-status .pill.sim')?.textContent).toContain('simulated · empty')
    await act(async () => { a.root.unmount() })
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ detail: 'boom' }), { status: 500 }))
    const b = await mount()
    expect(b.host.querySelector('.energy-error')?.textContent).toContain('Energy ledger unavailable: boom')
    await act(async () => { b.root.unmount() })
  })
})
