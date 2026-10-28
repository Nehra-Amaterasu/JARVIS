/**
 * The wall box: the ESP32-S3 and its three two-channel relay modules, as the Limbs view
 * reports them (GET /api/limbs). Pure helpers for the WallBox card: which relay sits on
 * which module and GPIO, what the box's 16x2 LCD would show, what the voice path answers
 * to, and how a test click's receipt reads. Nothing here switches anything. "Confirmed"
 * means the board reports its pin in the asked state; it cannot see the relay itself
 * (2026-10-28: 11 confirmed presses, no relay moved, a power fault on the modules' side).
 */
import type { LimbsDevice, LimbsView, Mode } from './limbs'

/** The firmware's RELAY_TABLE order (config.h): two relays per module, in this order. */
export const WALL_ORDER = ['light', 'fan', 'light2', 'light3', 'light4', 'light5'] as const
/** One mark per relay on the LCD's first row, in WALL_ORDER. */
export const LCD_MARK: Record<string, string> = { light: '1', fan: 'F', light2: '2', light3: '3', light4: '4', light5: '5' }

export interface ChannelRow {
  module: 1 | 2 | 3; input: 'IN1' | 'IN2'; id: string; name: string; gpio: number | null
  /** The app's state, the board's own report (null: not on the board), and whether they agree. */
  on: boolean; hardwareOn: boolean | null; confirmed: boolean; present: boolean
}

/** Every relay of the box in table order, with its module and input, even when devices.json lacks it. */
export function channelRows(devices: Pick<LimbsDevice, 'id' | 'name' | 'channel' | 'state' | 'hardware_on' | 'confirmed'>[]): ChannelRow[] {
  const byId = new Map(devices.map((d) => [d.id, d]))
  return WALL_ORDER.map((id, i) => {
    const d = byId.get(id)
    return {
      module: (Math.floor(i / 2) + 1) as 1 | 2 | 3, input: i % 2 ? 'IN2' : 'IN1', id,
      name: d?.name ?? id, gpio: d?.channel ?? null, on: !!d?.state?.on,
      hardwareOn: d ? d.hardware_on : null, confirmed: !!d?.confirmed, present: !!d,
    }
  })
}

/** Are the box's devices the ones in the view (board "esp32")? */
export function isWallBox(v: Pick<LimbsView, 'devices'> | null | undefined): boolean {
  return !!v && v.devices.some((d) => d.board === 'esp32')
}

/** The LCD's first row, as the firmware draws it: a mark when on, "-" off, "?" not wired. */
export function lcdRow1(rows: ChannelRow[]): string {
  return rows.map((r) => (!r.present || r.hardwareOn === null ? '?' : (r.hardwareOn ? LCD_MARK[r.id] : '-'))).join(' ')
}

/** The LCD's second row: where the board is and how loud, or what it is doing. */
export function lcdRow2(esp: { connected: boolean; link: 'usb' | 'wifi' | null; where: string | null; rssi: number | null } | null | undefined): string {
  if (!esp?.connected) return 'Wi-Fi: joining'
  if (esp.link === 'usb') return `USB ${esp.where ?? ''}`.trim()
  return `${esp.where ?? '?'} ${esp.rssi != null ? `${esp.rssi} dBm` : ''}`.trim().slice(0, 16)
}

/** What the ceiling drawing lights: true on, false off, null when the relay is not on the board. */
export function ceilingState(rows: ChannelRow[]): Record<string, boolean | null> {
  const out: Record<string, boolean | null> = {}
  for (const r of rows) out[r.id] = !r.present ? null : r.hardwareOn === null ? null : (r.hardwareOn ?? r.on)
  return out
}

/** Words shared by two or more device names ("pink", "warm"): the voice path groups them. */
export function groupWords(devices: Pick<LimbsDevice, 'id' | 'name'>[]): { word: string; ids: string[] }[] {
  const stop = new Set(['light', 'lights', 'lamp', 'lamps', 'the', 'ceiling', 'room', 'cove', 'coves', 'and'])
  const words = new Map<string, string[]>()
  for (const d of devices) {
    for (const w of new Set(d.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))) {
      if (stop.has(w) || w.length < 3) continue
      words.set(w, [...(words.get(w) ?? []), d.id])
    }
  }
  return [...words].filter(([, ids]) => ids.length >= 2).map(([word, ids]) => ({ word, ids }))
}

/** The sentences JARVIS answers to for this box: devices, groups, modes, the ladder, all off. */
export function voiceLines(devices: Pick<LimbsDevice, 'id' | 'name' | 'kind'>[], modes: Pick<Mode, 'id' | 'name'>[]): { say: string; does: string }[] {
  const out: { say: string; does: string }[] = []
  const names = new Map(devices.map((d) => [d.id, d.name]))
  for (const d of devices) {
    const n = d.name.toLowerCase()
    out.push({ say: d.id === 'light' ? '"lights on" / "lights off"' : `"${n} on" / "${n} off"`, does: `${d.name} (${d.id})` })
  }
  for (const g of groupWords(devices)) out.push({ say: `"${g.word} on" / "${g.word} lights off"`, does: g.ids.map((i) => names.get(i) ?? i).join(' + ') })
  const ladder = ['night_light', 'movie', 'relaxation', 'focus', 'reading', 'morning', 'all_lights'].filter((id) => modes.some((m) => m.id === id))
  if (ladder.length >= 3) out.push({ say: '"brighter" / "dimmer"', does: `one step along ${ladder.map((id) => modes.find((m) => m.id === id)?.name).join(' → ')}` })
  for (const m of modes) if (m.id !== 'all_off') out.push({ say: `"${m.name.toLowerCase()}"`, does: `the ${m.name} mode` })
  out.push({ say: '"everything off" / "sab band karo"', does: 'every relay off, fan included' })
  return out
}

export interface ClickReceipt {
  device: string; ok: boolean; restored?: boolean; text?: string
  steps: { action: string; delivered: boolean; board_says: boolean | null; ms: number }[]
}

/** One line for a test click's receipt: both steps confirmed, with their round trips. */
export function clickSummary(r: ClickReceipt): { text: string; ok: boolean } {
  if (r.ok) return { ok: true, text: `confirmed both · ${r.steps.map((s) => `${s.action} ${s.ms} ms`).join(' · ')}` }
  const bad = r.steps.find((s) => !s.delivered)
  return { ok: false, text: bad ? `${bad.action} not confirmed after ${bad.ms} ms (board says ${bad.board_says === null ? 'not wired' : bad.board_says ? 'on' : 'off'})` : (r.text ?? 'not confirmed') }
}
