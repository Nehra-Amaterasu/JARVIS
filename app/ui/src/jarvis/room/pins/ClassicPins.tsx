/**
 * The same compact pin map for the classic Limbs page. It uses the pure model (pinModel.ts) and the classic page's own
 * classes only, so with the shell flag off nothing of the clay kit (and its global rules) reaches the classic chunk.
 * Read-only: no route saves a pin map yet (see PinMap.tsx); the test click is the existing route, two presses.
 */
import { useState } from 'react'
import { post } from '../../../lib/api'
import type { LimbsView } from '../../../lib/limbs'
import { useStore } from '../../../lib/store'
import { LAMP_SPECS } from '../../../shared/lamp/types'
import { NO_SAVE_ROUTE, pinRows, type PinRow } from './pinModel'

const PILL: Record<string, string> = { live: 'live', simulated: 'sim', fault: 'fault', waiting: '', planned: '' }

export function ClassicPins({ v, onTested }: { v: LimbsView | null; onTested?: () => void }) {
  const rows = pinRows(v)
  return (
    <>
      <div className="card-head">
        <span className="card-title">Relay pins{rows.length ? ` (${rows.length})` : ''}</span>
      </div>
      <p className="wiring-p">Mains 230 V can kill: breaker off before any wire is touched. A relay sits in parallel with its wall switch.</p>
      {rows.length === 0
        ? <p className="wiring-p muted">WAITING: no relays reported yet.</p>
        : (
          <table className="wiring-table mono">
            <thead><tr><th>Relay</th><th>ESP32 pin</th><th>State</th><th>Test</th></tr></thead>
            <tbody>{rows.map((r) => <ClassicRow key={r.id} row={r} onTested={onTested} />)}</tbody>
          </table>
        )}
      <p className="wiring-p muted">PLANNED: editing pins. {NO_SAVE_ROUTE}</p>
    </>
  )
}

function ClassicRow({ row, onTested }: { row: PinRow; onTested?: () => void }) {
  const toast = useStore((s) => s.toast)
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (!armed) { setArmed(true); return }
    setArmed(false); setBusy(true)
    try {
      const r = await post<{ ok: boolean; text: string }>(`/api/limbs/${encodeURIComponent(row.id)}/test`)
      toast(r.text, r.ok ? 'live' : 'fault'); onTested?.()
    } catch (e) { toast((e as Error).message, 'fault') } finally { setBusy(false) }
  }
  return (
    <tr>
      <td>{row.name}</td>
      <td>GPIO {row.pin}</td>
      <td><span className={`pill ${PILL[row.lamp] ?? ''}`} title={row.reason}>{LAMP_SPECS[row.lamp].label}</span></td>
      <td>
        <button className={`btn sm ${armed ? 'danger' : ''}`} disabled={!row.testable || busy} onBlur={() => setArmed(false)} onClick={() => void run()}>
          {busy ? 'Clicking…' : armed ? 'Switch 1 s?' : 'Test'}
        </button>
      </td>
    </tr>
  )
}
