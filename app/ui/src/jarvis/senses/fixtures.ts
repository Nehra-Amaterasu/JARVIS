// Fixtures for the gallery and the jury bench: invented frames of an invented room, every one of them from the
// simulation source, so every reading on screen is stamped SIMULATED. Nothing here is a measurement and nothing is read
// from the real data folder. The generator is deterministic: the same index gives the same frame on every machine.
import type { FrameMsg, RoomSpec } from '../../twin/SpatialTwin'
import type { Readiness } from '../../lib/roomMeasure'
import type { TrainView, ZoneLite } from '../../lib/teachTrain'
import { COLS, ROWS, TAPE_COLS, TAPE_STEP_MIN, localDayStart, type Frame } from './model'
import { EMPTY_STATE, SensesStore, type SensesState, type StatusMsg } from './store'

/** 15 Nov 2026, 10:00 local: a fixed "now" so a fixture draws the same tape and ages on every run. */
export const FIXTURE_NOW = new Date(2026, 10, 15, 10, 0, 0).getTime()

const noise = (i: number, k: number) => {
  const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
  return s - Math.floor(s)
}

export function fixtureAmps(k: number): number[] {
  return Array.from({ length: COLS }, (_, i) => Math.max(0.05, 1.1 + 0.55 * Math.sin(i * 0.33 + k * 0.4) + 0.3 * Math.sin(i * 0.91 - k * 0.7) + 0.25 * noise(i, k)))
}

export function fixtureFrames(n = ROWS, k0 = 0): Frame[] {
  return Array.from({ length: n }, (_, j) => ({ t: FIXTURE_NOW / 1000 - (n - j) * 0.25, amps: fixtureAmps(k0 + j) }))
}

export const FIXTURE_ROOM: RoomSpec = {
  name: 'Invented room', width: 4.2, depth: 3.4, height: 2.6, measured: false,
  zones: [
    { name: 'desk', polygon: [[0.3, 0.3], [1.6, 0.3], [1.6, 1.3], [0.3, 1.3]] },
    { name: 'bed', polygon: [[2.4, 1.6], [4, 1.6], [4, 3.2], [2.4, 3.2]] },
    { name: 'door', polygon: [[0.2, 2.6], [1, 2.6], [1, 3.3], [0.2, 3.3]], is_exit: true },
  ],
  furniture: [
    { name: 'desk', x: 0.3, y: 0.3, w: 1.3, d: 0.7, h: 0.75 },
    { name: 'bed', x: 2.5, y: 1.7, w: 1.5, d: 1.6, h: 0.5 },
  ],
  sensors: [
    { id: 'esp32', kind: 'esp32', x: 3.9, y: 0.4, z: 1.1, yaw_deg: 0, pitch_deg: 0, fov_deg: 360, range_m: 8 },
    { id: 'router', kind: 'router', x: 0.2, y: 3.1, z: 1.6, yaw_deg: 0, pitch_deg: 0, fov_deg: 360, range_m: 8 },
  ],
  links: [['router', 'esp32']],
}

export function fixtureFrameMsg(k = 24, p = 0.52): FrameMsg {
  return {
    type: 'frame', seq: k, source: 'simulation', t: FIXTURE_NOW / 1000, tracks: [], motion: 0.4, zones: {}, zone_seconds: {},
    presence: { state: 'uncertain', p, confidence: 0.5, count: null, evidence: { wifi: 0.45, absence: -0.03 }, reason: 'fixture' },
    motion_detail: {
      state: 'motion', score: 3.2, threshold: 1.8, baseline: 'fixture', reason: 'fixture', breathing_bpm: null, breathing_conf: null, breathing_note: null,
      human_band: { energy: 2.4, threshold: 1.6, ratio: 1.5, recent: 2.1, start_gate: 1.6 },
    },
    learned: {
      t: 0, state: 'room', p: { empty: 0.08, outside: 0.07, room: 0.45, desk: 0.3, bed: 0.1 }, occupied_p: 0.85, advisory: true, trained: 'fixture', reference: 'calibrated',
      activity: { state: 'typing', p: { none: 0.05, still: 0.2, typing: 0.6, waving: 0.05, walking: 0.1 }, trained: 'fixture' },
    },
    belief: { state: 'unsure', confidence: 0.4, motion: 0.4, activity: null, updated: 0, zonesTrusted: false, zones: [
      { id: 'desk', name: 'desk', p: 0.42, x: 1, y: 0.8, r: 0.5 }, { id: 'bed', name: 'bed', p: 0.12, x: 3.2, y: 2.4, r: 0.6 },
    ] },
    csi: { channel: 6, n_subcarriers: 51, rate_hz: 10, rssi: -52, fill_ratio: 0.06, amplitudes: fixtureAmps(k) },
    rates: { csi_hz: 10, radar_hz: 0 },
    events: [
      { id: 1, t: 1, ts: 0, kind: 'motion', text: 'fixture: the motion score crossed its threshold' },
      { id: 2, t: 2, ts: 0, kind: 'motion', text: 'fixture: the score fell back under its threshold' },
      { id: 3, t: 3, ts: 0, kind: 'motion', text: 'fixture: the score crossed its threshold again' },
    ],
  } as FrameMsg
}

const STATUS: StatusMsg = {
  type: 'status', source: 'simulation', room_measured: false,
  sensors: { 'Wi-Fi CSI': { state: 'simulated', detail: '10 Hz, 6.0% filled, baseline fixture' }, ESP32: { state: 'simulated', detail: 'fixture firmware' } },
  link: { frames_ok: 18420, crc_errors: 3, loss_ratio: 0.004, port: null },
  hub: { running: true, mode: 'simulation', kind: 'simulation', scenario: 'walk', scenarios: ['evening', 'walk', 'still', 'empty'], baseline: 'fixture', error: null },
}

export const FIXTURE_ZONES: ZoneLite[] = [
  { id: 'desk', name: 'At the desk', dwell_s: 30 }, { id: 'bed', name: 'On the bed', dwell_s: 30 }, { id: 'door', name: 'By the door', dwell_s: 4 },
]

const item = (id: string, ok: boolean, label: string, how: string) => ({ id, ok, label, detail: ok ? 'done' : 'not yet', how })
export function fixtureReadiness(stage: 'partial' | 'ready'): Readiness {
  const ready = stage === 'ready'
  return {
    ready, zones_trusted: ready, zone_floor: ready ? 0.7 : null, layout_measured: ready, drill_days: ready ? 7 : 3,
    items: [
      item('layout', ready, 'Room measured with a tape', 'Open Measure my room and enter the walls, furniture, board and router.'),
      item('baseline_fan_off', true, 'Quiet baseline, fan off', 'Leave the room quiet, fan off: python -m aankhen calibrate --seconds 120'),
      item('baseline_fan_on', ready, 'Quiet baseline, fan on', 'Leave the room quiet, fan on: python -m aankhen calibrate --seconds 120 --fan'),
      item('drill_days', ready, `Drill days (${ready ? 7 : 3} of 7)`, 'Do the 26-minute drill once a day: python -m aankhen drill'),
      item('zone_gate', ready, 'Zone model passed the day-7 test', 'After day 7: python -m aankhen evaluate'),
    ],
    missing: ready ? [] : ['Room measured with a tape', 'Quiet baseline, fan on', 'Drill days (3 of 7)', 'Zone model passed the day-7 test'],
  }
}

const train = (status: 'predicting' | 'answering'): TrainView => ({
  status, model: { status }, job: { name: 'train', state: 'idle', stage: '', fraction: 0, error: null, started: null, finished: null }, report: null,
  available: { train_job: true, missing: [] },
})

export type FixtureKind = 'simulated' | 'none' | 'offline' | 'trusted' | 'unread'

/** A store that never connects (nothing retains it): the views read its tape and call its actions only on a press. */
export function fixtureStore(): SensesStore {
  const s = new SensesStore({
    now: () => FIXTURE_NOW, storage: null,
    openSocket: (() => ({ send() {}, close() {} })) as never,
  })
  // a week of invented "motion seen" columns and one paused stretch, in the simulated tape (never written to storage)
  for (let d = 0; d < 7; d++) {
    const day = localDayStart(FIXTURE_NOW - d * 86400000)
    for (let c = 0; c < TAPE_COLS; c++) {
      const h = (c * TAPE_STEP_MIN) / 60
      if (h > 7 && h < 23 && noise(d * 7 + 1, Math.floor(c / 4)) > 0.72 && !(d === 0 && h > 10)) s.tapeSim.record(day + c * TAPE_STEP_MIN * 60000 + 1000, 'seen')
      if (d === 2 && h >= 13 && h < 14.5) s.tapeSim.record(day + c * TAPE_STEP_MIN * 60000 + 1000, 'paused')
    }
  }
  return s
}

export function fixtureState(kind: FixtureKind): SensesState {
  const base: SensesState = { ...EMPTY_STATE, now: FIXTURE_NOW, tapeRev: 1, zones: FIXTURE_ZONES }
  if (kind === 'offline') return { ...base, online: false }
  if (kind === 'none') return { ...base, online: true, status: { ...STATUS, source: 'unknown', sensors: {}, link: {}, hub: { ...STATUS.hub!, running: false, mode: null, scenario: null } }, room: FIXTURE_ROOM, readiness: fixtureReadiness('partial'), train: train('predicting') }
  const trusted = kind === 'trusted'
  const hist = Array.from({ length: 150 }, (_, i) => ({ score: Math.max(0.6, 1.2 + 2.2 * Math.max(0, Math.sin(i / 14)) + 0.4 * noise(i, 3)), thr: 1.8 }))
  return {
    ...base, online: true, frames: fixtureFrames(), latest: fixtureFrameMsg(24, trusted ? 0.74 : 0.52), hist, status: STATUS, room: FIXTURE_ROOM,
    readiness: kind === 'unread' ? null : fixtureReadiness(trusted ? 'ready' : 'partial'), train: kind === 'unread' ? null : train(trusted ? 'answering' : 'predicting'),
    lastAt: FIXTURE_NOW,
  }
}
