// The relay pin map (RW1, D-V3-35): one row per relay, read from the Limbs view the app already holds.
// Pure functions here; the component only draws them.
import type { LampState } from '../../../shared/kit'
import type { LimbsDevice, LimbsView } from '../../../lib/limbs'

export interface PinRow {
  id: string
  name: string
  /** The GPIO the app switches this relay on (devices.json, or what the board's own banner reported). */
  pin: number
  lamp: LampState
  /** Why the lamp is not live; shown as the lamp's own reason, never colour alone. */
  reason?: string
  /** True when the board can take a test click now. */
  testable: boolean
}

/**
 * The adapter for saving a pin map. NULL today: no route in app/jarvis_app saves one (routes_limbs.py lists modes, test
 * and presence only). While it is null the edit control is drawn PLANNED with the reason. The route shape the engine lane
 * would need is in docs/research/product-design-overhaul.md (2026-11-15: RW1).
 */
export interface PinsAdapter {
  /** Sends the changed pins to the board's setting. Rejects with a sentence on failure. */
  save: (changes: Record<string, number>) => Promise<void>
}

export const NO_SAVE_ROUTE = 'Saving a pin map needs a route the app does not have yet. Pins are read from the board.'
export const CONFIRM_LINE = 'Press again to confirm. This is a hardware setting.'

/** ESP32-S3 exposes GPIO 0 to 48; 26 to 32 are the flash and PSRAM lines on most modules, so a relay cannot use them. */
export const GPIO_MIN = 0
export const GPIO_MAX = 48
const RESERVED = new Set([26, 27, 28, 29, 30, 31, 32])

function pinOf(d: LimbsDevice, v: LimbsView): number {
  const board = v.relay_board?.pins?.[d.id]
  return typeof board === 'number' && board >= 0 ? board : d.channel
}

/** The relays the ESP32 switches; if none is marked as an ESP32 relay (a virtual room), every device. */
export function pinRows(v: LimbsView | null): PinRow[] {
  if (!v) return []
  const esp = v.devices.filter((d) => d.board === 'esp32')
  const list = esp.length ? esp : v.devices
  const missing = new Set([...(v.esp32?.missing_channels ?? []), ...(v.relay_board?.missing_channels ?? [])])
  const mismatch = new Map((v.esp32?.pin_mismatch ?? []).map((m) => [m.device, m]))
  return list.map((d): PinRow => {
    const linked = d.board === 'esp32' ? !!v.esp32?.connected : !!v.relay_board?.connected
    let lamp: LampState
    let reason: string | undefined
    if (missing.has(d.id)) { lamp = 'fault'; reason = 'not on the flashed board' }
    else if (mismatch.has(d.id)) {
      const m = mismatch.get(d.id)!
      lamp = 'fault'; reason = `the board says GPIO ${m.board}, the settings say ${m.devices_json}`
    } else if (d.link === 'virtual' || !v.usb) { lamp = 'simulated'; reason = 'a virtual room, no board' }
    else if (linked) lamp = 'live'
    else { lamp = 'waiting'; reason = 'the board is not linked' }
    return { id: d.id, name: d.name, pin: pinOf(d, v), lamp, reason, testable: linked && !missing.has(d.id) }
  })
}

/** One sentence per problem; empty when the drafts are acceptable. Keys are relay ids. */
export function validateDrafts(rows: PinRow[], drafts: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {}
  const final = new Map<string, number>()
  for (const r of rows) {
    const raw = drafts[r.id]
    if (raw === undefined) { final.set(r.id, r.pin); continue }
    if (!/^\d{1,2}$/.test(raw.trim())) { errors[r.id] = `Error: ${GPIO_MIN} to ${GPIO_MAX}, digits only.`; continue }
    const n = Number(raw)
    if (n < GPIO_MIN || n > GPIO_MAX) errors[r.id] = `Error: ${GPIO_MIN} to ${GPIO_MAX}.`
    else if (RESERVED.has(n)) errors[r.id] = 'Error: this pin is the flash or memory line.'
    else final.set(r.id, n)
  }
  const seen = new Map<number, string>()
  for (const [id, n] of final) {
    const other = seen.get(n)
    if (other) {
      const target = drafts[id] !== undefined ? id : other                       // flag the pin that was edited
      errors[target] ??= `Error: same pin as ${target === id ? other : id}.`
    } else seen.set(n, id)
  }
  return errors
}

/** The relays whose draft differs from the pin now. */
export function changedPins(rows: PinRow[], drafts: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) {
    const raw = drafts[r.id]
    if (raw !== undefined && /^\d{1,2}$/.test(raw.trim()) && Number(raw) !== r.pin) out[r.id] = Number(raw)
  }
  return out
}
