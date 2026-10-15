/**
 * Limbs: the room's devices and modes as the app reports them (GET /api/limbs).
 * The relays only switch, so every state here is on or off: no brightness, no speed.
 */
export type Kind = 'light' | 'fan'
export type BoardId = 'uno' | 'esp32'

export interface LimbsDevice {
  id: string; name: string; kind: Kind; board: BoardId; channel: number
  state: { on: boolean }; link: 'usb' | 'virtual'
  hardware_on: boolean | null; confirmed: boolean; note: string
}

export interface Mode {
  id: string; name: string; set: Record<string, boolean>
  resolved: Record<string, boolean>; detail: string; builtin: boolean
}

export interface RelayBoard {
  connected: boolean; port: string | null; version: string | null
  pins: Record<string, number>; channels: string[]; state: Record<string, boolean | null>
  error: string | null; devices: string[]; missing_channels: string[]
}

export interface LimbsView {
  devices: LimbsDevice[]; modes: Mode[]; last_mode: string | null
  core_running: boolean; usb: boolean; hardware: string; relay_board: RelayBoard | null; problems: string[]
}

export interface PresenceOnView {
  settings: { enabled: boolean; window_min: number; quiet_start: string; quiet_end: string
    input_s: number; occupied_p: number; sustain_s: number }
  status: string; started: boolean
  decision: { decision: string; reason: string; at: number; line?: string } | null
}

/** "light on · fan off" for a draft mode, in the devices' order. */
export function describeSet(set: Record<string, boolean>, devices: Pick<LimbsDevice, 'id' | 'name'>[]): string {
  if ('*' in set && Object.keys(set).length === 1) return `everything ${set['*'] ? 'on' : 'off'}`
  const parts = devices.filter((d) => d.id in set).map((d) => `${d.name.toLowerCase()} ${set[d.id] ? 'on' : 'off'}`)
  if ('*' in set) parts.push(`the rest ${set['*'] ? 'on' : 'off'}`)
  return parts.join(' · ') || 'switches nothing'
}

/** A draft for the mode editor: every device named, on/off taken from what the mode resolves to. */
export function draftFrom(mode: Mode | null, devices: Pick<LimbsDevice, 'id'>[]): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const d of devices) out[d.id] = mode ? !!mode.resolved[d.id] : false
  return out
}

/** Why a draft cannot be saved, or null. Mirrors core/room_config.py check_mode. */
export function draftProblem(name: string, set: Record<string, boolean>, others: Mode[]): string | null {
  const n = name.trim()
  if (!n || n.length > 32) return 'Give it a name (1 to 32 characters).'
  if (!Object.keys(set).length) return 'Choose at least one device.'
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (others.some((m) => norm(m.name) === norm(n))) return `A mode called "${n}" already exists.`
  return null
}

/** Uno pin label: D4; ESP32: GPIO 21. */
export function pinLabel(board: BoardId, channel: number): string {
  return board === 'uno' ? `D${channel}` : `GPIO ${channel}`
}

/** The next free Uno pin after the ones in use (D6 after D4 and D5), skipping D0/D1. */
export function nextUnoPin(used: number[]): number | null {
  for (let p = 2; p <= 13; p++) if (!used.includes(p) && p > Math.max(3, ...used)) return p
  for (let p = 2; p <= 13; p++) if (!used.includes(p)) return p
  return null
}
