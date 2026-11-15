// The Room section's pure decisions (A.J02, spec 20.9.2). Nothing here draws or sends: the keys, the three-phase LED, the
// heavy-load guard, the 24 hour ring and the gate schematics are all computed from what the app already reports
// (GET /api/limbs, /api/limbs/presence-on, /api/energy, /api/security), so each rule is a vitest and the screens only paint.
//
// The one honesty rule: a key's lamp follows the BOARD's own report (`hardware_on`), never the saved state. A press is an
// ask; the lamp turns LIVE "confirmed" only when the board reports the asked state, and after 6 s without it the key says
// "asked, no report" (FAULT). The saved state (`state.on`) only ever draws the cap of a virtual room, which has no board.
import type { LampState } from '../../shared/lamp/types'
import type { LimbsDevice, LimbsView, Mode } from '../../lib/limbs'
import { WALL_ORDER, isWallBox } from '../../lib/wallbox'

/** Eight channels on the faceplate (spec 20.9.2); a missing one is drawn dashed "unavailable", not hidden. */
export const SLOTS = 8
/** The board has this long to report an asked state before the key says so (spec: "not confirmed after 6 s"). */
export const ASK_WINDOW_MS = 6000
/** A confirmed answer stays worded for this long, then the key goes back to its steady board word. */
export const CONFIRMED_SHOW_MS = 4000
/** The cover of a heavy-load key closes by itself after this long (spec: "within 5 s"). */
export const COVER_MS = 5000

export type KeyPhase = 'absent' | 'steady' | 'asked' | 'confirmed' | 'unconfirmed'
export interface Asked { want: boolean; at: number }

export interface KeySlot {
  /** 1 to 8. */
  slot: number
  id: string | null
  name: string
  kind: 'light' | 'fan' | null
  gpio: number | null
  present: boolean
  /** The board's own report: true on, false off, null when there is none. Never the saved state. */
  reported: boolean | null
  /** What the cap shows as pressed: the board's report, or the saved state of a virtual room (which has no board). */
  capOn: boolean
  virtual: boolean
  linked: boolean
  phase: KeyPhase
  lamp: LampState
  /** The lamp's word, always printed beside it. */
  word: string
}

export const clock24 = (ms: number): string => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** Which devices get a slot, in order: the wall box's own order first (an absent one stays, dashed), then any other device. */
export function slotIds(view: LimbsView | null): (string | null)[] {
  const devices = view?.devices ?? []
  const ids: string[] = []
  if (isWallBox(view)) {
    ids.push(...WALL_ORDER)
    for (const d of devices) if (!ids.includes(d.id)) ids.push(d.id)
  } else {
    ids.push(...devices.map((d) => d.id))
  }
  const out: (string | null)[] = ids.slice(0, SLOTS)
  while (out.length < SLOTS) out.push(null)
  return out
}

function linkedOf(d: LimbsDevice, v: LimbsView): boolean {
  if (d.link === 'virtual' || !v.usb) return false
  return d.board === 'esp32' ? !!v.esp32?.connected : !!v.relay_board?.connected
}

/**
 * The eight keys as the faceplate draws them. `asked` holds what the owner pressed and when; `confirmedAt` the time the
 * board's report first agreed with that ask. Both are the hook's, so this stays a pure function of its inputs.
 */
export function keySlots(view: LimbsView | null, asked: Record<string, Asked>, now: number, confirmedAt: Record<string, number> = {}): KeySlot[] {
  const byId = new Map((view?.devices ?? []).map((d) => [d.id, d]))
  return slotIds(view).map((id, i): KeySlot => {
    const slot = i + 1
    const d = id ? byId.get(id) : undefined
    if (!id || !d || !view) {
      return { slot, id, name: id ?? 'free', kind: null, gpio: null, present: false, reported: null, capOn: false, virtual: false, linked: false, phase: 'absent', lamp: 'planned', word: 'unavailable' }
    }
    const virtual = d.link === 'virtual' || !view.usb
    const linked = linkedOf(d, view)
    const reported = virtual ? null : d.hardware_on
    const base = { slot, id, name: d.name, kind: d.kind, gpio: d.channel, present: true, reported, virtual, linked }
    const ask = asked[id]
    const capOn = reported ?? (virtual ? !!d.state?.on : false)
    if (ask && !virtual) {
      if (reported === ask.want) {
        const at = confirmedAt[id]
        return { ...base, capOn, phase: 'confirmed', lamp: 'live', word: `${ask.want ? 'ON' : 'OFF'}, confirmed by board${at ? ` ${clock24(at)}` : ''}` }
      }
      if (now - ask.at >= ASK_WINDOW_MS) return { ...base, capOn, phase: 'unconfirmed', lamp: 'fault', word: 'asked, no report' }
      return { ...base, capOn, phase: 'asked', lamp: 'waiting', word: `asked ${ask.want ? 'ON' : 'OFF'}, waiting` }
    }
    if (virtual) return { ...base, capOn, phase: 'steady', lamp: 'simulated', word: `${capOn ? 'ON' : 'OFF'} · virtual` }
    if (reported === null) return { ...base, capOn, phase: 'steady', lamp: 'waiting', word: linked ? 'not on the board' : 'no report, offline' }
    return { ...base, capOn, phase: 'steady', lamp: 'live', word: `${reported ? 'ON' : 'OFF'} · board` }
  })
}

/** How many channels the board reports on right now (the All off key's count). Only real reports count. */
export const onCount = (slots: KeySlot[]): number => slots.filter((s) => s.present && s.reported === true).length

/** The names All off would switch off (the pre-press list). */
export const onNames = (slots: KeySlot[]): string[] => slots.filter((s) => s.present && s.reported === true).map((s) => s.name)

/* ------------------------------------------------------------------------------------------------ heavy-load flags */

export const HEAVY_KEY = 'jarvis.room.heavy'
export type HeavyFlags = Record<string, boolean>

/** The owner's per-channel flags. Browser storage only: no route holds them, so another device does not share them. */
export function loadHeavy(): HeavyFlags {
  try {
    const raw = localStorage.getItem(HEAVY_KEY)
    const v = raw ? (JSON.parse(raw) as unknown) : null
    if (!v || typeof v !== 'object') return {}
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x === true)) as HeavyFlags
  } catch {
    return {}
  }
}

export function saveHeavy(flags: HeavyFlags): void {
  try {
    localStorage.setItem(HEAVY_KEY, JSON.stringify(flags))
  } catch {
    /* storage blocked: the flags last for this page only */
  }
}

/** The line on the cover's underside: what the press will do. */
export const heavySummary = (name: string): string => `turns ON: ${name.toLowerCase()}, mains`

/**
 * A key needs two acts only when it is flagged AND the press turns it ON. OFF is always one press, and a light or fan
 * the owner never flagged stays one press (spec 20.9.2).
 */
export const needsTwoActs = (heavy: boolean, turningOn: boolean): boolean => heavy && turningOn

/** The flagged channels a mode would turn ON from where the board reports them now (so a scene cannot skip the guard). */
export function sceneGuarded(mode: Pick<Mode, 'resolved'> | null, slots: KeySlot[], heavy: HeavyFlags): KeySlot[] {
  if (!mode) return []
  return slots.filter((s) => s.present && s.id && heavy[s.id] && mode.resolved[s.id] === true && s.reported !== true)
}

/** The keys a mode would change, from where they are now: what the dial previews as dashed outlines. */
export function scenePreview(mode: Pick<Mode, 'resolved'> | null, slots: KeySlot[]): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  if (!mode) return out
  for (const s of slots) if (s.present && s.id && s.id in mode.resolved) out[s.id] = !!mode.resolved[s.id]
  return out
}

/** A mode as the eight channels in text: # on, . off, ? not named by the mode, - a free channel. Same glyphs as the log's strip. */
export function modeStrip(mode: Pick<Mode, 'resolved'>, ids: (string | null)[]): string {
  return ids.map((id) => (id === null ? '-' : id in mode.resolved ? (mode.resolved[id] ? '#' : '.') : '?')).join(' ')
}

/* ------------------------------------------------------------------------------------------------ the 24 hour ring */

export type RuleKind = 'quiet' | 'night' | 'window'
/** One time window of a rule. `from` and `to` are 24 hour "HH:MM"; a window that ends before it starts wraps midnight. */
export interface Rule {
  id: string
  label: string
  from: string
  to: string
  kind: RuleKind
  /** LIVE when the app reported the rule and it is on, WAITING when it is reported off. */
  state: LampState
  /** The words after the label in the preview line ("presence rule holds", "no auto-off"). */
  holds: string
}

export const DAY_MIN = 24 * 60
export const STEP_MIN = 15

export function minutesOf(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return null
  const h = Number(m[1])
  const mm = Number(m[2])
  return h > 23 || mm > 59 ? null : h * 60 + mm
}

export const hhmm = (min: number): string => {
  const m = ((Math.round(min) % DAY_MIN) + DAY_MIN) % DAY_MIN
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** The ring's drawn pieces of a rule: one, or two when it wraps midnight. Empty for an unreadable time. */
export function ruleSpans(r: Pick<Rule, 'from' | 'to'>): [number, number][] {
  const a = minutesOf(r.from)
  const b = minutesOf(r.to)
  if (a === null || b === null || a === b) return []
  return a < b ? [[a, b]] : [[a, DAY_MIN], [0, b]]
}

export function activeAt(r: Pick<Rule, 'from' | 'to'>, min: number): boolean {
  const m = ((min % DAY_MIN) + DAY_MIN) % DAY_MIN
  return ruleSpans(r).some(([a, b]) => m >= a && m < b)
}

/** The centre line while scrubbing. It only says what the rules would hold at that time: it is not the board. */
export function previewLine(rules: Rule[], min: number): string {
  const hits = rules.filter((r) => activeAt(r, min))
  const t = hhmm(min)
  if (!hits.length) return `PREVIEW ${t}: no rule holds`
  return `PREVIEW ${t}: ${hits.map((r) => `${r.label.toLowerCase()} ${r.holds}`).join('; ')}`
}

export function snapStep(min: number, dir: 1 | -1 | 0 = 0): number {
  const base = dir === 0 ? Math.round(min / STEP_MIN) * STEP_MIN : (Math.round(min / STEP_MIN) + dir) * STEP_MIN
  return ((base % DAY_MIN) + DAY_MIN) % DAY_MIN
}

/** The rules the app really reports. A per-channel on-window does not exist in any route, so none is invented here. */
export function rulesFrom(p: {
  presence?: { settings: { enabled: boolean; quiet_start: string; quiet_end: string } } | null
  energy?: { waste: { config: { night: { start: string; end: string }; auto_off_enabled?: boolean } }; auto_off?: boolean } | null
}): Rule[] {
  const out: Rule[] = []
  if (p.presence) {
    const s = p.presence.settings
    out.push({ id: 'presence.quiet', label: 'Quiet hours', from: s.quiet_start, to: s.quiet_end, kind: 'quiet', state: s.enabled ? 'live' : 'waiting', holds: s.enabled ? 'no auto-on' : '(presence rule is off)' })
  }
  if (p.energy) {
    const n = p.energy.waste.config.night
    out.push({ id: 'energy.night', label: 'Night', from: n.start, to: n.end, kind: 'night', state: p.energy.auto_off ? 'live' : 'waiting', holds: 'no auto-off' })
  }
  return out
}

/** SVG arc path on a circle at `turn` of 0 to 1 clockwise from 12 o'clock. */
export function arcPath(cx: number, cy: number, r: number, fromMin: number, toMin: number): string {
  const pt = (min: number) => {
    const a = (min / DAY_MIN) * Math.PI * 2
    return `${(cx + Math.sin(a) * r).toFixed(2)} ${(cy - Math.cos(a) * r).toFixed(2)}`
  }
  const sweep = toMin - fromMin
  if (sweep >= DAY_MIN - 0.01) return `M ${pt(0)} A ${r} ${r} 0 1 1 ${pt(DAY_MIN / 2)} A ${r} ${r} 0 1 1 ${pt(0)}`
  return `M ${pt(fromMin)} A ${r} ${r} 0 ${sweep > DAY_MIN / 2 ? 1 : 0} 1 ${pt(toMin)}`
}

/* ------------------------------------------------------------------------------------------------ the log */

export interface LogLine { id: number; at: number; text: string; state: LampState }
export const LOG_MAX = 40

/* ------------------------------------------------------------------------------------------------ the rule gates */

/** One input of a gate: what it needs, whether the app says it holds now, and the lamp that says how it knows. */
export interface GateInput { id: string; label: string; holds: boolean | null; state: LampState; reason?: string; not?: boolean }
export interface Gate {
  id: 'presence' | 'auto-off' | 'away'
  tag: string
  title: string
  inputs: GateInput[]
  output: string
  /** The last time the rule really fired, in the app's own words, or null when it never has (shown as "not fired yet"). */
  lastFired: { at: number | null; text: string } | null
  state: LampState
  reason: string
}

export const lastFiredText = (g: Pick<Gate, 'lastFired'>): string =>
  g.lastFired ? (g.lastFired.at ? `${clock24(g.lastFired.at * 1000)} ${g.lastFired.text}` : g.lastFired.text) : 'not fired yet'

/** Is a time "HH:MM" inside a quiet window now? Wraps midnight. */
export function inWindow(now: Date, from: string, to: string): boolean | null {
  const a = minutesOf(from)
  const b = minutesOf(to)
  if (a === null || b === null) return null
  const m = now.getHours() * 60 + now.getMinutes()
  if (a === b) return false
  return a < b ? m >= a && m < b : m >= a || m < b
}
