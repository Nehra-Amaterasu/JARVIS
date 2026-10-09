/**
 * Limbs: what JARVIS can switch. The glyph IS the reading: the bulb's glow is the
 * brightness, the fan's rotor turns at the set speed. Controls go through the same
 * room.apply() as voice commands, so this page and JARVIS can't disagree.
 */
import { Fan, Focus, Lightbulb, Moon, Sunrise, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, post } from '../lib/api'
import { usePoll } from '../lib/format'
import { useStore } from '../lib/store'
import { PageHeader } from '../components/Shell'

interface Device {
  id: string; name: string; kind: 'light' | 'fan'; unit: string; mains: boolean; note: string
  state: { on: boolean; level: number } | null; link: 'mqtt' | 'virtual' | 'offline'
}
interface View { devices: Device[]; scenes: { id: string; name: string; detail: string }[]; core_running: boolean; mqtt: boolean | null; hardware: string }

const SCENE_ICON: Record<string, typeof Focus> = { focus: Focus, relaxation: Sunrise, sleep: Moon }

export function LimbsPage() {
  const core = useStore((s) => s.core)
  const toast = useStore((s) => s.toast)
  const [view, , reload] = usePoll(() => api<View>('/api/limbs'), 3000)
  useEffect(() => { reload() }, [core?.room]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (path: string, body: unknown = {}) => {
    try {
      await post(path, body)
      window.setTimeout(reload, 150)
    } catch (e) {
      toast((e as Error).message, 'fault')
    }
  }
  const running = !!view?.core_running
  return (
    <div className="page fade-in">
      <PageHeader tab="limbs" right={<span className={`pill ${view?.mqtt ? 'live' : ''}`}><i className="led" />{view?.mqtt ? 'MQTT bus' : 'virtual room'}</span>} />
      {!running && (
        <div className="banner">
          <TriangleAlert size={16} />
          <span style={{ flex: 1 }}>JARVIS is asleep. The room’s state lives in JARVIS, so wake him (text mode is enough) to switch things here.</span>
          <button className="btn sm primary" onClick={() => void send('/api/core/start', { mode: 'text' })}>Wake in text mode</button>
        </div>
      )}
      <div className="banner sim">
        <span className="pill sim"><i className="led" />virtual</span>
        {view?.hardware ?? '…'} When the relay board is wired, the same switches drive it over MQTT.
      </div>
      <div className="limbs-grid">
        {view?.devices.map((d) => <DeviceCard key={d.id} d={d} disabled={!running} send={send} />)}
      </div>
      <div className="scenes">
        {view?.scenes.map((s) => {
          const Icon = SCENE_ICON[s.id] ?? Focus
          return (
            <button key={s.id} className="scene card" disabled={!running} onClick={() => void send(`/api/limbs/scene/${s.id}`)}>
              <Icon size={20} strokeWidth={1.6} />
              <b>{s.name}</b>
              <span>{s.detail}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function DeviceCard({ d, disabled, send }: { d: Device; disabled: boolean; send: (p: string, b?: unknown) => Promise<void> }) {
  const on = !!d.state?.on
  const level = d.state?.level ?? 0
  const [local, setLocal] = useState<number | null>(null)
  const shown = local ?? level
  return (
    <section className="card device">
      <div className="device-top">
        <div>
          <div className="device-name">{d.name}</div>
          <div className="mono muted" style={{ marginTop: 4 }}>{d.id} · {d.link}</div>
        </div>
        <button className={`switch ${on ? 'on' : ''}`} disabled={disabled} aria-pressed={on}
          aria-label={`${d.name} power`} onClick={() => void send(`/api/limbs/${d.id}`, { action: on ? 'off' : 'on' })} />
      </div>
      <div className="device-glyph">
        {d.kind === 'light' ? <Bulb on={on} level={shown} /> : <Rotor on={on} level={shown} />}
      </div>
      <div className="device-level">
        <span className="eyebrow">{d.unit}</span>
        <span className="dot">{on ? `${shown}%` : 'OFF'}</span>
      </div>
      <input type="range" className="slider" min={10} max={100} step={5} value={shown} disabled={disabled}
        style={{ ['--pct' as string]: `${((shown - 10) / 90) * 100}%` }}
        onChange={(e) => setLocal(Number(e.target.value))}
        onPointerUp={() => { if (local !== null) { void send(`/api/limbs/${d.id}`, { action: 'set', value: local }); setLocal(null) } }} />
      <div className="mono muted" style={{ fontSize: 11 }}>
        {d.mains && <span className="mains">MAINS 230 V · </span>}{d.note}
      </div>
    </section>
  )
}

/** The bulb's halo opacity and size ARE the brightness. */
function Bulb({ on, level }: { on: boolean; level: number }) {
  const k = on ? level / 100 : 0
  return (
    <>
      <span className="halo" style={{
        background: `radial-gradient(circle, rgba(255,236,190,${0.55 * k}) 0%, rgba(255,214,140,${0.18 * k}) 45%, transparent 70%)`,
        transform: `scale(${0.6 + 0.6 * k})`,
      }} />
      <Lightbulb size={64} strokeWidth={1.1} color={on ? `rgba(255,240,210,${0.5 + 0.5 * k})` : 'rgba(255,255,255,0.25)'} />
    </>
  )
}

/** The rotor turns at the fan's set speed (period 2.4 s at 10 % → 0.25 s at 100 %). */
function Rotor({ on, level }: { on: boolean; level: number }) {
  const period = on ? 2.6 - 2.35 * (level / 100) : 0
  return (
    <span style={{ display: 'grid', placeItems: 'center', animation: on ? `spin ${period}s linear infinite` : 'none' }}>
      <Fan size={68} strokeWidth={1.1} color={on ? 'var(--live)' : 'rgba(255,255,255,0.25)'} />
    </span>
  )
}
