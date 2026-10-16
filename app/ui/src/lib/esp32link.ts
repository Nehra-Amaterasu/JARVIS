/**
 * The ESP32's Wi-Fi link settings, as /api/esp32-link reports them (esp32_link.py).
 * The key itself never comes in this view: only its fingerprint, and the board's own
 * fingerprint from its STATUS, so a mismatch is visible without either side printing it.
 */
export type Prefer = 'auto' | 'usb' | 'wifi'

export interface Esp32LinkView {
  configured: boolean
  fingerprint: string | null
  address: string | null
  last_ip: string | null
  addresses: string[]
  prefer: Prefer
  board_port: number
  host_port: number
  mdns: string
  board_fingerprint: string | null
  key_matches: boolean | null
  firewall: string
  secrets_file: string
}

/** Whether the board holds the same key, in words and colour. */
export function keyState(v: Pick<Esp32LinkView, 'fingerprint' | 'board_fingerprint' | 'key_matches'>): { text: string; tone: '' | 'live' | 'sim' | 'fault' } {
  if (!v.fingerprint) return { text: 'no key yet', tone: 'sim' }
  if (v.key_matches === true) return { text: `key ${v.fingerprint} · the board has the same`, tone: 'live' }
  if (v.key_matches === false) return { text: `key ${v.fingerprint} · the board has ${v.board_fingerprint}: flash the line again`, tone: 'fault' }
  return { text: `key ${v.fingerprint} · board not reporting one (3.5.0 with the line flashed?)`, tone: 'sim' }
}

export const PREFER_WORDS: Record<Prefer, string> = {
  auto: 'Auto: USB when plugged in, else Wi-Fi',
  usb: 'USB only',
  wifi: 'Wi-Fi only',
}
