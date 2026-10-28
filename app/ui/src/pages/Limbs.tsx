/**
 * Limbs: what JARVIS can switch. The glyph IS the reading, and it shows only what the
 * relay board confirmed: the bulb glows when the light is on, the fan's rotor spins when
 * the fan is on. The relays only switch (contacts in parallel with the wall switches),
 * so there is no brightness and no speed here: the fan's speed is its wall regulator's.
 *
 * The app owns the room's state (app/jarvis_app/limbs.py), the only writer to the
 * relays: every switch works whether or not JARVIS is awake, drives the Uno over USB,
 * and keeps JARVIS's voice commands in step. "Confirmed by board" (cyan) appears only
 * when the board's OWN report agrees. The devices come from devices.json, so a light
 * wired on D6 later shows up here with no UI change.
 *
 * Modes are on/off sets ("Deep focus" = light on + fan on), editable here and asked
 * for by voice by their name ("Jarvis, deep focus").
 *
 * Below: the presence rule (light and fan back on after an app start when he is
 * there), the ESP32 sensor board, and the Uno relay wiring with a test click per relay.
 */
import { CircuitBoard, Fan, Focus, Lightbulb, Moon, Pencil, Plus, Power, Sunrise, Trash2, UserCheck, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, post } from '../lib/api'
import { usePoll } from '../lib/format'
import { describeSet, draftFrom, draftProblem, linkWord, type LimbsDevice, type LimbsView, type Mode, type PresenceOnView } from '../lib/limbs'
import { useStore } from '../lib/store'
import { PageHeader } from '../components/Shell'
import { BoardPanel } from '../components/BoardPanel'
import { BoardPorts } from '../components/BoardPorts'
import { Esp32LinkCard } from '../components/Esp32LinkCard'
import { FirmwareCard } from '../components/FirmwareCard'
import { RelayWiring } from '../components/RelayWiring'
import { WallBox } from '../components/WallBox'
import { isWallBox } from '../lib/wallbox'
import type { BoardView } from '../lib/board'
import '../styles/board.css'

const MODE_ICON: Record<string, typeof Focus> = { focus: Focus, relaxation: Sunrise, sleep: Moon, all_off: Power }

export function LimbsPage() {
  const toast = useStore((s) => s.toast)
  const events = useStore((s) => s.events)
  const [view, , reload] = usePoll(() => api<LimbsView>('/api/limbs'), 2000)
  const [board, , reloadBoard] = usePoll(() => api<BoardView>('/api/board'), 2000)
  // A voice command ("Hey Jarvis, fan off") arrives as an event: refresh at once.
  const lastRoom = events.filter((e) => e.source === 'limbs').slice(-1)[0]?.id
  useEffect(() => { reload() }, [lastRoom]) // eslint-disable-line react-hooks/exhaustive-deps
  // A compile or flash milestone (or the hub pausing for one): the board view follows at once.
  const lastBoard = events.filter((e) => e.source === 'board' || (e.source === 'aankhen' && e.kind === 'source')).slice(-1)[0]?.id
  useEffect(() => { reloadBoard() }, [lastBoard]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (path: string, body: unknown = {}) => {
    try {
      const r = await post<{ delivered?: Record<string, boolean> }>(path, body)
      const failed = Object.entries(r.delivered ?? {}).filter(([, ok]) => !ok).map(([d]) => d)
      if (failed.length) toast(`Saved, but the relay board didn't confirm: ${failed.join(', ')}. Is it connected (USB or Wi-Fi)?`, 'fault')
      window.setTimeout(reload, 120)
    } catch (e) {
      toast((e as Error).message, 'fault')
    }
  }
  return (
    <div className="page fade-in">
      <PageHeader tab="limbs" right={
        <span className={`pill ${linkWord(view).live ? 'live' : 'sim'}`}><i className="led" />
          {linkWord(view).text}</span>} />
      <div className={`banner ${view?.usb ? '' : 'sim'}`}>
        <CircuitBoard size={16} />
        <span style={{ flex: 1 }}>{view?.hardware ?? '…'}{view?.core_running ? ' Voice commands and these switches stay in sync.' : ' Voice commands sync as soon as JARVIS is awake.'}</span>
      </div>
      {!!view?.problems?.length && <div className="banner sim"><span>{view.problems.join(' · ')}</span></div>}
      <WallBox view={view} send={send} reload={reload} />
      <div className="limbs-grid">
        {view?.devices.map((d) => <DeviceCard key={d.id} d={d} send={send} />)}
      </div>

      {view && <Modes view={view} send={send} reload={reload} />}
      <PresenceRule />

      <h2 className="limbs-section">The boards</h2>
      {!isWallBox(view) && <RelayWiring v={view} onTested={reload} />}
      <div className="board-grid">
        <BoardPanel v={board} reload={reloadBoard} />
        <BoardPorts />
        <Esp32LinkCard />
      </div>
      <FirmwareCard v={board} reload={reloadBoard} />
    </div>
  )
}

function DeviceCard({ d, send }: { d: LimbsDevice; send: (p: string, b?: unknown) => Promise<void> }) {
  const on = !!d.state?.on
  // The glyph follows the board when it reports; the saved state only for a virtual room.
  const linked = d.link !== 'virtual'
  const shown = linked && d.hardware_on !== null ? d.hardware_on : on
  return (
    <section className={`card device ${d.confirmed ? 'confirmed' : ''}`}>
      <div className="device-top">
        <div>
          <div className="device-name">{d.name}</div>
          <div className="mono muted" style={{ marginTop: 4 }}>
            {d.id} · {d.link === 'wifi' ? 'Wi-Fi' : d.link}{linked && (d.confirmed ? ' · confirmed by board' : d.hardware_on === null ? ' · not on the board' : ' · waiting for the board')}
          </div>
        </div>
        <button className={`switch ${on ? 'on' : ''}`} aria-pressed={on} aria-label={`${d.name} power`}
          onClick={() => void send(`/api/limbs/${d.id}`, { action: on ? 'off' : 'on' })} />
      </div>
      <div className="device-glyph">
        {d.kind === 'light' ? <Bulb on={shown} /> : <Rotor on={shown} />}
      </div>
      <div className="device-level">
        <span className="eyebrow">{d.kind === 'light' ? 'light' : 'fan'}</span>
        <span className="dot">{shown ? 'ON' : 'OFF'}</span>
      </div>
      <div className="mono muted" style={{ fontSize: 11 }}>
        <span className="mains">MAINS 230 V · </span>{d.note}
        {d.kind === 'fan' && ' · speed: the wall regulator'}
      </div>
    </section>
  )
}

/** The bulb glows when it is on: a fixed warm halo, no fake brightness. */
function Bulb({ on }: { on: boolean }) {
  return (
    <>
      <span className="halo" style={{
        background: 'radial-gradient(circle, rgba(255,236,190,0.55) 0%, rgba(255,214,140,0.18) 45%, transparent 70%)',
        opacity: on ? 1 : 0, transform: `scale(${on ? 1.2 : 0.6})`,
      }} />
      <Lightbulb size={64} strokeWidth={1.1} color={on ? 'rgba(255,240,210,1)' : 'rgba(255,255,255,0.25)'} />
    </>
  )
}

/** The rotor spins when the fan is on, at one pace: its real speed is on the wall regulator. */
function Rotor({ on }: { on: boolean }) {
  return (
    <span style={{ display: 'grid', placeItems: 'center', animation: on ? 'spin 0.8s linear infinite' : 'none' }}>
      <Fan size={68} strokeWidth={1.1} color={on ? 'var(--live)' : 'rgba(255,255,255,0.25)'} />
    </span>
  )
}

function Modes({ view, send, reload }: { view: LimbsView; send: (p: string, b?: unknown) => Promise<void>; reload: () => void }) {
  const toast = useStore((s) => s.toast)
  const [editing, setEditing] = useState<Mode | 'new' | null>(null)
  const remove = async (m: Mode) => {
    if (!window.confirm(`Delete the mode "${m.name}"?`)) return
    try {
      await api(`/api/limbs/modes/${encodeURIComponent(m.id)}`, { method: 'DELETE' })
      toast(`Deleted ${m.name}`, 'info')
      reload()
    } catch (e) { toast((e as Error).message, 'fault') }
  }
  return (
    <div className="limbs-modes">
      <div className="limbs-modes-head">
        <h2 className="limbs-section" style={{ margin: 0 }}>Modes</h2>
        <span className="muted" style={{ fontSize: 12 }}>On/off sets. Say "Jarvis, &lt;mode name&gt;".</span>
        <button className="btn sm" onClick={() => setEditing('new')}><Plus size={13} />New mode</button>
      </div>
      <div className="scenes">
        {view.modes.map((m) => {
          const Icon = MODE_ICON[m.id] ?? Focus
          return (
            <div key={m.id} className={`scene card mode ${view.last_mode === m.id ? 'last' : ''}`}>
              <button className="mode-run" onClick={() => void send(`/api/limbs/scene/${encodeURIComponent(m.id)}`)}>
                <Icon size={20} strokeWidth={1.6} />
                <b>{m.name}</b>
                <span>{m.detail}</span>
                {view.last_mode === m.id && <em className="mono">last chosen</em>}
              </button>
              <div className="mode-tools">
                <button className="btn ghost sm icon" aria-label={`Edit ${m.name}`} onClick={() => setEditing(m)}><Pencil size={12} /></button>
                <button className="btn ghost sm icon" aria-label={`Delete ${m.name}`} onClick={() => void remove(m)}><Trash2 size={12} /></button>
              </div>
            </div>
          )
        })}
      </div>
      {editing && <ModeEditor key={editing === 'new' ? 'new' : editing.id} mode={editing === 'new' ? null : editing}
        view={view} close={() => setEditing(null)} saved={() => { setEditing(null); reload() }} />}
    </div>
  )
}

function ModeEditor({ mode, view, close, saved }: { mode: Mode | null; view: LimbsView; close: () => void; saved: () => void }) {
  const toast = useStore((s) => s.toast)
  const [name, setName] = useState(mode?.name ?? '')
  const [set, setSet] = useState<Record<string, boolean>>(() => draftFrom(mode, view.devices))
  const problem = draftProblem(name, set, view.modes.filter((m) => m.id !== mode?.id))
  const save = async () => {
    try {
      if (mode) await api(`/api/limbs/modes/${encodeURIComponent(mode.id)}`, { method: 'PUT', body: { name, set } })
      else await post('/api/limbs/modes/new', { name, set })
      toast(`Saved ${name.trim()}`, 'live')
      saved()
    } catch (e) { toast((e as Error).message, 'fault') }
  }
  return (
    <section className="card mode-editor">
      <div className="card-head">
        <span className="card-title">{mode ? `Edit ${mode.name}` : 'New mode'}</span>
        <button className="btn ghost sm icon" aria-label="Close" onClick={close}><X size={13} /></button>
      </div>
      <label className="mode-name">
        <span className="eyebrow">Name (what you say)</span>
        <input value={name} maxLength={32} placeholder="Reading" onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="mode-devices">
        {view.devices.map((d) => (
          <button key={d.id} className={`btn sm ${set[d.id] ? 'live' : ''}`} aria-pressed={!!set[d.id]}
            onClick={() => setSet((s) => ({ ...s, [d.id]: !s[d.id] }))}>
            {d.kind === 'light' ? <Lightbulb size={13} /> : <Fan size={13} />}{d.name}: {set[d.id] ? 'on' : 'off'}
          </button>
        ))}
      </div>
      <div className="mono muted" style={{ fontSize: 11 }}>{describeSet(set, view.devices)}</div>
      {problem && name && <div className="muted" style={{ fontSize: 12 }}>{problem}</div>}
      <div><button className="btn sm" disabled={!!problem} onClick={() => void save()}>Save</button></div>
    </section>
  )
}

function PresenceRule() {
  const toast = useStore((s) => s.toast)
  const [v, , reload] = usePoll(() => api<PresenceOnView>('/api/limbs/presence-on'), 10000)
  if (!v) return null
  const s = v.settings
  const change = async (c: Partial<PresenceOnView['settings']>) => {
    try { await post('/api/limbs/presence-on/settings', c); reload() } catch (e) { toast((e as Error).message, 'fault') }
  }
  return (
    <section className="card presence-rule">
      <div className="card-head">
        <span className="card-title"><UserCheck size={15} strokeWidth={1.8} style={{ marginRight: 8 }} />Back on when I'm here</span>
        <button className={`switch ${s.enabled ? 'on' : ''}`} aria-pressed={s.enabled} aria-label="Presence rule"
          onClick={() => void change({ enabled: !s.enabled })} />
      </div>
      <p className="wiring-p" style={{ marginTop: 0 }}>
        Opening the Uno's port resets it, so the relays are off after every app start. Once per start, for {s.window_min} min,
        the last mode (or light and fan on) comes back when you are here: keyboard or mouse in the last {s.input_s} s, or
        Aankhen's real board sure you are in (p ≥ {s.occupied_p}) for {s.sustain_s} s. Never in quiet hours, and never after
        you have used a switch yourself.
      </p>
      <div className="presence-quiet">
        <span className="eyebrow">Quiet hours</span>
        <input type="time" value={s.quiet_start} aria-label="Quiet hours start" onChange={(e) => void change({ quiet_start: e.target.value })} />
        <span className="muted">to</span>
        <input type="time" value={s.quiet_end} aria-label="Quiet hours end" onChange={(e) => void change({ quiet_end: e.target.value })} />
      </div>
      <div className="mono muted" style={{ fontSize: 11 }}>This start: {v.decision ? v.decision.reason : v.status}</div>
    </section>
  )
}
