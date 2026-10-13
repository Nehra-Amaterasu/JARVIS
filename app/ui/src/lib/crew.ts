/**
 * JARVIS's staff ("the crew"): small agents that each watch one thing and say what
 * they see. The UI's side of the crew backend (GET /api/crew, /api/crew/events and the
 * event bus, source "crew"). Pure helpers, unit-tested (src/__tests__/crew.test.ts).
 *
 * The backend may not exist yet, or be starting: every reader here turns that into a
 * state the cards can say plainly ("staff not running yet") instead of an error.
 */
import { ApiError, api, type BusEvent } from './api'

export type AgentState = 'running' | 'idle' | 'error' | 'off'

export interface AgentHealth {
  runs: number
  errors: number
  last_error: string | null
  avg_ms: number | null
  last_tick: number | null           // epoch seconds
  cadence_s: number | null
}
export interface Agent {
  id: string
  name: string
  role: string
  state: AgentState
  summary: string
  data: Record<string, unknown>
  health: AgentHealth
}
export interface CrewEvent {
  id: number | string
  ts: number                          // epoch seconds
  agent: string
  kind: string
  text: string
  data?: Record<string, unknown>
}
export interface CrewView { agents: Agent[]; events: CrewEvent[] }

/** What the crew endpoint said: data, "not there yet" (404), or a failure. */
export type CrewLoad =
  | { status: 'ok'; view: CrewView }
  | { status: 'absent' }
  | { status: 'error'; message: string }

export async function loadCrew(signal?: AbortSignal): Promise<CrewLoad> {
  try {
    const v = await api<Partial<CrewView>>('/api/crew', { signal })
    return { status: 'ok', view: normaliseCrew(v) }
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { status: 'absent' }
    if ((e as Error).name === 'AbortError') throw e
    return { status: 'error', message: (e as Error).message || 'unreachable' }
  }
}

const STATES: AgentState[] = ['running', 'idle', 'error', 'off']

/** Tolerant of a backend still finding its shape: missing fields get honest blanks. */
export function normaliseCrew(v: Partial<CrewView> | null | undefined): CrewView {
  const agents = (Array.isArray(v?.agents) ? v!.agents : []).map((a): Agent => {
    const h = (a?.health ?? {}) as Partial<AgentHealth>
    return {
      id: String(a?.id ?? a?.name ?? '?'),
      name: String(a?.name ?? a?.id ?? 'agent'),
      role: String(a?.role ?? ''),
      state: STATES.includes(a?.state as AgentState) ? (a!.state as AgentState) : 'off',
      summary: String(a?.summary ?? ''),
      data: (a?.data && typeof a.data === 'object') ? a.data : {},
      health: {
        runs: Number(h.runs) || 0, errors: Number(h.errors) || 0, last_error: h.last_error ?? null,
        avg_ms: h.avg_ms == null ? null : Number(h.avg_ms), last_tick: h.last_tick == null ? null : Number(h.last_tick),
        cadence_s: h.cadence_s == null ? null : Number(h.cadence_s),
      },
    }
  })
  const events = (Array.isArray(v?.events) ? v!.events : []).filter((e) => e && e.text)
  return { agents, events }
}

/* ------------------------------------------------------------------ the feed */
export interface FeedItem {
  key: string
  ts: number
  agent: string
  kind: string
  text: string
  sim: boolean
}

const isSim = (d: Record<string, unknown> | undefined, extra?: unknown) => Boolean(d?.sim ?? extra)

/** The narration, newest first: the polled events, plus bus events that arrived since
 *  the last poll (the bus is instant, the poll every 2 s). A bus event the poll has
 *  since returned (same agent and text within 5 s) is shown once. */
export function mergeFeed(polled: CrewEvent[], bus: BusEvent[], limit = 8): FeedItem[] {
  const items: FeedItem[] = polled.map((e) => ({
    key: `c${e.id}`, ts: e.ts, agent: e.agent, kind: e.kind, text: e.text, sim: isSim(e.data),
  }))
  for (const b of bus) {
    if (b.source !== 'crew' || !b.text) continue
    const agent = String(b.agent ?? (b.data as Record<string, unknown> | undefined)?.agent ?? '')
    const dup = items.some((x) => x.agent === agent && x.text === b.text && Math.abs(x.ts - b.ts) < 5)
    if (dup) continue
    items.push({ key: `b${b.id}`, ts: b.ts, agent, kind: b.kind, text: b.text,
      sim: isSim(b.data as Record<string, unknown> | undefined, b.sim) })
  }
  items.sort((a, b) => b.ts - a.ts)
  return items.slice(0, limit)
}

/* ------------------------------------------------------------------ looks */
export type Glyph = 'eyes' | 'energy' | 'guard' | 'memory' | 'time' | 'health' | 'mission' | 'voice' | 'home' | 'ledger' | 'bot'
const GLYPH_WORDS: [Glyph, RegExp][] = [
  ['eyes', /move|motion|eyes|aankhen|presence|room|sens/i],
  ['ledger', /ledger|task|request|job|count/i],
  ['energy', /energy|power|watt|electric|kwh|light/i],
  ['guard', /guard|secur|away|intru|door|lock/i],
  ['memory', /memor|yaad|recall|archive|brain/i],
  ['time', /remind|timer|alarm|schedul|calendar|clock|time/i],
  ['health', /health|vital|system|gpu|cpu|vram|disk/i],
  ['mission', /mission|study|germoney|quest|focus/i],
  ['voice', /voice|speech|speak|listen|ear/i],
  ['home', /home|house|limb|device|switch/i],
]
/** An agent's glyph, from what it is called and what it does. */
export function agentGlyph(a: Pick<Agent, 'id' | 'name' | 'role'> | { id: string; name?: string; role?: string }): Glyph {
  const id = a.id ?? '', words = `${a.name ?? ''} ${a.role ?? ''}`
  for (const [g, re] of GLYPH_WORDS) if (re.test(id)) return g
  for (const [g, re] of GLYPH_WORDS) if (re.test(words)) return g
  return 'bot'
}

/** LED tone: provenance colours, as everywhere. */
export function stateTone(s: AgentState): 'live' | 'idle' | 'fault' | 'off' {
  return s === 'running' ? 'live' : s === 'idle' ? 'idle' : s === 'error' ? 'fault' : 'off'
}

/** The agent that narrates the room (for "what I see right now"), if there is one. */
export function movementAgent(agents: Agent[]): Agent | null {
  return agents.find((a) => /^(movement|motion|eyes|presence)/i.test(a.id))
    ?? agents.find((a) => agentGlyph(a) === 'eyes') ?? null
}

/** "12 s ago", "3 min ago"; stale when the agent missed three of its own beats. */
export function sinceTick(h: AgentHealth, now: number): { text: string; stale: boolean } {
  if (h.last_tick == null) return { text: 'never ran', stale: true }
  const s = Math.max(0, now - h.last_tick)
  const text = s < 60 ? `${Math.round(s)} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`
  return { text, stale: h.cadence_s != null && h.cadence_s > 0 && s > 3 * h.cadence_s + 2 }
}

export const fmtMs = (ms: number | null | undefined) =>
  ms == null || !Number.isFinite(ms) ? '—' : ms < 10 ? ms.toFixed(1) : String(Math.round(ms))
