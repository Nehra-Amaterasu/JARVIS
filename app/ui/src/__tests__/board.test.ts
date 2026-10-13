/** The board on the Limbs tab: honest link words, the config form's own checks, flash readiness. */
import { describe, expect, it } from 'vitest'
import { beaconLine, configDraft, flashReady, fmtUptime, linkPill, liveStatus, pinProblem, resetLine, rssiWord, sizeLine, type BoardView, type ConfigView } from '../lib/board'

const cfg: ConfigView = {
  path: 'aankhen/firmware/config.h',
  values: { RELAY_LIGHT_PIN: 4, RELAY_FAN_PIN: 5, RELAY_ACTIVE_LOW: 1, CSI_RATE_HZ: 500, BEACON_ENABLED: 1, BEACON_PING_HZ: 100 },
  readonly: { AK_GAIN_LIB: 1, RADAR_RX_PIN: 18, RADAR_TX_PIN: 17, RADAR_BAUD: 256000 },
  fields: [
    { key: 'RELAY_LIGHT_PIN', label: 'Light', kind: 'pin', help: '' },
    { key: 'RELAY_FAN_PIN', label: 'Fan', kind: 'pin', help: '' },
    { key: 'CSI_RATE_HZ', label: 'Rate', kind: 'choice', options: [100, 500], help: '' },
  ],
  safe_pins: [1, 2, 4, 5, 6, 7],
  pin_reasons: { '0': 'a strapping pin', '19': 'the USB data line JARVIS talks over' },
}

describe('the link', () => {
  it('names the way JARVIS reaches the board, and is cyan only when the board answered', () => {
    expect(linkPill({ link: 'usb', usb: { port: 'COM7' } as BoardView['usb'], wifi: null, ip: null })).toEqual({ text: 'USB · COM7', tone: 'live' })
    expect(linkPill({ link: 'wifi', usb: null, wifi: { ip: '192.168.1.50' } as BoardView['wifi'], ip: '192.168.1.50' }).text).toBe('Wi-Fi · 192.168.1.50')
    expect(linkPill({ link: 'none', usb: null, wifi: null, ip: '192.168.1.50' })).toEqual({ text: 'not answering · 192.168.1.50', tone: 'sim' })
    expect(linkPill({ link: 'none', usb: null, wifi: null, ip: null }).text).toBe('no board')
  })

  it('reads the status from whichever link is live, never a stale one', () => {
    const usb = { fw: 'aankhen-3.4.0' }, air = { fw: 'aankhen-3.3.0' }
    const w = { status: air } as BoardView['wifi']
    expect(liveStatus({ link: 'usb', status: usb, wifi: w })).toBe(usb)
    expect(liveStatus({ link: 'wifi', status: usb, wifi: w })).toBe(air)
    expect(liveStatus({ link: 'none', status: usb, wifi: w })).toBeNull()
  })

  it('words for numbers', () => {
    expect(rssiWord(-52)).toBe('-52 dBm · strong')
    expect(rssiWord(-74)).toBe('-74 dBm · weak')
    expect(rssiWord(undefined)).toBe('—')
    expect(fmtUptime(93784)).toBe('1d 2h')
    expect(fmtUptime(125)).toBe('2m 5s')
    expect(resetLine('brownout').tone).toBe('fault')
    expect(beaconLine({ beacon_enabled: false })).toBe('off in config.h')
    expect(beaconLine({ beacon: { ip: null, mac_known: false, pings_ok: 0, rate_hz: 0, rssi: null, fallback: false } })).toBe('no phone registered')
    expect(sizeLine({ flash_bytes: 998101, flash_max: 1310720, flash_pct: 76, image_bytes: 998256 })).toBe('998,101 bytes · 76 % of the 1280 KB app slot')
  })
})

describe('the config form', () => {
  it('sends only what changed, and refuses unsafe or shared pins before the server does', () => {
    expect(configDraft(cfg, { RELAY_LIGHT_PIN: 4, CSI_RATE_HZ: 100 })).toEqual({ changes: { CSI_RATE_HZ: 100 }, problems: [] })
    expect(configDraft(cfg, { RELAY_FAN_PIN: 4 }).problems).toEqual(['the light and the fan cannot share GPIO 4'])
    expect(configDraft(cfg, { RELAY_FAN_PIN: 19 }).problems[0]).toMatch(/USB data line/)
    expect(pinProblem(18, cfg)).toBe("the radar's UART")
    expect(pinProblem(-1, cfg)).toBeNull()
    expect(pinProblem(40, cfg)).toBe('not a pin safe for a relay input')
  })
})

describe('flashing', () => {
  it('needs a fresh build and no job running', () => {
    const tools = { arduino_cli: true, espota: true }
    const build = { version: 'aankhen-3.4.0', at: 0, seconds: 30, image_bytes: 1, ota_in_build: true, relay_token_in_build: false, fresh: true }
    expect(flashReady({ build: null, job: null, tools })).toEqual({ ok: false, why: 'compile first' })
    expect(flashReady({ build: { ...build, fresh: false }, job: null, tools }).why).toMatch(/compile again/)
    expect(flashReady({ build, job: { state: 'running', kind: 'compile' } as BoardView['job'], tools }).ok).toBe(false)
    expect(flashReady({ build, job: null, tools })).toEqual({ ok: true, why: null })
  })
})
