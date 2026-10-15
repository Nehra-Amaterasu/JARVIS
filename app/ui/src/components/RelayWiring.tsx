/**
 * "Wire your relays" for the Arduino Uno relay board (limbs/uno_relay/uno_relay.ino):
 * the low-voltage side (VCC 5V, GND, IN1 D4, IN2 D5), what active-low means on the
 * module, the mains side (each relay IN PARALLEL with its wall switch), where more
 * channels go (D6, D7, ...), a safety checklist, and a test click per relay.
 *
 * The test click goes through Limbs (POST /api/limbs/{id}/test): 1 s flipped, then put
 * back, the same path and safety gate as the switches, with the Uno's own replies as
 * the receipt. The pins shown are the ones the board's boot banner reported when it
 * did, else devices.json's.
 */
import { AlertTriangle, Check, MousePointerClick, Plug, ShieldAlert, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { post } from '../lib/api'
import { nextUnoPin, type LimbsDevice, type LimbsView } from '../lib/limbs'
import { useStore } from '../lib/store'

const CHECKLIST = [
  'Breaker (MCB) for the circuit is OFF, and a tester shows the wires are dead.',
  'Low-voltage side first: VCC, GND and the IN wires on the Uno, test-clicked with NO mains on the relay.',
  'Relay COM and NO across the wall switch\'s two terminals (in parallel): the switch still works, and either one turns the load on.',
  'On the LIVE wire only, the one the wall switch already breaks: never the neutral, never the earth.',
  'Contacts rated above the load: a 10 A / 250 VAC relay is plenty for a tube light and a ceiling fan.',
  'No bare mains terminals: module in an enclosure, mains wires kept away from the Uno and its jumpers.',
  'Unsure about any of it: an electrician checks it before the breaker goes back on.',
]

interface TestReceipt {
  device: string; ok: boolean; restored: boolean; text: string
  steps: { action: string; delivered: boolean; board_says: boolean | null; ms: number }[]
}

export function RelayWiring({ v, onTested }: { v: LimbsView | null; onTested: () => void }) {
  const [done, setDone] = useState<boolean[]>(() => CHECKLIST.map(() => false))
  const rb = v?.relay_board ?? null
  const uno = (v?.devices ?? []).filter((d) => d.board === 'uno')
  const pinOf = (d: LimbsDevice) => rb?.pins?.[d.id] ?? d.channel
  const next = nextUnoPin(uno.map(pinOf))
  const ready = !!rb?.connected
  return (
    <section className="card wiring">
      <div className="card-head">
        <span className="card-title"><Plug size={15} strokeWidth={1.8} style={{ marginRight: 8 }} />Wire your relays · Arduino Uno</span>
        <span className="pill fault"><ShieldAlert size={11} />mains 230 V can kill</span>
      </div>

      <div className="wiring-grid">
        <div>
          <div className="eyebrow">Relay module → Uno (low-voltage side)</div>
          <table className="wiring-table mono">
            <thead><tr><th>Module</th><th>Uno pin</th><th>Why</th></tr></thead>
            <tbody>
              <tr><td>VCC</td><td>5V</td><td>the relay coils need 5 V; the Uno's 5V pin carries USB's 5 V</td></tr>
              <tr><td>GND</td><td>GND</td><td>shared ground: without it the IN signal means nothing</td></tr>
              {uno.map((d, i) => (
                <tr key={d.id}><td>IN{i + 1}</td><td className="live">D{pinOf(d)}</td><td>{d.name.toLowerCase()} ({d.id})</td></tr>
              ))}
            </tbody>
          </table>
          <p className="wiring-p">
            <b>Active-low</b>: a relay is ON when its IN pin is pulled <b>LOW</b>, and the module's LED lights. The firmware
            sets every pin HIGH (off) before making it an output, so nothing clicks at boot. Keep the yellow jumper on the
            module's VCC-JDVCC pins.
          </p>
          <p className="wiring-p">
            <b>More channels</b> go on the next free pins: {next !== null ? <><b>D{next}</b>{next < 13 ? `, then D${next + 1}` : ''}</> : 'no free pin left'}, ...
            (never D0/D1, the Uno's USB link). Each one is a row in uno_relay.ino's pin table (firmware 1.1.0) and a line
            in devices.json, with the same id; then flash the Uno once (flashing resets it, and the relays go off).
          </p>
          {!!rb?.missing_channels?.length && (
            <p className="wiring-p fault">Configured but not on the flashed board: {rb.missing_channels.join(', ')}. The board runs firmware {rb.version ?? '?'}.</p>
          )}
          <div className="eyebrow" style={{ marginTop: 14 }}>Mains side (breaker OFF)</div>
          <p className="wiring-p">
            Each relay goes <b>in parallel with its wall switch</b>: one wire from the switch's input terminal to the relay's
            <b> COM</b>, one from its output terminal to <b>NO</b>. NC stays empty. The wall switch keeps working by hand, and
            JARVIS can switch the load on while the wall switch is off. To be sure a load is off, both must be off.
          </p>
        </div>

        <div>
          <div className="eyebrow">Before the breaker goes back on</div>
          <ul className="wiring-check">
            {CHECKLIST.map((t, i) => (
              <li key={i}>
                <button className={`check ${done[i] ? 'on' : ''}`} aria-pressed={done[i]}
                  onClick={() => setDone((d) => d.map((x, j) => (j === i ? !x : x)))}>
                  <span className="box">{done[i] && <Check size={11} strokeWidth={3} />}</span><span>{t}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="eyebrow" style={{ marginTop: 14 }}>Test click</div>
          <div className="wiring-tests">
            {uno.map((d) => <TestButton key={d.id} device={d.id} pin={pinOf(d)} ready={ready} onTested={onTested} />)}
          </div>
          {!ready && <div className="muted wiring-note">Test clicks need the Uno on USB{rb?.error ? `: ${rb.error}` : '.'}</div>}
        </div>
      </div>

      <div className="wiring-later">
        <div className="eyebrow"><Zap size={11} /> Later: back to the ESP32's relays</div>
        <ol>
          <li>When the breadboard arrives, a device can move to the ESP32: set its <span className="mono">board</span> to
            <span className="mono"> esp32</span> and its <span className="mono">channel</span> to the GPIO in devices.json.</li>
          <li>Each device is switched by exactly one board: the app never sends a device's command to both.</li>
        </ol>
      </div>
    </section>
  )
}

function TestButton({ device, pin, ready, onTested }: { device: string; pin: number; ready: boolean; onTested: () => void }) {
  const toast = useStore((s) => s.toast)
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<TestReceipt | null>(null)
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 4000)          // an armed click that is not taken goes cold
    return () => window.clearTimeout(t)
  }, [armed])
  const run = async () => {
    if (!armed) { setArmed(true); return }
    setArmed(false)
    setBusy(true)
    try {
      const r = await post<TestReceipt>(`/api/limbs/${encodeURIComponent(device)}/test`)
      setReceipt(r)
      toast(r.text, r.ok ? 'live' : 'fault')
      onTested()
    } catch (e) {
      toast((e as Error).message, 'fault')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="wiring-test">
      <button className={`btn sm ${armed ? 'danger' : ''}`} disabled={!ready || busy} onClick={() => void run()}>
        <MousePointerClick size={13} />
        {busy ? 'Clicking…' : armed ? `Switch ${device} for 1 s` : `Test ${device} · D${pin}`}
      </button>
      {receipt && (
        <div className={`wiring-receipt mono ${receipt.ok ? 'live' : 'fault'}`}>
          {receipt.ok ? <Check size={12} /> : <AlertTriangle size={12} />}
          {receipt.steps.map((s, i) => (
            <span key={i}>{s.action} · {s.delivered ? 'sent' : 'NOT sent'} · board {s.board_says === null ? '—' : s.board_says ? 'on' : 'off'} ({s.ms} ms)</span>
          ))}
          <span>{receipt.restored ? 'restored' : 'NOT restored'}</span>
        </div>
      )}
    </div>
  )
}
