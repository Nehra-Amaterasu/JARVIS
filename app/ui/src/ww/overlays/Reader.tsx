// O3 Reader (plan 4.11, 6): a generated paper, or a sheet, over the centre. The Drawer (kit) portals it to
// document.body, so it opens at any scroll position of the page behind it (audit STUDY-01), traps focus and
// closes on Esc. This file adds what only the Reader knows: the paper as ONE numbered list, every stem through
// MathText, a visible Raw toggle so converted maths is never silent, J / K between sections, the marks entry
// beside the paper, and the line after Save marks.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { TOKEN } from '../../lib/api'
import { renderMarkdown } from '../../germoney/Reader'
import { Banner, Button, EmptyState, PrimaryButton } from '../kit'
import { MathText } from '../math/MathText'
import { registerOverlay } from '../frame/overlayRegistry'
import type { PQuestion } from '../study/api'
import { useStudy } from '../study/studyStore'
import './reader.css'

const SEED_P_NONE = 0.1   // ww_generator.SEED_P["none"]: a topic nobody has tapped; showing it on every line would be noise

/** "Answer any 5 of 10. 2 marks each." in words, as the plan's section heading. */
export function sectionLine(s: { name: string; marks: number; attempt: number; set: number }): string {
  const pick = s.attempt < s.set ? `Answer any ${s.attempt} of ${s.set}.` : s.set === 1 ? 'Answer the question.' : `Answer all ${s.set}.`
  return `Section ${s.name}. ${pick} ${s.marks} ${s.marks === 1 ? 'mark' : 'marks'} each.`
}

const stepOf = (marks: number) => (marks > 2 ? 1 : 0.5)
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

function Stepper({ q, n, value, onChange }: { q: PQuestion; n: number; value: number | undefined; onChange: (v: number) => void }) {
  const step = stepOf(q.marks)
  const set = value === undefined
  return (
    <span className="ww-q-step" role="group" aria-label={`Marks for question ${n}`}>
      <Button grouped size="sm" aria-label={`One step less for question ${n}`} disabled={set || value <= 0} onClick={() => onChange(Math.max(0, (value ?? 0) - step))}>
        <Minus size={14} aria-hidden="true" />
      </Button>
      <output className="ww-q-got" aria-live="polite">{set ? '–' : num(value)} / {num(q.marks)}</output>
      <Button grouped size="sm" aria-label={`One step more for question ${n}`} disabled={!set && value >= q.marks} onClick={() => onChange(Math.min(q.marks, (value ?? 0) + step))}>
        <Plus size={14} aria-hidden="true" />
      </Button>
    </span>
  )
}

export function PaperReader() {
  const practice = useStudy((s) => s.practice)
  const exam = useStudy((s) => s.exams?.papers.find((p) => p.id === s.practice?.paperId))
  const [raw, setRaw] = useState(false)
  const [got, setGot] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const seedKey = `${practice?.paperId}|${practice?.seed}|${practice?.tier}`
  useEffect(() => { setGot({}); setErr(null) }, [seedKey])

  const paper = practice?.paper ?? null
  // numbering runs on across the paper: the server restarts each section at 1 (audit FMT-3)
  const rows = useMemo(() => {
    let n = 0
    return (paper?.sections ?? []).map((s) => ({ s, qs: s.questions.map((q) => ({ q, n: ++n })) }))
  }, [paper])
  const all = rows.flatMap((r) => r.qs)

  // J / K move between sections; typing in a field is never hijacked
  useEffect(() => {
    let at = -1
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.key !== 'j' && e.key !== 'k') || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      const secs = [...(body.current?.querySelectorAll<HTMLElement>('[data-rd-section]') ?? [])]
      if (!secs.length) return
      at = Math.min(secs.length - 1, Math.max(0, at + (e.key === 'j' ? 1 : -1)))
      secs[at].focus({ preventScroll: true })
      secs[at].scrollIntoView({ block: 'start' })
      e.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  if (!practice || !paper) {
    return (
      <div className="ww-rd" data-overlay="reader" data-primary-none="">
        <EmptyState title="No paper is open." body="Make one from Study > Papers: pick a paper, then Practice paper." />
      </div>
    )
  }
  const marked = all.filter(({ q }) => got[q.id] !== undefined)
  const sum = marked.reduce((a, { q }) => a + (got[q.id] ?? 0), 0)
  const of = marked.reduce((a, { q }) => a + q.marks, 0)
  const saved = practice.saved
  const save = async () => {
    setBusy(true)
    setErr(null)
    const r = await useStudy.getState().saveMarks(marked.map(({ q }) => ({ id: q.id, got: got[q.id], max: q.marks })))
    setBusy(false)
    if (!r) setErr('Could not save the marks. Is the app running?')
  }
  const kind = exam?.kind === 'cie' ? 'CIE' : exam?.kind === 'end_sem' ? 'End-sem' : exam?.kind === 'backlog' ? 'Backlog' : null
  const meta = [kind, `${paper.total_marks} marks`, exam?.duration_min ? `${exam.duration_min} min` : null, `seed ${paper.seed}`].filter(Boolean).join(' · ')
  return (
    <div className="ww-rd" data-overlay="reader" data-kind="paper" ref={body}>
      <header className="ww-rd-head">
        <div className="ww-rd-headtext">
          <p className="ww-rd-title">{paper.title}</p>
          <p className="ww-rd-meta">{meta}</p>
        </div>
        <Button size="sm" aria-pressed={raw} title="Show the text as written, without typeset maths" onClick={() => setRaw((r) => !r)}>Raw</Button>
      </header>
      {paper.tier_note && <Banner tone="info">{paper.tier_note}</Banner>}
      {paper.pattern_missing && paper.pattern_note && <Banner tone="info">{paper.pattern_note}</Banner>}
      {paper.shortfall.length > 0 && <p className="ww-rd-note">Bank short: {paper.shortfall.join('; ')}</p>}
      <ol className="ww-paper" aria-label="Questions">
        {rows.map(({ s, qs }) => (
          <Fragment key={s.name}>
            <li className="ww-paper-sec" role="presentation">
              <h3 className="ww-paper-head" tabIndex={-1} data-rd-section={s.name}>{sectionLine(s)}</h3>
            </li>
            {qs.map(({ q, n }) => (
              <li key={q.id} value={n} className="ww-q" data-q={q.id} data-harvested={q.type === 'harvested' ? 'true' : undefined}>
                <span className="ww-q-n" aria-hidden="true">{n}.</span>
                <div className="ww-q-main">
                  <div className="ww-q-stem"><MathText raw={raw}>{q.text}</MathText></div>
                  <p className="ww-q-meta">
                    Unit {q.unit ?? '?'} · {q.topic}
                    {q.p != null && Math.abs(q.p - SEED_P_NONE) > 1e-9 ? ` · p ${Math.round(q.p * 100)} %` : ''}
                  </p>
                  <p className="ww-q-src" data-source="">source: {q.source || 'bank'}</p>
                </div>
                <span className="ww-q-marks" aria-label={`${q.marks} marks`}>[{num(q.marks)}]</span>
                {saved === null && <Stepper q={q} n={n} value={got[q.id]} onChange={(v) => setGot((g) => ({ ...g, [q.id]: v }))} />}
              </li>
            ))}
          </Fragment>
        ))}
      </ol>
      <footer className="ww-rd-foot">
        {saved === null ? (
          <>
            <p className="ww-rd-total" aria-live="polite">
              {marked.length ? `Marked ${marked.length} of ${all.length}: ${num(sum)} of ${num(of)}` : `Not marked yet. The paper is ${paper.total_marks} marks.`}
            </p>
            <PrimaryButton claimId="reader-save" rank="overlay" when={marked.length > 0} loading={busy}
              disabledReason={marked.length ? undefined : 'Mark at least one question.'} onClick={() => void save()}>
              Save marks
            </PrimaryButton>
          </>
        ) : (
          <p className="ww-rd-saved" role="status" data-saved="">{saved}{practice.score ? ` (${num(practice.score.score)} of ${num(practice.score.max)})` : ''}</p>
        )}
        {err && <p className="ww-rd-err" role="alert">{err}</p>}
      </footer>
    </div>
  )
}

/** A sheet or a note: Markdown through the same renderer the old Reader used, so MathText typesets it. */
export function FileReader({ path, title, text }: { path?: string; title?: string; text?: string }) {
  const [body, setBody] = useState<{ kind: 'md'; text: string } | { kind: 'frame'; url: string } | { kind: 'error' } | null>(text != null ? { kind: 'md', text } : null)
  const [raw, setRaw] = useState(false)
  useEffect(() => {
    if (text != null || !path) return
    let url: string | null = null
    let live = true
    setBody(null)
    fetch(`/api/mission/academics/file?path=${encodeURIComponent(path)}`, { headers: { 'X-Jarvis-Token': TOKEN } })
      .then(async (r) => {
        if (!r.ok) throw new Error()
        if (/\.(md|txt)$/i.test(path)) { const t = await r.text(); if (live) setBody({ kind: 'md', text: t }) }
        else { url = URL.createObjectURL(await r.blob()); if (live) setBody({ kind: 'frame', url }) }
      })
      .catch(() => { if (live) setBody({ kind: 'error' }) })
    return () => { live = false; if (url) URL.revokeObjectURL(url) }
  }, [path, text])
  const article = useMemo(() => (body?.kind === 'md' ? renderMarkdown(body.text, { raw }) : null), [body, raw])
  const name = (title ?? path?.split(/[\\/]/).pop() ?? 'Sheet').replace(/[-_]/g, ' ').replace(/\.(md|txt)$/i, '')
  return (
    <div className="ww-rd" data-overlay="reader" data-kind="file" data-primary-none="">
      <header className="ww-rd-head">
        <div className="ww-rd-headtext"><p className="ww-rd-title">{name}</p></div>
        {body?.kind === 'md' && <Button size="sm" aria-pressed={raw} title="Show the text as written, without typeset maths" onClick={() => setRaw((r) => !r)}>Raw</Button>}
      </header>
      {!body && <p className="ww-rd-note">Opening…</p>}
      {body?.kind === 'error' && <EmptyState title="This file could not be opened." body="It is not one the app may open, or the app stopped answering." />}
      {article && <article className="ww-rd-article">{article}</article>}
      {body?.kind === 'frame' && (/\.(png|jpe?g)$/i.test(path ?? '') ? <img className="ww-rd-img" src={body.url} alt={name} /> : <iframe className="ww-rd-frame" src={body.url} title={name} />)}
    </div>
  )
}

/** The overlay: openOverlay('reader', { kind: 'paper' }) or { kind: 'file', path, title } or { kind: 'text', title, text }. */
export function ReaderOverlay(props: Record<string, unknown>) {
  if (props.kind === 'file' || props.kind === 'text') {
    return <FileReader path={props.path as string | undefined} title={props.title as string | undefined} text={props.text as string | undefined} />
  }
  return <PaperReader />
}

registerOverlay('reader', ReaderOverlay as never)
