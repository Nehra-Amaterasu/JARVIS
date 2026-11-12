// The state contract of the honesty lamp (spec 6.6, decision D12). A reading is never just a number: it is a number
// plus {state, since, reason}. The default when a source cannot say is WAITING "no report", never LIVE, so a
// widget that was never wired shows an em dash and the word WAITING instead of a made-up value.

export const LAMP_STATES = ['live', 'waiting', 'simulated', 'planned', 'fault'] as const
export type LampState = (typeof LAMP_STATES)[number]

/** The contract every capability reports: what state, since when (epoch ms, null when unknown), and why in words. */
export interface LampReading {
  state: LampState
  /** Epoch ms of the last change of state; null when no report has ever arrived. */
  since: number | null
  /** One short human sentence. FAULT must carry one; WAITING says what is awaited ("no report" by default). */
  reason: string
}

export interface LampSpec {
  state: LampState
  /** The shape, named so a test can tell the five apart without looking at colour. */
  glyph: 'disc' | 'half-disc' | 'diamond' | 'dashed-ring' | 'triangle'
  /** The state token of the clay layer (the semantic layer of spec 6.3). */
  token: string
  /** The word shown beside the glyph and spoken by screen readers. */
  label: string
  /** What the state means, for tooltips and the roadmap overlay. */
  means: string
}

export const LAMP_SPECS: Record<LampState, LampSpec> = {
  live: { state: 'live', glyph: 'disc', token: '--state-measured', label: 'LIVE', means: 'A real source reported it now' },
  waiting: { state: 'waiting', glyph: 'half-disc', token: '--state-waiting', label: 'WAITING', means: 'The expected signal has not arrived' },
  simulated: { state: 'simulated', glyph: 'diamond', token: '--state-simulated', label: 'SIMULATED', means: 'The data is generated, not measured' },
  planned: { state: 'planned', glyph: 'dashed-ring', token: '--state-planned', label: 'PLANNED', means: 'Not built: no code path produces it' },
  fault: { state: 'fault', glyph: 'triangle', token: '--state-fault', label: 'FAULT', means: 'The source reported an error' },
}

export const NO_REPORT = 'no report'

/** The reading a capability has before anything has been said. Frozen and shared so a store selector stays stable. */
export const WAITING_DEFAULT: Readonly<LampReading> = Object.freeze({ state: 'waiting', since: null, reason: NO_REPORT })

export const isLampState = (s: unknown): s is LampState => typeof s === 'string' && (LAMP_STATES as readonly string[]).includes(s)

/**
 * Turn whatever a source handed over into a valid reading. Anything unusable becomes WAITING "no report"; it never
 * becomes LIVE. A LIVE reading with no `since` is kept (the source did report) but marked as undated; a FAULT with no
 * reason gets the honest "no reason given" rather than an empty line.
 */
export function readingOf(input?: Partial<LampReading> | null): LampReading {
  if (!input || !isLampState(input.state)) return WAITING_DEFAULT as LampReading
  const since = typeof input.since === 'number' && Number.isFinite(input.since) ? input.since : null
  const given = typeof input.reason === 'string' ? input.reason.trim() : ''
  if (input.state === 'fault') return { state: 'fault', since, reason: given || 'no reason given' }
  if (input.state === 'waiting') return { state: 'waiting', since, reason: given || NO_REPORT }
  return { state: input.state, since, reason: given }
}

/** "since 14:03" or "no report yet"; `now` is a parameter so the text is testable. */
export function sinceText(r: LampReading, now: number = Date.now()): string {
  if (r.since == null) return 'no report yet'
  const s = Math.max(0, Math.round((now - r.since) / 1000))
  if (s < 5) return 'just now'
  if (s < 90) return `${s} s ago`
  const m = Math.round(s / 60)
  if (m < 90) return `${m} min ago`
  return `${Math.round(m / 60)} h ago`
}

/** The accessible name of a lamp: state word, then the reason when there is one, then the age. */
export function lampName(r: LampReading, now?: number): string {
  const spec = LAMP_SPECS[r.state]
  return `${spec.label}${r.reason ? `, ${r.reason}` : ''}, ${sinceText(r, now)}`
}

/** A state may show a number only when something real or openly generated produced it. */
export const showsNumber = (s: LampState): boolean => s === 'live' || s === 'simulated'
