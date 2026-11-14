// The SigilRing bound to the voice signal. It re-renders only itself, at most every SIGIL_MIN_MS while frames arrive,
// and once more when the last frame turns stale (one timeout, re-armed by each frame and cleared on unmount), so with
// no frames nothing here runs at all. The lit ticks are the smoothed bands of the channel the voice picture shows;
// with no fresh frame the ring is hollow, whatever the last frame said.
import { useEffect, useState } from 'react'
import { STALE_MS, voiceState, type CoreView, type VoiceSignal } from '../voice'
import type { LampState } from '../../shared/lamp'
import { SigilRing } from './SigilRing'

/** 10 re-renders a second at most: the ring is a second projection of the hill, not a second meter. */
export const SIGIL_MIN_MS = 100

export interface SigilSnap { bands: number[]; state: LampState }

const EMPTY: number[] = []

/** What the ring shows at `now`: bands and LIVE (or SIMULATED) only while a fresh frame exists; else hollow. */
export function sigilSnap(signal: VoiceSignal, core: CoreView, now: number, simulated = false): SigilSnap {
  const vs = voiceState(core, { input: signal.view('in', now), output: signal.view('out', now) }, now, 1)
  const lampState = simulated && vs.lamp.state === 'live' ? 'simulated' : vs.lamp.state
  if (vs.measured && vs.channel) {
    const f = signal.latest(vs.channel)
    const bands = f?.smooth ? Array.from(f.smooth) : f?.bands ?? null
    if (bands && (lampState === 'live' || lampState === 'simulated')) return { bands, state: lampState }
  }
  // not measured: never LIVE. A running core with no frame is WAITING; an error stays FAULT.
  return { bands: EMPTY, state: lampState === 'live' || lampState === 'simulated' ? 'waiting' : lampState }
}

export function LiveSigil({ signal, core, simulated = false }: { signal: VoiceSignal; core: CoreView; simulated?: boolean }) {
  const [snap, setSnap] = useState<SigilSnap>(() => sigilSnap(signal, core, Date.now(), simulated))
  useEffect(() => {
    let last = 0
    let stale: ReturnType<typeof setTimeout> | null = null
    const update = () => setSnap(sigilSnap(signal, core, Date.now(), simulated))
    update()
    const off = signal.subscribe(() => {
      const now = Date.now()
      if (now - last >= SIGIL_MIN_MS) {
        last = now
        update()
      }
      if (stale) clearTimeout(stale)
      stale = setTimeout(() => {
        stale = null
        update()
      }, STALE_MS + 20)
    })
    return () => {
      off()
      if (stale) clearTimeout(stale)
    }
  }, [signal, core, simulated])
  return <SigilRing bands={snap.bands} state={snap.state} />
}
