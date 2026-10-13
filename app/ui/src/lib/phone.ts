/**
 * Phone access (Connect, 05.4): the UI's side of app/jarvis_app/routes_phone.py.
 * The switch, the addresses the phone opens, pairing codes and paired phones.
 */
import { api } from './api'

export interface PairedPhone { id: string; name: string; created: number; last_seen: number }
export interface PhoneView {
  enabled: boolean
  forced: boolean | null
  saved_enabled: boolean
  running: boolean
  listening_on: string[]
  error: string | null
  port: number
  bind: string
  https: boolean
  cert: string
  key: string
  urls: string[]
  addresses: string[]
  open_at: string[]
  devices: PairedPhone[]
  pairing: { active: boolean; expires_in: number }
  firewall_cmd: string
  mic_ready: boolean
}
export interface PairCode { code: string; url: string; link: string; qr_svg: string; expires_in: number }

export const loadPhone = () => api<PhoneView>('/api/remote')
export const savePhone = (changes: Partial<Pick<PhoneView, 'enabled' | 'port' | 'bind' | 'cert' | 'key' | 'urls'>>) =>
  api<PhoneView>('/api/remote', { method: 'PUT', body: changes })
export const startPairing = (url?: string) => api<PairCode>('/api/remote/pair', { method: 'POST', body: { url } })
export const cancelPairing = () => api('/api/remote/pair', { method: 'DELETE' })
export const revokePhone = (id: string) => api<{ devices: PairedPhone[] }>(`/api/remote/devices/${id}`, { method: 'DELETE' })

/** "running on 2 addresses" / "off" / the error, for the card's header. */
export function phoneStatus(v: PhoneView | null): { text: string; tone: '' | 'live' | 'fault' } {
  if (!v) return { text: '…', tone: '' }
  if (!v.enabled) return { text: v.forced === false ? 'off (JARVIS_PHONE=0)' : 'off', tone: '' }
  if (v.running) return { text: `listening on :${v.port}${v.https ? ' · https' : ''}`, tone: 'live' }
  return { text: v.error ? 'not listening' : 'starting…', tone: v.error ? 'fault' : '' }
}

/** The SVG from the server as an <img> source (never injected as markup). */
export const svgSrc = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

export function lastSeen(t: number, now = Date.now()): string {
  const s = Math.max(0, Math.round(now / 1000 - t))
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

export const TAILSCALE_SERVE = (port: number) => `tailscale serve --bg --https=443 http://127.0.0.1:${port}`
