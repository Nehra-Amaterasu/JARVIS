// Day / Week (spec 20.6.2 and 20.5.3, package L03): the week as seven day columns of blocks, the timetable rack and the attendance
// margin ledger. Planned blocks are hollow (a recessed form with the kind's ring), done ones solid (a raised tile with its disc), and
// the word says which, so the difference is never only a drawing. `m` on a planned block starts a move: Left and Right choose the
// day, Enter places it, Esc cancels. The move goes through the Day port; a WAITING port says nothing was saved and nothing moves.
//
//   desk (page >= 700 px)   head | the week (7 columns) beside the rack and the margin ledger
//   phone                   head, the seven days as sections, then the rack and the ledger; the page box scrolls, the document never does
//
// Honest by construction: the week's rows come through the port (the null adapter says WAITING and why) joined with what the
// existing stores already know (the plan's minutes, today's classes), which are LIVE. A figure is drawn only beside a LIVE or
// SIMULATED lamp. The week's planned minutes are printed only with the word "planned".
import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react'
import { Button, Drawer, IconButton } from '../../../shared/kit'
import { CaptureLine } from '../../../shared/capture'
import { DayMark, shortDate, addDays } from '../../../shared/almanac'
import { showsNumber, type LampState } from '../../../shared/lamp'
import { LampWord } from '../today/Plate'
import { useAttendance } from '../../life/useLife'
import type { AttendanceAnswer } from '../../life/derive'
import { usePlan } from '../../../germoney/game/plan'
import { liveDays } from '../month/live'
import { DAY_PORT, type DayDetail, type DayPort, type PortReply } from '../ports'
import { attempt, useForm, useRead, useToday } from './hooks'
import { AllDrawer, Margins, Rack, type FreeSlot } from './Rack'
import {
  dayName, dayNum, fmtMinutes, ledgerReading, moveTarget, plannedMinutes, sortBlocks, weekDates, weekLabel, weekStart,
  type MarginRow, type RackClass, type WeekBlock,
} from './model'
import '../../../styles/design/primitive.css'
import '../today/today.css'
import './base.css'
import './week.css'

const MAX_BLOCKS = 6
/** The hours of the week's ruler, 08 to 20: a tick every hour, a label every two. Twelve rows of about 40 px fill the 1366 x 768 canvas
 *  (the 08 to 22 range left rows of 30 px and a ruler of 11 px type). Drawn only while the week holds no block, as the form of a block to come. */
const RULER_HOURS = ['08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20'] as const

type Details = Record<string, PortReply<DayDetail>>

/** The lamp of the week from its seven reads and what the stores know: SIMULATED if any row is invented, FAULT if a read broke, LIVE when anything real is drawn. */
export function weekLamp(replies: readonly PortReply<unknown>[], hasLive: boolean): { state: LampState; reason: string } {
  const sim = replies.find((r) => r.state === 'simulated')
  if (sim) return { state: 'simulated', reason: sim.reason }
  const fault = replies.find((r) => r.state === 'fault')
  if (fault) return { state: 'fault', reason: fault.reason }
  if (hasLive || replies.some((r) => r.state === 'live')) {
    // a mixed state carries one lamp, so the reason names what is still not read: the day log's port, while it answers WAITING or PLANNED
    const idle = replies.find((r) => r.state === 'waiting' || r.state === 'planned')
    const base = 'your own logs and today\'s classes'
    return { state: 'live', reason: idle ? `${base}; the day log is ${idle.state}: ${idle.reason}` : base }
  }
  const first = replies[0]
  return first ? { state: first.state === 'planned' ? 'planned' : 'waiting', reason: first.reason } : { state: 'waiting', reason: 'reading the week' }
}

/** The blocks of one day: the port's happened and planned rows plus what the stores know (study minutes logged, today's classes). */
export function blocksOf(date: string, today: string, reply: PortReply<DayDetail> | undefined, live: { minutes: number | null; classes: readonly RackClass[] }): WeekBlock[] {
  const out: WeekBlock[] = []
  const d = reply?.data
  if (d && reply && showsNumber(reply.state)) {
    for (const h of d.happened) out.push({ id: h.id, date, time: h.time, kind: h.kind, text: h.text, status: 'done', state: reply.state, movable: false })
    for (const p of d.planned) out.push({ id: p.id, date, time: p.time, kind: p.kind, text: p.text, status: p.status, state: reply.state, movable: p.status === 'planned' })
  }
  // what the port already lists (a study block, a class) is not drawn a second time from the stores
  const portHas = (k: string) => out.some((x) => x.kind === k)
  if (live.minutes && live.minutes > 0 && !portHas('study')) out.push({ id: `live-study-${date}`, date, time: null, kind: 'study', text: 'Study logged', status: 'done', state: 'live', minutes: live.minutes, movable: false })
  if (date === today && !portHas('class')) {
    for (const c of live.classes) {
      if (c.status === 'absent' || c.status === 'cancelled') continue
      out.push({ id: `live-class-${c.id}`, date, time: c.start, kind: 'class', text: c.name, status: c.status === 'present' ? 'done' : 'planned', state: 'live', movable: false })
    }
  }
  return out.sort(sortBlocks)
}

export interface WeekPageProps {
  port?: DayPort
  /** A fixed clock (the bench and the tests). Absent: the real date. */
  today?: string
  form?: 'desk' | 'phone'
  /** Study minutes by date from the plan's log (LIVE). */
  minutes?: Readonly<Record<string, number>>
  /** The attendance answer: undefined while it is being read, null when it could not be. */
  attendance?: AttendanceAnswer | null
  /** The attendance rows are invented (the bench). */
  simulated?: boolean
  initialMove?: { id: string; date: string } | null
  initialAll?: boolean
}

export function WeekPage({ port = DAY_PORT, today: fixedToday, form: forcedForm, minutes = {}, attendance, simulated = false, initialMove = null, initialAll = false }: WeekPageProps) {
  const root = useRef<HTMLDivElement>(null)
  const form = useForm(root, forcedForm)
  const today = useToday(fixedToday)
  const [start, setStart] = useState(() => weekStart(today))
  const [version, setVersion] = useState(0)
  const [moving, setMoving] = useState<{ id: string; from: string; to: string } | null>(initialMove ? { id: initialMove.id, from: initialMove.date, to: initialMove.date } : null)
  const [note, setNote] = useState<string | null>(null)
  const [all, setAll] = useState(initialAll)
  const [focusDate, setFocusDate] = useState<string | null>(null)
  const staleRef = useRef<Details | null>(null)
  const [free, setFree] = useState<FreeSlot | null>(null)
  const [planning, setPlanning] = useState(false)
  /** The day shown on the phone (one day at a time); null = today. */
  const [sel, setSel] = useState<string | null>(null)
  /** The planned block that last took focus: the Move key in the foot acts on it. */
  const [picked, setPicked] = useState<string | null>(null)
  const dates = useMemo(() => weekDates(start), [start])

  const reply = useRead<Details>(`w:${start}:${version}`, async () => {
    const rs = await Promise.all(dates.map((d) => port.day(d)))
    return { state: 'live', reason: '', since: null, data: Object.fromEntries(dates.map((d, i) => [d, rs[i]])) }
  }, `w:${start}`)
  // a read that broke keeps its state and its reason: it is FAULT with a way to try again, never an endless "reading the week"
  const readFault = reply && reply.state === 'fault' ? reply : null
  const details = reply && !readFault ? reply.data : null

  // attendance, as the rack and the ledger read it
  const att = attendance && attendance.status === 'ok' ? attendance : null
  const classes: RackClass[] = useMemo(() => (att?.today ?? []).map((c) => ({ id: c.id, start: c.start, end: c.end, name: c.name, room: c.room, status: c.status })), [att])
  const rows: MarginRow[] = useMemo(() => (att?.subjects ?? []).map((s) => ({ subject: s.subject, name: s.name, held: s.held, attended: s.attended, last: s.last })), [att])
  const required = att?.rule.threshold ?? 0.75
  const margins = att ? ledgerReading(rows, today, simulated) : { state: 'waiting' as LampState, reason: attendance === undefined ? 'reading the attendance' : attendance ? attendance.say || 'attendance is not available' : 'the attendance could not be read' }
  const rack: { state: LampState; reason: string } = att ? (simulated ? { state: 'simulated', reason: 'invented rows, not your records' } : { state: 'live', reason: 'from your timetable' }) : { state: 'waiting', reason: margins.reason }

  const blocks = useMemo(() => {
    const m = new Map<string, WeekBlock[]>()
    for (const d of dates) m.set(d, blocksOf(d, today, details?.[d], { minutes: minutes[d] ?? null, classes: d === today ? classes : [] }))
    return m
  }, [dates, today, details, minutes, classes])
  const hasLive = [...blocks.values()].some((b) => b.some((x) => x.state === 'live'))
  const lamp = readFault
    ? { state: 'fault' as LampState, reason: `${readFault.reason}. The week could not be read.` }
    : details ? weekLamp(Object.values(details), hasLive) : { state: 'waiting' as LampState, reason: 'reading the week' }

  const refresh = useCallback(() => setVersion((v) => v + 1), [])
  const stepWeek = (n: -1 | 1) => { setMoving(null); setSel(null); setStart((s) => addDays(s, 7 * n)) }

  const commit = async () => {
    if (!moving) return
    const { id, from, to } = moving
    setMoving(null)
    if (from === to) { setNote('The block stays where it is.'); return }
    const r = await attempt(() => port.logs({ op: 'move', date: from, id, to }), setNote)
    if (!r) return
    const applied = !!r.data?.applied && showsNumber(r.state)
    setNote(applied && r.data ? r.data.message : `${r.reason}${applied ? '' : '. Nothing was saved.'}`)
    if (applied) { staleRef.current = details; setFocusDate(to); refresh() }
  }

  // The move keys belong to the block being moved (or the page itself, for a move started from the bench): on Next week, This week, the rack
  // or a key in the drawer, Enter and Space do what that control does and the arrows move the focus as usual.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const t = e.target as HTMLElement
    if (!root.current?.contains(t)) return
    if (moving) {
      if (!(t === root.current || t.closest('.wk-block[data-moving="true"]'))) return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setMoving({ ...moving, to: moveTarget(dates, moving.to, e.key === 'ArrowLeft' ? -1 : 1) }) }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void commit() }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMoving(null); setNote('Move cancelled. The block stays where it is.') }
      return
    }
    if (e.key !== 'm' || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
    const b = t.closest<HTMLElement>('.wk-block')
    if (!b) return
    e.preventDefault()
    if (b.dataset.movable !== 'true') { setNote('Only a planned block can move. Done blocks and your class marks stay where they happened.'); return }
    setMoving({ id: b.dataset.id ?? '', from: b.dataset.date ?? '', to: b.dataset.date ?? '' })
  }

  // a planned block that takes focus (a press or Tab) becomes the one the foot's Move key acts on
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    const b = (e.target as HTMLElement).closest?.<HTMLElement>('.wk-block')
    if (b) setPicked(b.dataset.movable === 'true' ? b.dataset.id ?? null : null)
  }

  // a move ends when focus leaves the block being moved: nothing is placed by a key pressed somewhere else
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!moving) return
    if (!(e.target as HTMLElement).closest?.('.wk-block[data-moving="true"]')) return
    const to = e.relatedTarget as HTMLElement | null
    if (to?.closest?.('.wk-block[data-moving="true"], .wk-movekeys')) return
    if (!to && typeof document.hasFocus === 'function' && !document.hasFocus()) return
    setMoving(null)
    setNote('Move cancelled. The block stays where it is.')
  }

  // after a placed move, focus returns to the first block of the day it landed on (the block's id changes with its date)
  useEffect(() => {
    if (!focusDate) return
    if (readFault) { setFocusDate(null); return }
    if (!details || details === staleRef.current) return // the re-read has not landed: the old week is still on screen
    root.current?.querySelector<HTMLElement>(`.wk-day[data-date="${focusDate}"] .wk-block`)?.focus()
    setFocusDate(null)
  }, [focusDate, details, readFault])

  const phone = form === 'phone'
  const movingBlock = moving ? [...blocks.values()].flat().find((b) => b.id === moving.id) : null
  const status = moving
    ? `Moving ${movingBlock ? `"${movingBlock.text}"` : 'the block'} to ${shortDate(moving.to)}. Left and Right choose the day, Enter places it, Escape cancels.`
    : note
  // the block the pointer path acts on: the last planned block that took focus (a press on a block focuses it)
  const pickedBlock = picked ? [...blocks.values()].flat().find((b) => b.id === picked && b.movable) ?? null : null

  // the pointer path of a move, the same steps as m, the arrows, Enter and Esc
  const startMove = (b: WeekBlock) => {
    setMoving({ id: b.id, from: b.date, to: b.date })
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`.wk-block[data-id="${b.id}"]`)?.focus())
  }
  const stepMove = (n: -1 | 1) => { if (moving) setMoving({ ...moving, to: moveTarget(dates, moving.to, n) }) }
  const cancelMove = () => { setMoving(null); setNote('Move cancelled. The block stays where it is.') }

  const noBlocks = [...blocks.values()].every((l) => l.length === 0)
  const portRead = !!details && dates.every((d) => showsNumber(details[d]?.state ?? 'waiting'))
  const emptyLine = `${portRead ? 'Nothing is planned this week.' : 'No block yet this week.'} Plan a block to start.`
  const shownDates = phone ? [sel && dates.includes(sel) ? sel : dates.includes(today) ? today : dates[0]] : dates
  const days = shownDates.map((d) => {
    const list = blocks.get(d) ?? []
    const planned = plannedMinutes(list)
    const shown = phone ? list : list.slice(0, MAX_BLOCKS)
    return (
      <section key={d} className="wk-day" data-date={d} data-today={d === today ? 'true' : undefined} data-landing={moving && moving.to === d && moving.from !== d ? 'true' : undefined} aria-label={shortDate(d)} aria-current={d === today ? 'date' : undefined}>
        <header className="wk-day-head">
          <span className="wk-day-name">{dayName(d)}</span>
          <span className="wk-day-num dy-mono">{dayNum(d)}</span>
          {d === today && <span className="wk-notch" aria-hidden="true" />}
        </header>
        <div className="wk-well" data-empty={list.length === 0 ? 'true' : undefined}>
          <ul className="wk-blocks" aria-label={list.length === 0 ? 'No block' : 'Blocks'}>
            {moving && moving.to === d && moving.from !== d && <li className="wk-landing" role="presentation">Lands here</li>}
            {shown.map((b) => (
              <li key={b.id}>
                <div role="group" tabIndex={0} className="wk-block dy-raised" data-status={b.status} data-kind={b.kind} data-movable={b.movable ? 'true' : 'false'} data-moving={moving?.id === b.id ? 'true' : undefined}
                  data-id={b.id} data-date={b.date}
                  aria-label={`${b.text}${b.time ? `, ${b.time}` : ''}, ${b.status === 'done' ? 'done' : b.status === 'carried' ? 'planned, carried on' : 'planned'}${b.movable ? '. Press m to move it' : ''}`}>
                  <DayMark kind={b.kind} done={b.status === 'done'} decorative size={14} />
                  <span className="wk-block-text">
                    <span className="wk-block-line">{b.time && <span className="dy-mono wk-block-time">{b.time}</span>}<span className="wk-block-what">{b.text}</span></span>
                    <span className="wk-block-meta">{b.status === 'done' ? 'done' : b.status === 'carried' ? 'planned, carried on' : 'planned'}{b.minutes && showsNumber(b.state) ? ` · ${b.minutes} min` : ''}</span>
                  </span>
                </div>
              </li>
            ))}
            {list.length > shown.length && <li className="wk-more">+{list.length - shown.length} more</li>}
            {phone && list.length === 0 && <li className="wk-empty" role="presentation">{noBlocks ? emptyLine : 'Nothing on this day.'}</li>}
          </ul>
          {planned !== null && <footer className="wk-day-foot dy-mono">planned {fmtMinutes(planned)}</footer>}
        </div>
      </section>
    )
  })

  // phone: one day at a time, chosen from a strip of seven chips; the chosen chip is raised, today wears the ink mark under its date
  const strip = phone && (
    <div className="wk-strip" role="group" aria-label="Choose a day">
      {dates.map((d) => {
        const on = shownDates[0] === d
        const n = (blocks.get(d) ?? []).length
        return (
          <button key={d} type="button" className="wk-chip" aria-pressed={on} data-today={d === today ? 'true' : undefined} data-landing={moving && moving.to === d && moving.from !== d ? 'true' : undefined}
            aria-label={`${shortDate(d)}${d === today ? ', today' : ''}, ${n === 0 ? 'no block' : `${n} block${n === 1 ? '' : 's'}`}`}
            onClick={() => { if (!moving) setSel(d) }}>
            <span className="wk-chip-name">{dayName(d).slice(0, 2)}</span>
            <span className="wk-chip-num dy-mono">{dayNum(d)}</span>
            <i className="wk-chip-dot" data-on={n > 0 ? 'true' : undefined} aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )

  const moveKeys = moving ? (
    <span className="wk-movekeys" role="group" aria-label="Move the block">
      <IconButton label="One day earlier" grouped onClick={() => stepMove(-1)}><ChevronLeft size={18} aria-hidden="true" /></IconButton>
      <IconButton label="One day later" grouped onClick={() => stepMove(1)}><ChevronRight size={18} aria-hidden="true" /></IconButton>
      <Button grouped onClick={() => void commit()} data-act="place-block">Place it</Button>
      <Button grouped onClick={cancelMove} data-act="cancel-move">Cancel</Button>
    </span>
  ) : pickedBlock ? (
    <span className="wk-movekeys" role="group" aria-label="Move the block">
      <Button grouped onClick={() => startMove(pickedBlock)} data-act="move-block"><GripVertical size={16} aria-hidden="true" />Move this block</Button>
    </span>
  ) : null

  const planKey = <Button tone="primary" size="lg" className="dy-primary" onClick={() => setPlanning(true)} data-act="plan-block">Plan a block</Button>

  return (
    <div ref={root} className="dy wk" data-form={form} data-state={lamp.state} data-simulated={lamp.state === 'simulated' || simulated ? 'true' : undefined} onKeyDown={onKeyDown} onBlur={onBlur} onFocus={onFocus}>
      <header className="dy-head">
        <div className="dy-head-text">
          <h1 className="dy-title">Week <small>{weekLabel(start)}</small></h1>
          <p className="dy-sub" role="status"><LampWord state={lamp.state} /><span className="dy-why">{lamp.reason}</span></p>
        </div>
        <div className="dy-keys">
          <IconButton label="Previous week" grouped onClick={() => stepWeek(-1)}><ChevronLeft size={18} aria-hidden="true" /></IconButton>
          <IconButton label="Next week" grouped onClick={() => stepWeek(1)}><ChevronRight size={18} aria-hidden="true" /></IconButton>
          {readFault && <Button grouped onClick={refresh} data-act="retry-week">Try again</Button>}
          <Button grouped onClick={() => { setMoving(null); setSel(null); setStart(weekStart(today)) }} data-key="this-week">This week</Button>
          {!phone && planKey}
        </div>
      </header>

      <div className="dy-main wk-main">
        <div className="wk-left">
          {phone && planKey}
          {strip}
          <div className="wk-frame" data-empty={noBlocks ? 'true' : undefined}>
            {noBlocks && !phone && (
              <div className="wk-ruler dy-mono" aria-hidden="true">
                {RULER_HOURS.map((h, i) => <span key={h}><b>{i % 2 === 0 ? h : ''}</b><i /></span>)}
              </div>
            )}
            <div className="wk-week" aria-label="The week">
              {days}
              {noBlocks && !phone && (
                <>
                  <div className="wk-lines" aria-hidden="true">{RULER_HOURS.map((h, i) => <i key={h} data-major={i % 2 === 0 ? 'true' : undefined} />)}</div>
                  <p className="wk-empty">{emptyLine}</p>
                </>
              )}
            </div>
          </div>
          <div className="wk-foot">
            <p className="wk-line" role="status" aria-live="polite" data-moving={moving ? 'true' : undefined}>
              {status ?? <>A planned block is hollow, a done one solid. Press <kbd>m</kbd> on a planned block to move it.</>}
            </p>
            {moveKeys}
          </div>
        </div>
        <div className="wk-side">
          <div className="dy-cell"><Rack classes={classes} state={rack.state} reason={rack.reason} onAll={() => setAll(true)} onFree={setFree} /></div>
          <div className="dy-cell"><Margins rows={rows} required={required} state={margins.state} reason={margins.reason} onAll={() => setAll(true)} /></div>
        </div>
      </div>

      <Drawer open={planning} onClose={() => setPlanning(false)} title="Plan a block" place={phone ? 'bottom' : 'right'} className="dy-sheet wk-sheet">
        {planning && (
          <div className="wk-drawer-body">
            <p className="dy-note">Write what you would like to plan and when; the line is read and nothing more.</p>
            <CaptureLine grammar="ww" label="Capture, for example: remind me today 4 pm revise" globalKey={false} initialText="remind me today "
              onCommit={() => { setPlanning(false); setNote('That line was understood. Nothing was saved: the intent store is not connected yet.') }} />
          </div>
        )}
      </Drawer>

      <Drawer open={!!free} onClose={() => setFree(null)} title="Free time" place={phone ? 'bottom' : 'right'} className="dy-sheet wk-sheet">
        {free && (
          <div className="wk-drawer-body">
            <p className="dy-note">{free.from} to {free.to}, free for {fmtMinutes(free.minutes)}. Write what you would like to do in it; the line is read and nothing more.</p>
            <CaptureLine grammar="ww" label="Capture, for example: remind me today 4 pm revise" globalKey={false} initialText={`remind me today ${free.from} `}
              onCommit={() => { setFree(null); setNote('That line was understood. Nothing was saved: the intent store is not connected yet.') }} />
          </div>
        )}
      </Drawer>

      <AllDrawer open={all} onClose={() => setAll(false)} classes={classes} rows={rows} required={required} state={margins.state} reason={margins.reason} rackState={rack.state} rackReason={rack.reason} />
    </div>
  )
}

/** What the shell loads for Day / Week: the real port, the real stores, the real clock. */
export default function Week() {
  const attendance = useAttendance()
  const logs = usePlan((s) => s.state?.events ?? null)
  useEffect(() => { if (usePlan.getState().today === null) void usePlan.getState().refresh() }, [])
  const today = useToday()
  const minutes = useMemo(() => {
    const out: Record<string, number> = {}
    for (const d of liveDays(today, logs, null)) if (d.minutes) out[d.date] = d.minutes
    return out
  }, [logs, today])
  // undefined = still reading; null = the route did not answer (the page then says so instead of drawing nothing)
  const att = attendance.data ?? (attendance.loading ? undefined : null)
  return <WeekPage minutes={minutes} attendance={att} />
}

