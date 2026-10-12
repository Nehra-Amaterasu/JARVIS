/**
 * The away-mode alert, shown over every tab (SIH-1). An "alert" event from the
 * server (pending / alarm / tamper / warning) drops this banner in; it leaves when
 * the house is disarmed or re-armed, when a warning or a sensor fault resolves, or
 * when it is dismissed. A motion alarm that has ended stays until dismissed — a
 * break-in must not vanish because the intruder left.
 *
 * Simulated alerts are amber and say SIMULATED; real ones are red (lib/away.ts).
 */
import { ShieldAlert, Siren, WifiOff, X } from 'lucide-react'
import { useState } from 'react'
import { post } from '../lib/api'
import { activeAlert, type ActiveAlert } from '../lib/away'
import { clock } from '../lib/format'
import { Presence } from '../lib/motion'
import { useStore } from '../lib/store'
import '../styles/away.css'

const KEY = 'jarvis.securityAlert.dismissed'
const TITLE: Record<string, string> = {
  pending: 'Motion while armed', alarm: 'Alarm', tamper: 'Sensor offline', warning: 'Away mode is not watching',
}

function readDismissed(): number {
  try {
    return Number(sessionStorage.getItem(KEY)) || 0
  } catch {
    return 0
  }
}

export function SecurityAlert() {
  const events = useStore((s) => s.events)
  const toast = useStore((s) => s.toast)
  const [dismissed, setDismissed] = useState(readDismissed)
  const [busy, setBusy] = useState(false)
  const active = activeAlert(events, dismissed)
  // Keep the last alert's content while the banner animates out (React's "adjust
  // state while rendering" pattern: only when the alert itself changed).
  const [last, setLast] = useState<ActiveAlert | null>(null)
  if (active && (active.ev.id !== last?.ev.id || active.ended !== last?.ended)) setLast(active)
  const a = active ?? last

  const dismiss = () => {
    if (!a) return
    setDismissed(a.ev.id)
    try { sessionStorage.setItem(KEY, String(a.ev.id)) } catch { /* private window */ }
  }
  const disarm = async () => {
    setBusy(true)
    try {
      await post('/api/security/disarm')
      toast('Away mode disarmed', 'live')
    } catch (e) {
      toast((e as Error).message, 'fault')
    } finally {
      setBusy(false)
    }
  }

  const Icon = a?.level === 'tamper' ? WifiOff : a?.level === 'warning' ? ShieldAlert : Siren
  const label = a?.ev.label as string | undefined
  // The pill already says SIMULATED / REPLAY; don't repeat it at the start of the text.
  const text = a && label && a.ev.text.startsWith(`${label} — `) ? a.ev.text.slice(label.length + 3) : a?.ev.text
  return (
    <Presence show={!!active}>
      {a ? (
        <div key={a.ev.id} className={`sec-alert ${a.tone} ${a.ended ? 'ended' : ''}`} role="alert" aria-live="assertive">
          <span className={`sec-alert-icon ${a.ended ? '' : 'breathe'}`}><Icon size={22} strokeWidth={1.8} /></span>
          <div className="sec-alert-body">
            <div className="sec-alert-title">
              {label && <span className="pill sim">{label}</span>}
              {TITLE[a.level] ?? 'Away mode'}
              {a.ended && <span className="muted"> · ended</span>}
              <time className="mono muted">{clock(a.ev.ts)}</time>
            </div>
            <div className="sec-alert-text">{text}</div>
          </div>
          {(a.level === 'pending' || a.level === 'alarm') && !a.ended && (
            <button className="btn danger sm" disabled={busy} onClick={() => void disarm()}>Disarm</button>
          )}
          <button className="btn ghost icon sm" aria-label="Dismiss" onClick={dismiss}><X size={14} /></button>
        </div>
      ) : <div />}
    </Presence>
  )
}
