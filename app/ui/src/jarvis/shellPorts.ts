/**
 * JARVIS's side of seam S5: the real voice, memory and ambient adapters, and the verbs it lends the palette.
 * The composition root (App.tsx) installs them only in a build that has JARVIS, behind the shell flag; a
 * Well Wisher-only build keeps the null adapters and shows "text only" / "no sensing here".
 *
 * Nothing here invents a state: the voice level is the mic level the core actually sends, and only while
 * the core runs in voice mode; presence is the `senses` lamp reading, WAITING until a source reports.
 */
import { post } from '../lib/api'
import { useStore } from '../lib/store'
import { WAITING_DEFAULT } from '../shared/lamp/types'
import type { Verb } from '../shell/commands'
import { installPort, type AmbientPort, type MemoryPort, type VoicePort } from '../shell/ports'
import { useShell } from '../shell/store'

const voice: VoicePort = {
  present: true,
  absentText: 'text only',
  level: () => {
    const s = useStore.getState()
    return s.core?.running && s.core.mode === 'voice' ? s.micLevel : null
  },
  ask: async (text) => {
    if (!useStore.getState().core?.running) return { ok: false, reason: 'JARVIS is asleep: wake him first' }
    useShell.getState().go({ product: 'jarvis', section: 'core', view: 'talk' })
    try {
      await post('/api/core/say', { text })
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: (e as Error).message }
    }
  },
}

const memory: MemoryPort = {
  present: true,
  absentText: 'no memory here',
  search: async (text) => {
    useStore.getState().setPendingQuery(text)
    useShell.getState().go({ product: 'jarvis', section: 'memory', view: 'recall' })
    return { ok: true }
  },
}

const ambient: AmbientPort = {
  present: true,
  absentText: 'no sensing here',
  presence: () => useStore.getState().readings.senses ?? WAITING_DEFAULT,
}

/** Install the three JARVIS adapters. Returns the undo. */
export function installJarvisPorts(): () => void {
  const undo = [installPort('voice', voice), installPort('memory', memory), installPort('ambient', ambient)]
  return () => undo.forEach((u) => u())
}

const act = (label: string, fn: () => Promise<unknown>) => async () => {
  try {
    await fn()
  } catch (e) {
    useStore.getState().toast(`${label}: ${(e as Error).message}`, 'fault')
  }
}

const asleep = () => !useStore.getState().core?.running
const awake = () => !!useStore.getState().core?.running

/** The palette's JARVIS verbs: the same calls the old palette made, with what they do as detail, never as a key. */
export const JARVIS_VERBS: readonly Verb[] = [
  { id: 'wake-voice', label: 'Wake JARVIS: voice', detail: 'mic, Whisper and speech', when: asleep, run: act('Wake', () => post('/api/core/start', { mode: 'voice' })) },
  { id: 'wake-text', label: 'Wake JARVIS: text only', detail: 'fast, no audio', when: asleep, run: act('Wake', () => post('/api/core/start', { mode: 'text' })) },
  { id: 'sleep', label: 'Put JARVIS to sleep', detail: 'frees the GPU', when: awake, run: act('Sleep', () => post('/api/core/stop')) },
  { id: 'light-on', label: 'Light on', run: act('Light', () => post('/api/limbs/light', { action: 'on' })) },
  { id: 'light-off', label: 'Light off', run: act('Light', () => post('/api/limbs/light', { action: 'off' })) },
  { id: 'fan-on', label: 'Fan on', run: act('Fan', () => post('/api/limbs/fan', { action: 'on' })) },
  { id: 'fan-off', label: 'Fan off', run: act('Fan', () => post('/api/limbs/fan', { action: 'off' })) },
  { id: 'scene-focus', label: 'Mode: deep focus', run: act('Mode', () => post('/api/limbs/scene/focus')) },
  { id: 'scene-sleep', label: 'Mode: sleep', run: act('Mode', () => post('/api/limbs/scene/sleep')) },
]
