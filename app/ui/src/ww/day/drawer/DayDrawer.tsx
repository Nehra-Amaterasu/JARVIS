// DayDrawer (package L01, spec 20.6.1): one day opened from the Almanac. A right drawer of 560 px on the desk and a bottom sheet
// on the phone, three folds: Happened (a row each with Undo and Delete), Planned (Done turns the hollow mark solid, Move sends it
// to tomorrow, "Not now" makes it a carried outline, with no word of failure) and Intents (the rules that fall on the day, an Edit
// key, and the "next time" strip). Esc closes it and focus returns to the cell (the kit Drawer does both).
//
// The drawer reads and writes only through the Day port. Every answer carries its lamp: a WAITING port draws the folds hollow with
// the reason, and a press the port cannot apply says "nothing was saved" in words instead of changing the row. The surface and the
// ink are this drawer's own (see drawer.css), because a side panel that inherits a transparent token is unreadable (owner, 15 Nov).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Drawer, Fold, Lamp, PlannedGlyph } from '../../../shared/kit'
import { DayMark, addDays, longDate, type Kind } from '../../../shared/almanac'
import { showsNumber } from '../../../shared/lamp'
import { DAY_PORT, type DayDetail, type DayPort, type EntryRow, type IntentRow, type LogAction, type PlannedRow, type PortReply } from '../ports'
import { FOLDS } from './folds'
import './drawer.css'

export interface DayDrawerProps {
  date: string
  open?: boolean
  onClose?: () => void
  port?: DayPort
  form?: 'desk' | 'phone'
  /** Called after the port applied a change, so the calendar behind can read again. */
  onChanged?: () => void
}

function useDetail(port: DayPort, date: string, open: boolean, version: number) {
  const [reply, setReply] = useState<PortReply<DayDetail> | null>(null)
  useEffect(() => {
    if (!open) return
    let live = true
    port.day(date).then((r) => { if (live) setReply(r) }, () => { if (live) setReply({ state: 'fault', reason: 'the day could not be read', since: null, data: null }) })
    return () => { live = false }
  }, [port, date, open, version])
  // a reply for another day is not this day's: until the read for `date` lands, the drawer says it is reading
  return reply && (reply.data === null || reply.data.date === date) ? reply : null
}

const timeText = (t: string | null) => t ?? ''

function Empty({ children }: { children: string }) {
  return <p className="dd-empty">{children}</p>
}

export function DayDrawer({ date, open = true, onClose, port = DAY_PORT, form = 'desk', onChanged }: DayDrawerProps) {
  const [version, setVersion] = useState(0)
  const [note, setNote] = useState<{ text: string; applied: boolean } | null>(null)
  const reply = useDetail(port, date, open, version)
  const detail = reply?.data ?? null
  const counted = reply ? showsNumber(reply.state) : false

  useEffect(() => { setNote(null) }, [date])

  const act = useCallback(async (a: LogAction) => {
    const r = await port.logs(a)
    const applied = !!r.data?.applied && (r.state === 'live' || r.state === 'simulated')
    setNote({ text: r.data?.message && applied ? r.data.message : `${r.reason}${applied ? '' : '. Nothing was saved.'}`, applied })
    if (applied) {
      setVersion((v) => v + 1)
      onChanged?.()
    }
  }, [port, onChanged])

  const marks = useMemo(() => {
    const seen = new Map<string, { kind: Kind; done: boolean }>()
    for (const h of detail?.happened ?? []) seen.set(`${h.kind}-d`, { kind: h.kind, done: true })
    for (const p of detail?.planned ?? []) if (p.status !== 'done') seen.set(`${p.kind}-p`, { kind: p.kind, done: false })
    return [...seen.values()]
  }, [detail])

  const phone = form === 'phone'
  const tomorrow = addDays(date, 1)

  const happened = (r: EntryRow) => (
    <li key={r.id} className="dd-row" data-kind={r.kind}>
      <span className="dd-time">{timeText(r.time)}</span>
      <DayMark kind={r.kind} done />
      <span className="dd-text">{r.text}</span>
      <span className="dd-acts">
        <Button grouped size="sm" aria-label={`Undo: ${r.text}`} onClick={() => void act({ op: 'undo', date, id: r.id })}>Undo</Button>
        <Button grouped size="sm" aria-label={`Delete: ${r.text}`} onClick={() => void act({ op: 'delete', date, id: r.id })}>Delete</Button>
      </span>
    </li>
  )
  const plannedRow = (r: PlannedRow) => (
    <li key={r.id} className="dd-row" data-kind={r.kind} data-status={r.status}>
      <span className="dd-time">{timeText(r.time)}</span>
      <DayMark kind={r.kind} done={r.status === 'done'} />
      <span className="dd-text">
        {r.text}
        {r.status === 'carried' && <span className="dd-carried">Carried</span>}
      </span>
      <span className="dd-acts">
        {r.status !== 'done' && <Button grouped size="sm" aria-label={`Done: ${r.text}`} onClick={() => void act({ op: 'done', date, id: r.id })}>Done</Button>}
        {r.status !== 'done' && <Button grouped size="sm" aria-label={`Move to tomorrow: ${r.text}`} onClick={() => void act({ op: 'move', date, id: r.id, to: tomorrow })}>Move</Button>}
        {r.status === 'planned' && <Button grouped size="sm" aria-label={`Not now: ${r.text}`} onClick={() => void act({ op: 'notNow', date, id: r.id })}>Not now</Button>}
      </span>
    </li>
  )
  const intentRow = (r: IntentRow) => (
    <li key={r.id} className="dd-row" data-kind="intent">
      <span className="dd-time" />
      <DayMark kind="intent" done={false} />
      <span className="dd-text">{r.rule}</span>
      <span className="dd-acts">
        <Button grouped size="sm" aria-label={`Edit: ${r.rule}`} onClick={() => setNote({ text: 'Editing an intent opens with the Intent store, which is not connected yet. Nothing was changed.', applied: false })}>Edit</Button>
      </span>
    </li>
  )

  const waitingWhy = reply && !showsNumber(reply.state) ? reply.reason : null
  return (
    <Drawer open={open} onClose={onClose ?? (() => undefined)} title={longDate(date)} place={phone ? 'bottom' : 'right'} className="dd-sheet">
      <div className="dd" data-form={form} data-state={reply?.state ?? 'reading'}>
        <div className="dd-head">
          <span className="dd-marks">
            {marks.length > 0 ? marks.map((m) => <DayMark key={`${m.kind}${m.done}`} kind={m.kind} done={m.done} size={18} />) : <span className="dd-quiet">{counted ? 'Nothing on this day yet' : 'No marks to draw'}</span>}
          </span>
          {reply ? <Lamp state={reply.state} reason={waitingWhy ?? undefined} /> : <span className="dd-quiet" role="status">Reading the day</span>}
        </div>
        {waitingWhy && <p className="dd-why">{waitingWhy}</p>}
        <p className="dd-note" role="status" aria-live="polite" data-applied={note?.applied ? 'true' : undefined}>{note?.text ?? ''}</p>

        <Fold title="Happened" defaultOpen>
          {detail && detail.happened.length > 0 ? <ul className="dd-list">{detail.happened.map(happened)}</ul> : <Empty>{detail ? 'Nothing was logged on this day.' : 'Nothing to show until the day log answers.'}</Empty>}
        </Fold>
        <Fold title="Planned" defaultOpen>
          {detail && detail.planned.length > 0 ? <ul className="dd-list">{detail.planned.map(plannedRow)}</ul> : <Empty>{detail ? 'Nothing is planned for this day.' : 'Nothing to show until the day log answers.'}</Empty>}
        </Fold>
        <Fold title="Intents" defaultOpen>
          {detail && detail.intents.length > 0 ? <ul className="dd-list">{detail.intents.map(intentRow)}</ul> : <Empty>{detail ? 'No intention falls on this day.' : 'Nothing to show until the intent store answers.'}</Empty>}
          {detail && detail.nextTime.length > 0 && (
            <div className="dd-next" aria-label="Set for next time">
              <span className="dd-next-title">Next time</span>
              {detail.nextTime.map((t) => <span key={t} className="dd-chip">{t}</span>)}
            </div>
          )}
        </Fold>
        {FOLDS.map((f) => (
          <Fold key={f.id} title={f.title} lazy><f.Body date={date} detail={detail} /></Fold>
        ))}

        <div className="dd-foot">
          <Button size="md" grouped onClick={() => void act({ op: 'addIntent', date })}>Add intent</Button>
          <Button size="md" grouped onClick={() => void act({ op: 'logDone', date })}>Log something done</Button>
          {waitingWhy && <span className="dd-planned"><PlannedGlyph size={14} />Saving waits for the day log</span>}
        </div>
      </div>
    </Drawer>
  )
}
