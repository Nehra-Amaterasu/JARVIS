/**
 * Reminders: what JARVIS will say, and when. One box takes it the way he would say
 * it ("call Mum at 9 pm", "timer 10 min", "medicine 8 am daily"); the server reads it
 * with the same parser JARVIS's voice path uses and says the resolved time back.
 *
 * Honest about delivery: reminders fire while this app is open; JARVIS says them
 * aloud only when he is awake in voice mode (the pill shows which), and the recent
 * list says, per firing, whether it was spoken, only shown, or missed.
 */
import { AlarmClock, Bell, CalendarClock, Plus, Power, Repeat, Timer, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { api, post } from '../lib/api'
import { useNow, usePoll } from '../lib/format'
import { Presence, Ticker } from '../lib/motion'
import { countdown, firingTone, fmtClock, fmtDue, fmtRepeat, lastReminderEvent, title, upcoming, type Reminder,
  type RemindersView } from '../lib/reminders'
import { useStore } from '../lib/store'
import '../styles/reminders.css'

const ICON = { reminder: Bell, timer: Timer, alarm: AlarmClock, action: Power } as const

export function RemindersCard() {
  const events = useStore((s) => s.events)
  const toast = useStore((s) => s.toast)
  const [view, loading, reload] = usePoll(() => api<RemindersView>('/api/reminders'), 15000)
  // Anything that changes the list (voice, another window, a firing) arrives as an event.
  const last = lastReminderEvent(events)
  useEffect(() => { if (last) reload() }, [last])           // eslint-disable-line react-hooks/exhaustive-deps
  const now = useNow(1000) / 1000
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [leaving, setLeaving] = useState<string[]>([])

  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (!phrase.trim() || busy) return
    setBusy(true)
    try {
      const r = await post<{ say: string }>('/api/reminders', { phrase: phrase.trim(), origin: 'app' })
      toast(r.say, 'live')
      setPhrase('')
      reload()
    } catch (err) {
      toast((err as Error).message, 'fault')
    } finally {
      setBusy(false)
    }
  }

  const cancel = (r: Reminder) => {
    setLeaving((l) => [...l, r.id])                       // animate out first, then delete
    window.setTimeout(async () => {
      try {
        await api(`/api/reminders/${r.id}`, { method: 'DELETE' })
      } catch (err) {
        toast((err as Error).message, 'fault')
      }
      setLeaving((l) => l.filter((x) => x !== r.id))
      reload()
    }, 240)
  }

  const items = upcoming(view?.items ?? [])
  const recent = (view?.recent ?? []).filter((r) => r.last_fired).slice(0, 4)
  return (
    <section className="card reminders">
      <div className="card-head">
        <span className="card-title"><span className="track">B3</span>Reminders</span>
        <span key={String(view?.voice)} className={`pill pop ${view?.voice ? 'live' : ''}`}>
          {view?.voice && <i className="led" />}{view?.voice ? 'spoken' : 'window only'}
        </span>
      </div>

      <form className="rem-form" onSubmit={add}>
        <input className="field" value={phrase} onChange={(e) => setPhrase(e.target.value)} disabled={busy}
          placeholder="call Mum at 9 pm · timer 10 min · medicine 8 am daily" aria-label="New reminder" />
        <button className="btn icon live" type="submit" disabled={busy || !phrase.trim()} aria-label="Add reminder">
          <Plus size={16} />
        </button>
      </form>

      {loading && !view ? (
        <div className="rem-list">
          {[0, 1].map((i) => <div key={i} className="skeleton scan" style={{ height: 34, margin: '6px 0' }} />)}
        </div>
      ) : !view ? (
        <div className="empty fault">Reminders aren't answering. Is the app server up?</div>
      ) : items.length === 0 ? (
        <div className="empty rise">
          <CalendarClock size={18} />
          <span>Nothing pending. Say “remind me at 9 to call Mum”, or type it above.</span>
        </div>
      ) : (
        <div className="rem-list">
          {items.map((r, i) => {
            const Icon = ICON[r.kind] ?? Bell
            const rep = fmtRepeat(r)
            return (
              <Presence key={r.id} show={!leaving.includes(r.id)}>
                <div className={`rem-row rise ${r.kind}`} style={{ ['--i' as string]: i }}>
                  <Icon size={16} strokeWidth={1.8} />
                  <div className="rem-what">
                    <b title={r.text}>{title(r)}</b>
                    <div className="rem-when">
                      {rep ? <><Repeat size={10} style={{ verticalAlign: -1 }} /> {rep} · next {fmtDue(r.due, now)}</>
                        : fmtDue(r.due, now)}
                    </div>
                  </div>
                  {r.kind === 'timer'
                    ? <Ticker className="rem-count" value={Math.max(0, Math.ceil(r.due - now))} fmt={(s) => countdown(s, 0)} />
                    : <span />}
                  <button className="btn icon ghost" onClick={() => cancel(r)} aria-label={`Cancel ${title(r)}`}>
                    <X size={14} />
                  </button>
                </div>
              </Presence>
            )
          })}
        </div>
      )}

      {recent.length > 0 && (
        <div className="rem-recent">
          <span className="eyebrow">Today</span>
          {recent.map((r, i) => {
            const f = r.fired[r.fired.length - 1]
            const kind = f && f.late_s > 900 ? 'missed' : 'due'
            const tone = firingTone({ kind, spoken: f?.spoken, outcome: f?.outcome })
            return (
              <div key={`${r.id}-${r.last_fired}`} className="rem-past rise" style={{ ['--i' as string]: i }}>
                <span className={`pill ${tone === 'info' ? '' : tone}`}>
                  {kind === 'missed' ? 'missed' : tone === 'sim' ? 'virtual' : f?.spoken ? 'spoken' : 'shown'}
                </span>
                <span className="mono muted">{fmtClock(r.last_fired ?? r.due)}</span>
                <span>{title(r)}{r.acked ? ' · done' : ''}</span>
              </div>
            )
          })}
        </div>
      )}
      <p className="rem-note mono muted">
        They fire while this app is open; JARVIS says them aloud when he is awake in voice mode.
      </p>
    </section>
  )
}
