/**
 * Well Wisher → Life. The day in taps (ww_life.py): counters with a gentle weekly
 * taper line, a quick add for meals, anime, movies and reels, and the reels waiting
 * for an explain-back. Then the weekly habits and the quest lines.
 * Built to cost seconds: one tap per counter, no forms, a slip is never a reset.
 */
import { Clapperboard, Film, Link2, Minus, Plus, Sparkles, Utensils } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, post } from '../../lib/api'
import { useStore } from '../../lib/store'
import { MissionHeader } from '../ui'
import { QuestCards } from './Status'
import { HabitsCard } from './Today'
import './sections.css'

interface Counter { id: string; name: string; want: 'less' | 'more' | 'yes'; today: number | null; line: number | null; on_line: boolean | null; last7: number[] }
interface Item { kind: string; text: string; minutes?: number; url?: string }
export interface LifeAnswer {
  status: string; say: string; rule: string; counters: Counter[]; items: Item[]; points_today: number
  weeks: { ends: string; points: number; logged: number }[]
  reels_to_explain: { date: string; index: number; text: string; url?: string; kind: string }[]
}

const KINDS = [{ id: 'meal', icon: Utensils, label: 'Meal' }, { id: 'anime', icon: Sparkles, label: 'Anime' },
  { id: 'movie', icon: Film, label: 'Movie' }, { id: 'series', icon: Clapperboard, label: 'Series' }, { id: 'reel', icon: Link2, label: 'Reel' }] as const

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

export function DayCard() {
  const [d, setD] = useState<LifeAnswer | null>(null)
  const [kind, setKind] = useState<(typeof KINDS)[number]['id']>('meal')
  const [text, setText] = useState('')
  const [extra, setExtra] = useState('')
  const toast = useStore((s) => s.toast)
  useEffect(() => { void api<LifeAnswer>('/api/mission/life').then(setD).catch(() => undefined) }, [])
  if (!d || d.status !== 'ok') return null
  const tap = async (op: string, body: object) => {
    try { setD(await post<LifeAnswer>(`/api/mission/life/${op}`, body)) } catch { toast('Could not save that.', 'fault') }
  }
  const add = () => {
    const body: Record<string, unknown> = { kind, text }
    if (kind === 'reel') body.url = extra
    else if (extra) body.minutes = Number(extra)
    void tap('item', body).then(() => { setText(''); setExtra('') })
  }
  return (
    <section className="card day" aria-label="Today in taps">
      <div className="card-head"><span className="card-title">Today in taps</span>
        <span className="mono small">{d.points_today} pt · week {d.weeks[0]?.points ?? 0}</span></div>
      <div className="taps">
        {d.counters.map((c) => (
          <div key={c.id} className={`tap ${c.on_line === true ? 'ok' : c.on_line === false ? 'over' : ''}`}>
            <span className="tap-name small">{c.name}</span>
            {c.want === 'yes'
              ? <button className={`tap-yes ${c.today ? 'on' : ''}`} onClick={() => void tap('count', { id: c.id, value: c.today ? 0 : 1 })}>{c.today ? 'Yes' : 'Not yet'}</button>
              : <div className="tap-row">
                  <button className="icon-btn" aria-label={`${c.name} minus one`} disabled={!c.today} onClick={() => void tap('count', { id: c.id, delta: -1 })}><Minus size={14} /></button>
                  <b className="tap-n mono">{c.today ?? '–'}</b>
                  <button className="icon-btn" aria-label={`${c.name} plus one`} onClick={() => void tap('count', { id: c.id, delta: 1 })}><Plus size={14} /></button>
                </div>}
            <span className="tap-line mono small muted">{c.line === null ? (c.want === 'yes' ? '' : 'line after 3 days') : `${c.want === 'less' ? '≤' : '≥'} ${c.line}`}</span>
          </div>))}
      </div>
      <div className="quick">
        <div className="seg" role="tablist">{KINDS.map((k) => (
          <button key={k.id} role="tab" aria-selected={kind === k.id} className={kind === k.id ? 'on' : ''} onClick={() => setKind(k.id)}><k.icon size={13} />{k.label}</button>))}
        </div>
        <div className="field-row">
          <input className="field" value={text} onChange={(e) => setText(e.target.value)} aria-label="what"
            placeholder={kind === 'reel' ? 'What it taught, in one line' : kind === 'meal' ? 'What you ate' : 'Title'} />
          <input className="field sm" value={extra} onChange={(e) => setExtra(e.target.value)} aria-label={kind === 'reel' ? 'link' : 'minutes'}
            placeholder={kind === 'reel' ? 'paste the link' : 'min'} />
          <button className="btn sm" disabled={!text.trim()} onClick={add}><Plus size={13} />Add</button>
        </div>
        {d.items.length > 0 && <div className="items small">{d.items.slice(-6).map((it, i) => <span key={i} className="chip small">{it.kind} · {it.text}</span>)}</div>}
      </div>
      {d.reels_to_explain.length > 0 && <ReelExplain reels={d.reels_to_explain} onDone={(date, index, t) => void tap('explained', { date, index, text: t })} />}
      <details className="small muted"><summary>How points work</summary><p>{d.rule}</p></details>
    </section>
  )
}

function ReelExplain({ reels, onDone }: { reels: LifeAnswer['reels_to_explain']; onDone: (date: string, index: number, text: string) => void }) {
  const [t, setT] = useState('')
  const r = reels[0]
  return (
    <div className="reel-explain">
      <span className="eyebrow">Explain it back · {r.date.slice(5)}</span>
      <p className="small"><b>{r.text}</b>{r.url && <> · <a href={r.url} target="_blank" rel="noreferrer">the reel</a></>}</p>
      <textarea className="field" rows={2} value={t} onChange={(e) => setT(e.target.value)} placeholder="In your own words, without looking: what was the idea?" />
      <button className="btn sm" disabled={t.trim().length < 20} onClick={() => { onDone(r.date, r.index, t); setT('') }}>Saved to my knowledge</button>
    </div>
  )
}
