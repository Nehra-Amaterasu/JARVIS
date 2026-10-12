/**
 * The moment a reminder is due: a glass card pops up over whatever tab is open, with
 * Done (he did it — kept with the firing, the start of SIH-3's "le li") and Snooze.
 *
 * Mount ONCE, globally (it listens to the event bus; it is not tied to a page). When
 * JARVIS did not say it aloud (asleep, or text mode) the window chimes instead, so a
 * reminder is never silent while the app is open. Old firings replayed from the bus
 * history on reconnect are never shown again.
 */
import { AlarmClock, BellRing, Check, Clock, Power } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { post } from '../lib/api'
import { Presence } from '../lib/motion'
import { alertsFrom, lastReminderEvent, type Alert } from '../lib/reminders'
import { useStore } from '../lib/store'
import '../styles/reminders.css'

const FRESH_S = 120                     // a firing older than this is history, not news

/** Two soft notes (A5, E6) through WebAudio: no file, no download. */
function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    ;[880, 1318.5].forEach((f, i) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = f
      const t = ctx.currentTime + i * 0.18
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.12, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9)
      o.connect(g).connect(ctx.destination)
      o.start(t)
      o.stop(t + 1)
    })
    window.setTimeout(() => void ctx.close(), 1600)
  } catch {
    /* no audio device: the card still shows */
  }
}

export function ReminderAlerts() {
  const events = useStore((s) => s.events)
  const toast = useStore((s) => s.toast)
  const seen = useRef(lastReminderEvent(useStore.getState().events))
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [leaving, setLeaving] = useState<number[]>([])

  useEffect(() => {
    const fresh = alertsFrom(events, seen.current).filter((a) => {
      const ev = events.find((e) => e.id === a.id)
      return !!ev && Date.now() / 1000 - ev.ts < FRESH_S
    })
    const newest = lastReminderEvent(events)
    if (newest > seen.current) seen.current = newest
    if (!fresh.length) return
    setAlerts((a) => [...a, ...fresh].slice(-3))
    if (fresh.some((a) => !a.spoken)) chime()
  }, [events])

  const close = (id: number) => {
    setLeaving((l) => [...l, id])
    window.setTimeout(() => {
      setAlerts((a) => a.filter((x) => x.id !== id))
      setLeaving((l) => l.filter((x) => x !== id))
    }, 240)
  }

  const act = async (a: Alert, what: 'ack' | 'snooze') => {
    close(a.id)
    if (!a.rid) return
    try {
      const r = await post<{ say?: string }>(`/api/reminders/${a.rid}/${what}`, what === 'snooze' ? { minutes: 10 } : {})
      if (r.say) toast(r.say, 'info')
    } catch (err) {
      toast((err as Error).message, 'fault')
    }
  }

  return (
    <div className="rem-alerts" aria-live="polite">
      {alerts.map((a) => {
        const Icon = a.kind === 'skipped' ? Power : a.text.includes('alarm') ? AlarmClock : BellRing
        return (
          <Presence key={a.id} show={!leaving.includes(a.id)}>
            <div className={`rem-alert pop ${a.tone}`} role="alert">
              <Icon size={20} strokeWidth={1.7} className={a.tone === 'live' ? 'breathe' : ''} />
              <div>
                <p>{a.text}</p>
                <span className="mono muted">{a.spoken ? 'JARVIS said this aloud' : 'shown here only: JARVIS is not speaking'}</span>
                <div className="rem-alert-actions">
                  {a.kind === 'due' && a.rid && (
                    <>
                      <button className="btn sm live" onClick={() => void act(a, 'ack')}><Check size={13} />Done</button>
                      <button className="btn sm" onClick={() => void act(a, 'snooze')}><Clock size={13} />10 min</button>
                    </>
                  )}
                  <button className="btn sm ghost" onClick={() => close(a.id)}>Dismiss</button>
                </div>
              </div>
            </div>
          </Presence>
        )
      })}
    </div>
  )
}
