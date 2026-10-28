/**
 * The wall box: the ESP32-S3 driving three two-channel relay modules at the switchboard.
 * Everything shown is what the app reports (GET /api/limbs): the ceiling lights up from the
 * board's OWN relay report, never from a wish. Switching, modes and test clicks go through
 * the same routes as the device cards (Limbs is the one writer); each click is confirmed
 * only when the board's STATUS shows it.
 */
import { Cable, MonitorSpeaker, Zap } from 'lucide-react'
import { useState } from 'react'
import { post } from '../lib/api'
import type { LimbsView } from '../lib/limbs'
import { ceilingState, channelRows, clickSummary, isWallBox, lcdRow1, lcdRow2, voiceLines, type ClickReceipt } from '../lib/wallbox'
import { useStore } from '../lib/store'

const COLOR: Record<string, string> = { light: '#e9f3ff', fan: '#5aa9e6', light2: '#ffb347', light3: '#ffb347', light4: '#ff5fa8', light5: '#ff5fa8' }
const OFF = 'rgba(255,255,255,0.16)'
const MISSING = 'rgba(255,120,120,0.35)'

export function WallBox({ view, send, reload }: { view: LimbsView | null; send: (p: string, b?: unknown) => Promise<void>; reload: () => void }) {
  const toast = useStore((s) => s.toast)
  const [receipts, setReceipts] = useState<Record<string, { text: string; ok: boolean; at: number }>>({})
  const [busy, setBusy] = useState<string | null>(null)
  if (!view) return null
  if (!isWallBox(view)) {
    return (
      <section className="card wallbox">
        <div className="card-head"><span className="card-title"><Zap size={15} strokeWidth={1.8} style={{ marginRight: 8 }} />Wall box · ESP32-S3 + 3 relay modules</span></div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Not active: the devices are on the Arduino Uno. To hand them to the ESP32, copy <span className="mono">app/jarvis_app/devices.esp32-box.example.json</span> to
          <span className="mono"> data/app/devices.json</span> (and the modes file beside it), then restart JARVIS.
        </p>
      </section>
    )
  }
  const rows = channelRows(view.devices)
  const lit = ceilingState(rows)
  const esp = view.esp32 ?? null
  const click = async (id: string) => {
    setBusy(id)
    try {
      const r = await post<ClickReceipt>(`/api/limbs/${encodeURIComponent(id)}/test`)
      const s = clickSummary(r)
      setReceipts((m) => ({ ...m, [id]: { ...s, at: Date.now() } }))
      toast(`${id}: ${s.text}`, s.ok ? 'live' : 'fault')
      reload()
    } catch (e) {
      const text = (e as Error).message
      setReceipts((m) => ({ ...m, [id]: { text, ok: false, at: Date.now() } }))
      toast(text, 'fault')
    } finally { setBusy(null) }
  }
  const stroke = (id: string) => (lit[id] === null ? MISSING : lit[id] ? COLOR[id] : OFF)
  return (
    <section className="card wallbox">
      <div className="card-head">
        <span className="card-title"><Zap size={15} strokeWidth={1.8} style={{ marginRight: 8 }} />Wall box · ESP32-S3 + 3 relay modules</span>
        <span className={`pill ${esp?.connected ? 'live' : 'sim'}`}><i className="led" />{esp?.connected ? esp.how : 'board offline'}</span>
      </div>
      {esp && !esp.connected && <p className="wiring-p fault" style={{ margin: 0 }}>{esp.text}</p>}
      {!!esp?.missing_channels.length && <p className="wiring-p fault" style={{ margin: 0 }}>Not on the board: {esp.missing_channels.join(', ')} (flash the firmware whose RELAY_TABLE has them).</p>}
      {!!esp?.pin_mismatch.length && <p className="wiring-p fault" style={{ margin: 0 }}>
        Pins differ: {esp.pin_mismatch.map((m) => `${m.device} is GPIO ${m.board} on the board, ${m.devices_json} in devices.json`).join('; ')}.</p>}

      <div className="wallbox-grid">
        <div className="wallbox-ceiling">
          <svg viewBox="0 0 420 420" role="img" aria-label="The ceiling: which coves and lights are on, from the board's own report" style={{ width: '100%', height: 'auto', display: 'block' }}>
            <rect x="0" y="0" width="420" height="420" rx="10" fill="rgba(255,255,255,0.03)" />
            <rect x="22" y="22" width="376" height="376" rx="4" fill="none" stroke={stroke('light4')} strokeWidth="7" data-id="light4" />
            <circle cx="210" cy="210" r="168" fill="none" stroke={stroke('light2')} strokeWidth="7" data-id="light2" />
            <rect x="98" y="98" width="224" height="224" rx="3" fill="none" stroke={stroke('light5')} strokeWidth="6" data-id="light5" />
            <rect x="118" y="118" width="184" height="184" rx="3" fill="none" stroke={stroke('light3')} strokeWidth="6" data-id="light3" />
            <g data-id="light">
              <rect x="150" y="150" width="120" height="120" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" strokeDasharray="4 4" />
              {[[172, 172], [248, 172], [172, 248], [248, 248]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="11" fill={stroke('light')} />)}
            </g>
            <g transform="translate(210 210)" data-id="fan" style={{ animation: lit.fan ? 'spin 1.2s linear infinite' : 'none', transformOrigin: '210px 210px' }}>
              <circle r="9" fill={stroke('fan')} />
              {[0, 120, 240].map((a) => <rect key={a} x="-4" y="-34" width="8" height="26" rx="4" fill={stroke('fan')} transform={`rotate(${a})`} />)}
            </g>
            <g fontSize="10" fill="rgba(255,255,255,0.45)" fontFamily="var(--f-mono)">
              <text x="30" y="16">L4 pink outer</text>
              <text x="300" y="45" textAnchor="end">L2 warm outer</text>
              <text x="104" y="92">L5 pink inner</text>
              <text x="124" y="113">L3 warm inner</text>
              <text x="210" y="290" textAnchor="middle">L1 white ×4 · fan</text>
            </g>
          </svg>
          <div className="wallbox-lcd" aria-label="What the box's 16x2 display shows">
            <MonitorSpeaker size={13} />
            <pre>{lcdRow1(rows)}{'\n'}{lcdRow2(esp)}</pre>
          </div>
        </div>

        <div className="wallbox-side">
          <div className="wallbox-modes" role="group" aria-label="Modes">
            {view.modes.map((m) => (
              <button key={m.id} className={`btn sm ${view.last_mode === m.id ? 'primary' : ''}`} aria-pressed={view.last_mode === m.id}
                title={m.detail} onClick={() => void send(`/api/limbs/scene/${encodeURIComponent(m.id)}`)}>{m.name}</button>
            ))}
          </div>
          <table className="wallbox-table">
            <thead><tr><th>Module</th><th>Relay</th><th>GPIO</th><th>Pin (board's report)</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const rc = receipts[r.id]
                return (
                  <tr key={r.id} className={!r.present ? 'missing' : ''}>
                    <td className="mono">{r.module} · {r.input}</td>
                    <td>
                      <button className="wallbox-name" disabled={!r.present} aria-pressed={r.on} onClick={() => void send(`/api/limbs/${r.id}`, { action: r.on ? 'off' : 'on' })}>
                        <i style={{ background: stroke(r.id) }} />{r.name}<span className="mono muted"> {r.id}</span>
                      </button>
                    </td>
                    <td className="mono">{r.gpio ?? '—'}</td>
                    <td className="mono">{!r.present ? 'not in devices.json' : r.hardwareOn === null ? (esp?.connected ? 'not wired' : 'offline') : r.hardwareOn ? 'ON' : 'off'}{r.present && r.confirmed ? ' ✓' : ''}</td>
                    <td>
                      <button className="btn sm" disabled={!r.present || !esp?.connected || busy !== null} onClick={() => void click(r.id)}>
                        <Cable size={12} />{busy === r.id ? 'clicking…' : 'Test click'}
                      </button>
                      {rc && <div className={`wallbox-receipt ${rc.ok ? '' : 'fault'}`}>{rc.text}</div>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            A test click flips the pin for 1 s and puts it back; it counts only when the board confirms both steps. The board confirms its own pin, not the relay: watch the module's LED and listen for the click. No power LED on a module means its 5 V or GND is not arriving.
            Wall switches OFF so JARVIS is in charge; a light that is on with its relay off has its wire on NC.
          </p>
          <details className="wallbox-voice">
            <summary>What to say</summary>
            <table className="wallbox-table"><tbody>
              {voiceLines(view.devices, view.modes).map((l) => <tr key={l.say}><td>{l.say}</td><td className="muted">{l.does}</td></tr>)}
            </tbody></table>
          </details>
        </div>
      </div>
    </section>
  )
}
