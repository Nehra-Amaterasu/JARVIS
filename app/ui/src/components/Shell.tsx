/**
 * The frame around every tab: frameless title bar, the dock, the event ticker,
 * toasts. Each element earns its place:
 *   - the core chip in the title bar is JARVIS's state, visible from every tab
 *   - the VRAM meter shows the one resource that decides whether JARVIS works
 *   - the ticker is the only place every subsystem reports to, in order
 */
import {
  Activity, AudioLines, Award, BookOpen, BrainCircuit, Cable, CalendarDays, Dumbbell, Flame, Gauge, Hand, Layers, Map, Maximize2, Minus,
  ScanEye, Search, ShieldCheck, ShoppingBag, Skull, SlidersHorizontal, Swords, Terminal, Trophy, X,
} from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { TABS, useStore, type Tab } from '../lib/store'
import { clock, fmtGb, useNow } from '../lib/format'
import type { CoreState } from '../lib/api'

declare global {
  interface Window {
    pywebview?: { api: { minimize: () => void; toggle_maximize: () => Promise<boolean>; close: () => void } }
  }
}

const ICONS: Record<Tab, typeof AudioLines> = {
  core: AudioLines, yaadash: BrainCircuit, aankhen: ScanEye, limbs: Hand, connect: Cable, system: Gauge,
  mission: Trophy, quests: Swords, campaign: Map, trials: Award, drill: Layers, armory: ShoppingBag, crucible: Flame, forge: Dumbbell, syllabus: BookOpen, terminal: Terminal,
  interrogation: Skull, proof: ShieldCheck, schedule: CalendarDays, calibration: SlidersHorizontal,
  status: Activity,
}

export const STATE_LABEL: Record<CoreState, string> = {
  offline: 'Offline', booting: 'Waking', sleeping: 'Asleep', idle: 'Ready', listening: 'Listening',
  transcribing: 'Transcribing', thinking: 'Thinking', replying: 'Replying', speaking: 'Speaking',
  followup: 'Listening for more',
}

export function stateTone(s: CoreState | undefined): 'live' | 'fault' | 'idle' | 'off' {
  if (!s || s === 'offline') return 'off'
  if (['listening', 'transcribing', 'thinking', 'replying', 'speaking', 'followup'].includes(s)) return 'live'
  return 'idle'
}

/* ------------------------------------------------------------------ title bar */
export function TitleBar() {
  const core = useStore((s) => s.core)
  const vitals = useStore((s) => s.vitals)
  const setPalette = useStore((s) => s.setPalette)
  const now = useNow(1000)
  const gpu = vitals?.gpu
  const vramPct = gpu ? (gpu.mem_used_mb / gpu.mem_total_mb) * 100 : 0
  const tone = stateTone(core?.state)
  const inApp = !!window.pywebview

  return (
    <header className="titlebar pywebview-drag-region">
      <div className="tb-left">
        <span className="wordmark display">Jarvis</span>
        <span className={`core-chip ${tone}`} title={core?.status_line || 'JARVIS state'}>
          <i className="led" />
          {core ? STATE_LABEL[core.state] ?? core.state : 'Connecting'}
          {core?.running && core.stt?.device === 'cpu' && <em title={core.stt.gpu_error ?? ''}>voice on CPU (GPU unavailable)</em>}
          {core?.running && core.mode && <em>{core.mode}</em>}
        </span>
      </div>

      <button className="tb-search" onClick={() => setPalette(true)}>
        <Search size={14} strokeWidth={2} />
        <span>Search memory, run a command…</span>
        <kbd>Ctrl K</kbd>
      </button>

      <div className="tb-right">
        <div className="vram" title={gpu ? `${gpu.name}: ${gpu.mem_used_mb} / ${gpu.mem_total_mb} MB` : 'GPU not readable'}>
          <span className="eyebrow">VRAM</span>
          <div className="vram-bar">
            <i style={{ width: `${vramPct}%` }} className={vramPct > 92 ? 'hot' : ''} />
          </div>
          <span className="mono">{gpu ? `${fmtGb(gpu.mem_used_mb)}/${fmtGb(gpu.mem_total_mb, 0)}G` : '—'}</span>
        </div>
        <span className="tb-clock dot">{clock(now / 1000).slice(0, 5)}</span>
        {inApp && (
          <div className="winctl">
            <button aria-label="Minimise" onClick={() => window.pywebview?.api.minimize()}><Minus size={13} /></button>
            <button aria-label="Maximise" onClick={() => void window.pywebview?.api.toggle_maximize()}><Maximize2 size={11} /></button>
            <button aria-label="Close" className="close" onClick={() => window.pywebview?.api.close()}><X size={13} /></button>
          </div>
        )}
      </div>
    </header>
  )
}

/* ------------------------------------------------------------------ dock */
export function Dock() {
  const tab = useStore((s) => s.tab)
  const setTab = useStore((s) => s.setTab)
  const core = useStore((s) => s.core)
  return (
    <nav className="dock glass-thin" aria-label="Sections">
      {TABS.filter((t) => t.dock).map((t, i, arr) => {
        const Icon = ICONS[t.id]
        const missionTab = TABS.find((x) => x.id === tab)?.group === 'mission'
        // Well Wisher sub-pages (Terminal, Proof...) light the group's Command icon.
        const on = tab === t.id || (t.id === 'mission' && missionTab && !arr.some((x) => x.id === tab))
        return (
          <div key={t.id} className="dock-slot">
            {i > 0 && arr[i - 1].group !== t.group && <span className="dock-divider mono">well wisher</span>}
            <button className={`dock-item ${on ? 'on' : ''}`} onClick={() => setTab(t.id)}
              aria-current={on ? 'page' : undefined}>
              <span className="dock-icon"><Icon size={18} strokeWidth={1.75} /></span>
              <span className="dock-label">{t.title}</span>
              {t.id === 'core' && core?.running && <i className={`dock-led ${stateTone(core.state)}`} />}
            </button>
          </div>
        )
      })}
      <div className="dock-spacer" />
      <span className="dock-ver mono">v1.0</span>
    </nav>
  )
}

/* ------------------------------------------------------------------ ticker */
const SOURCE_TAG: Record<string, string> = {
  core: 'CORE', aankhen: 'EYES', memory: 'MEM', limbs: 'LIMB', system: 'SYS', mission: 'WISH',
}

export function Ticker() {
  const events = useStore((s) => s.events)
  const online = useStore((s) => s.eventsOnline)
  const recent = useMemo(() => events.slice(-14).reverse(), [events])
  return (
    <footer className="ticker">
      <span className={`ticker-live ${online ? 'on' : ''}`}>
        <i />{online ? 'LIVE' : 'OFFLINE'}
      </span>
      <div className="ticker-track">
        {recent.length === 0 && <span className="muted mono">Nothing has happened yet.</span>}
        {recent.map((e, i) => (
          <span key={e.id} className={`tick ${i === 0 ? 'newest' : ''} ${e.sim ? 'sim' : ''} ${e.kind === 'error' ? 'fault' : ''}`}>
            <b>{SOURCE_TAG[e.source] ?? e.source.toUpperCase()}</b>
            {e.text}
            <time>{clock(e.ts)}</time>
          </span>
        ))}
      </div>
    </footer>
  )
}

/* ------------------------------------------------------------------ toasts */
export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast glass ${t.tone}`}>
          <i className="led" />
          {t.text}
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ page header */
export function PageHeader({ tab, right }: { tab: Tab; right?: React.ReactNode }) {
  const meta = TABS.find((t) => t.id === tab)!
  return (
    <div className="page-head">
      <div>
        <div className="ph-meta">
          <span className="mono ph-n">{meta.n}</span>
          <span className="ph-rule" />
          <span className="eyebrow">{meta.sub}</span>
        </div>
        <h1 className="display ph-title">
          <span className="chrome-text">{meta.title}</span>
        </h1>
      </div>
      {right && <div className="ph-right">{right}</div>}
    </div>
  )
}

/** Keyboard: Ctrl K palette, Ctrl 1-6 tabs. */
export function useHotkeys() {
  const setPalette = useStore((s) => s.setPalette)
  const setTab = useStore((s) => s.setTab)
  const ref = useRef({ setPalette, setTab })
  ref.current = { setPalette, setTab }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        ref.current.setPalette(true)
      }
      if ((e.ctrlKey || e.metaKey) && /^[1-6]$/.test(e.key)) {
        e.preventDefault()
        ref.current.setTab(TABS[Number(e.key) - 1].id)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault()
        ref.current.setTab('mission')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
