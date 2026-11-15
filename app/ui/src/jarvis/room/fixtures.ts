// Invented rooms for the gallery, the tests and the jury page. No real device name, address or board appears here. Every view
// built from these is stamped SIMULATED where it is drawn (the gallery has no board and no app).
import type { AwayStatus, Incident } from '../../lib/away'
import type { EnergyView } from '../../lib/energy'
import type { LimbsDevice, LimbsView, Mode, PresenceOnView } from '../../lib/limbs'

const NAMES: Record<string, [string, 'light' | 'fan', number]> = {
  light: ['Tube light', 'light', 4], fan: ['Ceiling fan', 'fan', 5], light2: ['Cove warm', 'light', 6],
  light3: ['Cove soft', 'light', 7], light4: ['Desk lamp', 'light', 15], light5: ['Corner light', 'light', 16],
}

const dev = (id: string, hardware: boolean | null, on: boolean, extra: Partial<LimbsDevice> = {}): LimbsDevice => ({
  id, name: NAMES[id][0], kind: NAMES[id][1], board: 'esp32', channel: NAMES[id][2], state: { on }, link: 'wifi',
  hardware_on: hardware, confirmed: hardware !== null && hardware === on, note: '', ...extra,
})

export const FIXTURE_MODES: Mode[] = [
  { id: 'focus', name: 'Deep focus', set: { light: true, fan: true }, resolved: { light: true, fan: true, light2: false, light3: false, light4: false, light5: false }, detail: 'tube light on, fan on', builtin: true },
  { id: 'relaxation', name: 'Relaxation', set: { light2: true, light3: true }, resolved: { light: false, fan: true, light2: true, light3: true, light4: false, light5: false }, detail: 'coves on, fan on', builtin: true },
  { id: 'sleep', name: 'Sleep', set: { '*': false }, resolved: { light: false, fan: true, light2: false, light3: false, light4: false, light5: false }, detail: 'lights off, fan on', builtin: true },
  { id: 'all_off', name: 'All off', set: { '*': false }, resolved: { light: false, fan: false, light2: false, light3: false, light4: false, light5: false }, detail: 'everything off', builtin: true },
]

export type RoomKind = 'live' | 'offline' | 'virtual'

export function fixtureRoom(kind: RoomKind = 'live'): LimbsView {
  const live = kind === 'live'
  const virtual = kind === 'virtual'
  const devices: LimbsDevice[] = virtual
    ? [dev('light', null, true, { link: 'virtual' }), dev('fan', null, false, { link: 'virtual' })].map((d) => ({ ...d, board: 'esp32' as const }))
    : [
      dev('light', live ? true : null, true),
      dev('fan', live ? false : null, false),
      dev('light2', live ? true : null, true),
      dev('light3', live ? false : null, false),
      dev('light4', live ? false : null, false),
      dev('light5', null, false),
    ]
  return {
    devices, modes: FIXTURE_MODES, last_mode: live ? 'focus' : null, core_running: true, usb: !virtual, hardware: 'fixture room',
    relay_board: null, problems: [], links: ['wifi'],
    esp32: {
      devices: devices.map((d) => d.id), connected: live, link: live ? 'wifi' : null, where: live ? 'fixture-box' : null, rssi: live ? -58 : null,
      fw: live ? 'fixture 0.0' : null, how: live ? 'Wi-Fi' : null, missing_channels: [], pin_mismatch: [], text: live ? '' : 'The relay board is not reachable.',
    },
  } as unknown as LimbsView
}

export const fixturePresence = (enabled = true): PresenceOnView => ({
  settings: { enabled, window_min: 10, quiet_start: '23:00', quiet_end: '07:00', input_s: 120, occupied_p: 0.8, sustain_s: 30 },
  status: 'waiting for the relay board', started: false,
  decision: { decision: 'acted', reason: 'keyboard input: the last mode came back', at: 1_700_000_000 },
})

export const fixtureEnergy = (autoOff = false): EnergyView => ({
  now: 1_700_000_000, estimate: true, meter: null, auto_off: autoOff, core_running: true, relay_board: true, problems: [],
  presence: { state: 'present', source: 'fixture', learned: null, sim: true },
  circuits: { source: 'example', example: true, relay_channels: 6, problems: [], relay_rating_a: 10, safe_current_a: 7, circuits: [
    { id: 'heater', name: 'Water heater', room: 'bath', kind: 'heater', rated_w: 2000, relay: null, safe_7a: false, alias: null, must_not_auto_off: false, speed_steps: 0, refused: null, requested_relay: null, current_a: 8.7, relay_safe: false, relay_reason: null, never_on_relay: true, switchable: false, note: '' },
  ] },
  states: { heater: { on: false, watts: 0, since: null, link: 'manual', origin: null } },
  waste: {
    status: { state: 'starting', text: 'Waiting for the first presence reading.', sim: true },
    config: { sensed_room: 'room', grace_min: 5, nudge_after_min: 10, auto_off_enabled: autoOff, auto_off_after_min: 15, min_after_nudge_min: 3, night: { start: '23:30', end: '06:30' }, notes: [] },
    nudges: [],
  },
  report: {} as EnergyView['report'],
}) as EnergyView

export const fixtureAway = (armed = false): AwayStatus => ({
  phase: armed ? 'armed' : 'disarmed', armed, armed_by: armed ? 'app' : null, armed_at: armed ? 1_700_000_000 : null, watch_from: null, exit_left_s: null, entry_left_s: null,
  disarmed_at: null, disarmed_by: null, auto_arm: { enabled: false, ready: false, reason: 'auto-arm is off', paused: false, arms_in_s: null },
  phones: [], phones_home: [], check: null, incident: null, tamper: null, sensor: { source: 'simulation' }, warnings: [], limits: [], now: 1_700_000_000,
  aankhen: { running: false, mode: null },
  config: { phones: [], auto_arm: false, away_after_min: 20, return_gap_s: 60, exit_delay_s: 30, entry_delay_s: 20, confirm_k: 3, confirm_n: 5, clear_after_s: 60, tamper_after_s: 30, check_every_s: 30, ping: true, warning: '' },
  config_problem: null,
}) as AwayStatus

export const fixtureIncidents: Incident[] = []
