/** Connect's Phone card helpers (lib/phone.ts): the header says off / listening / why not,
 * the QR is an image source (never markup), and "seen" reads like a person would say it. */
import { describe, expect, it } from 'vitest'
import { lastSeen, phoneStatus, svgSrc, TAILSCALE_SERVE, type PhoneView } from '../lib/phone'

const view = (extra: Partial<PhoneView> = {}): PhoneView => ({
  enabled: false, forced: null, saved_enabled: false, running: false, listening_on: [], error: null, port: 8778,
  bind: 'auto', https: false, cert: '', key: '', urls: [], addresses: [], open_at: [], devices: [],
  pairing: { active: false, expires_in: 0 }, firewall_cmd: '', mic_ready: false, ...extra,
})

describe('phoneStatus', () => {
  it('is off by default and says when the environment forced it', () => {
    expect(phoneStatus(view())).toEqual({ text: 'off', tone: '' })
    expect(phoneStatus(view({ forced: false })).text).toBe('off (JARVIS_PHONE=0)')
  })
  it('shows the port when listening and a fault when it could not', () => {
    expect(phoneStatus(view({ enabled: true, running: true, https: true }))).toEqual({ text: 'listening on :8778 · https', tone: 'live' })
    expect(phoneStatus(view({ enabled: true, error: 'no address' }))).toEqual({ text: 'not listening', tone: 'fault' })
  })
})

describe('helpers', () => {
  it('turns the server SVG into a data URL', () => {
    const src = svgSrc('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0,0h1"/></svg>')
    expect(src.startsWith('data:image/svg+xml;charset=utf-8,%3Csvg')).toBe(true)
    expect(src).not.toContain('<')
  })
  it('says when a phone was last seen', () => {
    const now = 1_760_000_000_000
    expect(lastSeen(now / 1000 - 20, now)).toBe('just now')
    expect(lastSeen(now / 1000 - 600, now)).toBe('10 min ago')
    expect(lastSeen(now / 1000 - 3 * 86400, now)).toBe('3 d ago')
  })
  it('proxies Tailscale Serve to the phone port on loopback', () => {
    expect(TAILSCALE_SERVE(8778)).toBe('tailscale serve --bg --https=443 http://127.0.0.1:8778')
  })
})
