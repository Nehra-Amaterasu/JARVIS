// The local library (parity C07): the rail card and the drawer body. The card says what the route reported (documents, pages,
// passages, and scanned pages that could NOT be read) and a running job's real progress; a route that does not answer is
// WAITING with the reason and no number. The drawer holds the rest: add a folder or file, the document list, ask your notes
// (an answer with clickable citations that open the exact passage, file and page) and forget a document (two presses; the
// file itself is never touched).
import { BookOpenText, FolderPlus, Trash2 } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Lamp, showsNumber, type LampReading } from '../../shared/lamp'
import { KIND_LABEL, answerTone, docSummary, jobFraction, jobSummary, markTerms, sourceLabel, splitCitations, type LibraryAnswer } from '../../lib/library'
import { simState, type RouteStatus } from './model'
import type { LibraryLive } from './useSound'
import './sound.css'

const EXAMPLES = ['Explain setup and hold time', 'How do I group ones on a K-map?']

export function libraryReading(route: RouteStatus, hasView: boolean, simulated: boolean): LampReading {
  if (hasView && route.ok) return { state: simState('live', simulated), since: route.at, reason: 'the library route answered' }
  const reason = route.reason ? `the library route did not answer: ${route.reason}` : 'reading the library'
  return { state: 'waiting', since: null, reason }
}

export function LibraryCard({ lib, simulated, onOpen }: { lib: LibraryLive; simulated: boolean; onOpen: () => void }) {
  const v = lib.view
  const reading = libraryReading(lib.route, !!v, simulated)
  const num = showsNumber(reading.state)
  const job = v?.job
  return (
    <section className="sd-tool" aria-label="Study library" data-card="library">
      <div className="sd-tool-text">
        <h3><span className="sd-tag">[LIB]</span>Study library<Lamp reading={reading} subject="Library" /></h3>
        {num && v ? (
          lib.running && job ? (
            <div className="sd-job" role="status">
              <div className="sd-job-line"><span>Reading {job.current ?? 'the folder'}</span>{job.total ? <span>{job.done ?? 0} / {job.total}</span> : null}</div>
              <div className="sd-bar"><i style={{ width: `${jobFraction(job) * 100}%` }} /></div>
            </div>
          ) : (
            <p className="sd-note">{v.documents} document{v.documents === 1 ? '' : 's'}, {v.pages} pages, {v.chunks} passages{v.scanned_pages ? `; ${v.scanned_pages} scanned page${v.scanned_pages === 1 ? '' : 's'} not read` : ''}.</p>
          )
        ) : (
          <p className="sd-note">No count shown: {reading.reason}.</p>
        )}
      </div>
      <button type="button" className="sd-key" onClick={onOpen} data-open="library"><BookOpenText size={16} aria-hidden="true" />Open</button>
    </section>
  )
}

function Answer({ ans }: { ans: LibraryAnswer }) {
  const tone = answerTone(ans)
  const segs = useMemo(() => splitCitations(ans.answer ?? ''), [ans.answer])
  const terms = useMemo(() => markTerms(ans.question), [ans.question])
  const byN = useMemo(() => new Map(ans.sources.map((s) => [s.n, s])), [ans.sources])
  const [open, setOpen] = useState<number | null>(ans.used[0] ?? null)
  const shown = open != null ? byN.get(open) : undefined
  const verdict = tone === 'live' ? { state: 'live' as const, word: 'cited from your notes' }
    : tone === 'quiet' ? { state: 'waiting' as const, word: 'not in your notes' }
      : tone === 'sim' ? { state: 'waiting' as const, word: 'uncited, check it' }
        : { state: 'fault' as const, word: ans.llm_error ? 'local model down' : 'cites a passage that does not exist' }
  const hl = (t: string) => (terms.length ? t.split(new RegExp(`(${terms.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')).map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p)) : t)
  return (
    <div className="sd-answer" role="status" data-tone={tone}>
      <Lamp reading={{ state: verdict.state, since: null, reason: verdict.word }} />
      <p className="sd-note">{verdict.word}{ans.llm ? `, drafted by ${ans.llm}` : ''}{ans.mode === 'keyword-only' ? ', keywords only' : ''}</p>
      {ans.llm_error ? (
        <p className="sd-answer-text">The local model did not answer ({ans.llm_error}). These are the passages it would have read.</p>
      ) : (
        <p className="sd-answer-text">
          {segs.map((s, i) => s.kind === 'text'
            ? <span key={i}>{s.text}</span>
            : s.ns.map((n) => (
              <button key={`${i}-${n}`} type="button" className="sd-cite" aria-pressed={open === n} aria-label={byN.has(n) ? `Show passage ${n}` : `Passage ${n} does not exist`}
                onClick={() => byN.has(n) && setOpen(open === n ? null : n)}>{n}</button>
            )))}
        </p>
      )}
      {ans.abstained && ans.reason && <p className="sd-note">{ans.reason}</p>}
      {shown && (
        <p className="sd-passage"><b>{sourceLabel(shown)}{shown.path ? ` · ${shown.path}` : ''}</b>{hl(shown.text)}</p>
      )}
    </div>
  )
}

export function LibraryBody({ lib, simulated, initial = null }: { lib: LibraryLive; simulated: boolean; /** An answer already on the page (the gallery draws one). */ initial?: LibraryAnswer | null }) {
  const v = lib.view
  const reading = libraryReading(lib.route, !!v, simulated)
  const [path, setPath] = useState('')
  const [q, setQ] = useState('')
  const [ans, setAns] = useState<LibraryAnswer | null>(initial)
  const [sure, setSure] = useState<string | null>(null)
  const has = !!v?.documents
  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (!path.trim() || lib.running) return
    if (await lib.add(path)) setPath('')
  }
  const ask = async (text: string) => {
    const t = text.trim()
    if (!t || !has) return
    setQ(t)
    setAns(null)
    setAns(await lib.ask(t))
  }
  return (
    <>
      <div className="sd-row"><Lamp reading={reading} subject="Library" /><p className="sd-note">{v ? `${v.mode === 'hybrid' ? 'Words and meaning, offline' : 'Keywords only'}. ${v.documents} document${v.documents === 1 ? '' : 's'}, ${v.pages} pages, ${v.chunks} passages.` : reading.reason}</p></div>

      <form className="sd-field" onSubmit={add}>
        <label htmlFor="sd-lib-path">Add notes</label>
        <div className="sd-row">
          <input id="sd-lib-path" className="sd-well" value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false} placeholder="A folder or file of notes" aria-disabled={!v || undefined} readOnly={!v} />
          <button type="submit" className="sd-key" aria-disabled={!v || lib.running || !path.trim() || undefined}><FolderPlus size={16} aria-hidden="true" />{lib.running ? 'Reading' : 'Add'}</button>
        </div>
      </form>
      {lib.running && v?.job && (
        <div className="sd-job" role="status">
          <div className="sd-job-line"><span>Reading {v.job.current ?? 'the folder'}</span>{v.job.total ? <span>{v.job.done ?? 0} / {v.job.total}</span> : null}</div>
          <div className="sd-bar"><i style={{ width: `${jobFraction(v.job) * 100}%` }} /></div>
        </div>
      )}
      {lib.note && !lib.running && <p className="sd-note" role="status">{lib.note}{v?.job?.state === 'done' ? ` ${jobSummary(v.job)}` : ''}</p>}
      {lib.error && <p className="sd-note" role="alert" data-fault="">Not done: {lib.error}</p>}

      {v && !has && !lib.running && <p className="sd-empty">No notes yet. Add a folder of lecture PDFs, slides, Word or Markdown notes. They are read here, offline, and every answer names the page it came from.</p>}
      {has && (
        <ul className="sd-docs" aria-label="Documents">
          {v!.docs.map((d) => (
            <li key={d.doc_id} className="sd-doc" title={d.path}>
              <span className="sd-doc-kind">{KIND_LABEL[d.kind] ?? d.kind}</span>
              <span><span className="sd-doc-name">{d.file}</span><br /><span className="sd-doc-sub">{docSummary(d)}</span></span>
              <button type="button" className="sd-key" data-quiet="true" data-danger={sure === d.doc_id || undefined} aria-label={sure === d.doc_id ? `Forget ${d.file}, press again` : `Forget ${d.file}`}
                onBlur={() => setSure(null)} onClick={() => { if (sure !== d.doc_id) setSure(d.doc_id); else { setSure(null); void lib.forget(d.doc_id) } }}>
                {sure === d.doc_id ? 'Forget?' : <Trash2 size={16} aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="sd-field" onSubmit={(e) => { e.preventDefault(); void ask(q) }}>
        <label htmlFor="sd-lib-ask">Ask your notes</label>
        <div className="sd-row">
          <input id="sd-lib-ask" className="sd-well" value={q} onChange={(e) => setQ(e.target.value)} placeholder={has ? 'The answer cites the page' : 'Add notes first'} aria-disabled={!has || undefined} readOnly={!has} />
          <button type="submit" className="sd-key" aria-disabled={!has || lib.asking || !q.trim() || undefined}>{lib.asking ? 'Reading' : 'Ask'}</button>
        </div>
      </form>
      {has && !ans && !lib.asking && (
        <div className="sd-eg">{EXAMPLES.map((s) => <button key={s} type="button" className="sd-chip" onClick={() => void ask(s)}>{s}</button>)}</div>
      )}
      {lib.asking && <p className="sd-note" role="status">Searching {v?.chunks ?? ''} passages, then the local model reads the best five.</p>}
      {ans && !lib.asking && <Answer key={`${ans.question}-${ans.took_ms}`} ans={ans} />}
    </>
  )
}
