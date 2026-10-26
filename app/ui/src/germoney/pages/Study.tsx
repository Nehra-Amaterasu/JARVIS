/**
 * Well Wisher → Study. Everything about learning, in one place:
 *   Internals   the exams engine (papers, topics, today's blocks), full width on top
 *               because it carries seven papers side by side
 *   Node        the study engine for one skill-tree node: choose the primary resource,
 *               log what you studied with your notes, do its contracts, then the
 *               spaced explain-backs that make it stick (ww_study.py)
 *   Knowledge   one new concept a day and the recalls due (ww_learning.py)
 */
import { BookMarked, Check, FileText, Paperclip, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { api, post } from '../../lib/api'
import { useStore } from '../../lib/store'
import { loadBank } from '../data/bank'
import { usePlan } from '../game/plan'
import { useReader } from '../Reader'
import { MissionHeader } from '../ui'
import { ExamsCard } from './Exams'
import { toB64 } from './Log'
import { LearnCard } from './Today'
import './sections.css'

/** The node the Study page shows; the Tree's "Study this" sets it. */
export const useStudyNode = create<{ id: string | null; set: (id: string) => void }>((set) => ({ id: null, set: (id) => set({ id }) }))

interface Res { id: string; title: string; kind?: string; url?: string; free?: boolean; hours?: number | null }
interface Entry { id: string; date: string; what: string; minutes: number; note?: string; files: { name: string; path: string }[] }
export interface StudyAnswer {
  status: string; stage: 'choose' | 'study' | 'contracts' | 'review' | 'mastered' | null; say: string
  node: { id: string; name: string; branch: string; outcomes: string[]; hours_est: number } | null
  next: { kind: string; title: string; why: string; key?: string; minutes?: number; due_now?: boolean } | null
  primary: Res | null; backups: Res[]
  contracts: { key: string; id: string; title: string; minutes: number; done: boolean }[]
  entries: Entry[]; follow_ups: { n: number; due: string; passed: boolean; due_now: boolean }[]
  progress: { minutes: number; hours_est: number | null; share: number | null; notes: number; contracts_done: number; contracts: number }
}

const STAGES = ['choose', 'study', 'contracts', 'review', 'mastered'] as const

export function StudyPage() {
  return (
    <div className="mission-page study">
      <MissionHeader n="M2" title="Study" sub="Exams, one node at a time, and the daily concept" />
      <div className="study-stack">
        <ExamsCard />
        <div className="study-grid">
          <section className="study-main"><StudyNodeCard /></section>
          <aside className="study-side"><LearnCard /></aside>
        </div>
      </div>
    </div>
  )
}

export function StudyNodeCard() {
  const bank = useMemo(() => loadBank(), [])
  const statuses = usePlan((s) => s.state?.statuses) as Record<string, string> | undefined
  const chosen = useStudyNode((s) => s.id)
  const setNode = useStudyNode((s) => s.set)
  const toast = useStore((s) => s.toast)
  const fallback = bank.order.find((n) => statuses?.[n] === 'in_progress') ?? bank.order.find((n) => statuses?.[n] === 'available') ?? bank.order[0]
  const id = chosen ?? fallback
  const [a, setA] = useState<StudyAnswer | null>(null)
  const reload = () => api<StudyAnswer>(`/api/mission/study/${encodeURIComponent(id)}`).then(setA).catch(() => setA(null))
  useEffect(() => { if (id) void reload() }, [id])   // eslint-disable-line react-hooks/exhaustive-deps
  const open = useMemo(() => bank.order.filter((n) => statuses?.[n] === 'in_progress' || statuses?.[n] === 'available'), [bank, statuses])
  const resources = useMemo(() => (a ? [...(a.primary ? [a.primary] : []), ...a.backups] : []), [a])
  if (!id) return null
  const send = async (op: string, body: object) => {
    try { setA(await post<StudyAnswer>(`/api/mission/study/${encodeURIComponent(id)}/${op}`, body)) } catch { toast('Could not save that.', 'fault') }
  }
  const at = a?.stage ? STAGES.indexOf(a.stage) : -1
  const share = Math.max(0, Math.min(1, a?.progress.share ?? 0))
  return (
    <section className="card study-node" aria-label="Study a node">
      <div className="card-head">
        <span className="card-title"><BookMarked size={14} />Study a node</span>
        <select className="field sm" value={id} onChange={(e) => setNode(e.target.value)} aria-label="node">
          {(open.length ? open : bank.order).map((n) => <option key={n} value={n}>{bank.nodes[n]?.name ?? n}</option>)}
        </select>
      </div>
      {a?.node && (<>
        <ol className="stage-rail" aria-label="stage">
          {STAGES.map((s, i) => (
            <li key={s} className={i === at ? 'on' : i < at ? 'past' : ''} aria-current={i === at ? 'step' : undefined}><i aria-hidden /><span>{s}</span></li>))}
        </ol>

        {a.next && (
          <div className="study-next">
            <span className="eyebrow">Next</span>
            <b className="sn-title">{a.next.title}</b>
            <span className="muted small">{a.next.why}{a.next.minutes ? ` · ${a.next.minutes} min` : ''}</span>
            {a.next.kind === 'review' && a.next.due_now && (
              <div className="sn-act"><button className="btn sm" onClick={() => void send('review', { ok: true })}><Check size={12} />I explained it</button>
                <button className="btn sm ghost" onClick={() => void send('review', { ok: false })}>Not yet</button></div>)}
          </div>)}

        <div className="study-prog">
          <span className="sn-bar" aria-hidden><i style={{ transform: `scaleX(${share})` }} /></span>
          <span className="mono muted small">{Math.round(a.progress.minutes / 60 * 10) / 10} / {a.progress.hours_est ?? '?'} h · {a.progress.notes} notes · {a.progress.contracts_done}/{a.progress.contracts} contracts</span>
        </div>

        <details open={a.stage === 'choose'}>
          <summary className="small"><b>Resource</b><span className="sn-sum muted">{a.primary ? a.primary.title : 'not chosen'}</span></summary>
          <div className="res-pick" role="radiogroup" aria-label="primary resource">
            {resources.map((r) => {
              const on = a.primary?.id === r.id
              const meta = [r.kind, r.free ? 'free' : '', r.hours ? `~${r.hours} h` : ''].filter(Boolean).join(' · ')
              return (
                <button key={r.id} role="radio" aria-checked={on} className={`res${on ? ' on' : ''}`} onClick={() => { if (!on) void send('primary', { resource: r.id }) }}>
                  <i aria-hidden /><span className="res-t" title={r.title}>{r.title}</span><span className="res-m mono">{meta}</span>
                </button>)
            })}
          </div>
        </details>

        <StudyLog nodeId={id} onSaved={() => void reload()} />

        {a.contracts.length > 0 && (
          <details open={a.stage === 'contracts'}>
            <summary className="small"><b>Contracts</b><span className="sn-sum muted mono">{a.progress.contracts_done}/{a.progress.contracts} done</span></summary>
            <ul className="sn-contracts">{a.contracts.map((c) => (
              <li key={c.key} className={c.done ? 'done' : ''} aria-label={`${c.title}, ${c.done ? 'done' : 'to do'}`}>
                <span className="tick" aria-hidden>{c.done && <Check size={10} strokeWidth={3} />}</span>
                <span className="t" title={c.title}>{c.title}</span><span className="mono muted">{c.minutes}′</span>
              </li>))}
            </ul>
            <p className="muted small">Contracts are done from Today (they come up in your blocks) or from the Tree's node panel.</p>
          </details>)}

        {a.follow_ups.length > 0 && (
          <div className="follow">
            <span className="eyebrow">Explain it from memory</span>
            {a.follow_ups.map((f) => (
              <span key={f.n} className={`fu mono small${f.passed ? ' passed' : f.due_now ? ' due' : ''}`} title={f.passed ? 'passed' : f.due_now ? 'due now' : `due ${f.due}`}>
                {f.passed && <Check size={10} strokeWidth={3} aria-hidden />}{f.n} · {f.due.slice(5)}</span>))}
          </div>)}

        {a.entries.length > 0 && (
          <details>
            <summary className="small"><b>What you studied</b><span className="sn-sum muted mono">{a.entries.length}</span></summary>
            <div className="sn-entries">
              {a.entries.map((e) => (
                <div key={e.id} className="entry small">
                  <span className="mono muted">{e.date.slice(5)}</span><span className="t" title={e.what}>{e.what}</span><span className="mono muted">{e.minutes}′</span>
                  {e.files.length > 0 && (
                    <span className="entry-files">{e.files.map((f) => (
                      <button key={f.path} className="btn sm ghost" title={f.name} onClick={() => useReader.getState().open(f.path, f.name)}><FileText size={12} /><span>{f.name}</span></button>))}
                    </span>)}
                </div>))}
            </div>
          </details>)}
      </>)}
    </section>
  )
}

/** Log a study session for the node, with notes attached (POST /api/mission/learning). One row. */
function StudyLog({ nodeId, onSaved }: { nodeId: string; onSaved: () => void }) {
  const [what, setWhat] = useState('')
  const [minutes, setMinutes] = useState('45')
  const [files, setFiles] = useState<File[]>([])
  const ref = useRef<HTMLInputElement>(null)
  const toast = useStore((s) => s.toast)
  const save = async () => {
    const enc = await Promise.all(files.map(async (f) => ({ name: f.name, data: await toB64(f) })))
    try {
      const r = await post<{ say: string }>('/api/mission/learning', { what, minutes: Number(minutes) || 0, nodes: [nodeId], files: enc, tags: ['study'] })
      toast(r.say, 'live')
      setWhat(''); setFiles([])
      onSaved()
    } catch { toast('Could not log that session.', 'fault') }
  }
  return (
    <form className="study-log" onSubmit={(e) => { e.preventDefault(); if (what.trim()) void save() }}>
      <input className="field" value={what} onChange={(e) => setWhat(e.target.value)} placeholder="What did you study? (chapter, pages, video)" aria-label="what you studied" />
      <label className="sl-min">
        <input className="field" type="number" min={1} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label="minutes" />
        <span className="mono muted" aria-hidden>min</span>
      </label>
      <button type="button" className="btn sm ghost" title={files.map((f) => f.name).join('\n') || 'Attach notes'} onClick={() => ref.current?.click()}>
        <Paperclip size={13} />{files.length ? `${files.length} note${files.length > 1 ? 's' : ''}` : 'Notes'}</button>
      <input ref={ref} type="file" multiple hidden onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 6))} />
      <button type="submit" className="btn sm" disabled={!what.trim()}><Upload size={13} />Log</button>
    </form>
  )
}
