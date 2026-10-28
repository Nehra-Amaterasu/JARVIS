/** The wall box card's helpers: table order, the LCD rows, group words, voice lines, receipts. */
import { describe, expect, it } from 'vitest'
import type { LimbsDevice, Mode } from '../lib/limbs'
import { ceilingState, channelRows, clickSummary, groupWords, isWallBox, lcdRow1, lcdRow2, voiceLines } from '../lib/wallbox'

const dev = (id: string, name: string, channel: number, on = false, hw: boolean | null = false, kind: 'light' | 'fan' = 'light'): LimbsDevice => ({
  id, name, kind, board: 'esp32', channel, state: { on }, link: 'wifi', hardware_on: hw, confirmed: hw !== null && hw === on, note: '',
})
const box = [dev('light', 'White lights', 4, true, true), dev('fan', 'Ceiling fan', 5, false, false, 'fan'), dev('light2', 'Warm outer', 6),
  dev('light3', 'Warm inner', 7, true, true), dev('light4', 'Pink outer', 15, true, true), dev('light5', 'Pink inner', 16, false, null)]
const modes: Pick<Mode, 'id' | 'name'>[] = [{ id: 'movie', name: 'Movie' }, { id: 'relaxation', name: 'Wind down' }, { id: 'morning', name: 'Morning' },
  { id: 'night_light', name: 'Night light' }, { id: 'all_off', name: 'All off' }]

describe('the wall box table', () => {
  it('puts two relays on each module in the firmware order, even when a device is missing', () => {
    const rows = channelRows(box.filter((d) => d.id !== 'light5'))
    expect(rows.map((r) => `${r.module}${r.input}:${r.id}`)).toEqual(['1IN1:light', '1IN2:fan', '2IN1:light2', '2IN2:light3', '3IN1:light4', '3IN2:light5'])
    expect(rows[5]).toMatchObject({ present: false, gpio: null, hardwareOn: null })
    expect(rows[4]).toMatchObject({ present: true, gpio: 15, on: true, hardwareOn: true, confirmed: true })
  })
  it('knows a box from a Uno room', () => {
    expect(isWallBox({ devices: box })).toBe(true)
    expect(isWallBox({ devices: [{ ...box[0], board: 'uno' }] })).toBe(false)
    expect(isWallBox(null)).toBe(false)
  })
})

describe('the LCD rows', () => {
  it('draws one mark per relay from the board, "-" off and "?" not wired', () => {
    expect(lcdRow1(channelRows(box))).toBe('1 - - 3 4 ?')
    expect(lcdRow1(channelRows([]))).toBe('? ? ? ? ? ?')
  })
  it('shows the link on the second row, at most 16 characters', () => {
    expect(lcdRow2({ connected: true, link: 'wifi', where: '192.168.0.250', rssi: -61 })).toBe('192.168.0.250 -6')
    expect(lcdRow2({ connected: true, link: 'usb', where: 'COM9', rssi: null })).toBe('USB COM9')
    expect(lcdRow2({ connected: false, link: null, where: null, rssi: null })).toBe('Wi-Fi: joining')
  })
  it('lights the ceiling from the board, never from a wish', () => {
    const s = ceilingState(channelRows([{ ...box[2], state: { on: true }, hardware_on: false }]))
    expect(s.light2).toBe(false)
    expect(s.light5).toBeNull()
  })
})

describe('what to say', () => {
  it('groups the words two names share and skips plain ones', () => {
    expect(groupWords(box)).toEqual([{ word: 'warm', ids: ['light2', 'light3'] }, { word: 'outer', ids: ['light2', 'light4'] },
      { word: 'inner', ids: ['light3', 'light5'] }, { word: 'pink', ids: ['light4', 'light5'] }])
  })
  it('lists devices, groups, the ladder, the modes and all off', () => {
    const lines = voiceLines(box, modes)
    expect(lines[0].say).toBe('"lights on" / "lights off"')
    expect(lines.find((l) => l.say.startsWith('"pink on"'))?.does).toBe('Pink outer + Pink inner')
    expect(lines.find((l) => l.say === '"brighter" / "dimmer"')?.does).toBe('one step along Night light → Movie → Wind down → Morning')
    expect(lines.some((l) => l.say === '"movie"')).toBe(true)
    expect(lines.at(-1)?.say).toContain('sab band karo')
    expect(lines.some((l) => l.say === '"all off"')).toBe(false)
  })
})

describe('a test click receipt', () => {
  it('reads both round trips when the board confirmed both steps', () => {
    expect(clickSummary({ device: 'light', ok: true, steps: [{ action: 'on', delivered: true, board_says: true, ms: 118 }, { action: 'off', delivered: true, board_says: false, ms: 96 }] }))
      .toEqual({ ok: true, text: 'confirmed both · on 118 ms · off 96 ms' })
  })
  it('names the step the board did not confirm', () => {
    expect(clickSummary({ device: 'light5', ok: false, steps: [{ action: 'on', delivered: false, board_says: null, ms: 2004 }] }).text)
      .toBe('on not confirmed after 2004 ms (board says not wired)')
  })
})
