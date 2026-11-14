// Fixtures for the gallery entry and the jury page: a Core that is asleep, one that is thinking, one that is speaking.
// Everything here is GENERATED and every LIVE is drawn SIMULATED (CoreTalkView `simulated`), with the stage stamped
// "FIXTURE · SIMULATED". The words are neutral examples (Unit 3, physics, chai), never anyone's real transcript.
// No timer lives here: a voice frame enters only when the caller asks (`pulse`), so a fixture never animates by itself.
import { useMemo, useState } from 'react'
import type { CoreInfo, Turn } from '../../lib/api'
import { N_BANDS, VoiceSignal, type VoiceFrame } from '../voice'
import { CoreTalkView } from './CoreTalk'
import type { CoreActions } from './useCoreLive'
import { coreViewOf, ribbonStages, stageSeconds, type Organ, type StageId, type StageMedian } from './model'

export type CoreFixtureKind = 'asleep' | 'thinking' | 'speaking' | 'fault'

/** A speech-shaped spectrum from a formula (a fixture, not a recording); `phase` shifts the formant a little. */
export function fixtureBands(phase = 0): number[] {
  return Array.from({ length: N_BANDS }, (_, i) => Math.round(Math.max(0, Math.min(255, 36 + 190 * Math.exp(-((i - 6 - phase) ** 2) / 22) + 70 * Math.exp(-((i - 15 + phase) ** 2) / 9)))))
}

/** One fixture frame into `signal`, arriving now. The caller decides when; nothing repeats on its own. */
export function pulse(signal: VoiceSignal, channel: 'in' | 'out', seq: number, at = Date.now()): void {
  const f: VoiceFrame = {
    channel, t: at / 1000, seq, sr: 24000, rmsDb: -21, peakDb: null, bands: fixtureBands((seq % 5) * 0.4), level: null, latMs: null, final: false,
    thrDb: null, speechProb: null, vadThreshold: null, speaking: null, arrival: at,
  }
  signal.ingest(f)
}

const T0 = 1_763_000_000 // a fixed epoch second, so the fixture's clock text is the same on every machine

export const FIXTURE_TURNS: (Turn & { session?: string; handoff?: unknown })[] = [
  { id: 1, role: 'you', text: 'What is planned for physics today?', t: T0, done: true, session: 'fixture' },
  { id: 2, role: 'jarvis', text: 'Unit 3, the photoelectric effect: forty minutes of practice, then a short review before chai.', t: T0 + 4, done: true, seconds: 3.1, session: 'fixture' },
  { id: 3, role: 'you', text: 'Remind me to revise Unit 3 at six.', t: T0 + 41, done: true, session: 'fixture' },
  { id: 4, role: 'jarvis', text: 'Added to your day at six in the evening.', t: T0 + 44, done: true, seconds: 2.4, session: 'fixture', handoff: { product: 'ww', target: 'ww/day.today', label: 'Day 3 Dec 18:00' } },
  { id: 5, role: 'you', text: 'Turn the fan on.', t: T0 + 90, done: true, session: 'fixture' },
  { id: 6, role: 'jarvis', text: 'Fan on. The board confirmed it.', t: T0 + 92, done: true, seconds: 1.8, session: 'fixture' },
  { id: 7, role: 'you', text: 'Why does the stopping voltage not depend on brightness?', t: T0 + 140, done: true, session: 'fixture' },
]

const MEDIANS: Record<StageId, StageMedian> = {
  hear: { value: 0.7, n: 9 }, write: { value: 0.5, n: 9 }, think: { value: 1.4, n: 9 }, say: { value: null, n: 2 },
}
const NO_MEDIANS: Record<StageId, StageMedian> = { hear: { value: null, n: 0 }, write: { value: null, n: 0 }, think: { value: null, n: 0 }, say: { value: null, n: 0 } }

const org = (id: Organ['id'], name: string, state: Organ['reading']['state'], reason: string, source: string, since: number | null): Organ =>
  ({ id, name, reading: { state, since, reason }, source })

function coreOf(kind: CoreFixtureKind, now: number): CoreInfo | null {
  if (kind === 'asleep') return { running: false, mode: null, state: 'offline', boot_step: null, pid: null, started_at: null, ready_at: null, uptime_s: null, last_error: null, exit_code: null, timings: {}, room: {}, mqtt: null }
  if (kind === 'fault') return { running: false, mode: null, state: 'offline', boot_step: null, pid: null, started_at: null, ready_at: null, uptime_s: null, last_error: 'voice process exited: microphone not found', exit_code: 1, timings: {}, room: {}, mqtt: null }
  return {
    running: true, mode: 'voice', state: kind === 'thinking' ? 'thinking' : 'speaking', boot_step: null, pid: 1, started_at: now / 1000 - 754, ready_at: now / 1000 - 730,
    uptime_s: 754, last_error: null, exit_code: null, timings: { endpoint: 0.6, stt: 0.4, first_token: 1.3, first_audio: 1.9 }, room: { fan: { on: true } }, mqtt: true,
    status_line: 'Voice on the GPU, wake word on',
  }
}

const FIXTURE_ACTIONS: CoreActions = {
  wake: async () => {},
  sleep: async () => {},
  say: async () => {},
  flag: async () => 'fixture: nothing was saved',
}

export function useFixture(kind: CoreFixtureKind, now = Date.now(), external?: VoiceSignal) {
  const own = useMemo(() => new VoiceSignal(), [])
  const signal = external ?? own
  return useMemo(() => {
    const core = coreOf(kind, now)
    const since = kind === 'thinking' ? now - 2400 : kind === 'speaking' ? now - 1200 : null
    const last = stageSeconds(core?.running ? core.timings : null)
    const medians = core?.running ? MEDIANS : NO_MEDIANS
    const awake = !!core?.running
    const organs: Organ[] = [
      awake ? org('brain', 'BRAIN', 'live', 'model loaded', 'ollama', now - 700_000) : org('brain', 'BRAIN', 'waiting', 'core off', 'ollama', null),
      kind === 'fault' ? org('voice', 'VOICE', 'fault', 'microphone not found', 'core', now - 30_000) : awake ? org('voice', 'VOICE', 'live', 'voice process running', 'core', now - 730_000) : org('voice', 'VOICE', 'waiting', 'core off', 'core', null),
      awake ? org('room', 'ROOM', 'live', 'board link up', 'board', now - 600_000) : org('room', 'ROOM', 'waiting', 'not tested', 'board', null),
      org('sense', 'SENSE', 'waiting', 'not tested', 'aankhen', null),
      org('mem', 'MEM', 'waiting', 'not tested', 'memory', null),
    ]
    const turns = awake ? FIXTURE_TURNS : kind === 'fault' ? FIXTURE_TURNS.slice(0, 2) : []
    return {
      core, coreView: coreViewOf(core, since), turns, organs, signal, now, last, medians,
      stages: ribbonStages({ core, stateSince: since, now, last, medians }),
      actions: FIXTURE_ACTIONS,
    }
  }, [kind, now, signal])
}

/** The whole Core Talk surface on a fixture, stamped SIMULATED. */
export function CoreFixture({ kind, motion = 'none', signal }: { kind: CoreFixtureKind; motion?: 'auto' | 'none'; signal?: VoiceSignal }) {
  const [now] = useState(() => Date.now())
  const f = useFixture(kind, now, signal)
  return <CoreTalkView {...f} simulated motion={motion} notifyPresent />
}
