/**
 * Mission → Schedule (calendar.tsx). The phone app read the device calendar; a
 * laptop has none of its own, so JARVIS reads your Google (or any) calendar through
 * its PRIVATE iCal address — read-only, no sign-in, no token. It shows today, finds
 * the free blocks (≥ 30 min, 08:00–23:00, Germoney's rule) and lets you claim one
 * as a study block, downloadable as .ics to add to the real calendar.
 */
import { CalendarPlus, Download, Link2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { api, post, TOKEN } from '../../lib/api'
import { usePoll } from '../../lib/format'
import { useStore } from '../../lib/store'
import { MissionHeader } from '../ui'

interface Ev { id?: string; title: string; start: string; end: string; allDay: boolean; location?: string; source: 'calendar' | 'jarvis' }
interface Day { date: string; feed: boolean; error: string | null; events: Ev[]; free: { start: string; end: string; minutes: number }[] }

const hhmm = (iso: string) => iso.slice(11, 16)

export function SchedulePage() {
  const [day, , reload] = usePoll(() => api<Day>('/api/germoney/calendar/today'), 60_000)
  const toast = useStore((s) => s.toast)
  const [url, setUrl] = useState('')
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('VLSI deep work')

  const saveFeed = async (u: string | null) => {
    try {
      await api('/api/germoney/calendar/feed', { method: 'PUT', body: { url: u } })
      setEditing(false)
      setUrl('')
      reload()
      toast(u ? 'Calendar linked.' : 'Calendar unlinked.', 'live')
    } catch (e) {
      toast((e as Error).message, 'fault')
    }
  }
  const claim = async (start: string, minutes: number) => {
    try {
      await post('/api/germoney/calendar/block', { title, start, minutes: Math.min(minutes, 120) })
      reload()
      toast(`Study block claimed at ${hhmm(start)}.`, 'live')
    } catch (e) {
      toast((e as Error).message, 'fault')
    }
  }
  const download = (id: string) => {
    void fetch(`/api/germoney/calendar/block/${id}.ics`, { headers: { 'X-Jarvis-Token': TOKEN } }).then((r) => r.blob()).then((b) => {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(b)
      a.download = `${id}.ics`
      a.click()
      URL.revokeObjectURL(a.href)
    })
  }
  const remove = async (id: string) => {
    await api(`/api/germoney/calendar/block/${id}`, { method: 'DELETE' })
    reload()
  }
  return (
    <div className="mission-page">
      <MissionHeader n="M13" title="Schedule" sub={`Today, ${day ? new Date(day.date).toDateString() : ''}`}
        right={day?.feed && !editing ? <button className="btn sm ghost" onClick={() => setEditing(true)}><Link2 size={13} />Calendar linked</button> : null} />
      {(!day?.feed || editing) && (
        <section className="card" style={{ marginBottom: 18 }}>
          <div className="card-head"><span className="card-title"><Link2 size={14} style={{ marginRight: 8 }} />Link your calendar (read-only)</span></div>
          <p className="muted small">Google Calendar → Settings → your calendar → <b>Secret address in iCal format</b>. Paste it here. It stays on this laptop; JARVIS only reads it.</p>
          <form className="gate-row" onSubmit={(e) => { e.preventDefault(); if (url.trim()) void saveFeed(url.trim()) }}>
            <input className="field" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button className="btn primary">Link</button>
            {day?.feed && <button type="button" className="btn ghost" onClick={() => void saveFeed(null)}>Unlink</button>}
          </form>
        </section>
      )}
      {day?.error && <div className="banner fault-banner">{day.error}</div>}
      <div className="germany-grid">
        <section className="card">
          <div className="card-head"><span className="card-title">// Today</span><span className="mono muted">{day?.events.length ?? 0} events</span></div>
          {day?.events.length === 0 && <div className="empty">Nothing scheduled{day.feed ? '' : ' (no calendar linked)'}.</div>}
          {day?.events.map((e, i) => (
            <div key={i} className={`ev ${e.source}`}>
              <span className="mono">{e.allDay ? 'all day' : `${hhmm(e.start)}–${hhmm(e.end)}`}</span>
              <span>{e.title}{e.location && <em className="muted small"> · {e.location}</em>}</span>
              {e.source === 'jarvis' && e.id && (
                <span className="ev-actions">
                  <button className="btn sm ghost icon" aria-label="Download .ics" onClick={() => download(e.id!)}><Download size={13} /></button>
                  <button className="btn sm ghost icon" aria-label="Remove block" onClick={() => void remove(e.id!)}><Trash2 size={13} /></button>
                </span>
              )}
            </div>
          ))}
        </section>
        <section className="card">
          <div className="card-head"><span className="card-title">// Free blocks</span><span className="mono muted">≥ 30 min · 08:00–23:00</span></div>
          <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Study block title" style={{ marginBottom: 10 }} />
          {day?.free.map((f) => (
            <div key={f.start} className="ev free">
              <span className="mono">{hhmm(f.start)}–{hhmm(f.end)}</span><span>{f.minutes} min free</span>
              <button className="btn sm" onClick={() => void claim(f.start, f.minutes)}><CalendarPlus size={13} />Claim {Math.min(f.minutes, 120)} min</button>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
