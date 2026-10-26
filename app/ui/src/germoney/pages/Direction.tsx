/**
 * Mission → Today, top: where today's energy goes (ww_director.py, which merges the
 * exams, sessions, learning and body engines), and the building hours read back from
 * real commits (ww_sessions.py), with one button that logs them as work.
 */
import { BookOpen, Brain, Code2, Compass, GitCommit, HeartPulse, Mic } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, post } from '../../lib/api'
import { useStore } from '../../lib/store'
import './direction.css'

interface Step { kind: 'study' | 'recall' | 'habit' | 'build'; title: string; minutes: number; why: string }
export interface DirectorAnswer {
  status: string; mode: 'exam' | 'normal'; say: string; note: string | null; rule: string
  steps: Step[]; split: { study: number; build: number; built_today: number }
}
interface Session { id: string; date: string; start: string; end: string; minutes: number; commits: number; main_area: string; subjects: string[]; imported: boolean }
export interface SessionsAnswer {
  status: string; say: string; today_minutes: number; week_minutes: number
  week_areas: Record<string, number>; pending: string[]; days: { date: string; minutes: number }[]
  sessions: Session[]; model: { explain: string }
}

const ICON = { study: BookOpen, recall: Brain, habit: HeartPulse, build: Code2 } as const
const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m}m`)

export function DirectionCard() {
  const [d, setD] = useState<DirectorAnswer | null>(null)
  const core = useStore((s) => s.core)
  const toast = useStore((s) => s.toast)
  useEffect(() => {
    let live = true
    api<DirectorAnswer>('/api/mission/director').then((r) => { if (live) setD(r) }).catch(() => undefined)
    return () => { live = false }
  }, [])
  if (!d || d.status !== 'ok') return null
  const total = d.split.study + d.split.build + d.split.built_today || 1
  const read = async () => {
    try { await post('/api/core/speak', { text: d.say }) } catch { toast(d.say, 'info') }
  }
  return (
    <section className="card direction" aria-label="Direction">
      <div className="card-head">
        <span className="card-title"><Compass size={14} />Direction</span>
        <span className={`pill small ${d.mode === 'exam' ? 'exam' : ''}`}>{d.mode === 'exam' ? 'Exam week' : 'Build week'}</span>
      </div>
      <p className="dir-say">{d.say}</p>
      <div className="dir-split" aria-label="Today's minutes">
        <i className="study" style={{ flexGrow: d.split.study / total }} title={`study left ${hm(d.split.study)}`} />
        <i className="built" style={{ flexGrow: d.split.built_today / total }} title={`built today ${hm(d.split.built_today)}`} />
        <i className="build" style={{ flexGrow: d.split.build / total }} title={`build budget left ${hm(d.split.build)}`} />
      </div>
      <div className="dir-legend small mono">
        <span><b className="study" />study {hm(d.split.study)}</span>
        <span><b className="built" />built {hm(d.split.built_today)}</span>
        <span><b className="build" />build room {hm(d.split.build)}</span>
      </div>
      {d.note && <p className="small dir-note">{d.note}</p>}
      <ol className="dir-steps">
        {d.steps.map((s, i) => {
          const Icon = ICON[s.kind]
          return (
            <li key={i} className={`dir-step ${s.kind}`}>
              <Icon size={14} aria-hidden />
              <span className="dir-title">{s.title}<span className="muted small"> · {s.why}</span></span>
              <span className="mono small">{hm(s.minutes)}</span>
            </li>)
        })}
      </ol>
      <div className="row">
        {core?.running && <button className="btn sm ghost" onClick={() => void read()}><Mic size={13} />Read it to me</button>}
        <details className="small muted"><summary>The rule</summary><p>{d.rule}</p></details>
      </div>
    </section>
  )
}

export function SessionsCard() {
  const [s, setS] = useState<SessionsAnswer | null>(null)
  const toast = useStore((x) => x.toast)
  useEffect(() => {
    let live = true
    api<SessionsAnswer>('/api/mission/sessions').then((r) => { if (live) setS(r) }).catch(() => undefined)
    return () => { live = false }
  }, [])
  if (!s || s.status !== 'ok') return null
  const max = Math.max(60, ...s.days.map((d) => d.minutes))
  const imp = async () => {
    try {
      const r = await post<SessionsAnswer & { say: string }>('/api/mission/sessions/import')
      setS(r)
      toast(r.say, 'live')
    } catch {
      toast('Could not log the sessions.', 'fault')
    }
  }
  const areas = Object.entries(s.week_areas).slice(0, 5)
  const wk = Object.values(s.week_areas).reduce((a, b) => a + b, 0) || 1
  return (
    <section className="card sessions" aria-label="Building hours">
      <div className="card-head"><span className="card-title"><GitCommit size={14} />Building</span>
        <span className="mono small">{hm(s.today_minutes)} today · {(s.week_minutes / 60).toFixed(1)} h week</span></div>
      <div className="ses-bars" aria-label="last 14 days">
        {s.days.map((d) => <i key={d.date} title={`${d.date}: ${hm(d.minutes)}`} style={{ height: `${Math.max(3, (d.minutes / max) * 100)}%` }} className={d.minutes ? 'on' : ''} />)}
      </div>
      {areas.length > 0 && (
        <div className="ses-areas small">{areas.map(([a, m]) => (
          <span key={a} className="ses-area"><span>{a}</span><span className="mono muted">{Math.round((m / wk) * 100)}%</span></span>))}
        </div>)}
      {s.sessions.slice(0, 3).map((x) => (
        <div key={x.id} className="ses-row small">
          <span className="mono">{x.date.slice(5)} {x.start}–{x.end}</span>
          <span className="ses-what">{x.main_area} · {x.commits} commit{x.commits === 1 ? '' : 's'}</span>
          <span className="mono">{hm(x.minutes)}</span>
        </div>))}
      {s.pending.length > 0
        ? <button className="btn sm" onClick={() => void imp()}><GitCommit size={13} />Log {s.pending.length} session{s.pending.length === 1 ? '' : 's'} as work</button>
        : s.sessions.length > 0 && <p className="small muted">Every session is logged.</p>}
      <p className="muted small">{s.model.explain}</p>
    </section>
  )
}
