/**
 * The study library (ROADMAP Y5 / SIH-4) as a Yaadash card: my notes, asked with
 * citations, offline.
 *
 *   add      a folder or file path -> read in the background, a scanning skeleton
 *            and a progress meter while it runs
 *   list     every document with what JARVIS really holds of it: pages, passages,
 *            and scanned pages it could NOT read (amber, never hidden)
 *   ask      the answer with clickable [n]; each opens the exact passage it came
 *            from, with its file, page and path, so the claim can be checked
 *
 * Colour is provenance: a cited passage is cyan (it is my own document's text);
 * an uncited answer or keyword-only search is amber (check it); a dead model or a
 * citation to a passage that does not exist is red. "Not in your notes" is quiet:
 * saying so is the feature working, not failing.
 */
import { BookOpenText, CircleAlert, FolderPlus, Quote, ScanLine, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, post } from '../lib/api'
import { usePoll } from '../lib/format'
import {
  KIND_LABEL, answerTone, docSummary, jobFraction, jobSummary, markTerms, sourceLabel, splitCitations,
  type LibraryAnswer, type LibraryDoc, type LibrarySource, type LibraryView,
} from '../lib/library'
import { Presence, Ticker } from '../lib/motion'
import { useStore } from '../lib/store'
import '../styles/library.css'

const EXAMPLES = ['Explain setup and hold time', 'How do I group ones on a K-map?', 'AC ki warranty kab tak hai?']

const seconds = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`)

export function LibraryPanel() {
  const toast = useStore((s) => s.toast)
  const [polling, setPolling] = useState(false)
  const [view, , reload] = usePoll(() => api<LibraryView>('/api/library'), polling ? 900 : 0)
  const job = view?.job
  const running = job?.state === 'running'

  // Poll only while an ingest runs; announce it once when it ends.
  const lastState = useRef<string | undefined>(undefined)
  useEffect(() => {
    setPolling(running)
    if (lastState.current === 'running' && job && job.state !== 'running') {
      if (job.state === 'done') toast(`Library: ${jobSummary(job)}`, 'live')
      else toast(`Library: ${job.error ?? 'reading failed'}`, 'fault')
    }
    lastState.current = job?.state
  }, [job?.state])                                              // eslint-disable-line react-hooks/exhaustive-deps

  const [path, setPath] = useState('')
  const [adding, setAdding] = useState(false)
  const add = async () => {
    const p = path.trim()
    if (!p) return
    setAdding(true)
    try {
      await post('/api/library/ingest', { path: p })
      setPath('')
      setPolling(true)
      reload()
    } catch (e) {
      toast((e as Error).message, 'fault')
    } finally {
      setAdding(false)
    }
  }

  const [confirm, setConfirm] = useState<string | null>(null)
  const forget = async (d: LibraryDoc) => {
    if (confirm !== d.doc_id) { setConfirm(d.doc_id); return }
    try {
      await api(`/api/library/doc/${d.doc_id}`, { method: 'DELETE' })
      toast(`Forgot ${d.file}. The file itself is untouched.`, 'info')
      reload()
    } catch (e) {
      toast((e as Error).message, 'fault')
    } finally {
      setConfirm(null)
    }
  }

  const [q, setQ] = useState('')
  const [asking, setAsking] = useState(false)
  const [ans, setAns] = useState<LibraryAnswer | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const ask = async (question: string) => {
    const t = question.trim()
    if (!t) return
    setQ(t)
    setAsking(true)
    setErr(null)
    try {
      const res = await post<LibraryAnswer>('/api/library/ask', { question: t })
      setAns(res)
      // Open the first cited passage: the answer is only as good as what it cites.
      setOpen(res.used[0] ?? null)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setAsking(false)
    }
  }

  const hasDocs = !!view?.documents
  return (
    <section className="card library">
      <div className="card-head">
        <span className="card-title"><span className="track">L</span>Study library</span>
        {view && (
          <span key={view.mode} className={`pill pop ${view.mode === 'hybrid' ? 'live' : 'sim'}`}
            title={view.mode === 'hybrid' ? 'Keywords + meaning (bge-small, on this PC)' : `No embedder: keyword search only${view.embedder.error ? ` (${view.embedder.error})` : ''}`}>
            {view.mode === 'hybrid' ? 'hybrid · offline' : 'keywords only'}
          </span>
        )}
      </div>

      <div className="lib-stats">
        <span><b className="dot"><Ticker value={view ? view.documents : null} /></b>documents</span>
        <span><b className="dot"><Ticker value={view ? view.pages : null} /></b>pages</span>
        <span><b className="dot"><Ticker value={view ? view.chunks : null} /></b>passages</span>
        {!!view?.scanned_pages && (
          <span className="sim" title={view.ocr ? 'Read by OCR' : 'Scanned pages have no text layer, and no local OCR is installed'}>
            <b className="dot"><Ticker value={view.scanned_pages} /></b>scanned, unread
          </span>
        )}
      </div>

      <form className="lib-add" onSubmit={(e) => { e.preventDefault(); void add() }}>
        <FolderPlus size={16} className="muted" />
        <input name="path" value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false}
          placeholder="A folder or file of notes, e.g. D:\Notes\Sem 5" aria-label="Path of a folder or file to add" />
        <button className="btn sm" disabled={adding || running || !path.trim()}>{running ? 'Reading…' : 'Add'}</button>
      </form>

      <Presence show={running}>
        <div className="lib-job rise">
          <div className="lib-job-line mono">
            <ScanLine size={13} className="breathe live" />
            <span className="lib-job-file">Reading {job?.current ?? 'the folder'}</span>
            {job?.total ? <span className="muted"><Ticker value={job.done ?? 0} /> / {job.total}</span> : null}
          </div>
          <div className="meter live"><i style={{ width: `${jobFraction(job) * 100}%` }} /></div>
          <div className="lib-skel" aria-hidden>
            {[0, 1, 2].map((i) => <div key={i} className="skeleton scan rise" style={{ ['--i' as string]: i }} />)}
          </div>
        </div>
      </Presence>

      {job?.state === 'done' && !running && (
        <div key={`done-${job.took_s}`} className="lib-last mono pop">
          Last read: {jobSummary(job)}{job.took_s != null ? ` · ${job.took_s.toFixed(0)} s` : ''}
          {job.problems?.map((p) => <div key={p.file} className="sim">{p.file}: {p.note ?? p.status}</div>)}
        </div>
      )}
      {job?.state === 'failed' && !running && (
        <div className="banner pop"><CircleAlert size={16} className="fault" />{job.error}</div>
      )}

      {!view && <div className="lib-skel" aria-hidden>{[0, 1].map((i) => <div key={i} className="skeleton scan" />)}</div>}
      {view && !hasDocs && !running && (
        <div className="empty lib-empty rise">
          No notes yet. Add a folder of lecture PDFs, slides, Word or Markdown notes — they are read here,
          offline, and every answer names the page it came from.
        </div>
      )}
      {hasDocs && (
        <div className="lib-docs">
          {view!.docs.map((d, i) => (
            <div key={d.doc_id} className="lib-doc rise" style={{ ['--i' as string]: Math.min(i, 12) }} title={d.path}>
              <span className={`lib-kind k-${d.kind}`}>{KIND_LABEL[d.kind] ?? d.kind}</span>
              <div className="lib-doc-main">
                <div className="lib-doc-name">{d.file}</div>
                <div className="lib-doc-sub">{docSummary(d)}</div>
              </div>
              <span className="lib-doc-flags">
                {d.scanned.length > 0 && <span className="pill sim" title={d.notes.join('\n')}>scanned</span>}
                {d.ocr.length > 0 && <span className="pill sim" title="Text recognised by OCR: estimated">OCR</span>}
                {view!.mode === 'hybrid' && d.chunks > 0 && !d.embedder && <span className="pill sim" title="Stored without vectors; keyword search only until re-read">keywords</span>}
              </span>
              <button className={`btn ghost sm ${confirm === d.doc_id ? 'danger' : 'icon'}`} onClick={() => void forget(d)}
                onBlur={() => setConfirm(null)} aria-label={`Forget ${d.file}`}
                title="Forget this document (the file itself is untouched)">
                {confirm === d.doc_id ? 'Forget?' : <Trash2 size={13} />}
              </button>
            </div>
          ))}
        </div>
      )}

      <form className="lib-ask" onSubmit={(e) => { e.preventDefault(); void ask(q) }}>
        <BookOpenText size={17} className="muted" />
        <input name="q" value={q} onChange={(e) => setQ(e.target.value)} disabled={!hasDocs}
          placeholder={hasDocs ? 'Ask your notes — the answer cites the page' : 'Add notes first, then ask them'} aria-label="Question for your notes" />
        <button className="btn primary sm" disabled={asking || !q.trim() || !hasDocs}>{asking ? 'Reading…' : 'Ask'}</button>
      </form>
      {hasDocs && !ans && !asking && (
        <div className="chips lib-chips">
          {EXAMPLES.map((s, i) => <button key={s} className="chip rise" style={{ ['--i' as string]: i }} onClick={() => void ask(s)}>{s}</button>)}
        </div>
      )}

      {asking && (
        <div className="lib-thinking rise" aria-live="polite">
          <div className="skeleton scan" style={{ width: '94%' }} />
          <div className="skeleton scan" style={{ width: '78%' }} />
          <span className="mono muted">Searching {view?.chunks ?? ''} passages, then the local model reads the best five…</span>
        </div>
      )}
      {err && <div className="banner pop"><X size={16} className="fault" />{err}</div>}
      {ans && !asking && <Answer key={`${ans.question}-${ans.took_ms}`} ans={ans} open={open} setOpen={setOpen} />}
    </section>
  )
}

function highlight(text: string, terms: string[]): ReactNode {
  if (!terms.length) return text
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))
}

function Answer({ ans, open, setOpen }: { ans: LibraryAnswer; open: number | null; setOpen: (n: number | null) => void }) {
  const tone = answerTone(ans)
  const segs = useMemo(() => splitCitations(ans.answer ?? ''), [ans.answer])
  const terms = useMemo(() => markTerms(ans.question), [ans.question])
  const byN = useMemo(() => new Map(ans.sources.map((s) => [s.n, s])), [ans.sources])
  const shown = open != null ? byN.get(open) : undefined
  // Keep the last passage on screen while its panel animates out.
  const last = useRef<LibrarySource | undefined>(shown)
  if (shown) last.current = shown
  const quote = shown ?? last.current
  const toggle = (n: number) => setOpen(open === n ? null : n)

  return (
    <div className={`lib-answer rise tone-${tone}`}>
      <div className="lib-answer-head">
        {tone === 'live' && <span className="pill live pop"><i className="led" />cited from your notes</span>}
        {tone === 'quiet' && <span className="pill pop">not in your notes</span>}
        {tone === 'sim' && <span className="pill sim pop">uncited — check it</span>}
        {tone === 'fault' && <span className="pill fault pop">{ans.llm_error ? 'local model down' : 'cites a passage that does not exist'}</span>}
        <span className="mono muted lib-meta">
          {ans.llm ? `drafted by ${ans.llm} · ` : ''}{ans.mode === 'keyword-only' ? 'keywords only · ' : ''}{seconds(ans.took_ms)}
        </span>
      </div>

      {ans.llm_error
        ? <p className="lib-answer-text dim">The local model did not answer ({ans.llm_error}). These are the passages it would have read.</p>
        : (
          <p className="lib-answer-text">
            {segs.map((s, i) => s.kind === 'text'
              ? <span key={i}>{s.text}</span>
              : s.ns.map((n) => (
                <button key={`${i}-${n}`} type="button" className={`cite pop ${byN.has(n) ? '' : 'bad'} ${open === n ? 'on' : ''}`}
                  onClick={() => byN.has(n) && toggle(n)} aria-label={byN.has(n) ? `Show passage ${n}` : `Passage ${n} does not exist`}
                  title={byN.has(n) ? sourceLabel(byN.get(n)!) : 'The model cited a passage it was never given'}>{n}</button>
              )))}
          </p>
        )}
      {ans.abstained && ans.reason && <div className="mono muted lib-reason">{ans.reason}</div>}
      {ans.caveat && <div className="lib-caveat sim pop"><CircleAlert size={12} />{ans.caveat}</div>}

      {ans.sources.length > 0 && (
        <div className="lib-sources">
          <span className="eyebrow">{ans.abstained ? 'Closest passages — not enough to answer' : 'Passages read'}</span>
          {ans.sources.map((s, i) => (
            <button key={s.id} type="button" style={{ ['--i' as string]: i }} onClick={() => toggle(s.n)} aria-pressed={open === s.n}
              className={`lib-src rise ${ans.used.includes(s.n) ? 'used' : ''} ${open === s.n ? 'on' : ''}`}>
              <span className="lib-src-n mono">{s.n}</span>
              <span className="lib-src-body">
                <span className="lib-src-file">{s.file}</span>
                <span className="mono lib-src-loc">{s.loc}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <Presence show={!!shown}>
        <div key={quote?.id ?? 'none'} className="lib-quote glass-thin rise">
          <div className="lib-quote-head">
            <Quote size={13} />
            <span className="mono">[{quote?.n}] {quote ? sourceLabel(quote) : ''}</span>
          </div>
          <p>{quote ? highlight(quote.text, terms) : null}</p>
          {quote?.path && <div className="mono muted lib-quote-path">{quote.path}</div>}
        </div>
      </Presence>
    </div>
  )
}
