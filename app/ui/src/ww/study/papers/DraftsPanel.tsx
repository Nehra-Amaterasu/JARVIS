// DraftsPanel (row R12, package O): "Draft questions from my notes" on the paper desk. Routes R-50, R-51, R-52.
//
// The local model drafts, and only drafts: it reads passages of his own Classroom notes on one topic and proposes up to five questions.
// Every draft is PENDING and labelled "written by the local model, not checked" until he accepts it, and accepting needs marks. An
// accepted draft becomes a question of his bank that still says the model wrote it; nothing here ever calls a draft verified, and the
// engine's own checks (did it copy the notes, how similar) are printed as the engine's numbers, in words.
//
// waiting and planned answers show the engine's sentence ("The local model is not running.", "Drafting is off: rules only.").
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Field, Fold } from '../../../shared/kit'
import { Lamp, readingOf } from '../../../shared/lamp'
import type { ClientReply, DraftRow, PyqClient } from '../adapters/types'
import type { Topic } from '../ports'
import { TagChip } from '../review/TagChip'

const SHOWN = 8
export const DRAFT_TAG = 'written by the local model, not checked'

type Say = { state: ClientReply<unknown>['state']; text: string }

/** The engine's checks as plain words with its own numbers; a check the engine did not send is not guessed. */
export function checksText(d: Pick<DraftRow, 'copied' | 'similarity'>): string {
  const copied = d.copied === null ? 'not reported' : d.copied ? 'yes' : 'no'
  return `Copied from the notes: ${copied}${d.similarity === null ? '' : `; similarity ${d.similarity.toFixed(2)}`}`
}

const marksOf = (s: string): number | null => {
  const n = Number(s.trim())
  return s.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null
}

function DraftCard({ d, client, onDecided, listId }: { d: DraftRow; client: PyqClient; onDecided: (row: DraftRow) => void; listId: string }) {
  const [marks, setMarks] = useState(d.marks === null ? '' : String(d.marks))
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(d.text)
  // the unit and the topic can be corrected before accepting (R-52 takes both; the engine checks them against the syllabus)
  const [unit, setUnit] = useState(d.unit === null ? '' : String(d.unit))
  const [topic, setTopic] = useState(d.topic)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<Say | null>(null)
  const pending = d.status === 'pending'
  const m = marksOf(marks)

  const decide = async (status: 'accepted' | 'rejected') => {
    setBusy(true)
    setSaid(null)
    const u = unit.trim() === '' ? null : Number(unit)
    const patch = status === 'accepted'
      ? {
        status, ...(m !== null ? { marks: m } : {}),
        ...(editing && text.trim() && text !== d.text ? { text: text.trim() } : {}),
        ...(editing && u !== null && Number.isInteger(u) && u !== d.unit ? { unit: u } : {}),
        ...(editing && topic.trim() && topic.trim() !== d.topic ? { topic: topic.trim() } : {}),
      } as const
      : { status } as const
    const r = await client.draftsDecide(d.id, patch)
    setBusy(false)
    if (r.data) { setEditing(false); onDecided(r.data) } else setSaid({ state: r.state, text: r.reason })
  }

  return (
    <li className="pp-draft" data-component="draft" data-status={d.status} data-draft={d.id}>
      <p className="pp-draft-tag"><TagChip source="MODEL" label={DRAFT_TAG} /></p>
      {editing
        ? (
          <>
            <Field kind="area" label="Question text" value={text} onChange={(e) => setText(e.target.value)} />
            <div className="pp-draft-where">
              <Field kind="number" label="Unit" value={unit} min={1} step={1} inputMode="numeric" onChange={(e) => setUnit(e.target.value)} />
              <Field label="Topic" value={topic} list={listId} autoComplete="off" onChange={(e) => setTopic(e.target.value)} />
            </div>
          </>
        )
        : <p className="pp-draft-text">{d.text}</p>}
      <p className="pp-draft-meta">
        <span>{d.topic}{d.unit !== null ? `, unit ${d.unit}` : ''}</span>
        <span>{d.marks === null ? 'marks not set' : `${d.marks} marks as drafted`}</span>
      </p>
      {d.sources.length > 0 && <p className="pp-draft-from">From your notes: {d.sources.map((s) => s.title || s.fileId).join('; ')}</p>}
      <p className="pp-draft-checks">{checksText(d)}</p>

      {pending ? (
        <>
          <Field kind="number" label="Marks" value={marks} min={1} step={1} inputMode="numeric" onChange={(e) => setMarks(e.target.value)} hint="Needed to accept." />
          <div className="pp-draft-act">
            <Button size="md" grouped loading={busy} disabledReason={m === null ? 'Set the marks first.' : undefined} onClick={() => void decide('accepted')}>
              {editing ? 'Accept edited' : 'Accept'}
            </Button>
            {editing
              ? <Button size="md" grouped onClick={() => { setEditing(false); setText(d.text); setUnit(d.unit === null ? '' : String(d.unit)); setTopic(d.topic) }}>Cancel edit</Button>
              : <Button size="md" grouped onClick={() => setEditing(true)}>Edit then accept</Button>}
            <Button size="md" grouped loading={busy} onClick={() => void decide('rejected')}>Reject</Button>
          </div>
        </>
      ) : d.status === 'accepted' ? (
        <p className="pp-draft-done">Accepted by you{d.edited ? ' after an edit' : ''}: it is a question of your bank now, and it still says the local model wrote it.</p>
      ) : (
        <p className="pp-draft-done">Rejected{d.reason ? `: ${d.reason}` : '.'} It stays on file as rejected.</p>
      )}
      {said && <p className="pp-draft-say" role="status" data-state={said.state}><Lamp reading={readingOf({ state: said.state, reason: said.text })} /><span>{said.text}</span></p>}
    </li>
  )
}

export interface DraftsPanelProps {
  client: PyqClient
  /** The subject slug of the chosen paper; he can type another. */
  subject?: string
  /** The syllabus topics the desk knows, offered as suggestions. The engine checks the topic against the syllabus. */
  topics?: readonly Topic[]
  /** A draft was accepted: the bank has a new question, read the desk again. */
  onAccepted?: () => void
  defaultOpen?: boolean
}

export function DraftsPanel({ client, subject = '', topics = [], onAccepted, defaultOpen }: DraftsPanelProps) {
  const [form, setForm] = useState({ subject, topic: '', unit: '', count: '3', marks: '' })
  const [rows, setRows] = useState<DraftRow[] | null>(null)
  const [listSay, setListSay] = useState<Say | null>(null)
  const [made, setMade] = useState<Say | null>(null)
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  const listId = useRef(`pp-topics-${Math.random().toString(36).slice(2, 7)}`)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  // the subject follows the chosen paper until he has typed one of his own
  const touched = useRef(false)
  useEffect(() => { if (!touched.current) setForm((f) => ({ ...f, subject })) }, [subject])

  const reload = useCallback(async () => {
    const r = await client.draftsList()
    if (!alive.current) return
    if (r.data) { setRows(r.data); setListSay(r.state === 'live' ? null : { state: r.state, text: r.reason }) } else { setRows([]); setListSay({ state: r.state, text: r.reason }) }
  }, [client])
  useEffect(() => { void reload() }, [reload])

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => { if (k === 'subject') touched.current = true; setForm((f) => ({ ...f, [k]: e.target.value })) }
  const unit = form.unit.trim() === '' ? undefined : Number(form.unit)
  const count = Number(form.count)
  const missing = !form.subject.trim() ? 'Say which subject first.' : !form.topic.trim() ? 'Say which topic first.' : unit !== undefined && !Number.isInteger(unit) ? 'The unit is a whole number.' : undefined

  const make = async () => {
    setBusy(true)
    setMade(null)
    const r = await client.draftsMake({
      subject: form.subject.trim(), topic: form.topic.trim(),
      ...(unit !== undefined ? { unit } : {}), count, ...(marksOf(form.marks) !== null ? { marks: marksOf(form.marks) as number } : {}),
    })
    if (!alive.current) return
    setBusy(false)
    setMade({ state: r.state, text: r.reason })
    if (r.state === 'live') await reload()
  }

  const decided = (row: DraftRow) => {
    setRows((cur) => (cur ?? []).map((x) => (x.id === row.id ? row : x)))
    if (row.status === 'accepted') onAccepted?.()
  }

  const shown = (rows ?? []).slice(0, SHOWN)
  const pendingCount = (rows ?? []).filter((r) => r.status === 'pending').length

  return (
    <div className="pp-drafts" data-component="drafts-panel">
      <Fold title="Draft questions from my notes" defaultOpen={defaultOpen} lazy level={3}>
        <div className="pp-drafts-body">
          <p className="pp-drafts-note">The local model reads your own notes on one topic and proposes questions. Each one waits here, marked as written by the model, until you accept it.</p>
          <div className="pp-drafts-form">
            <Field label="Subject" value={form.subject} onChange={set('subject')} hint="The subject's short name." autoComplete="off" />
            <Field label="Topic" value={form.topic} onChange={set('topic')} list={listId.current} autoComplete="off" />
            <datalist id={listId.current}>{topics.map((t) => <option key={t.id} value={t.label} />)}</datalist>
            <Field kind="number" label="Unit (optional)" value={form.unit} onChange={set('unit')} min={1} step={1} inputMode="numeric" />
            <Field kind="select" label="How many" value={form.count} onChange={set('count')}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={String(n)}>{n}</option>)}
            </Field>
            <Field kind="number" label="Marks (optional)" value={form.marks} onChange={set('marks')} min={1} step={1} inputMode="numeric" />
          </div>
          <div className="pp-drafts-act">
            <Button size="md" grouped loading={busy} disabledReason={missing} onClick={() => void make()}>Draft</Button>
          </div>
          {made && <p className="pp-drafts-say" role="status" data-state={made.state}><Lamp reading={readingOf({ state: made.state, reason: made.text })} /><span>{made.text}</span></p>}

          {rows !== null && rows.length > 0 && (
            <>
              <p className="pp-drafts-count">{pendingCount === 0 ? 'No draft is waiting for your review.' : `${pendingCount} ${pendingCount === 1 ? 'draft is' : 'drafts are'} waiting for your review.`}</p>
              <ul className="pp-draftlist" aria-label="Drafts from your notes">
                {shown.map((d) => <DraftCard key={d.id} d={d} client={client} onDecided={decided} listId={listId.current} />)}
              </ul>
              {rows.length > shown.length && <p className="pp-drafts-note">{rows.length - shown.length} older on file.</p>}
            </>
          )}
          {listSay && <p className="pp-drafts-say" role="status" data-state={listSay.state}><Lamp reading={readingOf({ state: listSay.state, reason: listSay.text })} /><span>{listSay.text}</span></p>}
        </div>
      </Fold>
    </div>
  )
}
