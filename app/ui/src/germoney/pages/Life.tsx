/**
 * Well Wisher → Life. The day in taps (ww_life.py): counters with a gentle weekly
 * taper line, a quick add for meals, anime, movies and reels, and the reels waiting
 * for an explain-back. Then the weekly habits and the quest lines.
 * Built to cost seconds: one tap per counter, no forms, a slip is never a reset.
 *
 * Under 10 seconds a day: every counter is a square tile with 44 px minus/plus
 * targets (the touch minimum), the count moves on the tap (the server answer lands
 * ~50-150 ms later and replaces it), and the quick add is one row that submits on Enter.
 */
import { Check, Clapperboard, Film, Link2, Minus, Plus, Sparkles, Utensils } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, post } from '../../lib/api'
import { useStore } from '../../lib/store'
import { MissionHeader } from '../ui'
import { QuestCards } from './Status'
import { HabitsCard } from './Today'
import './sections.css'
import './life.css'

interface Counter { id: string; name: string; want: 'less' | 'more' | 'yes'; today: number | null; line: number | null; on_line: boolean | null; last7: number[] }
interface Item { kind: string; text: string; minutes?: number; url?: string }
export interface LifeAnswer {
  status: string; say: string; rule: string; counters: Counter[]; items: Item[]; points_today: number
  weeks: { ends: string; points: number; logged: number }[]
  reels_to_explain: { date: string; index: number; text: string; url?: string; kind: string }[]
}

const KINDS = [{ id: 'meal', icon: Utensils, label: 'Meal' }, { id: 'anime', icon: Sparkles, label: 'Anime' },
  { id: 'movie', icon: Film, label: 'Movie' }, { id: 'series', icon: Clapperboard, label: 'Series' }, { id: 'reel', icon: Link2, label: 'Reel' }] as const
type Kind = (typeof KINDS)[number]['id']
const ICON_OF: Record<string, (typeof KINDS)[number]['icon']> = Object.fromEntries(KINDS.map((k) => [k.id, k.icon]))

export function LifePage() {
  return (
    <div className="mission-page life">
      <MissionHeader n="M4" title="Life" sub="The day in taps · habits · quests" />
      <div className="study-grid">
        <section className="study-main"><DayCard /><QuestCards /></section>
        <aside className="study-side"><HabitsCard /></aside>
      </div>
    </div>
  )
}

/** The count shown before the server answers: the tap moves the number at once. */
function bump(d: LifeAnswer, id: string, body: { delta?: number; value?: number }): LifeAnswer {
  return { ...d, counters: d.counters.map((c) => c.id !== id ? c
    : { ...c, today: body.value !== undefined ? body.value : Math.max(0, (c.today ?? 0) + (body.delta ?? 0)) }) }
}

export function DayCard() {
  const [d, setD] = useState<LifeAnswer | null>(null)
  const [kind, setKind] = useState<Kind>('meal')
  const [text, setText] = useState('')
  const [extra, setExtra] = useState('')
  const toast = useStore((s) => s.toast)
  const seq = useRef(0)
  // A tap counter per tile: each tap remounts one ring, which plays once (200 ms) and stays still.
  const [pulse, setPulse] = useState<Record<string, number>>({})
  useEffect(() => { void api<LifeAnswer>('/api/mission/life').then(setD).catch(() => undefined) }, [])
  // Only the last six items show as chips: enough to see what got in, never a list to scroll.
  const recent = useMemo(() => (d?.items ?? []).slice(-6), [d?.items])
  if (!d || d.status !== 'ok') return null
  const tap = async (op: string, body: object) => {
    try { setD(await post<LifeAnswer>(`/api/mission/life/${op}`, body)) } catch { toast('Could not save that.', 'fault') }
  }
  const count = (id: string, body: { id: string; delta?: number; value?: number }) => {
    // Three quick taps send three requests; only the newest answer is applied, so an
    // older reply landing late never makes the number jump back.
    const mine = ++seq.current
    setD((prev) => prev && bump(prev, id, body))
    void post<LifeAnswer>('/api/mission/life/count', body)
      .then((r) => { if (mine === seq.current) setD(r) })
      .catch(() => {
        toast('Could not save that.', 'fault')
        void api<LifeAnswer>('/api/mission/life').then(setD).catch(() => undefined)
      })
  }
  const add = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!text.trim()) return
    const body: Record<string, unknown> = { kind, text }
    if (kind === 'reel') body.url = extra
    else if (extra) body.minutes = Number(extra)
    void tap('item', body).then(() => { setText(''); setExtra('') })
  }
  return (
    <section className="card day" aria-label="Today in taps">
      <div className="day-head">
        <span className="day-title"><span className="day-glyph" aria-hidden /><span className="card-title">Today in taps</span></span>
        <span className="day-pts" aria-label={`${d.points_today} points today, ${d.weeks[0]?.points ?? 0} this week`}>
          <span><b>{d.points_today}</b><em>pt today</em></span><span><b>{d.weeks[0]?.points ?? 0}</b><em>this week</em></span></span></div>
      <div className="taps">
        {d.counters.map((c, i) => (
          <div key={c.id} className={`tap ${c.want === 'yes' ? 'is-yes' : ''} ${c.on_line === true ? 'ok' : c.on_line === false ? 'over' : ''}`}>
            <span className="tap-top">
              <span className="tap-idx mono" aria-hidden>{String(i + 1).padStart(2, '0')}</span>
              <span className="tap-name" title={c.name}>{c.name}</span>
              <span className="tap-line mono">{c.line === null ? (c.want === 'yes' ? '' : 'line in 3 d') : `${c.want === 'less' ? '≤' : '≥'} ${c.line}`}</span>
            </span>
            {c.want === 'yes'
              ? <button className={`tap-yes ${c.today ? 'on' : ''}`} aria-pressed={!!c.today} aria-label={`${c.name}: ${c.today ? 'yes' : 'not yet'}`}
                  onClick={() => { setPulse((p) => ({ ...p, [c.id]: (p[c.id] ?? 0) + 1 })); count(c.id, { id: c.id, value: c.today ? 0 : 1 }) }}>
                  <span className="tap-tick" aria-hidden>{c.today ? <Check size={24} strokeWidth={2.6} /> : null}
                    {pulse[c.id] ? <i key={pulse[c.id]} className="tap-ring" /> : null}</span>
                  <span className="tap-yes-label">{c.today ? 'Yes' : 'Not yet'}</span>
                </button>
              : <>
                  <span className="tap-mid">
                    <b key={c.today ?? -1} className="tap-n" aria-live="polite">{c.today ?? '–'}</b>
                    {pulse[c.id] ? <i key={`r${pulse[c.id]}`} className="tap-ring" aria-hidden /> : null}
                  </span>
                  <WeekDots c={c} />
                  <div className="tap-row">
                    <button className="tap-btn" aria-label={`${c.name} minus one`} disabled={!c.today}
                      onClick={() => { setPulse((p) => ({ ...p, [c.id]: (p[c.id] ?? 0) + 1 })); count(c.id, { id: c.id, delta: -1 }) }}><Minus size={18} /></button>
                    <button className="tap-btn plus" aria-label={`${c.name} plus one`}
                      onClick={() => { setPulse((p) => ({ ...p, [c.id]: (p[c.id] ?? 0) + 1 })); count(c.id, { id: c.id, delta: 1 }) }}><Plus size={18} /></button>
                  </div>
                </>}
          </div>))}
      </div>
      <form className="quick" onSubmit={add}>
        <div className="life-kinds" role="radiogroup" aria-label="What to add">{KINDS.map((k) => (
          <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} title={k.label} className={kind === k.id ? 'on' : ''} onClick={() => setKind(k.id)}>
            <k.icon size={14} /><span className="lk-label">{k.label}</span></button>))}
        </div>
        <input className="field q-text" value={text} onChange={(e) => setText(e.target.value)} aria-label="what"
          placeholder={kind === 'reel' ? 'What it taught, in one line' : kind === 'meal' ? 'What you ate' : 'Title'} />
        <input className="field q-extra" value={extra} onChange={(e) => setExtra(e.target.value)} aria-label={kind === 'reel' ? 'link' : 'minutes'}
          inputMode={kind === 'reel' ? 'url' : 'numeric'} placeholder={kind === 'reel' ? 'link' : 'min'} />
        <button type="submit" className="btn sm q-add" disabled={!text.trim()}><Plus size={13} />Add</button>
      </form>
      {recent.length > 0 && (
        <div className="items" aria-label="Logged today">{recent.map((it, i) => {
          const Icon = ICON_OF[it.kind]
          return <span key={i} className="life-chip" title={`${it.kind}: ${it.text}${it.minutes ? ` · ${it.minutes} min` : ''}`}>
            {Icon ? <Icon size={11} aria-hidden /> : <span className="lc-kind">{it.kind}</span>}<span className="lc-text">{it.text}</span></span>
        })}</div>)}
      {d.reels_to_explain.length > 0 && <ReelExplain reels={d.reels_to_explain} onDone={(date, index, t) => void tap('explained', { date, index, text: t })} />}
      <details className="day-rule small muted"><summary>How points work</summary><p>{d.rule}</p></details>
    </section>
  )
}

/**
 * The last seven days as seven dots, Nothing-glyph style, today last and larger.
 * Filled = that day met the line; ring = it did not; faint = no line yet. Seven
 * spans per tile, no layout reads.
 */
function WeekDots({ c }: { c: Counter }) {
  const days = [...c.last7.slice(-6), c.today ?? 0]
  const met = (v: number) => c.line === null ? null : c.want === 'less' ? v <= c.line : v >= c.line
  return (
    <span className="week-dots" aria-label={`last ${days.length} days: ${days.join(', ')}`}>
      {days.map((v, i) => {
        const m = met(v)
        return <i key={i} className={`${m === null ? 'na' : m ? 'met' : 'miss'} ${i === days.length - 1 ? 'today' : ''}`} />
      })}
    </span>
  )
}

function ReelExplain({ reels, onDone }: { reels: LifeAnswer['reels_to_explain']; onDone: (date: string, index: number, text: string) => void }) {
  const [t, setT] = useState('')
  const r = reels[0]
  return (
    <div className="reel-explain">
      <div className="re-head"><span className="eyebrow">Explain it back · {r.date.slice(5)}</span>
        {reels.length > 1 && <span className="mono muted small">{reels.length - 1} more waiting</span>}</div>
      <p className="re-what"><b title={r.text}>{r.text}</b>{r.url && <> · <a href={r.url} target="_blank" rel="noreferrer">the reel</a></>}</p>
      <textarea className="field" rows={2} value={t} onChange={(e) => setT(e.target.value)} placeholder="In your own words, without looking: what was the idea?" />
      <div className="re-foot"><span className="mono muted small">{t.trim().length < 20 ? `${20 - t.trim().length} more characters` : 'ready'}</span>
        <button className="btn sm" disabled={t.trim().length < 20} onClick={() => { onDone(r.date, r.index, t); setT('') }}>Saved to my knowledge</button></div>
    </div>
  )
}
