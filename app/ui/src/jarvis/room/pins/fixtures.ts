// Invented pins for tests and the harness. No real board pin, network name, address or MAC appears here.
import type { LimbsView } from '../../../lib/limbs'

const dev = (id: string, name: string, channel: number) => ({
  id, name, kind: 'light', board: 'esp32', channel, state: { on: false }, link: 'wifi', hardware_on: null, confirmed: true, note: '',
})

export function fixtureView(over: Partial<{ connected: boolean; missing: string[]; mismatch: boolean; virtual: boolean }> = {}): LimbsView {
  const connected = over.connected ?? true
  return {
    devices: [dev('r1', 'Tube light', 4), dev('r2', 'Ceiling fan', 5), dev('r3', 'Desk lamp', 6), dev('r4', 'Corner light', 7), dev('r5', 'Night light', 15), dev('r6', 'Spare', 16)]
      .map((d) => (over.virtual ? { ...d, link: 'virtual' } : d)),
    modes: [], last_mode: null, core_running: true, usb: !over.virtual, hardware: '', relay_board: null, problems: [],
    esp32: {
      devices: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'], connected, link: 'wifi', where: null, rssi: null, fw: null, how: null,
      missing_channels: over.missing ?? [], pin_mismatch: over.mismatch ? [{ device: 'r2', devices_json: 5, board: 9 }] : [], text: '',
    },
    links: ['wifi'],
  } as unknown as LimbsView
}
