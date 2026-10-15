/**
 * The Energy card's data and the small decisions about how to show it.
 *
 * Provenance is the rule (styles/tokens.css): every kWh and rupee here is an
 * ESTIMATE (rated watts x on-time, app/jarvis_app/energy.py), so it is amber until a
 * meter adds readings. Cyan is kept for what sensors really saw (live presence);
 * red for a relay the safety check refused.
 */

export type Period = 'day' | 'week' | 'month'
export type Tone = 'live' | 'sim' | 'fault' | 'muted'

export interface CircuitRow {
  id: string; name: string; room: string; kind: string; rated_w: number | null
  relay: number | null; switchable: boolean; refused: string | null
  on_s: number; kwh: number; rupees: number; virtual_kwh: number; manual_kwh: number
}

export interface Report {
  period: Period; start: number; end: number; now: number
  estimate: boolean; basis: string
  kwh: number; rupees: number; virtual_kwh: number; manual_kwh: number; virtual_share: number
  circuits: CircuitRow[]
  series: { t: number; label: string; kwh: number; rupees: number; future: boolean }[]
  waste: { minutes: number; kwh: number; rupees: number; sim_minutes: number; sim_kwh: number; by_circuit_min: Record<string, number> }
  gaps: { t0: number; t1: number }[]
  month_kwh_to_date: number
  tariff: { name: string; example: boolean; telescopic: boolean; base_kwh_month: number; currency: string; note: string; marginal_rate: number; slabs: { upto_kwh: number | null; rate: number }[] }
  excludes: string
}

export interface Circuit {
  id: string; name: string; room: string; kind: string; rated_w: number; relay: number | null
  safe_7a: boolean | null; alias: string | null; must_not_auto_off: boolean; speed_steps: number
  refused: string | null; requested_relay: number | null; current_a: number; relay_safe: boolean
  relay_reason: string | null; never_on_relay: boolean; switchable: boolean; note: string
}

export interface Nudge {
  id: string; ts: number; kind: 'empty_room' | 'long_on'; room: string; circuits: string[]
  empty_min?: number; on_min?: number; sim: boolean; text: string
  spoken: boolean; spoken_at: number | null; not_spoken?: string
  status: 'open' | 'kept' | 'resolved' | 'auto_off' | 'reminder' | 'closed'
  resolved_why?: string; night: boolean
  auto_off: { will_auto_off: boolean; targets: string[]; after_min?: number; why_not: string[] }
}

export interface EnergyView {
  now: number; estimate: boolean; meter: null | Record<string, unknown>
  report: Report
  circuits: { source: 'yours' | 'example'; example: boolean; relay_channels: number; problems: { id: string | null; error: string }[]; relay_rating_a: number; safe_current_a: number; circuits: Circuit[] }
  states: Record<string, { on: boolean; watts: number; since: number | null; link: 'usb' | 'virtual' | 'manual' | null; origin: string | null }>
  waste: {
    status: { state: string; text: string; sim?: boolean; empty_min?: number }
    config: { sensed_room: string | null; grace_min: number; nudge_after_min: number; auto_off_enabled: boolean; auto_off_after_min: number; min_after_nudge_min: number; night: { start: string; end: string }; notes: string[] }
    nudges: Nudge[]
  }
  presence: { state?: string | null; source?: string | null; learned?: string | null; sim: boolean }
  auto_off: boolean
  core_running: boolean
  relay_board: boolean
  problems: string[]
}

export const PERIOD_LABEL: Record<Period, string> = { day: 'Today', week: 'This week', month: 'This month' }
export const PERIOD_TAB: Record<Period, string> = { day: 'Today', week: 'Week', month: 'Month' }

/** Energy numbers are amber until a meter measures them. */
export const energyTone = (v: Pick<EnergyView, 'meter' | 'estimate'>): Tone => (v.meter && !v.estimate ? 'live' : 'sim')

export function fmtKwh(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  if (n === 0) return '0'
  if (n > 0 && n < 0.001) return '<0.001'          // a few Wh: not zero, and not "0.000"
  if (n < 1) return n.toFixed(3)
  if (n < 10) return n.toFixed(2)
  return n.toFixed(1)
}

export function fmtRupees(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Bar widths (0-100) relative to the largest consumer in the period. */
export function barRows(rows: CircuitRow[]): (CircuitRow & { pct: number })[] {
  const max = Math.max(0, ...rows.map((r) => r.kwh))
  return rows.map((r) => ({ ...r, pct: max > 0 ? Math.max(r.kwh > 0 ? 2 : 0, (r.kwh / max) * 100) : 0 }))
}

/** Spark-bar heights for the series (0-100), future buckets kept at zero. */
export function seriesHeights(series: Report['series']): number[] {
  const max = Math.max(0, ...series.map((s) => s.kwh))
  return series.map((s) => (s.future || max <= 0 ? 0 : (s.kwh / max) * 100))
}

/** What the relay chip says about a circuit, and in which colour. */
export function relayLabel(c: Circuit, safeA = 5.6): { text: string; tone: Tone; title: string } {
  if (c.refused) return { text: c.requested_relay ? `relay ${c.requested_relay} refused` : 'refused', tone: 'fault', title: c.refused }
  if (c.never_on_relay) return { text: 'never on a relay', tone: 'muted', title: c.relay_reason ?? '' }
  if (c.relay === null) return { text: 'tracked only', tone: 'muted', title: 'No relay channel: JARVIS records what you report.' }
  return {
    text: c.switchable ? `relay ${c.relay}` : `relay ${c.relay} · not wired yet`,
    tone: 'muted',
    title: `${c.current_a.toFixed(2)} A of a safe ${safeA.toFixed(1)} A`
      + (c.switchable ? '' : ' — the Uno firmware that drives this channel does not exist yet'),
  }
}

/** The one-line provenance warning under the numbers, or null when there is nothing to warn about. */
export function sourceNote(r: Report): string | null {
  const parts: string[] = []
  if (r.kwh > 0 && r.virtual_share >= 0.005) {
    parts.push(`${Math.round(r.virtual_share * 100)}% of this is the virtual room: with no relay board connected, the app's switches are not your wall switches`)
  }
  if (r.manual_kwh > 0) parts.push(`${fmtKwh(r.manual_kwh)} kWh is from loads you reported`)
  if (r.gaps.length) parts.push(`${r.gaps.length} stretch${r.gaps.length === 1 ? '' : 'es'} with the app closed ${r.gaps.length === 1 ? 'is' : 'are'} not counted`)
  return parts.length ? parts.join(' · ') + '.' : null
}

/** A nudge's status as a short label and tone. */
export function nudgeBadge(n: Nudge): { text: string; tone: Tone } {
  if (n.status === 'auto_off') return { text: 'switched off', tone: 'live' }
  if (n.status === 'kept') return { text: 'kept on', tone: 'muted' }
  if (n.status === 'resolved') return { text: n.resolved_why ? `closed · ${n.resolved_why}` : 'closed', tone: 'muted' }
  if (n.status === 'closed') return { text: 'closed · app restarted', tone: 'muted' }
  if (n.spoken) return { text: 'spoken', tone: n.sim ? 'sim' : 'live' }
  // A simulated nudge already wears a "simulated" pill: don't say it twice.
  if (n.sim) return { text: 'not spoken', tone: 'sim' }
  return { text: n.not_spoken ? `not spoken · ${n.not_spoken}` : 'app only', tone: 'muted' }
}

/** Can the "keep it on" button still change anything? */
export const canKeep = (n: Nudge) => n.status === 'open' && n.auto_off.will_auto_off

export const clockHM = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

export function fmtMinutes(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return '0 min'
  if (min < 60) return `${Math.round(min)} min`
  return `${Math.floor(min / 60)} h ${Math.round(min % 60)} min`
}
