import { describe, expect, it } from 'vitest'
import { configDraft, linkPill, liveStatus, type BoardStatus, type ConfigView, type SessionView } from '../lib/board'
import { keyState } from '../lib/esp32link'
import { linkWord } from '../lib/limbs'

const session: SessionView = { address: '192.168.1.50', rssi: -61, handshake: true, fw: 'aankhen-3.5.0', note: null, net: null }

describe('the ESP32 over the Wi-Fi link', () => {
  it('names the link as "Wi-Fi · ip · rssi" or "USB · COMx"', () => {
    expect(linkPill({ link: 'wifi', usb: null, wifi: null, ip: null, session })).toEqual({ text: 'Wi-Fi · 192.168.1.50 · -61 dBm', tone: 'live' })
    expect(linkPill({ link: 'wifi', usb: null, wifi: null, ip: '192.168.1.50', session: { ...session, handshake: false, rssi: null } }))
      .toEqual({ text: 'Wi-Fi · 192.168.1.50', tone: 'sim' })
  })
  it('takes the board report from the session, which carries the relays', () => {
    const st: BoardStatus = { fw: 'aankhen-3.5.0', relays: { light: true } }
    expect(liveStatus({ link: 'wifi', status: st, wifi: null, session })).toBe(st)
  })
  it('says which relay boards are live on the Limbs pill', () => {
    expect(linkWord({ usb: true, links: ['wifi'] })).toEqual({ text: 'relay board · Wi-Fi', live: true })
    expect(linkWord({ usb: true, links: ['usb', 'wifi'] }).text).toBe('relay board · USB + Wi-Fi')
    expect(linkWord({ usb: true })).toEqual({ text: 'relay board · USB', live: true })
    expect(linkWord({ usb: false, links: [] })).toEqual({ text: 'virtual room', live: false })
  })
  it('compares key fingerprints, never keys', () => {
    expect(keyState({ fingerprint: 'ab12cd34', board_fingerprint: 'ab12cd34', key_matches: true }).tone).toBe('live')
    expect(keyState({ fingerprint: 'ab12cd34', board_fingerprint: '00000000', key_matches: false }).text).toMatch(/flash the line again/)
    expect(keyState({ fingerprint: null, board_fingerprint: null, key_matches: null }).text).toBe('no key yet')
  })
})

describe('five relay pins in the config form', () => {
  const pin = (key: string) => ({ key, label: key, kind: 'pin' as const, help: '' })
  const cfg: ConfigView = {
    path: 'config.h', readonly: { RADAR_RX_PIN: 18, RADAR_TX_PIN: 17 }, safe_pins: [4, 5, 6, 7, 8, 9], pin_reasons: {},
    values: { RELAY_LIGHT_PIN: 4, RELAY_FAN_PIN: 5, RELAY_LIGHT2_PIN: 6, RELAY_LIGHT3_PIN: 7, RELAY_LIGHT4_PIN: 8 },
    fields: ['RELAY_LIGHT_PIN', 'RELAY_FAN_PIN', 'RELAY_LIGHT2_PIN', 'RELAY_LIGHT3_PIN', 'RELAY_LIGHT4_PIN'].map(pin),
  }
  it('refuses two relays on one GPIO, and checks every relay pin', () => {
    expect(configDraft(cfg, { RELAY_LIGHT2_PIN: 5 }).problems).toEqual(['RELAY_LIGHT2_PIN and RELAY_FAN_PIN cannot share GPIO 5'])
    expect(configDraft(cfg, { RELAY_LIGHT4_PIN: 9 })).toEqual({ changes: { RELAY_LIGHT4_PIN: 9 }, problems: [] })
    expect(configDraft(cfg, { RELAY_LIGHT3_PIN: -1 }).problems).toEqual([])
    expect(configDraft(cfg, { RELAY_LIGHT3_PIN: 46 }).problems[0]).toMatch(/RELAY_LIGHT3_PIN: GPIO 46/)
  })
})
