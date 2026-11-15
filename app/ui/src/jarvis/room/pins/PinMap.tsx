/**
 * The relay pin map (RW1, D-V3-35, parity R06): one fold in Room, one row per relay: name, ESP32 GPIO, a state lamp with
 * its word, a test key. Collapsed it is one 44 px key. Editing a pin is a hardware setting: the field changes locally,
 * "Apply" needs a second press, and nothing reaches the board before that press. With no save route (adapter null) the
 * edit control is drawn PLANNED with the reason and the pins are read-only.
 *
 * The test key is the existing route (POST /api/limbs/{id}/test: 1 s flipped, then put back); it also needs two presses,
 * because it switches mains. An armed key goes cold when focus leaves it or on Escape, not on a timer.
 */
import { useState } from 'react'
import { post } from '../../../lib/api'
import type { LimbsView } from '../../../lib/limbs'
import { useStore } from '../../../lib/store'
import { Button, Field, Fold, Lamp } from '../../../shared/kit'
import { CONFIRM_LINE, NO_SAVE_ROUTE, changedPins, pinRows, validateDrafts, type PinRow, type PinsAdapter } from './pinModel'
import './pins.css'

export interface PinMapProps {
  v: LimbsView | null
  /** Called after a test click so the host can reload the view. */
  onTested?: () => void
  /** Null until a route can save a pin map: the edit control is then PLANNED. */
  adapter?: PinsAdapter | null
  defaultOpen?: boolean
  /** A test click; the default posts to the Limbs route. Injected by tests. */
  test?: (device: string) => Promise<{ ok: boolean; text: string }>
}

const defaultTest = (device: string) => post<{ ok: boolean; text: string }>(`/api/limbs/${encodeURIComponent(device)}/test`)

export function PinMap({ v, onTested, adapter = null, defaultOpen, test = defaultTest }: PinMapProps) {
  const rows = pinRows(v)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [fail, setFail] = useState('')
  const errors = validateDrafts(rows, drafts)
  const changes = changedPins(rows, drafts)
  const dirty = Object.keys(changes).length > 0
  const bad = Object.keys(errors).length > 0

  const edit = (id: string, value: string) => { setDrafts((d) => ({ ...d, [id]: value })); setArmed(false); setFail('') }
  const apply = async () => {
    if (!adapter || !dirty || bad) return
    if (!armed) { setArmed(true); return }
    setArmed(false); setBusy(true)
    try { await adapter.save(changes); setDrafts({}) }
    catch (e) { setFail((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <Fold title={`Relay pins${rows.length ? ` (${rows.length})` : ''}`} defaultOpen={defaultOpen}>
      <div className="pp">
        <p className="pp-note">Mains 230 V can kill: breaker off before any wire is touched. A relay sits in parallel with its wall switch.</p>
        {rows.length === 0 && <p className="pp-note"><Lamp state="waiting" reason="no relays reported yet" /></p>}
        <ul className="pp-list">
          {rows.map((r) => (
            <PinLine key={r.id} row={r} editable={!!adapter} draft={drafts[r.id]} error={errors[r.id]} onEdit={(x) => edit(r.id, x)} test={test} onTested={onTested} />
          ))}
        </ul>
        <div className="pp-foot" onKeyDown={(e) => { if (e.key === 'Escape') setArmed(false) }}>
          {adapter ? (
            <>
              <Button grouped tone={armed ? 'danger' : 'primary'} loading={busy} onBlur={() => setArmed(false)} onClick={() => void apply()}
                disabledReason={!dirty ? 'change a pin first' : bad ? 'fix the pins marked Error' : undefined}>
                {armed ? 'Apply again to confirm' : 'Apply'}
              </Button>
              <span className="pp-say" role="status">{fail ? `Error: ${fail}` : armed ? CONFIRM_LINE : dirty ? 'Nothing is sent to the board until you apply.' : ''}</span>
            </>
          ) : (
            <>
              <Lamp state="planned" reason="editing pins" />
              <span className="pp-say">{NO_SAVE_ROUTE}</span>
            </>
          )}
        </div>
      </div>
    </Fold>
  )
}

function PinLine({ row, editable, draft, error, onEdit, test, onTested }: {
  row: PinRow; editable: boolean; draft: string | undefined; error?: string; onEdit: (v: string) => void
  test: NonNullable<PinMapProps['test']>; onTested?: () => void
}) {
  const toast = useStore((s) => s.toast)
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (!armed) { setArmed(true); return }
    setArmed(false); setBusy(true)
    try { const r = await test(row.id); toast(r.text, r.ok ? 'live' : 'fault'); onTested?.() }
    catch (e) { toast((e as Error).message, 'fault') }
    finally { setBusy(false) }
  }
  return (
    <li className="pp-row">
      <span className="pp-name">{row.name}</span>
      {editable
        ? <Field label={`GPIO pin for ${row.name}`} inputMode="numeric" value={draft ?? String(row.pin)} error={error} onChange={(e) => onEdit(e.target.value)} />
        : <span className="pp-pin" aria-label={`GPIO ${row.pin}`}>GPIO {row.pin}</span>}
      <Lamp state={row.lamp} reason={row.reason} />
      <Button className="pp-test" grouped tone={armed ? 'danger' : 'quiet'} loading={busy} onBlur={() => setArmed(false)}
        onKeyDown={(e) => { if (e.key === 'Escape') setArmed(false) }} onClick={() => void run()}
        disabledReason={row.testable ? undefined : 'the board is not linked'}>
        {armed ? 'Switch 1 s?' : 'Test'}
      </Button>
    </li>
  )
}
