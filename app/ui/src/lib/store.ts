/**
 * App-wide state. Small on purpose: each tab fetches its own data; only what more
 * than one place needs lives here — the current tab, JARVIS's state, the live
 * event stream, system vitals, and the transient toasts.
 */
import { create } from 'zustand'
import { api, openSocket, type BusEvent, type CoreInfo, type Turn, type Vitals } from './api'

export type Tab = 'core' | 'yaadash' | 'aankhen' | 'limbs' | 'connect' | 'system'

export const TABS: { id: Tab; n: string; title: string; sub: string }[] = [
  { id: 'core', n: '01', title: 'Core', sub: 'JARVIS himself — wake him, talk, watch him think.' },
  { id: 'yaadash', n: '02', title: 'Yaadash', sub: 'Memory — every conversation, every person, every taste.' },
  { id: 'aankhen', n: '03', title: 'Aankhen', sub: 'Eyes — the room in 3D, sensed through Wi-Fi and radar.' },
  { id: 'limbs', n: '04', title: 'Limbs', sub: 'Hands — what JARVIS can switch in the room.' },
  { id: 'connect', n: '05', title: 'Connect', sub: 'Everything that plugs into JARVIS, detected live.' },
  { id: 'system', n: '06', title: 'System', sub: 'Vitals against the 6 GB ceiling. Models. Logs. Decisions.' },
]

export interface Toast { id: number; text: string; tone: 'live' | 'sim' | 'fault' | 'info' }

interface Store {
  tab: Tab
  setTab: (t: Tab) => void
  core: CoreInfo | null
  turns: Turn[]
  micLevel: number
  micThreshold: number
  events: BusEvent[]
  eventsOnline: boolean
  vitals: Vitals | null
  paletteOpen: boolean
  setPalette: (o: boolean) => void
  /** A memory search requested from elsewhere (the palette), run by Yaadash. */
  pendingQuery: string | null
  setPendingQuery: (q: string | null) => void
  toasts: Toast[]
  toast: (text: string, tone?: Toast['tone']) => void
  refreshCore: () => Promise<void>
  refreshVitals: () => Promise<void>
}

let toastId = 0

export const useStore = create<Store>((set, get) => ({
  tab: (sessionStorage.getItem('jarvis.tab') as Tab) || 'core',
  setTab: (tab) => {
    sessionStorage.setItem('jarvis.tab', tab)
    set({ tab })
  },
  core: null,
  turns: [],
  micLevel: 0,
  micThreshold: 0.04,
  events: [],
  eventsOnline: false,
  vitals: null,
  paletteOpen: false,
  setPalette: (paletteOpen) => set({ paletteOpen }),
  pendingQuery: null,
  setPendingQuery: (pendingQuery) => set({ pendingQuery }),
  toasts: [],
  toast: (text, tone = 'info') => {
    const id = ++toastId
    set({ toasts: [...get().toasts, { id, text, tone }] })
    window.setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 4200)
  },
  refreshCore: async () => {
    try {
      const [core, turns] = await Promise.all([api<CoreInfo>('/api/core'), api<Turn[]>('/api/core/transcript')])
      set({ core, turns })
    } catch {
      /* server not reachable yet */
    }
  },
  refreshVitals: async () => {
    try {
      set({ vitals: await api<Vitals>('/api/system') })
    } catch {
      /* ignore */
    }
  },
}))

/** Connect the event bus once; route events into the store. */
export function startEventStream() {
  const st = useStore
  return openSocket(
    '/ws/events',
    (raw) => {
      const msg = raw as BusEvent & { events?: BusEvent[] }
      if (msg.kind === 'history' && msg.events) {
        st.setState({ events: msg.events.slice(-80) })
        return
      }
      const ev = msg as BusEvent
      const s = st.getState()
      if (ev.source === 'core') {
        if (ev.kind === 'level') {
          st.setState({ micLevel: Number(ev.level) || 0, micThreshold: Number(ev.threshold) || 0.04 })
          return
        }
        if (ev.kind === 'reply_chunk') {
          const turns = s.turns.slice()
          const last = turns[turns.length - 1]
          if (last && last.id === ev.turn_id) {
            turns[turns.length - 1] = { ...last, text: last.text + String(ev.chunk ?? '') }
          } else {
            turns.push({ id: Number(ev.turn_id), role: 'jarvis', text: String(ev.chunk ?? ''), t: ev.ts, done: false })
          }
          st.setState({ turns })
          return
        }
        if (ev.kind === 'turn') {
          const turn = ev.turn as Turn
          const turns = s.turns.filter((t) => t.id !== turn.id)
          turns.push(turn)
          turns.sort((a, b) => a.id - b.id)
          st.setState({ turns: turns.slice(-200) })
        }
        if (ev.kind === 'state' && s.core) {
          st.setState({ core: { ...s.core, state: ev.state as CoreInfo['state'] } })
        }
        if (['starting', 'ready', 'stopped', 'boot', 'error'].includes(ev.kind)) void s.refreshCore()
        if (ev.kind === 'error') s.toast(ev.text || 'JARVIS reported an error', 'fault')
        if (ev.kind === 'ready') s.toast(ev.text, 'live')
      }
      if (ev.source === 'limbs' && (ev.kind === 'room' || ev.kind === 'room_state')) void s.refreshCore()
      if (ev.kind === 'level' || ev.kind === 'reply_chunk' || ev.kind === 'timing' || ev.kind === 'room_state' || ev.kind === 'speech_done') return
      if (!ev.text) return
      st.setState({ events: [...s.events, ev].slice(-120) })
    },
    (state) => {
      useStore.setState({ eventsOnline: state === 'open' })
      if (state === 'open') void useStore.getState().refreshCore()
    },
  )
}
