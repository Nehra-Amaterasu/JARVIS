/**
 * The ESP32 on the Limbs tab, as /api/board reports it (app/jarvis_app/board_ctl.py).
 *
 * Words and colour follow provenance, as everywhere in this app: cyan only for what the
 * board itself reported (its STATUS over USB, or GET /status over Wi-Fi), amber for
 * "known, but not live" (a remembered IP, a stale report), red for a fault. The
 * simulator's STATUS never reaches here: the server drops it.
 */

export interface BoardStatus {
  fw?: string
  uptime_s?: number
  relays?: Record<string, boolean | null>
  wifi?: string
  ip?: string
  rssi?: number
  channel?: number
  csi_hz?: number
  csi_dropped?: number
  csi_rejected?: number
  mqtt?: boolean
  http?: boolean
  heap_free?: number
  crc_ok?: boolean
  gain?: string
  ota?: boolean
  reset?: string
  beacon_enabled?: boolean
  beacon?: { ip: string | null; mac_known: boolean; pings_ok: number; rate_hz: number; rssi: number | null; fallback: boolean }
  full?: boolean
  age_s?: number | null
}

export interface WifiProbe {
  ip: string
  reachable: boolean
  status: BoardStatus | null
  full: boolean
  latency_ms: number | null
  note: string | null
  checked_at: number
}

export interface BuildInfo {
  version: string | null
  at: number
  seconds: number
  image_bytes: number
  ota_in_build: boolean
  relay_token_in_build: boolean
  flash_bytes?: number
  flash_max?: number
  flash_pct?: number
  ram_bytes?: number
  ram_max?: number
  fresh?: boolean
}

export interface JobView {
  id: string
  kind: 'compile' | 'flash'
  detail: string
  state: 'running' | 'ok' | 'failed'
  phase: string
  pct: number | null
  lines: string[]
  started_at: number
  finished_at: number | null
  seconds: number
  result: Partial<BuildInfo> & { ok?: boolean; summary?: string; error?: string; errors?: string[] }
  cmd: string[]
}

export interface BoardView {
  link: 'usb' | 'wifi' | 'none'
  usb: { port: string | null; handshake: boolean; fw: string | null; last_byte_s: number | null; note: string | null } | null
  status: BoardStatus | null
  wifi: WifiProbe | null
  ip: string | null
  ip_source: 'usb' | 'typed' | null
  firmware: { repo: string | null; running: string | null; differs: boolean; ota: boolean | null | undefined }
  link_stats: { frames_ok?: number; crc_errors?: number; loss_ratio?: number }
  hub: { running: boolean; mode: string | null; kind: string | null; port: string | null; hold: string | null }
  build: BuildInfo | null
  job: JobView | null
  tools: { arduino_cli: boolean; espota: boolean }
}

export interface ConfigField {
  key: string
  label: string
  kind: 'pin' | 'bool' | 'choice'
  options?: number[]
  help: string
}

export interface ConfigView {
  path: string
  values: Record<string, number | null>
  readonly: Record<string, number>
  fields: ConfigField[]
  safe_pins: number[]
  pin_reasons: Record<string, string>
  changed?: Record<string, [number, number]>
}

export interface FlashPlan {
  id: string
  target: 'usb' | 'wifi'
  port?: string
  ip?: string
  needs_password: boolean
  version: string
  image_bytes: number
  steps: string[]
  warnings: string[]
  expires_at: number
}

export interface TestStep { action: 'on' | 'off'; t_ms: number; delivered: boolean; board_says: boolean | null; confirm_ms: number }
export interface TestReceipt {
  device: string; pin: number | null; active_low: boolean; steps: TestStep[]; held_s: number
  restored: boolean; delivered: boolean; confirmed: boolean; ok: boolean; text: string; at: number
}

/** What the board panel's pill says, and in which colour. */
export function linkPill(v: Pick<BoardView, 'link' | 'usb' | 'wifi' | 'ip'>): { text: string; tone: '' | 'live' | 'sim' | 'fault' } {
  if (v.link === 'usb') return { text: `USB · ${v.usb?.port ?? '?'}`, tone: 'live' }
  if (v.link === 'wifi') return { text: `Wi-Fi · ${v.wifi?.ip ?? v.ip}`, tone: 'live' }
  if (v.ip) return { text: `not answering · ${v.ip}`, tone: 'sim' }
  return { text: 'no board', tone: 'sim' }
}

/** The board's own report: over USB if plugged in, else what GET /status returned. */
export function liveStatus(v: Pick<BoardView, 'link' | 'status' | 'wifi'>): BoardStatus | null {
  if (v.link === 'usb') return v.status
  if (v.link === 'wifi') return v.wifi?.status ?? null
  return null
}

/** -50 dBm is strong; below -75 a 2.4 GHz link starts losing packets (and CSI). */
export function rssiWord(rssi: number | null | undefined): string {
  if (rssi === null || rssi === undefined) return '—'
  const q = rssi >= -60 ? 'strong' : rssi >= -70 ? 'fair' : rssi >= -78 ? 'weak' : 'poor'
  return `${rssi} dBm · ${q}`
}

export function fmtUptime(s: number | null | undefined): string {
  if (s === null || s === undefined) return '—'
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m ${Math.floor(s % 60)}s`
  return `${Math.floor(s)}s`
}

/** Link 2 (the phone) in one line, from the board's view of it. */
export function beaconLine(st: BoardStatus | null): string {
  if (!st) return '—'
  if (st.beacon_enabled === false) return 'off in config.h'
  const b = st.beacon
  if (!b) return st.full === false ? 'needs the token' : '—'
  if (!b.ip) return 'no phone registered'
  if (b.fallback) return `paused to protect link 1 · ${b.ip}`
  if (!b.mac_known) return `${b.ip} registered · finding its MAC`
  return `${b.rate_hz} Hz from ${b.ip}`
}

/** Why the chip last started; a brownout after a relay click means the 5 V supply sags. */
export function resetLine(reason: string | undefined): { text: string; tone: '' | 'sim' | 'fault' } {
  switch (reason) {
    case undefined: return { text: '—', tone: '' }
    case 'brownout': return { text: 'brownout: the 5 V supply sagged', tone: 'fault' }
    case 'crash': return { text: 'crashed (panic)', tone: 'fault' }
    case 'watchdog': return { text: 'watchdog reset', tone: 'fault' }
    case 'software': return { text: 'restarted by firmware (an update)', tone: '' }
    case 'power-on': return { text: 'power-on', tone: '' }
    default: return { text: reason, tone: '' }
  }
}

/** The config form's own check, before the server's (which decides). */
export function pinProblem(pin: number, cfg: Pick<ConfigView, 'safe_pins' | 'pin_reasons' | 'readonly'>): string | null {
  if (pin === -1) return null
  if (pin === cfg.readonly.RADAR_RX_PIN || pin === cfg.readonly.RADAR_TX_PIN) return "the radar's UART"
  if (cfg.safe_pins.includes(pin)) return null
  return cfg.pin_reasons[String(pin)] ?? 'not a pin safe for a relay input'
}

/** Changed fields only, and every reason the draft cannot be saved. */
export function configDraft(cfg: ConfigView, draft: Record<string, number>): { changes: Record<string, number>; problems: string[] } {
  const changes: Record<string, number> = {}
  for (const f of cfg.fields) {
    const v = draft[f.key]
    if (v !== undefined && v !== cfg.values[f.key]) changes[f.key] = v
  }
  const merged = { ...cfg.values, ...changes }
  const problems: string[] = []
  for (const key of ['RELAY_LIGHT_PIN', 'RELAY_FAN_PIN']) {
    const why = key in changes ? pinProblem(changes[key], cfg) : null
    if (why) problems.push(`${key}: GPIO ${changes[key]} is ${why}`)
  }
  const light = merged.RELAY_LIGHT_PIN ?? -1, fan = merged.RELAY_FAN_PIN ?? -1
  if (light >= 0 && light === fan) problems.push(`the light and the fan cannot share GPIO ${light}`)
  return { changes, problems }
}

/** "998,101 bytes · 76 % of the app slot" */
export function sizeLine(b: Pick<BuildInfo, 'flash_bytes' | 'flash_max' | 'flash_pct' | 'image_bytes'>): string {
  const n = b.flash_bytes ?? b.image_bytes
  const pct = b.flash_pct ?? (b.flash_max ? Math.round((100 * n) / b.flash_max) : null)
  return `${n.toLocaleString('en-US')} bytes` + (pct !== null ? ` · ${pct} % of the ${b.flash_max ? `${(b.flash_max / 1024).toFixed(0)} KB ` : ''}app slot` : '')
}

/** What the flash buttons may do right now, and why not. */
export function flashReady(v: Pick<BoardView, 'build' | 'job' | 'tools'>): { ok: boolean; why: string | null } {
  if (v.job?.state === 'running') return { ok: false, why: `${v.job.kind} running` }
  if (!v.build) return { ok: false, why: 'compile first' }
  if (v.build.fresh === false) return { ok: false, why: 'sources changed: compile again' }
  return { ok: true, why: null }
}
