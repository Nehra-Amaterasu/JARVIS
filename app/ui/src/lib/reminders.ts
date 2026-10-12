/**
 * Reminders, timers, alarms and timed switches — the UI's side of
 * app/jarvis_app/reminders.py. Pure helpers, unit-tested (src/__tests__/reminders.test.ts).
 *
 * Times are said the way the server and JARVIS say them ("9 pm today",
 * "6:30 am tomorrow"), so what he reads matches what he hears.
 */
import type { BusEvent } from './api'

export type ReminderKind = 'reminder' | 'timer' | 'alarm' | 'action'

export interface Firing { at: number; due: number; spoken: boolean; late_s: number; acked?: number; outcome?: unknown }

export interface Reminder {
  id: string
  kind: ReminderKind
  text: string
  due: number
  repeat: 'daily' | 'weekdays' | 'weekly' | null
  interval_min: number | null
  action: { device: string; action: string; value: number | string | null } | null
  status: 'pending' | 'done' | 'cancelled'
  fired: Firing[]
  last_fired: number | null
  acked: number | null
  length_s?: number
  origin?: string
}

export interface RemindersView { items: Reminder[]; recent: Reminder[]; now: number; say: string; voice: boolean }

/** '9 pm', '9:30 am', '12 noon', 'midnight' (as core/tools/when.py fmt_clock). */
export function fmtClock(ts: number): string {
  const d = new Date(ts * 1000)
  const h = d.getHours()
  const m = d.getMinutes()
  if (h === 0 && m === 0) return 'midnight'
  if (h === 12 && m === 0) return '12 noon'
  const h12 = h % 12 || 12
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`
}

const DAY = 86_400_000
const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime() }

/** '9 pm today', '6:30 am tomorrow', '5 pm Fri', '9 am 25 Oct'. */
export function fmtDue(ts: number, nowTs: number): string {
  const days = Math.round((startOfDay(ts * 1000) - startOfDay(nowTs * 1000)) / DAY)
  const clock = fmtClock(ts)
  if (days === 0) return `${clock} today`
  if (days === 1) return `${clock} tomorrow`
  const d = new Date(ts * 1000)
  if (days > 1 && days < 7) return `${clock} ${d.toLocaleDateString('en-GB', { weekday: 'short' })}`
  return `${clock} ${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}`
}

export function fmtRepeat(r: Pick<Reminder, 'repeat' | 'interval_min' | 'due'>): string {
  if (r.interval_min) {
    return r.interval_min % 60 === 0
      ? (r.interval_min === 60 ? 'every hour' : `every ${r.interval_min / 60} hours`)
      : `every ${r.interval_min} min`
  }
  if (r.repeat === 'daily') return 'every day'
  if (r.repeat === 'weekdays') return 'weekdays'
  if (r.repeat === 'weekly') return `every ${new Date(r.due * 1000).toLocaleDateString('en-GB', { weekday: 'long' })}`
  return ''
}

/** A timer's countdown: '4:59', '1:02:03', '0:00' once it is up. */
export function countdown(dueTs: number, nowTs: number): string {
  const s = Math.max(0, Math.ceil(dueTs - nowTs))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`
}

/** What the row says. A timed switch names the switch; an empty reminder says so. */
export function title(r: Reminder): string {
  if (r.kind === 'action' && r.action) {
    if (r.action.device === 'environment') return `${r.action.action} scene`
    const noun = r.action.device === 'all' ? 'light and fan' : r.action.device
    return r.action.action === 'set' && r.action.value != null ? `${noun} to ${r.action.value}%` : `${noun} ${r.action.action}`
  }
  if (r.text) return r.text
  return r.kind === 'timer' ? 'Timer' : r.kind === 'alarm' ? 'Alarm' : 'Reminder'
}

export type Tone = 'live' | 'sim' | 'fault' | 'info'

/** Provenance colour of a firing: spoken by JARVIS (confirmed, cyan), late or missed
 *  (fault, red), a switch in the virtual room (simulated, amber), else neutral. */
export function firingTone(ev: Pick<BusEvent, 'kind'> & { spoken?: unknown; outcome?: unknown }): Tone {
  if (ev.kind === 'missed' || ev.kind === 'skipped') return 'fault'
  const out = ev.outcome as { usb?: boolean; error?: string } | null | undefined
  if (out && out.error) return 'fault'
  if (out && out.usb === false) return 'sim'
  return ev.spoken ? 'live' : 'info'
}

export interface Alert { id: number; rid: string | null; text: string; tone: Tone; spoken: boolean; kind: string }

const FIRES = new Set(['due', 'missed', 'skipped'])

/** New reminder firings on the bus, after `afterId`, oldest first. */
export function alertsFrom(events: BusEvent[], afterId: number): Alert[] {
  return events
    .filter((e) => e.source === 'reminders' && FIRES.has(e.kind) && e.id > afterId)
    .map((e) => ({
      id: e.id,
      rid: ((e.reminder as Reminder | undefined)?.id) ?? null,
      text: e.text,
      tone: firingTone(e as BusEvent & { spoken?: unknown; outcome?: unknown }),
      spoken: !!e.spoken,
      kind: e.kind,
    }))
}

/** The id of the newest reminders event (a change means: reload the list). */
export const lastReminderEvent = (events: BusEvent[]) =>
  events.reduce((m, e) => (e.source === 'reminders' && e.id > m ? e.id : m), 0)
