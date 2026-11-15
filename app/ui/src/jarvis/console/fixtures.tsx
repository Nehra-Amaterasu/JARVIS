// Invented fixtures for the Console views (the gallery entry J05 and the jury page): every value here is made up, none was
// measured, and every view that draws them is stamped SIMULATED (`simulated`). They hold no name, place, address or id of
// a real device. Times are relative to FIXED_NOW so a static render never changes.
import type { BusEvent, Vitals } from '../../lib/api'
import type { BoardView } from '../../lib/board'
import type { BoardsView } from '../../lib/boards'
import type { CrewLoad, FeedItem } from '../../lib/crew'
import type { LimbsView } from '../../lib/limbs'
import type { BrainView, LatencyView } from '../../lib/settings'
import { ConnectionsView } from './Connections'
import { CrewView } from './Crew'
import { EventsView } from './Events'
import { HardwareView } from './Hardware'
import { HealthView } from './Health'
import type { Integration, JobSpec } from './model'
import type { HealthLive } from './useConsole'

export const FIXED_NOW = 1_800_000_000

const coreOn: LatencyView['core'] = { running: true, mode: 'voice', state: 'sleeping', brain: 'fixture-brain:8b', chosen_brain: 'fixture-brain:8b', last_error: null }
const stat = (median: number, p90: number, n: number) => ({ median, p90, n })

export const LAT_ON: LatencyView = {
  core: coreOn,
  live: {
    threshold: 0.35, counts: {},
    wakes: [
      { t: FIXED_NOW - 12, score: 0.62, outcome: 'answered', first_word: 1.7, full: 3.3, done_speaking: 6.1, marginal: false },
      { t: FIXED_NOW - 420, score: 0.41, outcome: 'heard_nothing', first_word: null, full: null, done_speaking: null, marginal: true },
      { t: FIXED_NOW - 1500, score: 0.77, outcome: 'answered', first_word: 1.9, full: 3.6, done_speaking: 6.8, marginal: false },
    ],
  },
  summary: { turns: 18, spoken: 11, heard: stat(0.7, 1.1, 11), first_word: stat(1.8, 3.1, 11), full: stat(3.4, 5.2, 11), typed_first_word: null },
  recent: [1.6, 2.0, 1.7, 2.4, 1.9, 1.5, 2.1, 1.8].map((fw, i) => ({ ts: FIXED_NOW - 600 * (i + 1), spoken: i % 3 !== 2, heard: 0.5 + (i % 4) * 0.1, first_word: fw, full: fw + 1.4 + (i % 3) * 0.2, first_token: fw - 0.4 })),
}

export const LAT_OFF: LatencyView = {
  core: { running: false, mode: null, state: 'off', brain: null, chosen_brain: 'fixture-brain:8b', last_error: null },
  live: { wakes: [], counts: {}, threshold: 0.35 },
  summary: { turns: 0, spoken: 0, heard: null, first_word: null, full: null, typed_first_word: null },
  recent: [],
}

export const LAT_FAULT: LatencyView = { ...LAT_ON, core: { ...coreOn, running: false, state: 'off', last_error: 'the speech model failed to load: out of GPU memory' } }

const gpu = (used: number): Vitals['gpu'] => ({ name: 'Fixture GPU 6 GB', util: 12, mem_used_mb: used, mem_total_mb: 6144, temp_c: 54, power_w: 31, processes: [] })

const vitals = (g: Vitals['gpu'], ollama: Vitals['ollama']): Vitals => ({
  t: FIXED_NOW, cpu_pct: 14, cpu_count: 8, ram_used_mb: 9800, ram_total_mb: 16000, disk_free_gb: 120, disk_total_gb: 500, gpu: g, ollama,
  core: { running: true, mode: 'voice', state: 'sleeping', boot_step: null, pid: null, started_at: null, ready_at: null, uptime_s: 600, last_error: null, exit_code: null, timings: {}, room: {}, mqtt: null },
  aankhen: { running: false, mode: null, kind: null, scenario: null, scenarios: [], port: null, room: '' } as unknown as Vitals['aankhen'],
})

export const VITALS_ON = vitals(gpu(3920), [{ name: 'fixture-brain:8b', size_mb: 4700, vram_mb: 3400, expires_at: '' }])
export const VITALS_NONE = vitals(null, null)

const crewOk: CrewLoad = {
  status: 'ok',
  view: {
    agents: [
      { id: 'steward', name: 'Steward', role: 'checks that everything runs', state: 'idle', summary: 'all checks passed', data: {}, health: { runs: 40, errors: 0, last_error: null, avg_ms: 12, last_tick: FIXED_NOW - 30, cadence_s: 60 } },
      { id: 'movement', name: 'Movement', role: 'narrates the room', state: 'running', summary: 'quiet for 12 minutes', data: {}, health: { runs: 300, errors: 0, last_error: null, avg_ms: 3, last_tick: FIXED_NOW - 2, cadence_s: 5 } },
      { id: 'ledger', name: 'Ledger', role: 'counts the day', state: 'error', summary: 'could not read today', data: {}, health: { runs: 9, errors: 2, last_error: 'the day file is locked', avg_ms: 5, last_tick: FIXED_NOW - 90, cadence_s: 60 } },
      { id: 'reminders', name: 'Reminders', role: 'watches due times', state: 'off', summary: '', data: {}, health: { runs: 0, errors: 0, last_error: null, avg_ms: null, last_tick: null, cadence_s: null } },
    ],
    events: [],
  },
}

export const FEED: FeedItem[] = [
  { key: 'a', ts: FIXED_NOW - 20, agent: 'steward', kind: 'check', text: 'every check passed', sim: true },
  { key: 'b', ts: FIXED_NOW - 130, agent: 'movement', kind: 'note', text: 'the room has been quiet for 12 minutes', sim: true },
  { key: 'c', ts: FIXED_NOW - 300, agent: 'ledger', kind: 'error', text: 'could not read today: the day file is locked', sim: true },
]

const LOGS = [
  'core: waking, loading the speech model',
  'core: speech model ready on cuda',
  'core: wake word model ready, threshold 0.35',
  'core: brain fixture-brain:8b ready',
  'core: listening',
  'wake: score 0.62, answering',
  'think: first token after 1.2 s',
  'say: reply spoken, 6.1 s',
  'core: listening',
].map((line, i) => ({ t: FIXED_NOW - (9 - i) * 40, line }))

const boardJob: JobSpec = { id: 'fixture', tag: 'BRD', label: 'compile firmware', fraction: 0.64, state: 'live', reason: 'compiling' }

export type HealthKind = 'running' | 'first' | 'fault'

const noActions = { restartBrain: async () => 'restarting JARVIS: fixture-brain:8b', freeGpu: async () => 'freed 3.3 GB: fixture-brain:8b', steward: async () => 'the steward checked everything' }

export function healthLive(kind: HealthKind): HealthLive {
  const base = { board: null, now: FIXED_NOW, coreBooting: false, bootStep: null, actions: noActions }
  if (kind === 'first') return { ...base, online: true, lat: LAT_OFF, crew: { status: 'absent' }, vitals: VITALS_NONE, logs: [], jobs: [], coreRunning: false }
  if (kind === 'fault') return { ...base, online: true, lat: LAT_FAULT, crew: { status: 'ok', view: { agents: crewOk.status === 'ok' ? crewOk.view.agents.map((a) => (a.id === 'steward' ? { ...a, state: 'error' as const, summary: 'a check failed', health: { ...a.health, errors: 3, last_error: 'the brain did not answer' } } : a)) : [], events: [] } }, vitals: vitals(gpu(5700), []), logs: LOGS.slice(0, 3), jobs: [{ id: 'free', tag: 'SYS', label: 'free gpu', state: 'fault', reason: 'the unload route did not answer' }], coreRunning: false }
  return {
    ...base, online: true, lat: LAT_ON, crew: crewOk, vitals: VITALS_ON, logs: LOGS, coreRunning: true,
    jobs: [boardJob, { id: 'restart', tag: 'SYS', label: 'restart brain', fraction: 1, state: 'done', reason: 'finished' }, { id: 'steward', tag: 'SYS', label: 'steward check', state: 'hollow', reason: 'asked, waiting for the answer' }],
  }
}

export const EVENTS: BusEvent[] = [
  ['core', 'ready', 'JARVIS is awake', false, 2400], ['core', 'wake', 'wake word heard, score 0.62', false, 2100], ['limbs', 'switch', 'light turned on', false, 1900],
  ['aankhen', 'source', 'replaying a recorded night', true, 1700], ['core', 'timing', 'first word 1.7 s', false, 1500], ['board', 'link', 'board answered over Wi-Fi', false, 1200],
  ['crew', 'note', 'the room has been quiet for 12 minutes', true, 900], ['core', 'error', 'the speech model failed to load', false, 600], ['limbs', 'switch', 'fan turned off', false, 300], ['core', 'timing', 'full reply 3.3 s', false, 120],
].map(([source, kind, text, sim, ago], i) => ({ id: i + 1, ts: FIXED_NOW - (ago as number), source: source as string, kind: kind as string, text: text as string, sim: sim as boolean }))

export const INTEGRATIONS: Integration[] = [
  { id: 'esp32', group: 'hardware', name: 'ESP32-S3 board', status: 'connected', detail: 'answered over Wi-Fi', next: null },
  { id: 'relay', group: 'hardware', name: 'Relay board', status: 'connected', detail: 'six channels', next: null },
  { id: 'mic', group: 'audio', name: 'Microphone', status: 'connected', detail: 'default input', next: null },
  { id: 'ollama', group: 'brain', name: 'Ollama', status: 'connected', detail: 'serving 3 models', next: null },
  { id: 'whisper', group: 'voice', name: 'Whisper', status: 'installed', detail: 'on disk, loads when JARVIS wakes', next: null },
  { id: 'tts', group: 'voice', name: 'Offline voice', status: 'available', detail: 'not installed', next: 'pip install kokoro' },
  { id: 'wake', group: 'voice', name: 'Wake word', status: 'installed', detail: 'on disk, not loaded now', next: null },
  { id: 'mqtt', group: 'network', name: 'MQTT broker', status: 'missing', detail: 'nothing is listening on port 1883', next: 'winget install mosquitto' },
  { id: 'claude', group: 'assistants', name: 'Claude export', status: 'planned', detail: 'not built', next: null },
]

export const BRAIN: BrainView = {
  ollama: true, chosen: 'fixture-small:3b', running: 'fixture-brain:8b', default: 'fixture-brain:8b', pending_restart: true, core_running: true,
  models: [
    { name: 'fixture-brain:8b', size: 4.7e9, gb: 4.7, params: '8B', family: 'fixture', quant: 'Q4', capabilities: ['text', 'tools'], why_not: null, warn: null, note: 'the default', chosen: false, running: true, loaded_gb: 3.3 },
    { name: 'fixture-small:3b', size: 2.0e9, gb: 2.0, params: '3B', family: 'fixture', quant: 'Q4', capabilities: ['text'], why_not: null, warn: 'weaker at tools', note: null, chosen: true, running: false, loaded_gb: null },
    { name: 'fixture-big:32b', size: 19e9, gb: 19, params: '32B', family: 'fixture', quant: 'Q4', capabilities: ['text', 'tools'], why_not: 'too large for a 6 GB GPU', warn: null, note: null, chosen: false, running: false, loaded_gb: null },
  ],
}

export const BOARD_USB = {
  link: 'usb', usb: { port: 'COM-FIX', handshake: true, fw: '3.5.0', last_byte_s: 0.4, note: null }, session: null,
  status: { fw: '3.5.0', uptime_s: 5400, rssi: -58, csi_hz: 98, csi_dropped: 2, reset: 'power-on', relays: {} }, wifi: null, ip: null, ip_source: null,
  firmware: { repo: '3.5.0', running: '3.5.0', differs: false, ota: true }, link_stats: {}, hub: { running: true, mode: 'hardware', kind: 'esp32', port: 'COM-FIX', hold: null },
  build: { version: '3.5.0', at: FIXED_NOW - 3600, seconds: 41, image_bytes: 998101, flash_bytes: 998101, flash_max: 1310720, flash_pct: 76, fresh: true, ota_in_build: true, relay_token_in_build: true },
  job: { id: 'j1', kind: 'compile', detail: 'firmware', state: 'running', phase: 'compiling', pct: 64, lines: [], started_at: FIXED_NOW - 20, finished_at: null, seconds: 20, result: {}, cmd: [] },
  tools: { arduino_cli: true, espota: true },
} as unknown as BoardView

export const BOARD_WIFI = { ...BOARD_USB, link: 'wifi', usb: null, ip: '192.0.2.10', hub: { running: true, mode: 'hardware', kind: 'esp32', port: null, hold: null }, job: null, wifi: { ip: '192.0.2.10', reachable: true, status: null, full: true, latency_ms: 9, note: null, checked_at: FIXED_NOW } } as unknown as BoardView

export const PORTS = {
  ports: [
    { device: 'COM-FIX', verdict: 'aankhen', detail: 'sent a valid frame', vid: '303A', pid: '1001', chip: 'ESP32-S3', description: '', bytes: 4200, frame: null, fw: '3.5.0', listened_s: 2, at: FIXED_NOW, in_use: true },
    { device: 'COM-FIX2', verdict: 'foreign', detail: 'not an Aankhen board', vid: '0403', pid: '6001', chip: '', description: 'serial adapter', bytes: 0, frame: null, fw: null, listened_s: 2, at: FIXED_NOW, in_use: false },
  ],
  board: {}, hub: { running: true, mode: 'hardware', kind: 'esp32', scenario: null, requested_mode: null, port: 'COM-FIX' }, hotplug: { enabled: true, watching: true, interval_s: 5, requested_mode: null, announced: [], last: null },
} as unknown as BoardsView

export const LIMBS = {
  devices: [
    { id: 'light', name: 'Light', kind: 'light', board: 'esp32', channel: 1, state: { on: true }, link: 'wifi', hardware_on: true, confirmed: true, note: '' },
    { id: 'fan', name: 'Fan', kind: 'fan', board: 'esp32', channel: 2, state: { on: false }, link: 'wifi', hardware_on: false, confirmed: true, note: '' },
    { id: 'lamp', name: 'Desk lamp', kind: 'light', board: 'esp32', channel: 3, state: { on: true }, link: 'wifi', hardware_on: null, confirmed: false, note: '' },
  ],
  modes: [], last_mode: null, core_running: true, usb: true, hardware: 'fixture', relay_board: null, problems: [],
} as unknown as LimbsView

export type ConsoleFixtureKind = 'health-running' | 'health-first' | 'health-fault' | 'events' | 'events-filtered' | 'events-empty' | 'connections' | 'connections-detail' | 'hardware-usb' | 'hardware-wifi' | 'crew' | 'crew-absent'

const classicNote = (what: string) => <p className="jx-empty"><span className="jx-tag">[SYS]</span> the classic {what} card draws here in the app</p>

/** One fixture view by name. Every one is stamped SIMULATED. */
export function ConsoleFixture({ kind }: { kind: ConsoleFixtureKind }) {
  switch (kind) {
    case 'health-running': return <HealthView live={healthLive('running')} simulated />
    case 'health-first': return <HealthView live={healthLive('first')} simulated />
    case 'health-fault': return <HealthView live={healthLive('fault')} simulated initialPane="wakes" />
    case 'events': return <EventsView events={EVENTS} online now={FIXED_NOW} simulated />
    case 'events-filtered': return <EventsView events={EVENTS} online now={FIXED_NOW} initialFilter="core !sim since:1h" simulated />
    case 'events-empty': return <EventsView events={[]} online={false} now={FIXED_NOW} simulated />
    case 'connections': return <ConnectionsView items={INTEGRATIONS} brain={BRAIN} onChoose={() => {}} onRestart={() => {}} simulated panels={{ modules: classicNote('modules'), exports: classicNote('exports'), phone: classicNote('phone'), remarks: classicNote('remarks') }} />
    case 'connections-detail': return <ConnectionsView items={INTEGRATIONS} brain={BRAIN} onChoose={() => {}} onRestart={() => {}} initialTab="detail" initialSelected="mqtt" simulated />
    case 'hardware-usb': return <HardwareView board={BOARD_USB} ports={PORTS} limbs={LIMBS} now={FIXED_NOW * 1000} initialTab="firmware" simulated />
    case 'hardware-wifi': return <HardwareView board={BOARD_WIFI} ports={PORTS} limbs={LIMBS} now={FIXED_NOW * 1000} simulated panels={{ link: classicNote('Wi-Fi link'), firmware: classicNote('firmware') }} />
    case 'crew': return <CrewView load={crewOk} feed={FEED} now={FIXED_NOW} simulated onRun={() => {}} onOpenPlate={() => {}} />
    case 'crew-absent': return <CrewView load={{ status: 'absent' }} feed={[]} now={FIXED_NOW} simulated />
  }
}
