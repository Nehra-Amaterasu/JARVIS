/** The staff (lib/crew.ts): a backend that is absent or failing becomes words, not a
 * crash; the narration merges the poll with the bus without saying anything twice;
 * simulated lines stay marked; and each agent gets its glyph and LED. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BusEvent } from '../lib/api'
import {
  agentGlyph, fmtMs, loadCrew, mergeFeed, movementAgent, normaliseCrew, sinceTick, stateTone, type Agent, type CrewEvent,
} from '../lib/crew'

const agent = (id: string, extra: Partial<Agent> = {}): Agent => ({
  id, name: id, role: '', state: 'running', summary: '', data: {},
  health: { runs: 0, errors: 0, last_error: null, avg_ms: null, last_tick: null, cadence_s: null }, ...extra,
})

afterEach(() => vi.unstubAllGlobals())

describe('loading the crew', () => {
  const respond = (status: number, body: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })))

  it('reads the agents and events', async () => {
    respond(200, { agents: [{ id: 'movement', name: 'Movement', role: 'watches the room', state: 'running', summary: 'desk, typing', data: {}, health: { runs: 12, errors: 0, last_error: null, avg_ms: 3.5, last_tick: 100, cadence_s: 2 } }], events: [{ id: 1, ts: 100, agent: 'movement', kind: 'say', text: 'hello', data: {} }] })
    const r = await loadCrew()
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.view.agents[0]).toMatchObject({ id: 'movement', state: 'running', health: { runs: 12, avg_ms: 3.5 } })
    expect(r.view.events).toHaveLength(1)
  })
  it('turns a 404 into "not running yet", not an error', async () => {
    respond(404, { detail: 'Not Found' })
    expect(await loadCrew()).toEqual({ status: 'absent' })
  })
  it('turns a failure into a message', async () => {
    respond(500, { detail: 'crew crashed' })
    expect(await loadCrew()).toEqual({ status: 'error', message: 'crew crashed' })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    expect(await loadCrew()).toEqual({ status: 'error', message: 'Failed to fetch' })
  })
  it('fills what a young backend leaves out, honestly', () => {
    const v = normaliseCrew({ agents: [{ id: 'x', state: 'dancing' } as unknown as Agent], events: [{ id: 1, ts: 1, agent: 'x', kind: 'k', text: '' }] })
    expect(v.agents[0]).toMatchObject({ id: 'x', name: 'x', state: 'off', summary: '', health: { runs: 0, avg_ms: null } })
    expect(v.events).toHaveLength(0)                       // nothing to say: not shown
    expect(normaliseCrew(null)).toEqual({ agents: [], events: [] })
  })
})

describe('the narration', () => {
  const polled: CrewEvent[] = [
    { id: 1, ts: 100, agent: 'movement', kind: 'say', text: 'At the desk', data: {} },
    { id: 2, ts: 104, agent: 'energy', kind: 'say', text: 'Fan on for 2 h', data: { sim: true } },
  ]
  const bus = (id: number, ts: number, text: string, extra: Partial<BusEvent> = {}): BusEvent =>
    ({ id, ts, source: 'crew', kind: 'say', text, agent: 'movement', ...extra })

  it('puts the newest first and keeps simulated lines marked', () => {
    const f = mergeFeed(polled, [])
    expect(f.map((e) => e.text)).toEqual(['Fan on for 2 h', 'At the desk'])
    expect(f[0].sim).toBe(true)
    expect(f[1].sim).toBe(false)
  })
  it('shows a bus event at once, and only once when the poll catches up', () => {
    const live = bus(90, 110, 'Walking now', { sim: true })
    const before = mergeFeed(polled, [live])
    expect(before[0]).toMatchObject({ text: 'Walking now', sim: true, key: 'b90' })
    const after = mergeFeed([...polled, { id: 3, ts: 110.2, agent: 'movement', kind: 'say', text: 'Walking now', data: { sim: true } }], [live])
    expect(after.filter((e) => e.text === 'Walking now')).toHaveLength(1)
    expect(after[0].key).toBe('c3')
  })
  it('ignores the other sources on the bus and keeps at most `limit` lines', () => {
    const many = Array.from({ length: 20 }, (_, i) => bus(i + 10, 200 + i, `line ${i}`))
    const f = mergeFeed([], [...many, { id: 5, ts: 999, source: 'core', kind: 'say', text: 'not crew' }], 8)
    expect(f).toHaveLength(8)
    expect(f[0].text).toBe('line 19')
    expect(f.some((e) => e.text === 'not crew')).toBe(false)
  })
})

describe('looks', () => {
  it('gives each agent a glyph from what it is', () => {
    expect(agentGlyph({ id: 'movement' })).toBe('eyes')
    expect(agentGlyph({ id: 'x', name: 'Energy', role: 'watts and lights' })).toBe('energy')
    expect(agentGlyph({ id: 'away-guard' })).toBe('guard')
    expect(agentGlyph({ id: 'reminders' })).toBe('time')
    expect(agentGlyph({ id: 'ledger', name: 'Task ledger' })).toBe('ledger')
    expect(agentGlyph({ id: 'steward', name: 'Steward', role: "keeps an eye on JARVIS's own health" })).toBe('health')
    expect(agentGlyph({ id: 'q', name: 'Quartermaster', role: '' })).toBe('bot')
  })
  it('lights the LED by state', () => {
    expect(stateTone('running')).toBe('live')
    expect(stateTone('idle')).toBe('idle')
    expect(stateTone('error')).toBe('fault')
    expect(stateTone('off')).toBe('off')
  })
  it('finds the agent that narrates the room', () => {
    expect(movementAgent([agent('energy'), agent('movement')])?.id).toBe('movement')
    expect(movementAgent([agent('energy'), agent('watcher', { role: 'room presence' })])?.id).toBe('watcher')
    expect(movementAgent([agent('energy')])).toBeNull()
  })
  it('says when an agent last ran, and when it has missed its beats', () => {
    const h = (last: number | null, cadence: number | null) => ({ runs: 1, errors: 0, last_error: null, avg_ms: 1, last_tick: last, cadence_s: cadence })
    expect(sinceTick(h(95, 2), 100)).toEqual({ text: '5 s ago', stale: false })
    expect(sinceTick(h(80, 2), 100).stale).toBe(true)
    expect(sinceTick(h(100 - 180, null), 100)).toEqual({ text: '3 min ago', stale: false })
    expect(sinceTick(h(null, 2), 100)).toEqual({ text: 'never ran', stale: true })
    expect(fmtMs(3.456)).toBe('3.5')
    expect(fmtMs(42.4)).toBe('42')
    expect(fmtMs(null)).toBe('—')
  })
})
