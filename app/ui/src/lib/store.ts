/**
 * App-wide state. Small on purpose: each tab fetches its own data; only what more
 * than one place needs lives here — the current tab, JARVIS's state, the live
 * event stream, system vitals, and the transient toasts.
 */
import { create } from 'zustand'
import { api, openSocket, type BusEvent, type CoreInfo, type Turn, type Vitals } from './api'
import { switchView } from './motion'

export type Tab =
  | 'core' | 'yaadash' | 'aankhen' | 'limbs' | 'connect' | 'system'
  // Mission Germoney (src/germoney): the whole phone app, as tabs.
  | 'mission' | 'quests' | 'campaign' | 'trials' | 'drill' | 'armory'
  | 'crucible' | 'forge' | 'syllabus' | 'terminal' | 'interrogation' | 'proof' | 'schedule' | 'calibration'

export const TABS: { id: Tab; n: string; title: string; sub: string; group: 'jarvis' | 'mission'; dock?: boolean }[] = [
  { id: 'core', n: '01', title: 'Core', sub: 'JARVIS himself — wake him, talk, watch him think.', group: 'jarvis', dock: true },
  { id: 'yaadash', n: '02', title: 'Yaadash', sub: 'Memory — every conversation, every person, every taste.', group: 'jarvis', dock: true },
  { id: 'aankhen', n: '03', title: 'Aankhen', sub: 'Eyes — the room in 3D, sensed through Wi-Fi alone: no radar, no camera.', group: 'jarvis', dock: true },
  { id: 'limbs', n: '04', title: 'Limbs', sub: 'Hands — what JARVIS can switch in the room.', group: 'jarvis', dock: true },
  { id: 'connect', n: '05', title: 'Connect', sub: 'His brain, his voice, modules for a moment, fresh memory. Choose and test.', group: 'jarvis', dock: true },
  { id: 'system', n: '06', title: 'System', sub: 'Is he answering you, and how fast. Fix it from here.', group: 'jarvis', dock: true },
  { id: 'mission', n: 'M1', title: 'Today', sub: 'Contracts, schedule and deadlines for today.', group: 'mission', dock: true },
  { id: 'quests', n: 'M2', title: 'Contracts', sub: 'Now part of Today.', group: 'mission' },
  { id: 'campaign', n: 'M3', title: 'Road', sub: 'Campaigns, internships, certificates, Germany.', group: 'mission', dock: true },
  { id: 'trials', n: 'M4', title: 'Trials', sub: 'Now part of Road.', group: 'mission' },
  { id: 'drill', n: 'M5', title: 'Drill', sub: 'Now part of Focus.', group: 'mission' },
  { id: 'armory', n: 'M6', title: 'Armory', sub: 'Now part of Road.', group: 'mission' },
  { id: 'crucible', n: 'M7', title: 'Focus', sub: 'Deep work and spaced review.', group: 'mission', dock: true },
  { id: 'forge', n: 'M8', title: 'Forge', sub: 'Now part of Log.', group: 'mission' },
  { id: 'syllabus', n: 'M9', title: 'Tree', sub: 'The skill tree: what to learn next and why.', group: 'mission', dock: true },
  { id: 'terminal', n: 'M10', title: 'Log', sub: 'Log hours, proof and anything you learned.', group: 'mission', dock: true },
  { id: 'interrogation', n: 'M11', title: 'Interrogation', sub: 'Now part of Log.', group: 'mission' },
  { id: 'proof', n: 'M12', title: 'Proof', sub: 'Now part of Log.', group: 'mission' },
  { id: 'schedule', n: 'M13', title: 'Schedule', sub: 'Now part of Today.', group: 'mission' },
  { id: 'calibration', n: 'M0', title: 'Settings', sub: 'Exams, profile and calibration.', group: 'mission' },
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
  /** The firmware job's latest progress (board_ctl.py publishes it ephemeral, ~4 Hz):
   *  kept here for the Limbs tab, never in the ticker. */
  boardProgress: BusEvent | null
  refreshCore: () => Promise<void>
  refreshVitals: () => Promise<void>
}

let toastId = 0

export const useStore = create<Store>((set, get) => ({
  tab: (sessionStorage.getItem('jarvis.tab') as Tab) || 'core',
  setTab: (tab) => {
    if (get().tab === tab) return
    sessionStorage.setItem('jarvis.tab', tab)
    switchView(() => set({ tab }))          // the page morphs instead of cutting
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
  boardProgress: null,
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
      if (ev.source === 'board' && ev.kind === 'progress') {
        st.setState({ boardProgress: ev })
        return
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
