/**
 * "Wire your relays": the exact pins config.h sets, what active-low means on the
 * module, the low-voltage side (VCC / GND / IN), the mains side, a safety checklist,
 * and a test click per relay — 1 s toggled, then put back, through the same Limbs
 * path as the switches, with the board's own confirmation as the receipt.
 *
 * Then the second stage: the board powered from the switchboard by a 5 V supply,
 * with no USB cable, and updated over Wi-Fi.
 */
import { AlertTriangle, Check, MousePointerClick, Plug, ShieldAlert, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, post } from '../lib/api'
import type { BoardView, ConfigView, TestReceipt } from '../lib/board'
import { useStore } from '../lib/store'

const CHECKLIST = [
  'Breaker (MCB) for the circuit is OFF, and a tester shows the wires are dead.',
  'Low-voltage side first: VCC, GND and the IN wires connected and test-clicked with NO mains on the relay.',
  'A 5 V relay module: VCC to the ESP32\'s 5V pin, GND to the ESP32\'s GND (one shared ground).',
  'Mains through COM and NO (normally open) on the LIVE wire only: never the neutral, never the earth.',
  'Contacts rated above the load: a 10 A / 250 VAC relay is plenty for a tube light and a ceiling fan.',
  'No bare mains terminals: module in an enclosure, mains wires kept away from the low-voltage ones.',
  'Unsure about any of it: an electrician checks it before the breaker goes back on.',
]

export function RelayWiring({ v, onTested }: { v: BoardView | null; onTested: () => void }) {
  const [cfg, setCfg] = useState<ConfigView | null>(null)
  const [done, setDone] = useState<boolean[]>(() => CHECKLIST.map(() => false))
  useEffect(() => { api<ConfigView>('/api/board/config').then(setCfg).catch(() => {}) }, [v?.build?.at])
  const pin = (k: string) => cfg?.values[k] ?? null
  const low = (cfg?.values.RELAY_ACTIVE_LOW ?? 1) === 1
  const light = pin('RELAY_LIGHT_PIN'), fan = pin('RELAY_FAN_PIN')
  const gp = (p: number | null) => (p === null ? '…' : p < 0 ? 'none (-1)' : `GPIO ${p}`)
  return (
    <section className="card wiring">
      <div className="card-head">
        <span className="card-title"><Plug size={15} strokeWidth={1.8} style={{ marginRight: 8 }} />Wire your relays</span>
        <span className="pill fault"><ShieldAlert size={11} />mains 230 V can kill</span>
      </div>

      <div className="wiring-grid">
        <div>
          <div className="eyebrow">Relay module → ESP32-S3 (low-voltage side)</div>
          <table className="wiring-table mono">
            <thead><tr><th>Module</th><th>ESP32-S3 pin</th><th>Why</th></tr></thead>
            <tbody>
              <tr><td>VCC</td><td>5V</td><td>a 5 V module's coils need 5 V; the board's 5V pin carries USB's 5 V now</td></tr>
              <tr><td>GND</td><td>GND</td><td>shared ground: without it the IN signal means nothing</td></tr>
              <tr><td>IN1</td><td className="live">{gp(light)}</td><td>light (RELAY_LIGHT_PIN)</td></tr>
              <tr><td>IN2</td><td className="live">{gp(fan)}</td><td>fan (RELAY_FAN_PIN)</td></tr>
            </tbody>
          </table>
          <p className="wiring-p">
            <b>{low ? 'Active-low' : 'Active-high'}</b> (RELAY_ACTIVE_LOW {low ? 1 : 0}): the relay is ON when its IN pin is
            pulled <b>{low ? 'LOW' : 'HIGH'}</b>, and the module's LED lights. The firmware sets the OFF level on the pin
            before making it an output, so nothing clicks at boot.
            {low && ' If a relay stays on when told off, the ESP32\'s 3.3 V HIGH is not enough to switch a 5 V input off: move the module\'s VCC to 3V3 and, on a module with a JD-VCC jumper, remove the jumper and give JD-VCC 5 V.'}
          </p>
          <div className="eyebrow" style={{ marginTop: 14 }}>Mains side (breaker OFF)</div>
          <p className="wiring-p">
            Cut the <b>live</b> wire that feeds the light (or the fan regulator): one end to the relay's <b>COM</b>, the other to
            <b> NO</b>. NC stays empty, so the load is off whenever the board is off. Leave the wall switch in series
            only if you want it to stay a master off.
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
            <TestButton device="light" pin={light} ready={v?.link === 'usb'} onTested={onTested} />
            <TestButton device="fan" pin={fan} ready={v?.link === 'usb'} onTested={onTested} />
          </div>
          {v?.link !== 'usb' && <div className="muted wiring-note">Test clicks need the board on USB (the bench stage).</div>}
        </div>
      </div>

      <div className="wiring-later">
        <div className="eyebrow"><Zap size={11} /> Later: powered from the switchboard, no USB</div>
        <ol>
          <li>A <b>5 V DC supply</b> inside the switchboard (an enclosed 5 V 1 A module, fused on its mains side) feeds the board's
            <b> 5V</b> and <b>GND</b> pins. The board's regulator makes its own 3.3 V. <b className="fault">Never 230 V to the board</b>,
            and never mains near its pins.</li>
          <li>Budget: the ESP32-S3 peaks near 0.35 A on Wi-Fi, each relay coil draws ~70 mA at 5 V: under 0.5 A for two, so 1 A
            has margin. If "Last start" ever says <b>brownout</b> after a click, the supply sags under the coils.</li>
          <li>USB and the 5V pin are two of the board's three power inputs, used <b>one at a time</b> (Espressif's guide). Once the
            supply feeds 5V, unplug the USB cable; for the bench stage, USB alone powers both.</li>
          <li>Before unplugging USB for good: flash once over USB with <span className="mono">OTA_PASS_VALUE</span> in secrets.h, and
            check that this panel says "Firmware over Wi-Fi: on". From then on, Flash → Over Wi-Fi.</li>
        </ol>
      </div>
    </section>
  )
}

function TestButton({ device, pin, ready, onTested }: { device: 'light' | 'fan'; pin: number | null; ready: boolean; onTested: () => void }) {
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
      const r = await post<TestReceipt>(`/api/board/relay-test/${device}`)
      setReceipt(r)
      toast(r.text, r.ok ? 'live' : 'fault')
      onTested()
    } catch (e) {
      toast((e as Error).message, 'fault')
    } finally {
      setBusy(false)
    }
  }
  const disabled = !ready || busy || pin === null || pin < 0
  return (
    <div className="wiring-test">
      <button className={`btn sm ${armed ? 'danger' : ''}`} disabled={disabled} onClick={() => void run()}>
        <MousePointerClick size={13} />
        {busy ? 'Clicking…' : armed ? `Switch ${device} for 1 s` : `Test ${device}${pin !== null && pin >= 0 ? ` · GPIO ${pin}` : ''}`}
      </button>
      {receipt && (
        <div className={`wiring-receipt mono ${receipt.ok ? 'live' : 'fault'}`}>
          {receipt.ok ? <Check size={12} /> : <AlertTriangle size={12} />}
          {receipt.steps.map((s, i) => (
            <span key={i}>{s.action} @{s.t_ms} ms · {s.delivered ? 'sent' : 'NOT sent'} · board {s.board_says === null ? '—' : s.board_says ? 'on' : 'off'} ({s.confirm_ms} ms)</span>
          ))}
          <span>{receipt.restored ? 'restored' : 'NOT restored'} · held {receipt.held_s} s</span>
        </div>
      )}
    </div>
  )
}
