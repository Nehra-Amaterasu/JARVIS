// Reminders in Memory (parity R07): a two-row strip under the detail with the next two, and the full list in a drawer with the
// phrase field that JARVIS's own parser reads ("call Mum at 9 pm", "timer 10 min"), Cancel, and what fired lately. The
// ReminderChip and ReminderBell forms are package E03's; this is the moved list and its three routes, drawn in the new kit.
// Delivery is said honestly: a reminder fires while the app is open, and it is spoken only when JARVIS is awake in voice mode.
import { useState, type FormEvent } from 'react'
import { Drawer } from '../../shared/kit'
import { Lamp, type LampReading } from '../../shared/lamp'
import { PlannedControl } from '../../shared/planned/PlannedControl'
import { jarvisRegistry } from '../planned'
import { fmtDue, title, upcoming, type RemindersView } from '../../lib/reminders'
import { relDue } from './model'
import type { RemindersPort } from './port'
import type { Loadable } from './types'

export interface ReminderStripProps {
  view: Loadable<RemindersView>
  /** Epoch seconds; the caller's clock so a fixture is stable. */
  now: number
  onAll: () => void
  /** The list is a fixture: the lamp says SIMULATED. */
  simulated?: boolean
}

const readingOf = (v: Loadable<RemindersView>, simulated?: boolean): LampReading =>
  v.state === 'fault' ? { state: 'fault', since: null, reason: v.error }
    : v.state === 'loading' ? { state: 'waiting', since: null, reason: 'reading the list' }
      : { state: simulated ? 'simulated' : 'live', since: null, reason: simulated ? 'fixture' : v.data.voice ? 'spoken when awake' : 'shown in the window only' }

export function ReminderStrip({ view, now, onAll, simulated }: ReminderStripProps) {
  const next = view.data ? upcoming(view.data.items, 1) : []
  return (
    <section className="jm-rem" aria-label="Next reminders" data-testid="reminder-strip">
      <header>
        <span className="jm-tag">[REM]</span>
        <Lamp reading={readingOf(view, simulated)} showLabel={false} subject="Reminders" />
        <span className="jm-rem-title">Reminders</span>
        <button type="button" className="jm-key jm-key-sm" onClick={onAll}>All</button>
      </header>
      {view.state === 'fault' && <p className="jm-note">The list did not load ({view.error}).</p>}
      {view.state === 'ready' && next.length === 0 && <p className="jm-muted jm-rem-empty">Nothing is set. Say “remind me” or add one under All.</p>}
      {next.map((r) => (
        <p key={r.id} className="jm-rem-row"><span className="jm-rem-t">{title(r)}</span><span className="jm-dim jm-mono" title={fmtDue(r.due, now)}>{relDue(r.due, now)}</span></p>
      ))}
    </section>
  )
}

export function RemindersDrawer({ open, onClose, port, view, now, reload }: {
  open: boolean
  onClose: () => void
  port: RemindersPort
  view: Loadable<RemindersView>
  now: number
  reload: () => void
}) {
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [say, setSay] = useState<{ ok: boolean; text: string } | null>(null)
  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (!phrase.trim() || busy) return
    setBusy(true)
    try {
      const r = await port.add(phrase.trim())
      setSay({ ok: true, text: r.say })
      setPhrase('')
      reload()
    } catch (err) {
      setSay({ ok: false, text: (err as Error).message })
    } finally { setBusy(false) }
  }
  const cancel = async (id: string) => {
    try { await port.cancel(id); reload() } catch (err) { setSay({ ok: false, text: (err as Error).message }) }
  }
  const items = view.data ? upcoming(view.data.items) : []
  const recent = (view.data?.recent ?? []).filter((r) => r.last_fired).slice(0, 4)
  return (
    <Drawer open={open} onClose={onClose} title="Reminders">
      <div className="jm-drawer">
        <p className="jm-lead"><span className="jm-tag">[REM]</span> What JARVIS will say, and when. A reminder fires while this app is open; he says it aloud only when he is awake in voice mode.</p>
        <form className="jm-rem-form" onSubmit={(e) => void add(e)}>
          <label className="jm-sr" htmlFor="jm-rem-phrase">New reminder</label>
          <input id="jm-rem-phrase" className="jm-field" value={phrase} onChange={(e) => setPhrase(e.target.value)} disabled={busy} autoComplete="off"
            placeholder="call Mum at 9 pm · timer 10 min · medicine 8 am daily" />
          <button type="submit" className="jm-key jm-key-primary" aria-disabled={busy || !phrase.trim() || undefined}>Add</button>
        </form>
        {say && <p className={say.ok ? 'jm-note' : 'jm-note jm-fault'} role="status">{say.text}</p>}
        {view.state === 'fault' && <p className="jm-note" role="alert">The list did not load ({view.error}).</p>}
        <ul className="jm-rem-list" aria-label="Upcoming reminders">
          {items.map((r) => (
            <li key={r.id}><span className="jm-mono">{fmtDue(r.due, now)}</span><span className="jm-rem-t">{title(r)}</span>
              <button type="button" className="jm-key jm-key-sm" onClick={() => void cancel(r.id)} aria-label={`Cancel ${title(r)}`}>Cancel</button></li>
          ))}
          {view.state === 'ready' && items.length === 0 && <li className="jm-muted">No upcoming reminders.</li>}
        </ul>
        {recent.length > 0 && (
          <>
            <h4 className="jm-h">Fired lately</h4>
            <ul className="jm-rem-list">{recent.map((r) => <li key={r.id}><span className="jm-mono">{fmtDue(r.last_fired ?? r.due, now)}</span><span className="jm-rem-t">{title(r)}</span></li>)}</ul>
          </>
        )}
        <PlannedControl registry={jarvisRegistry} id="jarvis.reminder-alerts" />
      </div>
    </Drawer>
  )
}
