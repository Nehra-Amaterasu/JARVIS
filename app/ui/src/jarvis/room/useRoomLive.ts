// The Room section's data and actions, MOVED from the classic page (pages/Limbs.tsx `send`, the 2 s poll of /api/limbs, the
// event-driven reload) and from the Energy and Away cards (their routes and bodies), not rewritten: the same routes, the same
// bodies, the same toast when the board did not confirm. What this file adds is only the bookkeeping of an ASK: which channel
// the owner pressed, when, and when the board's report first agreed, so a key can show asked, confirmed, not confirmed.
//
// Nothing here sends on its own. Every request is the body of a function a press calls.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, post } from '../../lib/api'
import type { AwayStatus, Incident } from '../../lib/away'
import type { EnergyView } from '../../lib/energy'
import { usePoll } from '../../lib/format'
import type { LimbsView, PresenceOnView } from '../../lib/limbs'
import { useStore } from '../../lib/store'
import { ASK_WINDOW_MS, CONFIRMED_SHOW_MS, LOG_MAX, clock24, loadHeavy, saveHeavy, type Asked, type HeavyFlags, type LogLine } from './model'
import type { LampState } from '../../shared/lamp/types'

export type Send = (path: string, body?: unknown) => Promise<void>

export interface RoomActions {
  /** Ask one channel to a state. The key's lamp follows the board, so this only records the ask and sends it. */
  press: (id: string, on: boolean) => Promise<void>
  /** Apply a saved mode (POST /api/limbs/scene/{id}). */
  scene: (modeId: string) => Promise<void>
  /** Switch every channel the board reports on to off: the "all_off" mode when it exists, else one request per channel. */
  allOff: () => Promise<void>
  /** Any other room route (modes, test clicks). */
  send: Send
  reload: () => void
}

export interface RoomLive {
  view: LimbsView | null
  loading: boolean
  now: number
  asked: Record<string, Asked>
  confirmedAt: Record<string, number>
  log: LogLine[]
  heavy: HeavyFlags
  setHeavy: (next: HeavyFlags) => void
  actions: RoomActions
}

export function useRoomLive(): RoomLive {
  const toast = useStore((s) => s.toast)
  const lastRoom = useStore((s) => s.events.findLast((e) => e.source === 'limbs')?.id)
  const [view, loading, reload] = usePoll(() => api<LimbsView>('/api/limbs'), 2000)
  useEffect(() => { if (lastRoom) reload() }, [lastRoom]) // eslint-disable-line react-hooks/exhaustive-deps

  const [asked, setAsked] = useState<Record<string, Asked>>({})
  const [confirmedAt, setConfirmedAt] = useState<Record<string, number>>({})
  const [log, setLog] = useState<LogLine[]>([])
  const [heavy, setHeavyState] = useState<HeavyFlags>(() => loadHeavy())
  const seq = useRef(0)
  const [now, setNow] = useState(() => Date.now())
  const viewRef = useRef(view)
  viewRef.current = view
  const askedRef = useRef(asked)
  askedRef.current = asked

  const say = useCallback((text: string, state: LampState) => {
    seq.current += 1
    const line: LogLine = { id: seq.current, at: Date.now(), text, state }
    setLog((l) => [line, ...l].slice(0, LOG_MAX))
  }, [])

  // A clock only while an ask is open: the 6 s sweep and the "no report" turn need it, an idle room needs none.
  const pending = Object.keys(asked).length > 0
  useEffect(() => {
    if (!pending) return
    const id = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(id)
  }, [pending])

  // The board's report agreeing with an ask is the confirmation; the key words it for a few seconds, then it is steady again.
  useEffect(() => {
    if (!view) return
    for (const [id, ask] of Object.entries(asked)) {
      const d = view.devices.find((x) => x.id === id)
      if (d && d.link !== 'virtual' && d.hardware_on === ask.want && !confirmedAt[id]) {
        const at = Date.now()
        setConfirmedAt((c) => ({ ...c, [id]: at }))
        say(`confirmed by board: ${d.name} ${ask.want ? 'ON' : 'OFF'}`, 'live')
        window.setTimeout(() => {
          setAsked((a) => { const n = { ...a }; if (n[id]?.at === ask.at) delete n[id]; return n })
          setConfirmedAt((c) => { const n = { ...c }; delete n[id]; return n })
        }, CONFIRMED_SHOW_MS)
      }
    }
  }, [view, asked, confirmedAt, say])

  const send: Send = useCallback(async (path, body = {}) => {
    try {
      const r = await post<{ delivered?: Record<string, boolean> }>(path, body)
      const failed = Object.entries(r.delivered ?? {}).filter(([, ok]) => !ok).map(([d]) => d)
      if (failed.length) toast(`Saved, but the relay board didn't confirm: ${failed.join(', ')}. Is it connected (USB or Wi-Fi)?`, 'fault')
      window.setTimeout(reload, 120)
    } catch (e) {
      toast((e as Error).message, 'fault')
    }
  }, [toast, reload])

  const ask = useCallback((id: string, want: boolean) => {
    const at = Date.now()
    setNow(at)
    setAsked((a) => ({ ...a, [id]: { want, at } }))
    setConfirmedAt((c) => { const n = { ...c }; delete n[id]; return n })
    const name = viewRef.current?.devices.find((d) => d.id === id)?.name ?? id
    say(`asked: ${name} ${want ? 'ON' : 'OFF'}`, 'waiting')
    // the log says so once when the window ran out and the board never agreed
    window.setTimeout(() => {
      const cur = askedRef.current[id]
      if (cur && cur.at === at) {
        const d = viewRef.current?.devices.find((x) => x.id === id)
        if (!d || d.link === 'virtual' || d.hardware_on !== want) say(`asked, no report: ${name} ${want ? 'ON' : 'OFF'}`, 'fault')
      }
    }, ASK_WINDOW_MS + 100)
  }, [say])

  const actions = useMemo<RoomActions>(() => ({
    press: async (id, on) => { ask(id, on); await send(`/api/limbs/${encodeURIComponent(id)}`, { action: on ? 'on' : 'off' }) },
    scene: async (modeId) => {
      const v = viewRef.current
      const m = v?.modes.find((x) => x.id === modeId)
      // only a channel the board reports can answer an ask; one it does not report keeps its WAITING word instead of a false FAULT
      if (v && m) for (const d of v.devices) if (d.id in m.resolved && d.hardware_on !== null && d.hardware_on !== m.resolved[d.id]) ask(d.id, !!m.resolved[d.id])
      say(`mode: ${m?.name ?? modeId}`, 'waiting')
      await send(`/api/limbs/scene/${encodeURIComponent(modeId)}`)
    },
    allOff: async () => {
      const v = viewRef.current
      if (!v) return
      const on = v.devices.filter((d) => d.hardware_on === true)
      for (const d of on) ask(d.id, false)
      say(`all off: ${on.length} channel${on.length === 1 ? '' : 's'}`, 'waiting')
      if (v.modes.some((m) => m.id === 'all_off')) await send('/api/limbs/scene/all_off')
      else for (const d of on) await send(`/api/limbs/${encodeURIComponent(d.id)}`, { action: 'off' })
    },
    send,
    reload,
  }), [ask, say, send, reload])

  const setHeavy = useCallback((next: HeavyFlags) => { setHeavyState(next); saveHeavy(next) }, [])

  return { view, loading, now, asked, confirmedAt, log, heavy, setHeavy, actions }
}

/* ------------------------------------------------------------------------------------------------ the rules' data */

export interface RulesLive {
  presence: PresenceOnView | null
  presenceDown: boolean
  energy: EnergyView | null
  energyDown: boolean
  away: AwayStatus | null
  awayDown: boolean
  incidents: Incident[]
  act: {
    presence: (c: Partial<PresenceOnView['settings']>) => Promise<void>
    autoOff: (enabled: boolean) => Promise<void>
    keepNudge: (id: string) => Promise<void>
    markCircuit: (id: string, on: boolean) => Promise<void>
    arm: () => Promise<void>
    disarm: () => Promise<void>
    autoArm: (on: boolean) => Promise<void>
  }
}

/** The three rule sources, each polled as its classic card polled it (presence 10 s, energy 5 s, away 1 s, incidents 20 s). */
export function useRoomRules(): RulesLive {
  const toast = useStore((s) => s.toast)
  const lastEnergy = useStore((s) => s.events.findLast((e) => e.source === 'energy' || e.source === 'limbs')?.id)
  const lastSec = useStore((s) => s.events.findLast((e) => e.source === 'security')?.id)
  const [presence, pLoading, reloadP] = usePoll(() => api<PresenceOnView>('/api/limbs/presence-on'), 10000)
  const [energy, eLoading, reloadE] = usePoll(() => api<EnergyView>('/api/energy?period=day'), 5000)
  const [away, aLoading, reloadA] = usePoll(() => api<AwayStatus>('/api/security'), 2000)
  const [incidents, , reloadI] = usePoll(() => api<Incident[]>('/api/security/incidents?limit=3'), 20000)
  useEffect(() => { reloadE() }, [lastEnergy]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reloadA(); reloadI() }, [lastSec]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = useCallback(async (fn: () => Promise<unknown>, after: () => void, ok?: string) => {
    try { await fn(); if (ok) toast(ok, 'live'); after() } catch (e) { toast((e as Error).message, 'fault') }
  }, [toast])

  const act = useMemo<RulesLive['act']>(() => ({
    presence: (c) => run(() => post('/api/limbs/presence-on/settings', c), reloadP),
    autoOff: (enabled) => run(() => post('/api/energy/auto-off', { enabled }), reloadE),
    keepNudge: (id) => run(() => post(`/api/energy/nudges/${encodeURIComponent(id)}/keep`, {}), reloadE, 'Kept on: no automatic switch-off this time.'),
    markCircuit: (id, on) => run(() => post(`/api/energy/circuits/${encodeURIComponent(id)}/state`, { on }), reloadE),
    arm: () => run(() => post('/api/security/arm', { by: 'app' }), reloadA, 'Away mode armed'),
    disarm: () => run(() => post('/api/security/disarm'), reloadA, 'Away mode disarmed'),
    autoArm: (on) => run(() => api('/api/security/config', { method: 'PUT', body: { auto_arm: on } }), reloadA),
  }), [run, reloadP, reloadE, reloadA])

  return {
    presence, presenceDown: !pLoading && !presence,
    energy, energyDown: !eLoading && !energy,
    away, awayDown: !aLoading && !away,
    incidents: incidents ?? [],
    act,
  }
}

export { clock24 }

/** Only the two sources the day ring reads (the presence rule's quiet hours and the auto-off's night), for the Switches view. */
export function useRuleWindows(): { presence: PresenceOnView | null; energy: EnergyView | null } {
  const [presence] = usePoll(() => api<PresenceOnView>('/api/limbs/presence-on'), 30000)
  const [energy] = usePoll(() => api<EnergyView>('/api/energy?period=day'), 30000)
  return { presence, energy }
}
