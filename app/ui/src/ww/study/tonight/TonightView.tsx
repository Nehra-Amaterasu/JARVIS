/**
 * The tonight sheet (board request 12; routes R-55 to R-59), the first face of Study > Practice under the v3 look. Three trays:
 *   1 TONIGHT   today's sheet as the engine built it (subject, each question with its marks and why it was chosen), or the plain reason
 *               there is none and the Build key; Print.
 *   2 MARKS     the sheets waiting for marks, newest first; a number field per question (0 to its maximum); Save marks.
 *   3 SETTINGS  on or off, the time it is built by the clock, how many questions, how far ahead to look; Save settings.
 * Honest by construction: a mark is only what he typed and is labelled "typed by you"; nothing here computes a grade or says how an
 * exam will go; every engine sentence is printed as sent, beside its state word; nothing is built or scheduled except by his press of
 * Build or Save (the page has no timer and no poll).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Lamp, PrimaryButton, Segmented, Switch, type LampState } from '../../../shared/kit'
import { Zones } from '../../../shell/v3'
import { getImage } from '../adapters/http'
import { tonightClient, type AwaitingRow, type MarkInput, type Sheet, type SheetItem, type TonightClient, type TonightSettings, type TonightView as View } from '../adapters/pyqTonight'
import type { ClientReply } from '../adapters/types'
import { nameOf, Said, useSubjects } from './shared'
import './tonight.css'

/** The engine counts a topic as measured from 3 marks (ww_pyq/next.py MIN_ATTEMPTS: the owner's number of 27 Nov, it was 5; board request 17). */
const MARKS_TO_MEASURE = 3
const WEIGHT_WORD: Record<number, string> = { 3: 'high', 2: 'middle', 1: 'low' }
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const g = (n: number) => String(Math.round(n * 1000) / 1000)

interface Note { state: LampState; text: string }

/** The terms the engine printed with the question, in its own words and numbers. Nothing is added or rounded away. */
export function whyLine(w: NonNullable<SheetItem['why']>): string {
  const bits: string[] = []
  if (w.daysLeft !== null) bits.push(w.daysLeft === 0 ? 'paper today' : `paper in ${plural(w.daysLeft, 'day', 'days')}`)
  if (w.syllabusWeight !== null) bits.push(`syllabus weight ${w.syllabusWeight}${WEIGHT_WORD[w.syllabusWeight] ? ` (${WEIGHT_WORD[w.syllabusWeight]})` : ''}`)
  if (w.marksWeight !== null) bits.push(`marks weight ${g(w.marksWeight)}`)
  if (w.share !== null) bits.push(`seen share ${g(w.share)}`)
  if (w.proficiency !== null) bits.push(`proficiency ${g(w.proficiency)}`)
  return bits.join(', ')
}

/** A page crop is read with the token (an <img src> cannot send it) and shown as a picture; a failure is said in words. */
function Crop({ path }: { path: string }) {
  const [uri, setUri] = useState<string | null>(null)
  const [bad, setBad] = useState(false)
  useEffect(() => {
    let live = true
    getImage(path).then((u) => { if (live) setUri(u) }).catch(() => { if (live) setBad(true) })
    return () => { live = false }
  }, [path])
  if (bad) return <p className="tsh-line">The picture of this question could not be read.</p>
  return uri ? <img className="tsh-crop" src={uri} alt="The question as a picture from the paper" /> : <p className="tsh-line">Reading the picture…</p>
}

/** Print through the engine's own A4 sheet (R-59): fetched with the token, drawn in a frame that has no size, printed by the browser. */
async function printThrough(client: TonightClient, id: string): Promise<Note> {
  const r = await client.printHtml(id)
  if (!r.data) return { state: r.state === 'live' ? 'fault' : r.state, text: r.reason }
  await new Promise<void>((done) => {
    const f = document.createElement('iframe')
    f.className = 'tsh-printframe'
    f.setAttribute('aria-hidden', 'true')
    f.tabIndex = -1
    f.title = 'The sheet as it prints'
    f.onload = () => {
      f.contentWindow?.focus()
      f.contentWindow?.print()
      // the dialog is the browser's; the frame is kept a minute so a slow dialog still has its page, then removed
      setTimeout(() => f.remove(), 60_000)
      done()
    }
    f.srcdoc = r.data as string
    document.body.appendChild(f)
  })
  return { state: 'live', text: 'Sent to the print dialog. Choose your printer, or Save as PDF.' }
}

function PrintKey({ client, sheetId, primary, onNote }: { client: TonightClient; sheetId: string; primary?: boolean; onNote: (n: Note) => void }) {
  const [busy, setBusy] = useState(false)
  const press = async () => {
    setBusy(true)
    try { onNote(await printThrough(client, sheetId)) } finally { setBusy(false) }
  }
  return primary
    ? <PrimaryButton claimId="tonight-primary" rank="workspace" size="lg" loading={busy} onClick={() => void press()} data-key="print">Print this sheet</PrimaryButton>
    : <Button size="md" loading={busy} onClick={() => void press()} data-key="print">Print this sheet</Button>
}

function QuestionList({ sheet }: { sheet: Sheet }) {
  return (
    <ol className="tsh-items" data-items="">
      {sheet.items.map((it) => (
        <li key={it.questionId} className="tsh-item" data-q={it.questionId}>
          <p className="tsh-item-head">
            <span className="tsh-n">Q{it.n}</span>
            <span className="tsh-topic">{it.topic || 'No topic named'}{it.unit !== null ? `, unit ${it.unit}` : ''}</span>
            <span className="tsh-marks" data-marks={it.marks === null ? 'not-printed' : ''}>{it.marks === null ? 'marks not printed' : plural(it.marks, 'mark', 'marks')}</span>
          </p>
          {it.text ? <p className="tsh-text">{it.text}</p> : it.crop ? <Crop path={it.crop} /> : <p className="tsh-line">The engine sent no words or picture for this question.</p>}
          {it.why && <p className="tsh-why">Why this one: {whyLine(it.why) || 'the engine sent no terms'}.</p>}
          {it.mark && <p className="tsh-got" data-got="">Your mark, typed by you: {g(it.mark.got)} of {g(it.mark.max)}.</p>}
        </li>
      ))}
    </ol>
  )
}

interface MarksProps {
  client: TonightClient; subjects: { id: string; name: string }[]
  today: Sheet | null; awaiting: AwaitingRow[]
  onSaved: (sheet: Sheet | null) => void
}

function Marks({ client, subjects, today, awaiting, onSaved }: MarksProps) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [others, setOthers] = useState<Record<string, Sheet>>({})
  const [typed, setTyped] = useState<Record<string, string>>({})
  // a question whose marks are not printed (wave EW11): his own "out of", and whether to keep it as the question's marks (R-58 keep)
  const [outOf, setOutOf] = useState<Record<string, string>>({})
  const [keep, setKeep] = useState<Record<string, boolean>>({})
  const [note, setNote] = useState<Note | null>(null)
  const [busy, setBusy] = useState(false)
  // his default is tonight's sheet; an earlier sheet opens only on his press of its key (opening one asks the engine for it)
  const rows = useMemo(() => {
    const list = [...awaiting].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    return list
  }, [awaiting])
  const chosen = openId ?? today?.id ?? null
  const sheet: Sheet | null = chosen === null ? null : today && chosen === today.id ? today : others[chosen] ?? null
  const key = (q: string) => `${chosen}|${q}`

  const choose = async (row: AwaitingRow) => {
    setOpenId(row.id)
    setNote(null)
    if (others[row.id]) return
    // R-57 answers the sheet already kept for a day and subject as it is; there is no read-one route, so this is how an earlier sheet is opened
    const r = await client.build({ date: row.date, subject: row.subject })
    if (r.data) setOthers((o) => ({ ...o, [row.id]: r.data as Sheet }))
    else setNote({ state: r.state, text: r.reason })
  }

  const save = async () => {
    if (!sheet) return
    const items: MarkInput[] = []
    for (const it of sheet.items) {
      const t = (typed[key(it.questionId)] ?? '').trim()
      if (t === '') continue
      if (!/^\d+(\.\d+)?$/.test(t)) { setNote({ state: 'fault', text: `Q${it.n}: type the mark as a number, for example 3 or 2.5.` }); return }
      const row: MarkInput = { questionId: it.questionId, got: Number(t) }
      if (it.marksNotPrinted) {
        // sent as typed: an empty "out of" goes without it, and the engine's 400 sentence says what is missing (R-58)
        const o = (outOf[key(it.questionId)] ?? (it.mark ? String(it.mark.max) : '')).trim()
        if (o !== '') {
          if (!/^\d+(\.\d+)?$/.test(o)) { setNote({ state: 'fault', text: `Q${it.n}: type out of as a number, for example 10.` }); return }
          row.outOf = Number(o)
          if (keep[key(it.questionId)]) row.keep = true
        }
      }
      items.push(row)
    }
    if (!items.length) { setNote({ state: 'waiting', text: 'Type at least one mark first.' }); return }
    setBusy(true)
    try {
      const r = await client.saveMarks(sheet.id, items)
      if (r.state === 'live' && r.data?.sheet) {
        const next = r.data.sheet
        const mine = ([k]: [string, unknown]) => !k.startsWith(`${sheet.id}|`)
        setTyped((t) => Object.fromEntries(Object.entries(t).filter(mine)))
        setOutOf((t) => Object.fromEntries(Object.entries(t).filter(mine)))
        setKeep((t) => Object.fromEntries(Object.entries(t).filter(mine)))
        if (today && next.id === today.id) onSaved(next)
        else { setOthers((o) => ({ ...o, [next.id]: next })); onSaved(null) }
        setNote({ state: 'live', text: `${r.reason} Marked by ${r.data.markedBy || 'you'}; kept as you typed them.` })
      } else {
        // a refusal (a mark over the question's maximum, a question not on the sheet) is the engine's sentence, and what he typed stays
        setNote({ state: r.state === 'live' ? 'fault' : r.state, text: r.reason })
      }
    } finally { setBusy(false) }
  }

  return (
    <div className="tsh-col" data-tray="marks">
      {rows.length === 0 && !today && <p className="tsh-line" data-empty="marks">No sheet is waiting for marks.</p>}
      {(today || rows.length > 0) && (
        <ul className="tsh-sheets" aria-label="Sheets waiting for marks">
          {today && (
            <li><button type="button" className="tsh-sheetkey" aria-current={chosen === today.id ? 'true' : undefined} onClick={() => { setOpenId(today.id); setNote(null) }}>
              <span>Tonight: {nameOf(subjects, today.subject)}</span><span className="tsh-sub">{today.date}, {plural(today.unmarked, 'question', 'questions')} unmarked</span>
            </button></li>
          )}
          {rows.map((r) => (
            <li key={r.id}><button type="button" className="tsh-sheetkey" aria-current={chosen === r.id ? 'true' : undefined} onClick={() => void choose(r)}>
              <span>{nameOf(subjects, r.subject)}</span><span className="tsh-sub">{r.date}, {plural(r.unmarked, 'question', 'questions')} unmarked</span>
            </button></li>
          ))}
        </ul>
      )}
      {!sheet && rows.length > 0 && <p className="tsh-line" data-empty="choose">Choose a sheet to type its marks.</p>}
      {sheet && (
        <form className="tsh-form" noValidate onSubmit={(e) => { e.preventDefault(); void save() }} data-form={sheet.id}>
          <p className="tsh-line">Your marks, out of each maximum. Leave one empty to mark it later.</p>
          {sheet.items.map((it) => {
            const id = `tsh-m-${sheet.id}-${it.n}`
            const typedHere = typed[key(it.questionId)]
            if (it.marks === null) {
              const oid = `${id}-of`
              const k = key(it.questionId)
              const ofHere = outOf[k] ?? (it.mark ? String(it.mark.max) : '')
              return (
                <div key={it.questionId} className="tsh-markset" data-notprinted={it.questionId}>
                  <div className="tsh-markrow tsh-markrow-of">
                    <label htmlFor={id} className="tsh-marklabel"><span className="tsh-n">Q{it.n}</span> {it.topic || 'No topic named'}: marks not printed</label>
                    <input id={id} className="tsh-input tsh-num" type="number" inputMode="decimal" min={0} step="any"
                      value={typedHere ?? (it.mark ? String(it.mark.got) : '')} placeholder="mark"
                      onChange={(e) => setTyped((t) => ({ ...t, [k]: e.target.value }))} data-q={it.questionId} />
                    <label htmlFor={oid} className="tsh-of">out of</label>
                    <input id={oid} className="tsh-input tsh-num" type="number" inputMode="decimal" min={1} max={100} step="any" required
                      value={ofHere} placeholder="1-100"
                      onChange={(e) => setOutOf((t) => ({ ...t, [k]: e.target.value }))} data-out-of={it.questionId} />
                  </div>
                  <p className="tsh-line">The paper prints no marks for this question: say what you marked it out of, from 1 to 100. Needed to save its mark.</p>
                  <Switch checked={!!keep[k]} onChange={(v) => setKeep((x) => ({ ...x, [k]: v }))} label="Keep this number as the question's own marks, set by you" />
                </div>
              )
            }
            return (
              <div key={it.questionId} className="tsh-markrow">
                <label htmlFor={id} className="tsh-marklabel"><span className="tsh-n">Q{it.n}</span> {it.topic || 'No topic named'}</label>
                <input id={id} className="tsh-input tsh-num" type="number" inputMode="decimal" min={0} max={it.marks} step="any"
                  value={typedHere ?? (it.mark ? String(it.mark.got) : '')} placeholder="mark"
                  onChange={(e) => setTyped((t) => ({ ...t, [key(it.questionId)]: e.target.value }))} data-q={it.questionId} />
                <span className="tsh-of">of {g(it.marks)}</span>
              </div>
            )
          })}
          <div className="tsh-acts">
            <Button size="lg" loading={busy} type="submit" data-key="save-marks">Save marks</Button>
            <PrintKey client={client} sheetId={sheet.id} onNote={setNote} />
          </div>
        </form>
      )}
      {note && <Said state={note.state} text={note.text} role={note.state === 'fault' ? 'alert' : 'status'} id="marks" reveal />}
      <p className="tsh-line tsh-foot">Typed by you. Nothing here grades a sheet or says how a paper will go. The order of topics moves only after {MARKS_TO_MEASURE} marks on a topic.</p>
    </div>
  )
}

const HOURS = /^([01]\d|2[0-3]):[0-5]\d$/

function Settings({ client, settings, onSaved }: { client: TonightClient; settings: TonightSettings | null; onSaved: (s: TonightSettings) => void }) {
  const [draft, setDraft] = useState<{ on: boolean; hour: string; count: string; horizon: string } | null>(null)
  const [note, setNote] = useState<Note | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (settings) setDraft((d) => d ?? { on: settings.on, hour: settings.hour, count: String(settings.count), horizon: String(settings.horizonDays) })
  }, [settings])
  if (!settings || !draft) return <div className="tsh-stack" data-tray="settings"><p className="tsh-line">The settings are read from the engine when it answers.</p></div>
  const save = async () => {
    const count = Number(draft.count)
    const horizon = Number(draft.horizon)
    if (!HOURS.test(draft.hour)) { setNote({ state: 'fault', text: 'Set the time as hours and minutes, for example 19:00.' }); return }
    if (!Number.isInteger(count) || !Number.isInteger(horizon)) { setNote({ state: 'fault', text: 'Questions and days are whole numbers.' }); return }
    setBusy(true)
    try {
      const r = await client.saveSettings({ on: draft.on, hour: draft.hour, count, horizonDays: horizon })
      // the engine's refusal ("Questions are from 3 to 12.") is printed as sent, and the fields keep what he typed
      if (r.data) { onSaved(r.data); setDraft({ on: r.data.on, hour: r.data.hour, count: String(r.data.count), horizon: String(r.data.horizonDays) }) }
      setNote({ state: r.state, text: r.reason })
    } finally { setBusy(false) }
  }
  return (
    <form className="tsh-stack" data-tray="settings" noValidate onSubmit={(e) => { e.preventDefault(); void save() }}>
      <Segmented<'on' | 'off'> variant="choice" label="Evening sheet" value={draft.on ? 'on' : 'off'} onChange={(v) => setDraft({ ...draft, on: v === 'on' })}
        options={[{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }]} />
      <p className="tsh-line">On: the sheet is built once a day at the time you set, and one reminder is raised. Off: nothing is built and nothing reminds you.</p>
      <label className="tsh-fieldlabel" htmlFor="tsh-hour">Built by the clock at</label>
      <input id="tsh-hour" className="tsh-input" type="time" value={draft.hour} onChange={(e) => setDraft({ ...draft, hour: e.target.value })} />
      <div className="tsh-pair">
        <div className="tsh-stack">
          <label className="tsh-fieldlabel" htmlFor="tsh-count">Questions, 3 to 12</label>
          <input id="tsh-count" className="tsh-input tsh-num" type="number" inputMode="numeric" min={3} max={12} value={draft.count} onChange={(e) => setDraft({ ...draft, count: e.target.value })} />
        </div>
        <div className="tsh-stack">
          <label className="tsh-fieldlabel" htmlFor="tsh-horizon">Days ahead, 1 to 60</label>
          <input id="tsh-horizon" className="tsh-input tsh-num" type="number" inputMode="numeric" min={1} max={60} value={draft.horizon} onChange={(e) => setDraft({ ...draft, horizon: e.target.value })} />
        </div>
      </div>
      <div className="tsh-acts"><Button size="lg" loading={busy} type="submit" data-key="save-settings">Save settings</Button></div>
      {note && <Said state={note.state} text={note.text} role={note.state === 'fault' ? 'alert' : 'status'} id="settings" reveal />}
      <p className="tsh-line tsh-foot">Nothing is built or scheduled until you press Save or Build.</p>
    </form>
  )
}

export function TonightFace({ client = tonightClient }: { client?: TonightClient }) {
  const subjects = useSubjects()
  const [r, setR] = useState<ClientReply<View> | null>(null)
  const [note, setNote] = useState<Note | null>(null)
  const [building, setBuilding] = useState(false)
  const alive = useRef(true)
  const load = useCallback(async () => { const x = await client.tonight(); if (alive.current) setR(x) }, [client])
  useEffect(() => {
    alive.current = true
    void load()
    return () => { alive.current = false; client.abortAll() }
  }, [load, client])

  const data = r?.data ?? null
  const sheet = data?.sheet ?? null
  const state: LampState = r?.state ?? 'waiting'

  const build = async () => {
    setBuilding(true)
    try {
      const x = await client.build({})
      setNote({ state: x.state, text: x.reason })
      await load()
    } finally { setBuilding(false) }
  }

  const first = (
    <div className="tsh-col" data-tray="tonight">
      {!r && <p className="tsh-line">Reading tonight's sheet…</p>}
      {r && <Said state={state} text={r.reason} id="state" />}
      {sheet ? (
        <>
          <h3 className="tsh-title">{nameOf(subjects, sheet.subject)}, {sheet.date}</h3>
          <QuestionList sheet={sheet} />
          <div className="tsh-acts"><PrintKey client={client} sheetId={sheet.id} primary onNote={setNote} /></div>
        </>
      ) : r && (
        <div className="tsh-acts">
          <PrimaryButton claimId="tonight-primary" rank="workspace" size="lg" loading={building} onClick={() => void build()} data-key="build">Build tonight's sheet</PrimaryButton>
        </div>
      )}
      {note && <Said state={note.state} text={note.text} role={note.state === 'fault' ? 'alert' : 'status'} id="action" reveal />}
      <p className="tsh-line tsh-foot">A sheet is a few questions from your own accepted past papers. You work it on paper, then type your marks.</p>
    </div>
  )

  const waitingCount = (data?.awaiting.length ?? 0) + (sheet && sheet.unmarked ? 1 : 0)
  return (
    <Zones
      ratio={[1.6, 1.25, 0.95]}
      first={{ job: 'TONIGHT', chip: <Lamp state={state} reason={r?.reason} />, children: first }}
      second={{
        job: 'MARKS',
        peek: { name: 'Marks', lamp: waitingCount ? 'live' : 'waiting', note: waitingCount ? `${plural(waitingCount, 'sheet', 'sheets')} waiting for marks` : 'no sheet waiting' },
        children: (
          <Marks client={client} subjects={subjects} today={sheet} awaiting={data?.awaiting ?? []}
            onSaved={(next) => { if (next) setR((x) => (x && x.data ? { ...x, data: { ...x.data, sheet: next } } : x)); void load() }} />
        ),
      }}
      third={{
        job: 'SETTINGS',
        peek: { name: 'Settings', lamp: data?.settings ? (data.settings.on ? 'live' : 'planned') : 'waiting', note: data?.settings ? (data.settings.on ? `on, built at ${data.settings.hour}` : 'off') : 'not read yet' },
        children: (
          <div className="tsh-col">
            <Settings client={client} settings={data?.settings ?? null}
              onSaved={(s) => setR((x) => (x && x.data ? { ...x, data: { ...x.data, settings: s } } : x))} />
            {data && data.nextPapers.length > 0 && (
              <section className="tsh-ahead" aria-label="Papers ahead">
                <h3 className="tsh-sub-h">Papers ahead on your date sheet</h3>
                <ul className="tsh-list">
                  {data.nextPapers.map((p) => (
                    <li key={`${p.subject}|${p.date}|${p.title}`}>{p.title || nameOf(subjects, p.subject)}, {p.date}, {p.daysLeft === 0 ? 'today' : `in ${plural(p.daysLeft, 'day', 'days')}`}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        ),
      }}
    />
  )
}

export default TonightFace
