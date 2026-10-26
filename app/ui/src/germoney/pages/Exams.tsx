/**
 * Mission → Today → Internals. The exams engine (ww_exams.py) on one card: every
 * paper ahead with its coverage (from his taps) and a forecast range, today's
 * blocks with what to do in each, and one tap per topic ("learned", "solid").
 * The only measured number is a timed practice paper's marks; the card says so.
 */
import { AlertTriangle, BookOpen, Check, Clock, FileText, Target } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, post } from '../../lib/api'
import { useStore } from '../../lib/store'
import { openStudyFile } from '../game/plan'
import { prettyDate } from '../game/util'
import { NeonBar } from '../ui'
import './exams.css'

type TopicState = 'none' | 'learned' | 'solid'
export interface ExamTopic { key: string; unit: number; unit_title: string; topic: string; weight: 'high' | 'med' | 'low'; state: TopicState }
export interface ExamPaper {
  id: string; subject: string; title: string; code: string; date: string; start: string | null; end: string | null
  units: number[]; may_miss: boolean; days_left: number; coverage: number | null; topics: ExamTopic[]
  work_minutes: number; planned_minutes: number; logged_minutes: number
  paper_score: { score: number; max: number; date: string } | null
  counts: Record<TopicState, number>
  forecast: { half_plan: number; full_plan: number; assumption: string }
  files?: { name: string; path: string; folder: string }[]
}
interface Focus { kind: 'learn' | 'paper' | 'solid' | 'revise'; title: string; unit: number | null; minutes: number }
interface Slot { label: string; minutes: number; light: boolean; reserved: boolean; blocks: { paper: string; title: string; minutes: number; focus: Focus[] }[] }
export interface ExamsAnswer {
  status: string; date: string; say: string; rule?: string; risks: string[]
  papers: ExamPaper[]; days: { date: string; slots: Slot[] }[]
}

const pct = (x: number | null | undefined) => `${Math.round((x ?? 0) * 100)}%`
const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}` : `${m} min`)
const NEXT: Record<TopicState, TopicState> = { none: 'learned', learned: 'solid', solid: 'none' }

export function ExamsCard() {
  const [x, setX] = useState<ExamsAnswer | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const toast = useStore((s) => s.toast)
  useEffect(() => {
    let live = true
    api<ExamsAnswer>('/api/mission/exams').then((r) => { if (live) setX(r) }).catch(() => undefined)
    return () => { live = false }
  }, [])
  if (!x || x.status !== 'ok' || !x.papers.length) return null
  const send = async (subject: string, op: 'topic' | 'minutes' | 'paper', body: object, ok?: string) => {
    try {
      setX(await post<ExamsAnswer>(`/api/mission/exams/${encodeURIComponent(subject)}/${op}`, body))
      if (ok) toast(ok, 'live')
    } catch {
      toast('Could not save that. Is the app running?', 'fault')
    }
  }
  const next = x.papers[0]
  const today = x.days.find((d) => d.date === x.date)
  const byId = Object.fromEntries(x.papers.map((p) => [p.id, p]))
  return (
    <section className="card exams" aria-label="Internals">
      <div className="card-head">
        <span className="card-title"><BookOpen size={14} />Internals</span>
        <span className="mono small">{next.days_left ? `${next.days_left} d` : 'today'} to {next.title}{next.start ? ` · ${next.start}` : ''}</span>
      </div>

      <div className="ex-papers" role="list">
        {x.papers.map((p) => (
          <button key={p.id} role="listitem" className={`ex-paper ${open === p.id ? 'on' : ''}`} aria-expanded={open === p.id}
            onClick={() => setOpen(open === p.id ? null : p.id)}>
            <span className="ex-when mono">{prettyDate(p.date)}{p.start ? ` ${p.start}` : ''}</span>
            <span className="ex-name">{p.title}</span>
            <NeonBar progress={p.coverage ?? 0} tone={(p.coverage ?? 0) >= 0.7 ? 'live' : 'chrome'} />
            <span className="ex-nums small">
              <b>{p.topics.length ? pct(p.coverage) : 'no topics'}</b>
              {p.topics.length > 0 && <span className="muted"> · on the day {pct(p.forecast.half_plan)}–{pct(p.forecast.full_plan)}</span>}
            </span>
            {p.paper_score && <span className="chip live-chip small">paper {p.paper_score.score}/{p.paper_score.max}</span>}
            {p.may_miss && <span className="chip small">may not sit</span>}
          </button>
        ))}
      </div>
      <p className="muted small">Bar = topics you marked, weighted by unit. The range is where it lands if you do half, or all, of the planned minutes.</p>

      {open && byId[open] && <PaperTopics p={byId[open]} send={send} />}

      <div className="ex-today">
        <span className="eyebrow"><Clock size={12} /> Today's blocks</span>
        {!today && <p className="small muted">No study block left today.</p>}
        {today?.slots.map((s, i) => (
          <div key={i} className={`ex-slot ${s.light ? 'light' : ''}`}>
            <div className="ex-slot-head small"><b>{s.label}</b><span className="mono muted">{hm(s.minutes)}</span></div>
            {s.blocks.map((b) => (
              <div key={b.paper} className="ex-block">
                <div className="ex-block-head small">
                  <span>{b.title}</span><span className="mono">{hm(b.minutes)}</span>
                </div>
                <ol className="ex-focus small">
                  {b.focus.slice(0, 4).map((f, j) => (
                    <li key={j} className={f.kind}>{f.title}{f.unit ? <span className="muted"> · U{f.unit}</span> : null} <span className="mono muted">{f.minutes}′</span></li>))}
                  {b.focus.length > 4 && <li className="muted">+{b.focus.length - 4} more</li>}
                </ol>
                <div className="row">
                  {[30, 60].map((m) => (
                    <button key={m} className="btn sm ghost" onClick={() => void send(byId[b.paper].subject, 'minutes', { minutes: m }, `Logged ${m} min on ${b.title}.`)}>
                      <Check size={12} />{m} min done</button>))}
                </div>
              </div>))}
          </div>))}
      </div>

      {x.risks.length > 0 && (
        <div className="ex-risks small">
          {x.risks.map((r) => <div key={r}><AlertTriangle size={12} /> {r}</div>)}
        </div>)}
      <details className="small muted"><summary>How this plan is made</summary><p>{x.rule}</p></details>
    </section>
  )
}

function PaperTopics({ p, send }: { p: ExamPaper; send: (s: string, op: 'topic' | 'paper', b: object, ok?: string) => Promise<void> }) {
  const [score, setScore] = useState('')
  const [max, setMax] = useState('20')
  const units = [...new Set(p.topics.map((t) => t.unit))]
  return (
    <div className="ex-topics">
      <div className="ex-topics-head small">
        <b>{p.code ? `${p.code} · ` : ''}{p.title}</b>
        <span className="muted">Units {p.units.join(', ') || 'all'} · {p.counts.solid} solid · {p.counts.learned} learned · {p.counts.none} to go</span>
      </div>
      {(p.files?.length ?? 0) > 0 && (
        <div className="ex-files">{p.files!.map((f) => (
          <button key={f.path} className="btn sm ghost" onClick={() => void openStudyFile(f.path)}><FileText size={12} />{f.name.replace(/-/g, ' ')}</button>))}
        </div>)}
      {!p.topics.length && <p className="small muted">No unit list for this subject yet. Add the syllabus to academics.json and the topics appear here.</p>}
      {units.map((u) => {
        const ts = p.topics.filter((t) => t.unit === u)
        return (
          <div key={u} className="ex-unit">
            <span className="eyebrow">Unit {u} · {ts[0].unit_title} <span className={`ex-w ${ts[0].weight}`}>{ts[0].weight}</span></span>
            {ts.map((t) => (
              <button key={t.key} className={`ex-topic ${t.state}`} aria-label={`${t.topic}: ${t.state}. Tap to change.`}
                onClick={() => void send(p.subject, 'topic', { key: t.key, state: NEXT[t.state] })}>
                <i aria-hidden />{t.topic}<span className="mono">{t.state === 'none' ? '' : t.state}</span>
              </button>))}
          </div>)
      })}
      <p className="small muted">Tap once: learned (you can follow it). Twice: solid (you redid it closed book). Three times: clear.</p>
      <div className="field-row">
        <Target size={13} /><span className="small">Timed practice paper</span>
        <input className="field sm" type="number" min={0} value={score} onChange={(e) => setScore(e.target.value)} aria-label="marks scored" placeholder="marks" />
        <span className="small">/</span>
        <input className="field sm" type="number" min={1} value={max} onChange={(e) => setMax(e.target.value)} aria-label="out of" />
        <button className="btn sm" disabled={score === ''} onClick={() => void send(p.subject, 'paper', { score: Number(score), max: Number(max) }, 'Practice paper saved.').then(() => setScore(''))}>Save marks</button>
      </div>
    </div>
  )
}

export const _test = { NEXT, pct, hm }
