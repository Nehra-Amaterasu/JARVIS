// Day / Close (spec 20.6.2, package L03): closing the day on one canvas. What was logged today, what is planned for tomorrow, the key
// "Plan tomorrow" (three "When <cue>, I will <step> for <n> min" rows in a drawer), and an opt-in daily capture line built on the shared Capture
// Line (grammar `ww`) so a later daily habit can land on it. On the first opening after two or more days away the page says one neutral line,
// "Pick up here.", and shows the last three days that hold a log; no count changes and nothing is compared.
//
// Honest by construction: the figures are the student's own logs (LIVE) or come through the port (the null adapter says WAITING and why). The plan
// goes to the intent store, which is the null object today: the drawer says nothing was saved instead of pretending. The capture is opt-in, off
// by default, kept as a line on this device only, and carries no count, no run of days and no nudge to do it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Drawer, Field } from '../../../shared/kit'
import { CaptureLine, type Parsed } from '../../../shared/capture'
import { DayMark, shortDate } from '../../../shared/almanac'
import { showsNumber, type LampState } from '../../../shared/lamp'
import { LampWord, Num, TodayPlate } from '../today/Plate'
import { useAttendance } from '../../life/useLife'
import { useLeft } from '../../left/store'
import { usePlan } from '../../../germoney/game/plan'
import { liveDays } from '../month/live'
import { DAY_PORT, type DayPort, type LogResult, type PortReply } from '../ports'
import { attempt, localGet, localSet, useForm, useRead, useToday } from '../week/hooks'
import type { RackClass } from '../week/model'
import { PLAN_ROWS, isReturn, lastLogged, planRows, planSentence, tomorrowOf } from './model'
import { PLAN_STORE, type PlanStore } from './plan'
import '../../../styles/design/primitive.css'
import '../today/today.css'
import '../week/base.css'
import './close.css'
import '../v3/day-v3.css'
import { lookV3Enabled } from '../../../shell/look'
import { useViewChrome, Zones, type ViewChromeSpec } from '../../../shell/v3'
import { useStore } from '../../../lib/store'
import { CAPTURE_MODE, takeLine } from '../v3/capture'

const SEEN_KEY = 'ww.day.lastSeen'
const LINES_KEY = 'ww.day.captures'

const readLines = (): string[] => {
  try {
    const v = JSON.parse(localGet(LINES_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 3) : []
  } catch { return [] }
}

/** Why a store has not answered: WAITING while it is being read, FAULT when the read broke. Never "none" until it has answered. */
export interface Unread { state: 'waiting' | 'fault'; reason: string }

export interface ClosePageProps {
  port?: DayPort
  plan?: PlanStore
  today?: string
  form?: 'desk' | 'phone'
  /** Study minutes by date from the plan's log (LIVE). null while the plan store has not answered. */
  minutes?: Readonly<Record<string, number>> | null
  /** Why `minutes` is null. */
  minutesUnread?: Unread
  /** Today's classes from the timetable, with the marks the student tapped. null while the timetable has not answered. */
  classes?: readonly RackClass[] | null
  /** Why `classes` is null. */
  classesUnread?: Unread
  /** Tomorrow's first block from the exam plan, when it has one. */
  tomorrowFirst?: string | null
  /** The last date this page was opened, YYYY-MM-DD, or null on a first opening. */
  lastSeen?: string | null
  simulated?: boolean
  initialPlan?: boolean
  initialCapture?: boolean
}

export function ClosePage({ port = DAY_PORT, plan = PLAN_STORE, today: fixedToday, form: forcedForm, minutes = {}, minutesUnread = { state: 'waiting', reason: 'reading your plan' }, classes = [], classesUnread = { state: 'waiting', reason: 'reading the timetable' }, tomorrowFirst = null, lastSeen = null, simulated = false, initialPlan = false, initialCapture = false }: ClosePageProps) {
  const root = useRef<HTMLDivElement>(null)
  // under the v3 look the plan sits in one tray, so the form follows that tray's width
  const v3 = lookV3Enabled()
  const body = useRef<HTMLDivElement>(null)
  const form = useForm(v3 ? body : root, forcedForm)
  const today = useToday(fixedToday)
  const tomorrow = tomorrowOf(today)
  const [planOpen, setPlanOpen] = useState(initialPlan)
  const [capture, setCapture] = useState(initialCapture)
  const [lines, setLines] = useState<string[]>(readLines)
  const [drafts, setDrafts] = useState(() => Array.from({ length: PLAN_ROWS }, () => ({ cue: '', step: '', minutes: '' })))
  const [note, setNote] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  // the saved lines belong to the day they were saved for: at midnight "tomorrow" is a new day and they are not shown for it
  const [savedFor, setSavedFor] = useState<{ date: string; lines: string[] }>({ date: '', lines: [] })
  const todayR = useRead(`ct:${today}:${version}`, () => port.day(today), `ct:${today}`)
  const nextR = useRead(`cn:${tomorrow}:${version}`, () => port.day(tomorrow), `cn:${tomorrow}`)
  const back = useMemo(() => isReturn(lastSeen, today), [lastSeen, today])
  const recent = useMemo(() => lastLogged(minutes ?? {}, today), [minutes, today])
  const saved = savedFor.date === tomorrow ? savedFor.lines : []

  // each figure has the state of its own source: "none logged yet" and "no class today" are said only after that source has answered
  const todayState: LampState = simulated ? 'simulated' : 'live'
  const studyS: { state: LampState; reason: string } = minutes === null ? minutesUnread : { state: todayState, reason: '' }
  const classS: { state: LampState; reason: string } = classes === null ? classesUnread : { state: todayState, reason: '' }
  const mins = minutes?.[today] ?? 0
  const presentN = (classes ?? []).filter((c) => c.status === 'present').length
  const classN = (classes ?? []).filter((c) => c.status !== 'absent' && c.status !== 'cancelled').length
  const doneToday = todayR && showsNumber(todayR.state) ? todayR.data?.happened.length ?? 0 : null
  const plannedNext = nextR && showsNumber(nextR.state) ? nextR.data?.planned ?? [] : []
  // the head lamp follows the two stores the page reads for itself: a FAULT shows over a WAITING, and a LIVE is never drawn over an unread store
  const unread = [studyS, classS].find((s) => s.state === 'fault') ?? [studyS, classS].find((s) => s.state === 'waiting')
  const headState: LampState = unread ? unread.state : todayState
  const headReason = unread ? unread.reason : simulated ? 'invented rows, not your records' : 'what you logged today'

  const savePlan = async () => {
    const rows = planRows(drafts)
    if (rows.length === 0) { setNote('Write at least one step first.'); return }
    const r: PortReply<LogResult> | undefined = await attempt(() => plan.save(tomorrow, rows), setNote)
    if (!r) return
    const applied = !!r.data?.applied && showsNumber(r.state)
    setNote(applied && r.data ? r.data.message : `${r.reason}${applied ? '' : '. Nothing was saved.'}`)
    if (applied) { setSavedFor({ date: tomorrow, lines: rows.map(planSentence) }); setVersion((v) => v + 1); setPlanOpen(false) }
  }

  const onCapture = (p: Parsed) => {
    const next = [p.text, ...lines].slice(0, 3)
    setLines(next)
    localSet(LINES_KEY, JSON.stringify(next))
  }

  // the v3 dock: the capture line is the Capture mode (kept as a line on this device, as before); the opt-in switch is a row of More
  const onLine = useRef(onCapture)
  onLine.current = onCapture
  const capOn = useRef(capture)
  capOn.current = capture
  const chrome = useMemo<ViewChromeSpec | null>(() => (v3 ? {
    dock: {
      modes: [CAPTURE_MODE],
      onSubmit: (_mode, text) => {
        const say = (m: string) => useStore.getState().toast(m, 'info')
        if (!capOn.current) { say('Daily capture is off. Turn it on in More.'); return false }
        return takeLine(text, (p) => onLine.current(p), say)
      },
    },
    more: [{ id: 'capture', label: `Daily capture: ${capture ? 'on' : 'off'}, change`, onSelect: () => setCapture((c) => !c) }],
  } : null), [v3, capture])
  useViewChrome(chrome)

  // `p` opens the plan for tomorrow (never while typing, never with a modifier)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'p' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      if (document.querySelector('.ww-sheet[data-state="open"]')) return // another drawer is open: its keys are its own
      e.preventDefault()
      setPlanOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const phone = form === 'phone'
  const set = (i: number, k: 'cue' | 'step' | 'minutes', v: string) => setDrafts((d) => d.map((x, j) => (j === i ? { ...x, [k]: v } : x)))

  const planKey = <Button tone="primary" size="lg" className="dy-primary cl-plan-key" onClick={() => setPlanOpen(true)} data-open="plan-tomorrow" aria-keyshortcuts="p">Plan tomorrow</Button>

  const todayPlate = (
    <TodayPlate id="today" label="Today in one look" state={headState} reason={unread ? unread.reason : simulated ? 'invented rows, not your records' : 'your own logs'}>
      <dl className="cl-rows">
        <div><dt>Study logged</dt><dd>{minutes === null ? <><Num value={null} state={studyS.state} /><span className="cl-why">{studyS.reason}</span></> : mins > 0 ? <Num value={mins} unit="min" state={todayState} /> : <span className="cl-none">none logged yet</span>}</dd></div>
        <div><dt>Classes marked present</dt><dd>{classes === null ? <><Num value={null} state={classS.state} /><span className="cl-why">{classS.reason}</span></> : classN > 0 ? <Num value={presentN} unit={`of ${classN}`} state={todayState} /> : <span className="cl-none">no class today</span>}</dd></div>
        <div><dt>Other things logged</dt><dd>{doneToday === null ? <><Num value={null} state={todayR?.state ?? 'waiting'} /><span className="cl-why">{todayR ? todayR.reason : 'reading'}</span></> : <Num value={doneToday} state={todayR!.state} />}</dd></div>
      </dl>
    </TodayPlate>
  )

  const tomorrowPlate = (
    <TodayPlate id="tomorrow" label="Tomorrow" state={nextR ? nextR.state : 'waiting'} reason={nextR ? nextR.reason : 'reading'}>
      {tomorrowFirst && <p className="cl-first"><span className="cl-first-label">First block, from your exam plan</span>{tomorrowFirst}</p>}
      {plannedNext.length > 0 || saved.length > 0 ? (
        <ul className="cl-plan" aria-label="Planned for tomorrow">
          {plannedNext.map((p) => <li key={p.id}><DayMark kind={p.kind} done={false} decorative /><span className="dy-mono">{p.time ?? '– –'}</span><span>{p.text}</span></li>)}
          {saved.map((s, i) => <li key={`${i}-${s}`}><DayMark kind="intent" done={false} decorative /><span>{s}</span></li>)}
        </ul>
      ) : (
        <>
          <ul className="cl-slots" aria-label="Tomorrow's plan, three hollow lines">
            {[0, 1, 2].map((i) => <li key={i} className="cl-slot" data-hollow="true"><span className="dy-mono dy-hollow">– –:– –</span><span className="td-dash" /></li>)}
          </ul>
          <p className="dy-note">{nextR && showsNumber(nextR.state) ? 'Nothing is planned for tomorrow yet. Three lines are enough.' : "Write tomorrow's plan now; it stays a hollow form until it is saved."}</p>
        </>
      )}
      {!v3 && planKey}
    </TodayPlate>
  )

  const head = (
  <header className="dy-head">
    <div className="dy-head-text">
      <h1 className="dy-title">Close the day <small>{shortDate(today)}</small></h1>
      <p className="dy-sub" role="status"><LampWord state={headState} /><span className="dy-why">{headReason}</span></p>
    </div>
  </header>
  )
  const backSection = (
    <section className="cl-back" aria-label="Pick up here" data-return="">
      <p className="cl-back-line">Pick up here.</p>
      {recent.length > 0 && (
        <ul className="cl-back-days" aria-label="The last days with a log">
          {recent.map((d) => <li key={d.date}><span>{shortDate(d.date)}</span><span className="dy-mono">{d.minutes} min</span></li>)}
        </ul>
      )}
    </section>
  )
  const drawer = (
  <Drawer open={planOpen} onClose={() => setPlanOpen(false)} title={`Plan ${shortDate(tomorrow)}`} place={phone ? 'bottom' : 'right'} className="dy-sheet cl-sheet">
    <div className="cl-drawer">
      <p className="dy-note">Up to three lines: when something happens, what you will do and for how long. They are your intentions, not a result.</p>
      {drafts.map((d, i) => (
        <fieldset key={i} className="cl-row">
          <legend>Line {i + 1}</legend>
          <Field label="When" value={d.cue} maxLength={60} onChange={(e) => set(i, 'cue', e.target.value)} />
          <Field label="I will" value={d.step} maxLength={80} onChange={(e) => set(i, 'step', e.target.value)} />
          <Field label="For" unit="min" inputMode="numeric" value={d.minutes} maxLength={3} onChange={(e) => set(i, 'minutes', e.target.value)} />
        </fieldset>
      ))}
      <Button tone="primary" size="lg" onClick={() => void savePlan()} data-act="save-plan">Save the plan</Button>
      <p className="dy-note" role="status">{planOpen ? note ?? '' : ''}</p>
    </div>
  </Drawer>
  )

  // under the v3 look: three trays (CLOSE, TOMORROW, LOGGED); the capture line is the dock's Capture mode and the on/off key is a row of More
  if (v3) {
    return (
      <div ref={root} className="dy cx" data-v3="" data-form={form} data-simulated={simulated ? 'true' : undefined}>
        <Zones
          ratio={[1.85, 1.05, 0.95]}
          first={{
            job: 'CLOSE', className: 'tv3-flush',
            children: <div className="tv3 tv3-close" ref={body}>{head}{todayPlate}{planKey}</div>,
          }}
          second={{
            job: 'TOMORROW', peek: { name: 'Tomorrow', lamp: nextR ? nextR.state : 'waiting', note: nextR ? nextR.reason : 'reading' },
            children: <div className="tv3">{tomorrowPlate}</div>,
          }}
          third={{
            job: 'LOGGED', peek: { name: 'Logged', lamp: headState, note: lines.length === 0 ? 'no lines kept' : undefined },
            children: (
              <div className="tv3 tv3-logged">
                {back && backSection}
                <section className="cl-back" aria-label="Lines kept on this device">
                  <p className="cl-back-line">{lines.length > 0 ? 'Lines kept on this device' : capture ? 'No line kept yet.' : 'Daily capture is off.'}</p>
                  {lines.length > 0 && <ul className="cl-back-days" aria-label="Captured lines">{lines.map((l, i) => <li key={`${i}-${l}`}><span>{l}</span></li>)}</ul>}
                </section>
                <p className="dy-note">Kept on this device only. A line is not added to the water, spending or gym logs until their stores are connected.</p>
                <p className="dy-note cl-note" role="status">{planOpen ? '' : note ?? ''}</p>
              </div>
            ),
          }}
        />
        {drawer}
      </div>
    )
  }

  return (
    <div ref={root} className="dy cx" data-form={form} data-simulated={simulated ? 'true' : undefined}>
      <header className="dy-head">
        <div className="dy-head-text">
          <h1 className="dy-title">Close the day <small>{shortDate(today)}</small></h1>
          <p className="dy-sub" role="status"><LampWord state={headState} /><span className="dy-why">{headReason}</span></p>
        </div>
      </header>

      {back && (
        <section className="cl-back" aria-label="Pick up here" data-return="">
          <p className="cl-back-line">Pick up here.</p>
          {recent.length > 0 && (
            <ul className="cl-back-days" aria-label="The last days with a log">
              {recent.map((d) => <li key={d.date}><span>{shortDate(d.date)}</span><span className="dy-mono">{d.minutes} min</span></li>)}
            </ul>
          )}
        </section>
      )}

      <div className="dy-main cl-main">
        <div className="dy-cell">{todayPlate}</div>
        <div className="dy-cell">{tomorrowPlate}</div>
      </div>

      <footer className="cl-foot">
        <div className="cl-capture">
          {capture ? (
            <>
              <CaptureLine grammar="ww" label="Capture, for example: water 500" globalKey={false} onCommit={onCapture} />
              <p className="dy-note">Kept as a line on this device. It is not added to the water, spending or gym logs until their stores are connected.{lines.length > 0 ? ' Last lines: ' : ''}{lines.join(' · ')}</p>
            </>
          ) : (
            <p className="dy-note">Daily capture is off. Turn it on if you want a line to write the day's numbers in; it is optional and keeps no count.</p>
          )}
        </div>
        <Button grouped aria-pressed={capture} onClick={() => setCapture((c) => !c)} data-act="capture">{capture ? 'Capture: on' : 'Capture: off'}</Button>
      </footer>
      <p className="dy-note cl-note" role="status">{planOpen ? '' : note ?? ''}</p>

      <Drawer open={planOpen} onClose={() => setPlanOpen(false)} title={`Plan ${shortDate(tomorrow)}`} place={phone ? 'bottom' : 'right'} className="dy-sheet cl-sheet">
        <div className="cl-drawer">
          <p className="dy-note">Up to three lines: when something happens, what you will do and for how long. They are your intentions, not a result.</p>
          {drafts.map((d, i) => (
            <fieldset key={i} className="cl-row">
              <legend>Line {i + 1}</legend>
              <Field label="When" value={d.cue} maxLength={60} onChange={(e) => set(i, 'cue', e.target.value)} />
              <Field label="I will" value={d.step} maxLength={80} onChange={(e) => set(i, 'step', e.target.value)} />
              <Field label="For" unit="min" inputMode="numeric" value={d.minutes} maxLength={3} onChange={(e) => set(i, 'minutes', e.target.value)} />
            </fieldset>
          ))}
          <Button tone="primary" size="lg" onClick={() => void savePlan()} data-act="save-plan">Save the plan</Button>
          <p className="dy-note" role="status">{planOpen ? note ?? '' : ''}</p>
        </div>
      </Drawer>
    </div>
  )
}

/** What the shell loads for Day / Close: the real port, the real stores, the real clock. */
export default function Close() {
  const today = useToday()
  const logs = usePlan((s) => s.state?.events ?? null)
  const tomorrowFirst = useLeft((s) => s.tomorrow)
  const attendance = useAttendance()
  const [lastSeen] = useState(() => localGet(SEEN_KEY))
  useEffect(() => {
    if (usePlan.getState().today === null) void usePlan.getState().refresh()
    if (useLeft.getState().phase.exams === 'idle') void useLeft.getState().loadSlice('exams')
  }, [])
  useEffect(() => { localSet(SEEN_KEY, today) }, [today])
  const offline = usePlan((s) => s.offline)
  // null until the source has answered: the page then says WAITING (or FAULT) with the reason instead of "none logged yet" / "no class today"
  const minutes = useMemo(() => {
    if (logs === null) return null
    const out: Record<string, number> = {}
    for (const d of liveDays(today, logs, null)) if (d.minutes) out[d.date] = d.minutes
    return out
  }, [logs, today])
  const minutesUnread: Unread = offline ? { state: 'fault', reason: 'your plan could not be read' } : { state: 'waiting', reason: 'reading your plan' }
  const classes: RackClass[] | null = useMemo(() => (attendance.data?.status === 'ok' ? attendance.data.today.map((c) => ({ id: c.id, start: c.start, end: c.end, name: c.name, room: c.room, status: c.status })) : null), [attendance.data])
  const classesUnread: Unread = attendance.loading
    ? { state: 'waiting', reason: 'reading the timetable' }
    : attendance.data
      ? { state: 'waiting', reason: attendance.data.say || 'the timetable is not available' }
      : { state: 'fault', reason: 'the timetable could not be read' }
  return <ClosePage minutes={minutes} minutesUnread={minutesUnread} classes={classes} classesUnread={classesUnread} tomorrowFirst={tomorrowFirst} lastSeen={lastSeen} />
}
