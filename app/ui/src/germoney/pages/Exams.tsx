/**
 * Study → Internals. The exams engine (ww_exams.py) on one compact card: a strip of
 * paper tiles (coverage from his taps, the forecast range, the measured practice
 * score against his target), the open paper's topics below it, today's blocks as a
 * short timeline, and the risks folded into one line.
 * The only measured number is a timed practice paper's marks; the card says so.
 */
import { AlertTriangle, BookOpen, Check, Clock, FileText, Target } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { api, post } from '../../lib/api'
import { useStore } from '../../lib/store'
import { openStudyFile } from '../game/plan'
import { prettyDate } from '../game/util'
import './exams.css'

type TopicState = 'none' | 'learned' | 'solid'
export interface ExamTopic { key: string; unit: number; unit_title: string; topic: string; weight: 'high' | 'med' | 'low'; state: TopicState }
export interface ExamPaper {
  id: string; subject: string; title: string; code: string; date: string; start: string | null; end: string | null
  units: number[]; may_miss: boolean; days_left: number; coverage: number | null; topics: ExamTopic[]
  work_minutes: number; planned_minutes: number; logged_minutes: number
  /** From the date sheet (Settings): the marks he aims for, out of max (default 20). */
  target?: number | null; max?: number; difficulty?: 'easy' | 'normal' | 'hard'
  paper_score: { score: number; max: number; date: string; on_target?: boolean | null } | null
  counts: Record<TopicState, number>
  forecast: { half_plan: number; full_plan: number; assumption: string }
  files?: { name: string; path: string; folder: string }[]
}
interface Focus { kind: 'learn' | 'paper' | 'solid' | 'revise'; title: string; unit: number | null; minutes: number }
interface Block { paper: string; title: string; minutes: number; focus: Focus[] }
interface Slot { label: string; minutes: number; light: boolean; reserved: boolean; blocks: Block[] }
export interface ExamsAnswer {
  status: string; date: string; say: string; rule?: string; risks: string[]
  papers: ExamPaper[]; days: { date: string; slots: Slot[] }[]
}
type Send = (subject: string, op: 'topic' | 'minutes' | 'paper', body: object, ok?: string) => Promise<boolean>
type Tap = (subject: string, key: string, state: TopicState) => void

const pct = (x: number | null | undefined) => `${Math.round((x ?? 0) * 100)}%`
const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}` : `${m} min`)
const NEXT: Record<TopicState, TopicState> = { none: 'learned', learned: 'solid', solid: 'none' }
const SAY: Record<TopicState, string> = { none: 'to do', learned: 'learned', solid: 'solid' }
/** "50–90%": the forecast range, short enough for a 124 px tile. */
const range = (f: ExamPaper['forecast']) => `${Math.round(f.half_plan * 100)}–${pct(f.full_plan)}`

/** Optimistic topic tap: the chip moves at once, the server's answer replaces it a moment later. */
function patchTopic(x: ExamsAnswer, subject: string, key: string, state: TopicState): ExamsAnswer {
  return {
    ...x,
    papers: x.papers.map((p) => {
      if (p.subject !== subject) return p
      const topics = p.topics.map((t) => (t.key === key ? { ...t, state } : t))
      const counts = { none: 0, learned: 0, solid: 0 }
      topics.forEach((t) => { counts[t.state]++ })
      return { ...p, topics, counts }
    }),
  }
}

export function ExamsCard() {
  const [x, setX] = useState<ExamsAnswer | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const toast = useStore((s) => s.toast)
  const load = useCallback(() => api<ExamsAnswer>('/api/mission/exams'), [])
  useEffect(() => {
    let live = true
    load().then((r) => { if (live) setX(r) }).catch(() => undefined)
    return () => { live = false }
  }, [load])
  const send = useCallback<Send>(async (subject, op, body, ok) => {
    try {
      setX(await post<ExamsAnswer>(`/api/mission/exams/${encodeURIComponent(subject)}/${op}`, body))
      if (ok) toast(ok, 'live')
      return true
    } catch {
      toast('Could not save that. Is the app running?', 'fault')
      return false
    }
  }, [toast])
  const tap = useCallback<Tap>((subject, key, state) => {
    setX((cur) => (cur ? patchTopic(cur, subject, key, state) : cur))
    void send(subject, 'topic', { key, state }).then((saved) => {
      if (!saved) load().then(setX).catch(() => undefined)   // put the chip back where the server has it
    })
  }, [send, load])
  const toggle = useCallback((id: string) => setOpen((o) => (o === id ? null : id)), [])
  const byId = useMemo(() => Object.fromEntries((x?.papers ?? []).map((p) => [p.id, p])), [x])
  const today = useMemo(() => x?.days.find((d) => d.date === x.date), [x])
  if (!x || x.status !== 'ok' || !x.papers.length) return null
  const next = x.papers[0]
  const nextLine = `${next.days_left ? `${next.days_left} d` : 'today'} to ${next.title}${next.start ? ` · ${next.start}` : ''}`
  const openPaper = open ? byId[open] : undefined
  return (
    <section className="card exams" aria-label="Internals">
      <div className="card-head">
        <span className="card-title"><BookOpen size={14} />Internals</span>
        <span className="ex-next mono small" title={nextLine}>{nextLine}</span>
      </div>

      <ul className="ex-papers" aria-label="papers">
        {x.papers.map((p) => <li key={p.id}><PaperTile p={p} on={open === p.id} onToggle={toggle} /></li>)}
      </ul>
      <p className="ex-legend muted">Bar: your topic taps, weighted by unit. → where it lands on the day with half or all of the planned minutes. Only practice marks are measured.</p>

      {openPaper && <PaperTopics p={openPaper} send={send} tap={tap} />}

      <TodayLine slots={today?.slots ?? []} byId={byId} send={send} />

      <details className="ex-risks small">
        <summary>
          {x.risks.length ? <><AlertTriangle size={12} aria-hidden /><b>{x.risks.length} risk{x.risks.length > 1 ? 's' : ''}</b><span className="ex-risk-first">{x.risks[0]}</span></>
            : <span className="muted">How this plan is made</span>}
        </summary>
        {x.risks.length > 0 && <ul>{x.risks.map((r) => <li key={r}>{r}</li>)}</ul>}
        {x.rule && <p className="muted">{x.rule}</p>}
      </details>
    </section>
  )
}

/** One paper in the strip. Memoised on the numbers it shows, so a topic tap on one paper
 *  re-renders only that paper's tile, not all seven. */
const PaperTile = memo(function PaperTile({ p, on, onToggle }: { p: ExamPaper; on: boolean; onToggle: (id: string) => void }) {
  const hasTopics = p.topics.length > 0
  const s = p.paper_score
  const full = `${p.code ? `${p.code} · ` : ''}${p.title}`
  const aim = p.target != null ? `aim ${p.target}/${p.max ?? 20}` : ''
  return (
    <button className={`ex-paper${on ? ' on' : ''}${p.may_miss ? ' miss' : ''}`} aria-expanded={on} aria-controls="ex-topics"
      onClick={() => onToggle(p.id)}>
      <span className="ex-when mono">{prettyDate(p.date)}{p.start ? ` · ${p.start}` : ''}</span>
      <span className="ex-name" title={full}>{p.title}</span>
      <span className={`ex-bar${(p.coverage ?? 0) >= 0.7 ? ' hi' : ''}`} aria-hidden><i style={{ transform: `scaleX(${Math.max(0, Math.min(1, p.coverage ?? 0))})` }} /></span>
      <span className="ex-nums">
        <b className="mono">{hasTopics ? pct(p.coverage) : '–'}</b>
        {hasTopics
          ? <span className="ex-fc mono" title={`On the day: ${pct(p.forecast.half_plan)} with half the planned minutes, ${pct(p.forecast.full_plan)} with all of them. Your taps, not a measured score.`}>→ {range(p.forecast)}</span>
          : <span className="ex-fc muted">no topics</span>}
      </span>
      {(s || aim || p.may_miss) && (
        <span className="ex-foot">
          {s && <span className={`ex-score mono${s.on_target ? ' ok' : ''}`}
            title={`Timed practice paper, ${prettyDate(s.date)}: ${s.score} of ${s.max}. Measured.${s.on_target === false ? ' Below your target.' : ''}`}>{s.score}/{s.max}</span>}
          {aim && <span className="ex-aim mono">{s ? `aim ${p.target}` : aim}</span>}
          {p.may_miss && <span className="ex-miss">may not sit</span>}
        </span>)}
    </button>
  )
}, (a, b) => a.on === b.on && a.onToggle === b.onToggle && sameTile(a.p, b.p))

function sameTile(a: ExamPaper, b: ExamPaper): boolean {
  return a === b || (a.id === b.id && a.title === b.title && a.code === b.code && a.date === b.date && a.start === b.start
    && a.coverage === b.coverage && a.may_miss === b.may_miss && a.target === b.target && a.max === b.max
    && a.topics.length === b.topics.length && a.forecast.half_plan === b.forecast.half_plan && a.forecast.full_plan === b.forecast.full_plan
    && a.paper_score?.score === b.paper_score?.score && a.paper_score?.max === b.paper_score?.max
    && a.paper_score?.on_target === b.paper_score?.on_target)
}

function PaperTopics({ p, send, tap }: { p: ExamPaper; send: Send; tap: Tap }) {
  const [score, setScore] = useState('')
  const [max, setMax] = useState(String(p.max ?? 20))
  const units = useMemo(() => {
    const m = new Map<number, ExamTopic[]>()
    p.topics.forEach((t) => { m.set(t.unit, [...(m.get(t.unit) ?? []), t]) })
    return [...m.entries()]
  }, [p.topics])
  const onTap = useCallback((t: ExamTopic) => tap(p.subject, t.key, NEXT[t.state]), [tap, p.subject])
  return (
    <div className="ex-topics" id="ex-topics">
      <div className="ex-topics-head">
        <b className="ex-topics-title" title={`${p.code ? `${p.code} · ` : ''}${p.title}`}>{p.code ? `${p.code} · ` : ''}{p.title}</b>
        <span className="mono small muted">U {p.units.join(', ') || 'all'} · {p.counts.solid} solid · {p.counts.learned} learned · {p.counts.none} to go</span>
      </div>
      {(p.files?.length ?? 0) > 0 && (
        <div className="ex-files">{p.files!.map((f) => (
          <button key={f.path} className="btn sm ghost" title={f.name} onClick={() => void openStudyFile(f.path)}><FileText size={12} /><span>{f.name.replace(/-/g, ' ')}</span></button>))}
        </div>)}
      {!p.topics.length && <p className="small muted">No unit list for this subject yet. Add the syllabus to academics.json and the topics appear here.</p>}
      {units.map(([u, ts]) => (
        <div key={u} className="ex-unit">
          <div className="ex-unit-head">
            <span className="mono ex-u">U{u}</span>
            <span className="ex-unit-title" title={ts[0].unit_title}>{ts[0].unit_title}</span>
            <span className={`ex-w ${ts[0].weight}`} title={`${ts[0].weight} weight in the paper`}>{ts[0].weight}</span>
          </div>
          <div className="ex-chips">{ts.map((t) => <TopicChip key={t.key} t={t} onTap={onTap} />)}</div>
        </div>))}
      {p.topics.length > 0 && (
        <p className="ex-key small muted"><span className="ex-dot none" aria-hidden /> to do <span className="ex-dot learned" aria-hidden /> learned: you can follow it <span className="ex-dot solid" aria-hidden /> solid: redone closed book. One tap moves it on.</p>)}
      <div className="ex-practice">
        <Target size={13} aria-hidden /><span className="small">Timed practice paper</span>
        <input className="field sm" type="number" min={0} value={score} onChange={(e) => setScore(e.target.value)} aria-label="marks scored" placeholder="marks" />
        <span className="small muted">/</span>
        <input className="field sm" type="number" min={1} value={max} onChange={(e) => setMax(e.target.value)} aria-label="out of" />
        <button className="btn sm" disabled={score === ''}
          onClick={() => void send(p.subject, 'paper', { score: Number(score), max: Number(max) }, 'Practice paper saved.').then((ok) => { if (ok) setScore('') })}>Save marks</button>
        {p.target != null && <span className="small muted">target {p.target}/{p.max ?? 20}</span>}
      </div>
    </div>
  )
}

/** A topic: a dot that fills in three steps (ring, centre, full). Memoised on its own state,
 *  so a tap re-renders one chip, not the paper's fifteen. */
const TopicChip = memo(function TopicChip({ t, onTap }: { t: ExamTopic; onTap: (t: ExamTopic) => void }) {
  return (
    <button className={`ex-topic ${t.state}`} title={t.topic} aria-label={`${t.topic}: ${SAY[t.state]}. Tap for ${SAY[NEXT[t.state]]}.`}
      onClick={() => onTap(t)}>
      <i aria-hidden /><span>{t.topic}</span>
    </button>
  )
}, (a, b) => a.onTap === b.onTap && a.t.key === b.t.key && a.t.state === b.t.state && a.t.topic === b.t.topic)

function TodayLine({ slots, byId, send }: { slots: Slot[]; byId: Record<string, ExamPaper>; send: Send }) {
  return (
    <div className="ex-today">
      <span className="eyebrow"><Clock size={12} aria-hidden /> Today</span>
      {!slots.length && <p className="small muted">No study block left today.</p>}
      {slots.length > 0 && (
        <ol className="ex-line">
          {slots.map((s, i) => (
            <li key={i} className={`ex-slot${s.light ? ' light' : ''}`}>
              <div className="ex-slot-head small"><b>{s.label}</b><span className="mono muted">{hm(s.minutes)}</span></div>
              {s.blocks.map((b) => {
                const shown = b.focus.slice(0, 3)
                const all = b.focus.map((f) => `${f.title}${f.unit ? ` (U${f.unit})` : ''} ${f.minutes} min`).join('\n')
                return (
                  <div key={b.paper} className="ex-block small">
                    <span className="ex-b-title" title={b.title}>{b.title}</span>
                    <span className="ex-b-focus" title={all}>
                      {shown.map((f, j) => (
                        <span key={j} className={`f ${f.kind}`}>{j > 0 && <span className="muted"> · </span>}{f.title}{f.unit ? <span className="muted"> U{f.unit}</span> : null}<span className="mono muted"> {f.minutes}′</span></span>))}
                      {b.focus.length > 3 && <span className="muted"> · +{b.focus.length - 3}</span>}
                    </span>
                    <span className="ex-b-min mono muted">{hm(b.minutes)}</span>
                    <span className="ex-b-act">
                      {[30, 60].map((m) => (
                        <button key={m} className="btn sm ghost" aria-label={`Log ${m} min on ${b.title}`} disabled={!byId[b.paper]}
                          onClick={() => void send(byId[b.paper].subject, 'minutes', { minutes: m }, `Logged ${m} min on ${b.title}.`)}>
                          <Check size={12} aria-hidden />{m}′</button>))}
                    </span>
                  </div>)
              })}
            </li>))}
        </ol>)}
    </div>
  )
}

export const _test = { NEXT, pct, hm, range, patchTopic }
