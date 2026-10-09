/**
 * Yaadash: memory you can see into.
 *  - Search: hybrid BM25 + vector recall, shown as the REAL conversation (both
 *    sides, dated), with the matched words marked — never a paraphrase.
 *  - "Is this true?": the beliefs JARVIS inferred and wants confirmed. Amber until
 *    you answer, because an inference is not a fact.
 *  - People: closeness by your own rule (longevity over reels).
 *  - Taste: what you engage with, as a trajectory across the years.
 */
import { ArrowDownRight, ArrowUpRight, Check, Clock, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api, post } from '../lib/api'
import { fmt, fmtInt, pad2, usePoll } from '../lib/format'
import { useStore } from '../lib/store'
import { PageHeader } from '../components/Shell'

interface Stats {
  archive_messages: number | null; threads: number | null; people: number | null; people_scored: number | null
  memories: number | null; memory_sources: Record<string, number> | null
  beliefs: Record<string, number> | null; taste_topics: number | null; taste_captions: number | null
}
interface Excerpt { date: string | null; who: string | null; messages: { speaker: string; text: string; me: boolean }[] }
interface Fact { text: string; source: string; distance: number | null }
interface SearchRes { query: string; excerpts: Excerpt[]; facts: Fact[]; took_ms: number; excerpts_error?: string }
interface Belief { id: string; claim: string; category: string; era: string; confidence: number; support: number; source: string }
interface Person { name: string; closeness: number; rank: number; span_days: number; n_msgs: number; reciprocity: number; calls: number; share_ratio: number; why: string }
interface Topic { label: string; words: string[]; share: number; trend: string; by_year: Record<string, number> }

const SUGGEST = ['did I complete One Piece?', 'what did I say about Germany', 'who was I talking to in 2023', 'my CGPA']

export function YaadashPage() {
  const [stats] = usePoll(() => api<Stats>('/api/memory/stats'), 60000)
  const pending = useStore((s) => s.pendingQuery)
  const setPending = useStore((s) => s.setPendingQuery)
  const [q, setQ] = useState('')
  const [res, setRes] = useState<SearchRes | null>(null)
  const [searching, setSearching] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const run = async (query: string) => {
    const t = query.trim()
    if (!t) return
    setQ(t)
    setSearching(true)
    setErr(null)
    try {
      setRes(await api<SearchRes>(`/api/memory/search?q=${encodeURIComponent(t)}`))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSearching(false)
    }
  }

  useEffect(() => {
    if (pending) {
      void run(pending)
      setPending(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])

  const unconfirmed = stats?.beliefs?.unconfirmed ?? 0
  return (
    <div className="page fade-in">
      <PageHeader tab="yaadash" />
      <div className="stat-strip">
        <Stat label="Messages archived" value={stats?.archive_messages} sub={`${fmtInt(stats?.threads)} conversations`} />
        <Stat label="People" value={stats?.people_scored} sub={`of ${fmtInt(stats?.people)} threads, scored`} />
        <Stat label="Facts in memory" value={stats?.memories}
          sub={stats?.memory_sources ? Object.entries(stats.memory_sources).map(([k, v]) => `${k} ${v}`).join(' · ') : '—'} />
        <Stat label="Taste topics" value={stats?.taste_topics} sub={`from ${fmtInt(stats?.taste_captions)} liked & saved posts`} />
        <Stat label="Waiting for you" value={unconfirmed} sub={`${stats?.beliefs?.confirmed ?? 0} confirmed so far`} amber />
      </div>

      <div className="yd-grid">
        <div className="yd-col">
          <section>
            <form className="searchbar glass" onSubmit={(e) => { e.preventDefault(); void run(q) }}>
              <Search size={19} className="muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask your memory anything — a moment, a person, a fact…" />
              <button className="btn primary" disabled={searching || !q.trim()}>{searching ? 'Recalling…' : 'Recall'}</button>
            </form>
            {!res && (
              <div className="chips">
                {SUGGEST.map((s) => <button key={s} className="chip" onClick={() => void run(s)}>{s}</button>)}
              </div>
            )}
          </section>
          {err && <div className="banner"><X size={16} className="fault" />{err}</div>}
          {res && <Results res={res} />}
        </div>
        <div className="yd-col">
          <BeliefQueue />
          <People />
          <Taste />
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, sub, amber }: { label: string; value: number | null | undefined; sub: string; amber?: boolean }) {
  return (
    <div className={`card stat ${amber ? 'amber' : ''}`}>
      <span className="eyebrow">{label}</span>
      <span className="dot">{fmtInt(value)}</span>
      <small>{sub}</small>
    </div>
  )
}

/* ------------------------------------------------------------------ results */
function highlight(text: string, terms: string[]) {
  if (!terms.length) return text
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))
}

function Results({ res }: { res: SearchRes }) {
  const terms = useMemo(() => res.query.toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !['what', 'did', 'about', 'with', 'that', 'this', 'have'].includes(w)), [res.query])
  return (
    <>
      <div className="mono muted" style={{ margin: '-4px 4px 0' }}>
        {res.excerpts.length} moment{res.excerpts.length === 1 ? '' : 's'} · {res.facts.length} facts · {res.took_ms} ms
      </div>
      {res.excerpts.length === 0 && (
        <div className="card empty">Nothing in the archive matched closely enough. Yaadash says so instead of guessing.</div>
      )}
      {res.excerpts.map((ex, i) => (
        <section key={i} className="card excerpt fade-in">
          <div className="ex-head">
            <span><span className="mono muted" style={{ marginRight: 10 }}>{pad2(i + 1)}</span><span className="ex-who">{ex.who}</span></span>
            <span className="mono muted"><Clock size={11} style={{ verticalAlign: -1, marginRight: 5 }} />{ex.date}</span>
          </div>
          <div className="bubbles">
            {ex.messages.map((m, j) => {
              const hit = terms.some((t) => m.text.toLowerCase().includes(t))
              return (
                <div key={j} className={`bubble ${m.me ? 'me' : ''} ${hit ? 'hit' : ''}`}>
                  {!m.me && <span className="who">{m.speaker}</span>}
                  {highlight(m.text, terms)}
                </div>
              )
            })}
          </div>
        </section>
      ))}
      {res.facts.length > 0 && (
        <section className="card">
          <div className="card-head"><span className="card-title"><span className="track">F</span>Facts in memory</span>
            <span className="mono muted">relevance</span></div>
          {res.facts.map((f, i) => {
            const rel = f.distance === null ? 0 : Math.max(0, 1 - f.distance / 0.6)
            return (
              <div key={i} className="fact">
                <div>
                  <div style={{ userSelect: 'text' }}>{f.text}</div>
                  <div className="src">
                    {f.source}
                    {/* JARVIS's own past replies were stored back into memory — some of them
                        hallucinated. They are shown, but never as evidence. */}
                    {f.source?.startsWith('voice_interaction') && <span className="pill sim" style={{ marginLeft: 8, height: 18 }}>JARVIS’s own words · unverified</span>}
                  </div>
                </div>
                <div className="rel"><span className="mono muted">{fmt(f.distance, 2)}</span>
                  <div className={`bar ${rel > 0.45 ? 'live' : ''}`}><i style={{ width: `${rel * 100}%` }} /></div></div>
              </div>
            )
          })}
        </section>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ beliefs */
function BeliefQueue() {
  const [items, , reload] = usePoll(() => api<Belief[]>('/api/memory/questions?n=8'), 0)
  const [i, setI] = useState(0)
  const [correcting, setCorrecting] = useState(false)
  const [correction, setCorrection] = useState('')
  const toast = useStore((s) => s.toast)
  const b = items?.[i]

  const answer = async (verdict: string, corr?: string) => {
    if (!b) return
    try {
      await post(`/api/memory/beliefs/${b.id}`, { verdict, correction: corr ?? null })
      toast(verdict === 'confirmed' ? 'Confirmed — JARVIS will state it as fact.' : verdict === 'rejected' ? 'Rejected — never surfaced again.' : 'Kept as the past, not the present.', verdict === 'confirmed' ? 'live' : 'info')
      setCorrecting(false)
      setCorrection('')
      if (i + 1 >= (items?.length ?? 0)) { setI(0); reload() } else setI(i + 1)
    } catch (e) {
      toast((e as Error).message, 'fault')
    }
  }

  return (
    <section className="card belief">
      <div className="card-head">
        <span className="card-title"><span className="track">C1</span>Is this true?</span>
        <span className="mono muted">{items ? `${Math.min(i + 1, items.length)} / ${items.length}` : '…'}</span>
      </div>
      {!b && <div className="empty">{items ? 'Nothing to confirm. JARVIS is sure of everything it knows.' : 'Loading…'}</div>}
      {b && (
        <div key={b.id} className="fade-in">
          <div className="belief-meta">
            <span className="pill sim"><i className="led" />unconfirmed</span>
            <span className="pill">{b.category}</span>
            <span className="pill">{b.era}</span>
            <span className="mono muted">from {b.source}{b.support > 1 ? ` · ${b.support} messages agree` : ''}</span>
          </div>
          <div className="belief-claim">{b.claim}</div>
          <div className="conf-meter">
            <span className="eyebrow">JARVIS’s confidence</span>
            <div className="bar sim"><i style={{ width: `${b.confidence * 100}%` }} /></div>
            <span className="mono">{Math.round(b.confidence * 100)}%</span>
          </div>
          <div className="belief-btns">
            <button className="btn live" onClick={() => void answer('confirmed')}><Check size={15} />True</button>
            <button className="btn" onClick={() => void answer('outdated')}>Used to be</button>
            <button className="btn danger" onClick={() => void answer('rejected')}><X size={15} />False</button>
          </div>
          {!correcting
            ? <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => setCorrecting(true)}>Correct it instead…</button>
            : (
              <form className="belief-correct" onSubmit={(e) => { e.preventDefault(); if (correction.trim()) void answer('rejected', correction.trim()) }}>
                <input className="field" autoFocus value={correction} onChange={(e) => setCorrection(e.target.value)} placeholder="What's actually true?" />
                <button className="btn primary">Save</button>
              </form>
            )}
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ people */
function People() {
  const [people] = usePoll(() => api<Person[]>('/api/memory/people?limit=10'), 0)
  return (
    <section className="card">
      <div className="card-head">
        <span className="card-title"><span className="track">C2</span>Closest people</span>
        <span className="mono muted">longevity &gt; reels</span>
      </div>
      {!people && <div className="empty">Loading…</div>}
      {people?.map((p, i) => (
        <div key={p.name + i} className="person">
          <span className="person-n">{pad2(i + 1)}</span>
          <div style={{ minWidth: 0 }}>
            <div className="person-name">{p.name}</div>
            <div className="person-why">{(p.span_days / 365).toFixed(1)} yrs · {fmtInt(p.n_msgs)} msgs{p.calls ? ` · ${p.calls} calls` : ''}{p.share_ratio > 0.4 ? ` · ${Math.round(p.share_ratio * 100)}% reels` : ''}</div>
          </div>
          <div className="person-score">
            <span className="mono">{fmt(p.closeness, 0)}</span>
            <div className="bar"><i style={{ width: `${p.closeness}%` }} /></div>
          </div>
        </div>
      ))}
    </section>
  )
}

/* ------------------------------------------------------------------ taste */
function Taste() {
  const [taste] = usePoll(() => api<{ topics: Topic[]; n_captions: number; recent_from: number }>('/api/memory/taste'), 0)
  const topics = taste?.topics.slice(0, 9) ?? []
  return (
    <section className="card">
      <div className="card-head">
        <span className="card-title"><span className="track">C3</span>Taste over time</span>
        <span className="pill sim" title="Topic names are the local model's inference from top words">names inferred</span>
      </div>
      {topics.map((t) => {
        const years = Object.entries(t.by_year).sort(([a], [b]) => Number(a) - Number(b)).slice(-8)
        const mx = Math.max(...years.map(([, v]) => v), 1e-9)
        return (
          <div key={t.label} className="topic">
            <div style={{ minWidth: 0 }}>
              <div className="topic-label">{t.label}</div>
              <div className="topic-words">{t.words.slice(0, 6).join(' · ')}</div>
            </div>
            <div className="yearbars" title={years.map(([y, v]) => `${y}: ${v.toFixed(0)}`).join('\n')}>
              {years.map(([y, v]) => <i key={y} className={Number(y) >= (taste?.recent_from ?? 2025) ? 'recent' : ''} style={{ height: `${Math.max(4, (v / mx) * 100)}%` }} />)}
            </div>
            <span className={`trend ${t.trend}`}>
              {t.trend === 'rising' ? <ArrowUpRight size={11} style={{ verticalAlign: -1 }} /> : t.trend === 'faded' || t.trend === 'falling' ? <ArrowDownRight size={11} style={{ verticalAlign: -1 }} /> : null}
              {t.trend}
            </span>
          </div>
        )
      })}
    </section>
  )
}
