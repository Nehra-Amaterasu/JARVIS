/**
 * Seam S5 (spec 1.4): the only four ways one product reaches the other or the shell reaches either. A fifth
 * port needs a decision-log entry. Each port has a null adapter, so with a product absent the shell renders
 * its honest empty state ("text only", "no sensing here") instead of a broken control or a fake value.
 *
 * The adapters are plain objects installed at start-up by the composition root (App.tsx); the shell reads
 * them through getPort and never imports a product module itself.
 */
import { WAITING_DEFAULT, type LampReading } from '../shared/lamp/types'

export interface PortResult {
  ok: boolean
  /** Why it did nothing, in words the UI can show as they are. */
  reason?: string
}

export interface VoicePort {
  readonly present: boolean
  /** The words shown where this port is missing. */
  readonly absentText: string
  /** The real input level 0..1, or null when there is no level (the Ask orb then draws a still ring). */
  level(): number | null
  /** Text to the assistant. */
  ask(text: string): Promise<PortResult>
}

export interface MemoryPort {
  readonly present: boolean
  readonly absentText: string
  /** Open a memory search for this text. */
  search(text: string): Promise<PortResult>
}

export type NotifyTone = 'info' | 'live' | 'fault'

export interface NotifyPort {
  readonly present: boolean
  readonly absentText: string
  notify(text: string, tone?: NotifyTone): void
}

export interface AmbientPort {
  readonly present: boolean
  readonly absentText: string
  /** Whether a body moved, as a lamp reading. Never LIVE without a source that reported. */
  presence(): LampReading
}

export interface Ports {
  voice: VoicePort
  memory: MemoryPort
  notify: NotifyPort
  ambient: AmbientPort
}

export const PORT_NAMES = ['voice', 'memory', 'notify', 'ambient'] as const satisfies readonly (keyof Ports)[]

const absent = (reason: string): Promise<PortResult> => Promise.resolve({ ok: false, reason })

export const NULL_VOICE: VoicePort = Object.freeze({
  present: false,
  absentText: 'text only',
  level: () => null,
  ask: () => absent('text only: no assistant in this build'),
})

export const NULL_MEMORY: MemoryPort = Object.freeze({
  present: false,
  absentText: 'no memory here',
  search: () => absent('no memory here: memory search needs JARVIS'),
})

export const NULL_NOTIFY: NotifyPort = Object.freeze({
  present: false,
  absentText: 'no notifications',
  notify: () => undefined,
})

export const NULL_AMBIENT: AmbientPort = Object.freeze({
  present: false,
  absentText: 'no sensing here',
  presence: () => ({ ...WAITING_DEFAULT, reason: 'no sensing here' }),
})

export const NULL_PORTS: Readonly<Ports> = Object.freeze({ voice: NULL_VOICE, memory: NULL_MEMORY, notify: NULL_NOTIFY, ambient: NULL_AMBIENT })

let ports: Ports = { ...NULL_PORTS }
const listeners = new Set<() => void>()

export function getPort<K extends keyof Ports>(name: K): Ports[K] {
  return ports[name]
}

/** Install a real adapter (null puts the null adapter back). Returns the undo, for tests and hot reload. */
export function installPort<K extends keyof Ports>(name: K, adapter: Ports[K] | null): () => void {
  const prev = ports[name]
  ports = { ...ports, [name]: adapter ?? NULL_PORTS[name] }
  listeners.forEach((l) => l())
  return () => {
    if (ports[name] === (adapter ?? NULL_PORTS[name])) {
      ports = { ...ports, [name]: prev }
      listeners.forEach((l) => l())
    }
  }
}

export function subscribePorts(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function snapshotPorts(): Ports {
  return ports
}

/** Tests only. */
export function resetPortsForTests(): void {
  ports = { ...NULL_PORTS }
  listeners.forEach((l) => l())
}
