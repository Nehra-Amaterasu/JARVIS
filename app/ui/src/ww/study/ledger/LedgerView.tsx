/**
 * The counted ledger (board request 13; routes R-60 to R-62), the second face of Study > Plan under the v3 look. Three trays:
 *   1 TOPICS    one row per syllabus topic in the engine's order: unit, weight, notes on file, past questions and their marks, papers seen,
 *               attempts, marks got of maximum, and the holes with the engine's own word for each; a subject picker.
 *   2 MARKS     every mark on file for the opened topic (R-61: when, from which source, got of max), and the rows behind its counts.
 *   3 PACE      the engine's pace sentence and its numbers beside the state word (R-62).
 * Every number is the engine's count; the page adds no total, no forecast word and no judgement of a topic: a weak topic is not red, the
 * chosen row only takes the tint. A pace that is waiting prints its sentence and no number, never a zero.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Lamp, type LampState } from '../../../shared/kit'
import { Zones } from '../../../shell/v3'
import { tonightClient, type AttemptRow, type Ledger, type LedgerRow, type Pace, type TonightClient } from '../adapters/pyqTonight'
import type { ClientReply } from '../adapters/types'
import { Said, useSubjects } from '../tonight/shared'
import '../tonight/tonight.css'
import './ledger.css'

const WEIGHT_WORD: Record<number, string> = { 3: 'high', 2: 'middle', 1: 'low' }
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const g = (n: number) => String(Math.round(n * 1000) / 1000)
/** The engine's hole kind with its underscores read as spaces: the same word, not a new one. */
export const holeWord = (kind: string): string => kind.replace(/_/g, ' ')
const SOURCE_WORD: Record<string, string> = { sheet: 'a tonight sheet', paper: 'a generated paper' }

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return <span className="cld-cell"><span className="cld-cl">{label}</span><span className="cld-cv">{children}</span></span>
}

export function RowFace({ row, holes, chosen, onChoose }: { row: LedgerRow; holes: string[]; chosen: boolean; onChoose: () => void }) {
  return (
    <li>
      <button type="button" className="cld-row" aria-current={chosen ? 'true' : undefined} onClick={onChoose} data-topic={row.key}>
        <span className="cld-head">
          <span className="cld-topic">{row.unit !== null ? `Unit ${row.unit}, ` : ''}{row.topic}</span>
          <span className="cld-weight">{row.syllabusWeight !== null ? `Syllabus weight ${row.syllabusWeight}${WEIGHT_WORD[row.syllabusWeight] ? ` (${WEIGHT_WORD[row.syllabusWeight]})` : ''}` : 'No syllabus weight sent'}</span>
        </span>
        <span className="cld-cells">
          <Cell label="Notes">{row.notes}</Cell>
          <Cell label="Past questions">{row.pastQuestions}{row.pastQuestions ? `, ${g(row.pastMarks)} marks` : ''}</Cell>
          <Cell label="Papers seen">{row.papersSeen}</Cell>
          <Cell label="Attempts">{row.attempts}</Cell>
          <Cell label="Marks got">{row.attempts ? `${g(row.got)} of ${g(row.max)}` : 'none yet'}</Cell>
        </span>
        {holes.length > 0 && <span className="cld-holes" data-holes="">{holes.map((h) => <span key={h} className="cld-hole">{holeWord(h)}</span>)}</span>}
      </button>
    </li>
  )
}

function Opened({ client, subject, row, holeRows }: { client: TonightClient; subject: string; row: LedgerRow; holeRows: { kind: string; sentence: string }[] }) {
  const [r, setR] = useState<ClientReply<AttemptRow[]> | null>(null)
  useEffect(() => {
    let live = true
    setR(null)
    void client.attempts(subject, row.key).then((x) => { if (live) setR(x) })
    return () => { live = false }
  }, [client, subject, row.key])
  const rows = r?.data ?? []
  return (
    <div className="tsh-col" data-tray="topic-marks">
      <h3 className="tsh-title">{row.unit !== null ? `Unit ${row.unit}, ` : ''}{row.topic}</h3>
      {!r && <p className="tsh-line">Reading the marks on file…</p>}
      {r && <Said state={r.state} text={r.reason} id="attempts" />}
      {rows.length > 0 && (
        <ul className="cld-marks" data-marks="">
          {rows.map((a, i) => (
            <li key={`${a.at}|${a.questionId}|${i}`} className="cld-mark">
              <span className="cld-mdate">{a.at.slice(0, 10)}</span>
              <span className="cld-msrc">{SOURCE_WORD[a.source] ?? a.source}</span>
              <span className="cld-mgot">{g(a.got)} of {g(a.max)}{a.minutes !== null ? `, ${g(a.minutes)} min` : ''}</span>
            </li>
          ))}
        </ul>
      )}
      {holeRows.length > 0 && (
        <section aria-label="Holes on this topic">
          <h4 className="tsh-sub-h">Holes, as the engine words them</h4>
          <ul className="tsh-list">{holeRows.map((h) => <li key={h.kind}><span className="cld-hole">{holeWord(h.kind)}</span> {h.sentence}</li>)}</ul>
        </section>
      )}
      <details className="cld-behind">
        <summary>Rows behind the counts</summary>
        <p className="tsh-line">{plural(row.noteFiles.length, 'note file', 'note files')} that mention it, {plural(row.questionIds.length, 'past question', 'past questions')} tagged to it.</p>
        {row.noteFiles.length > 0 && <p className="cld-ids" data-ids="notes">{row.noteFiles.join(', ')}</p>}
        {row.questionIds.length > 0 && <p className="cld-ids" data-ids="questions">{row.questionIds.join(', ')}</p>}
      </details>
    </div>
  )
}

export function LedgerFace({ client = tonightClient }: { client?: TonightClient }) {
  const subjects = useSubjects()
  const [subject, setSubject] = useState<string | null>(null)
  const [led, setLed] = useState<ClientReply<Ledger> | null>(null)
  const [pace, setPace] = useState<ClientReply<Pace> | null>(null)
  const [topic, setTopic] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false; client.abortAll() } }, [client])
  const sub = subject ?? subjects[0]?.id ?? null

  const load = useCallback(async (id: string) => {
    setLed(null); setPace(null); setTopic(null)
    const [a, b] = await Promise.all([client.ledger(id), client.pace(id)])
    if (alive.current) { setLed(a); setPace(b) }
  }, [client])
  useEffect(() => { if (sub) void load(sub) }, [sub, load])

  const ledger = led?.data ?? null
  const row = ledger?.items.find((i) => i.key === topic) ?? null
  const holesOf = (k: string) => (ledger?.holes ?? []).filter((h) => h.key === k)
  const state: LampState = led?.state ?? 'waiting'

  const picker = (
    <>
      <label className="tsh-fieldlabel" htmlFor="cld-subject">Subject</label>
      <select id="cld-subject" className="tsh-input" value={sub ?? ''} onChange={(e) => setSubject(e.target.value)} disabled={subjects.length === 0}>
        {subjects.length === 0 && <option value="">No subject on file</option>}
        {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </>
  )

  const first = (
    <div className="tsh-col" data-tray="topics">
      {picker}
      {sub && !led && <p className="tsh-line">Reading the ledger…</p>}
      {led && <Said state={state} text={led.reason} id="ledger" />}
      {ledger && ledger.items.length > 0 && (
        <ul className="cld-rows" aria-label="Topics of the syllabus, in the engine's order" data-rows="">
          {ledger.items.map((it) => (
            <RowFace key={it.key} row={it} holes={holesOf(it.key).map((h) => h.kind)} chosen={topic === it.key} onChoose={() => setTopic(it.key)} />
          ))}
        </ul>
      )}
      {ledger && ledger.skipped.length > 0 && <p className="tsh-line" data-skipped="">{ledger.skipped.map((s) => `${s.file}: ${s.reason}`).join(' ')}</p>}
      <p className="tsh-line tsh-foot">Every number is counted from your notes, papers and marks. A hole is a gap in what is on file, not a judgement of the topic.</p>
    </div>
  )

  const p = pace?.data ?? null
  const counted = pace?.state === 'live' && p !== null
  return (
    <Zones
      ratio={[2.4, 1.25, 1]}
      first={{ job: 'TOPICS', chip: <Lamp state={state} reason={led?.reason} />, children: first }}
      second={{
        job: 'MARKS ON FILE',
        peek: { name: 'Marks', lamp: row ? 'live' : 'waiting', note: row ? row.topic : 'open a topic' },
        children: sub && row
          ? <Opened client={client} subject={sub} row={row} holeRows={holesOf(row.key)} />
          : <div className="tsh-col" data-tray="topic-marks"><p className="tsh-line" data-empty="topic">Open a topic to see every mark on file for it.</p></div>,
      }}
      third={{
        job: 'PACE',
        peek: { name: 'Pace', lamp: pace?.state ?? 'waiting', note: pace ? (counted ? 'counted from your marks' : 'not enough marks yet') : 'not read yet' },
        children: (
          <div className="tsh-col" data-tray="pace">
            {!pace && <p className="tsh-line">Reading the pace…</p>}
            {pace && <Said state={pace.state} text={pace.reason} id="pace" />}
            {counted && p && (
              <dl className="cld-facts" data-pace="">
                <div><dt>Topics</dt><dd>{p.topics}</dd></div>
                <div><dt>Marked once or more</dt><dd>{p.practised}</dd></div>
                <div><dt>Left</dt><dd>{p.left}</dd></div>
                <div><dt>Days counted</dt><dd>{p.daysCounted}{p.from && p.to ? ` (${p.from} to ${p.to})` : ''}</dd></div>
                {p.perDay !== null && <div><dt>First marks a day</dt><dd>{g(p.perDay)}</dd></div>}
                {p.paperDate && <div><dt>Paper</dt><dd>{p.paperDate}{p.daysLeft !== null ? `, ${plural(p.daysLeft, 'day', 'days')} away` : ''}</dd></div>}
              </dl>
            )}
            <p className="tsh-line tsh-foot">The pace is plain division over the days you marked something. It is not a forecast of a result.</p>
          </div>
        ),
      }}
    />
  )
}

export default LedgerFace
