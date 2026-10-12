/**
 * Away mode (SIH-1) on the UI side: the server's shapes and the small decisions the
 * card and the alert banner make from them. Pure functions, so they are unit-tested
 * (src/__tests__/away.test.ts) without rendering anything.
 *
 * Colour is provenance here too: an alarm from real sensors is red (--fault), one
 * from the simulator is amber (--sim) — it is still shown, never hidden, but it can
 * never look like a real break-in.
 */
import type { BusEvent } from './api'

export type Phase = 'disarmed' | 'arming' | 'armed' | 'pending' | 'alarm'
export type Tone = 'live' | 'sim' | 'fault' | 'idle'

export interface AwayPhone {
  name: string; mac: string | null; ip: string | null; key: string
  last_seen: number | null; seen_ago_s: number | null; home: boolean
  evidence: string | null; ip_now: string | null; randomised_mac: boolean
}

export interface AwayConfig {
  phones: { name: string; mac: string | null; ip: string | null }[]
  auto_arm: boolean; away_after_min: number; return_gap_s: number; exit_delay_s: number
  entry_delay_s: number; confirm_k: number; confirm_n: number; clear_after_s: number
  tamper_after_s: number; check_every_s: number; ping: boolean; warning: string
}

export interface Receipt { done: boolean | null; detail: string; text?: string }

export interface AwayStatus {
  phase: Phase
  armed: boolean; armed_by: 'app' | 'voice' | 'auto' | null; armed_at: number | null
  watch_from: number | null; exit_left_s: number | null; entry_left_s: number | null
  disarmed_at: number | null; disarmed_by: 'app' | 'phone' | null
  auto_arm: { enabled: boolean; ready: boolean; reason: string; paused: boolean; arms_in_s: number | null }
  phones: AwayPhone[]; phones_home: string[]
  check: { at: number; ok: boolean; error: string | null; method: string; every_s: number | null } | null
  incident: null | {
    id: string; stage: 'pending' | 'alarm'; started_at: number; confirmed_at: number
    label: string | null; simulated: boolean; source: string | null
    actions: { lights?: Receipt; speech?: Receipt }
  }
  tamper: null | { id: string; started_at: number }
  sensor: { source: string | null }
  warnings: string[]; limits: string[]; now: number
  aankhen: { running: boolean; mode: string | null }
  config: AwayConfig; config_problem: string | null
}

export interface TraceRow { t: number; wifi: string | null; score: number | null; thr: number | null; moving: number; still: number; radar?: boolean; presence: string | null; pos: boolean }

export interface Incident {
  id: string; kind: 'motion' | 'tamper'; started_at: number; confirmed_at: number
  ended_at: number | null; duration_s: number | null; source: string | null; simulated: boolean
  label: string | null; stage: string; outcome: string | null; armed_by: string | null
  actions: { lights?: Receipt; speech?: Receipt }; trace_n?: number; trace?: TraceRow[]
}

export interface Neighbor { ip: string; mac: string; state: string; randomised_mac: boolean; listed: boolean }

/* -------------------------------------------------------------- formatting */
export function fmtAgo(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return 'not seen yet'
  if (s < 5) return 'just now'
  if (s < 60) return `${Math.round(s)} s ago`
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 360) / 10} h ago`
  return `${Math.round(s / 86400)} d ago`
}

export function fmtIn(s: number): string {
  if (s < 60) return `${Math.max(0, Math.ceil(s))} s`
  return `${Math.ceil(s / 60)} min`
}

const BY: Record<string, string> = { auto: 'by itself — everyone was away', app: 'from the app', voice: 'by voice' }
export const armedByText = (by: string | null) => (by ? BY[by] ?? by : '')

const EVIDENCE: Record<string, string> = { ping: 'answered ping', 'arp-reachable': 'answered ARP' }
export const evidenceText = (e: string | null) => (e ? EVIDENCE[e] ?? e : '')

/* -------------------------------------------------------------- the state, in words */
export interface PhaseView { label: string; tone: Tone; line: string }

export function phaseView(st: AwayStatus | null): PhaseView {
  if (!st) return { label: '…', tone: 'idle', line: 'Reading away mode…' }
  const inc = st.incident
  const simInc = !!inc?.simulated
  switch (st.phase) {
    case 'arming':
      return { label: 'Arming', tone: 'sim', line: `Watching starts in ${fmtIn(st.exit_left_s ?? 0)} — time to leave.` }
    case 'pending':
      return {
        label: simInc ? 'Motion · simulated' : 'Motion confirmed', tone: simInc ? 'sim' : 'fault',
        line: `Alarm in ${fmtIn(st.entry_left_s ?? 0)} unless a family phone comes home or you disarm.`,
      }
    case 'alarm':
      return {
        label: simInc ? 'Alarm · simulated' : 'Alarm', tone: simInc ? 'sim' : 'fault',
        line: simInc ? 'A simulated intruder set it off. The real house was not watched.' : 'Motion inside while armed.',
      }
    case 'armed': {
      const src = st.sensor.source
      if (src === 'hardware') return { label: 'Armed', tone: 'live', line: `Armed ${armedByText(st.armed_by)}. Watching through Aankhen's sensors.` }
      if (src === 'simulation' || src === 'replay')
        return { label: 'Armed', tone: 'sim', line: `Armed ${armedByText(st.armed_by)} — but Aankhen is running a ${src}: the real house is not watched.` }
      return { label: 'Armed', tone: 'fault', line: `Armed ${armedByText(st.armed_by)} — but Aankhen is not running, so nothing is watched.` }
    }
    default: {
      const a = st.auto_arm
      if (!a.enabled) return { label: 'Disarmed', tone: 'idle', line: 'Auto-arm is off. Arm it by hand when the house is empty.' }
      if (a.arms_in_s !== null && a.arms_in_s > 0) return { label: 'Disarmed', tone: 'idle', line: `Arms itself in ${fmtIn(a.arms_in_s)} if no family phone is seen.` }
      return { label: 'Disarmed', tone: 'idle', line: `Won't arm itself: ${a.reason}.` }
    }
  }
}

/** Progress (0..1) of the running countdown, if any — drives the meter. */
export function countdown(st: AwayStatus | null): { left: number; total: number; frac: number } | null {
  if (!st) return null
  if (st.phase === 'arming' && st.exit_left_s !== null) {
    const total = st.config.exit_delay_s || 1
    return { left: st.exit_left_s, total, frac: 1 - st.exit_left_s / total }
  }
  if (st.phase === 'pending' && st.entry_left_s !== null) {
    const total = st.config.entry_delay_s || 1
    return { left: st.entry_left_s, total, frac: 1 - st.entry_left_s / total }
  }
  return null
}

/* -------------------------------------------------------------- adding a phone */
const MAC = /^[0-9a-f]{2}([-:]?)[0-9a-f]{2}(\1[0-9a-f]{2}){4}$/i

export function normMac(s: string): string | null {
  const t = s.trim()
  if (!MAC.test(t)) return null
  const hex = t.replace(/[-:]/g, '').toLowerCase()
  return hex.match(/../g)!.join('-')
}

/** A hint before the server's own check (the server's word is final). */
export function phoneProblem(p: { name: string; mac: string; ip: string }): string | null {
  if (!p.name.trim()) return 'Whose phone is it? Give it a name.'
  if (!p.mac.trim() && !p.ip.trim()) return "Give the phone's MAC address, its IP, or both."
  if (p.mac.trim()) {
    const m = normMac(p.mac)
    if (!m) return 'That MAC address should look like 3a-11-22-33-44-55.'
    if (parseInt(m[1], 16) & 1) return 'That is a group (multicast) address, not a phone.'
  }
  if (p.ip.trim()) {
    const parts = p.ip.trim().split('.')
    const ok = parts.length === 4 && parts.every((x) => /^\d{1,3}$/.test(x) && +x <= 255)
    const priv = ok && (parts[0] === '10' || (parts[0] === '192' && parts[1] === '168') || (parts[0] === '172' && +parts[1] >= 16 && +parts[1] <= 31))
    if (!priv) return 'Use the phone’s home-network address, like 192.168.1.23.'
  }
  return null
}

/* -------------------------------------------------------------- the alert banner */
export interface ActiveAlert { ev: BusEvent; level: string; tone: Tone; ended: boolean }

/**
 * The alert the banner should show, from the event stream: the newest security
 * alert, unless something later resolved it — arming or disarming resolves
 * everything; Aankhen watching again resolves a "not watching" warning; a closed
 * sensor-offline incident resolves its tamper alert. A motion alarm that has ended
 * stays up (marked ended) until it is dismissed: a break-in must not vanish unseen.
 */
export function activeAlert(events: BusEvent[], dismissedId = 0): ActiveAlert | null {
  const closed = new Set<unknown>()
  let watching = false
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.source !== 'security') continue
    if (e.id <= dismissedId) return null
    if (e.kind === 'armed' || e.kind === 'disarmed') return null
    if (e.kind === 'incident') { closed.add(e.incident); continue }
    if (e.kind === 'watching') { watching = true; continue }
    if (e.kind !== 'alert') continue
    const level = String(e.level ?? 'alarm')
    if (level === 'warning' && watching) return null
    if (level === 'tamper' && closed.has(e.incident)) return null
    const tone: Tone = e.sim || level === 'warning' ? 'sim' : 'fault'
    return { ev: e, level, tone, ended: e.incident !== undefined && closed.has(e.incident) }
  }
  return null
}

/* -------------------------------------------------------------- the 60 s trace */
export interface Bar { x: number; h: number; pos: boolean }

/** One bar per second of an incident's trace, heights relative to the threshold
 * (the threshold sits at 1/3 of the height, so 3x it fills the bar). */
export function traceBars(trace: TraceRow[], width: number, height: number): { bars: Bar[]; zeroX: number; thrY: number } {
  if (!trace.length) return { bars: [], zeroX: 0, thrY: height }
  const t0 = trace[0].t
  const t1 = Math.max(trace[trace.length - 1].t, t0 + 1)
  const sx = (t: number) => ((t - t0) / (t1 - t0)) * (width - 2) + 1
  const bars = trace.map((r) => {
    const x = r.thr && r.score !== null ? r.score / r.thr : r.pos ? 1.2 : 0
    return { x: sx(r.t), h: Math.max(1, Math.min(1, x / 3) * height), pos: r.pos }
  })
  return { bars, zeroX: sx(Math.min(Math.max(0, t0), t1)), thrY: height - height / 3 }
}
