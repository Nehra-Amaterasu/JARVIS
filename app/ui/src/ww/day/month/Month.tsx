// Day / Month, the Life calendar under shell v2 (spec 20.6.1, package L01). One canvas at 1366 x 768: a head (the month, previous and
// next, Week / Month / Year, Today, the Google lamp, Marks), the Almanac grid at the left, the month reading at the right and the
// weekday strip under the grid. At 390 px it is one column and the tap on a day opens a bottom sheet. Registered by
// shell/views/day-month.view.ts, so it replaces the frame on Day / Month only.
//
// Honest by construction: the month's days come through the Day port (a null adapter says WAITING and why) joined with what the
// existing stores already know and the student tapped (the plan's minutes, today's classes), which are LIVE. A figure is drawn only
// when its own lamp is LIVE or SIMULATED; the head says which source it is reading and in what state.
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button, IconButton, Lamp, NO_VALUE, Popover, Segmented } from '../../../shared/kit'
import {
  Almanac, DayMark, KINDS, MarksLegend, SHAPES, addDays, addMonths, mergeDays, monthLabel, monthOf, monthReading, pageLamp, shortDate, ymd,
  type AlmanacMode, type DayData, type Kind,
} from '../../../shared/almanac'
import { showsNumber, type LampState } from '../../../shared/lamp'
import { useLeft } from '../../left/store'
import { usePlan } from '../../../germoney/game/plan'
import { DayDrawer } from '../drawer/DayDrawer'
import { DAY_PORT, type DayPort, type IntentRow, type LogOp, type PortReply } from '../ports'
import { FACES } from './faces'
import { liveDays } from './live'
import './month.css'

/** A read through the port, tagged with the key it was made for, so a slow answer for another month is never drawn. */
function useRead<T>(key: string, read: () => Promise<PortReply<T>>): PortReply<T> | null {
  const [got, setGot] = useState<{ key: string; reply: PortReply<T> } | null>(null)
  const ref = useRef(read)
  ref.current = read
  useEffect(() => {
    let live = true
    ref.current().then(
      (reply) => { if (live) setGot({ key, reply }) },
      () => { if (live) setGot({ key, reply: { state: 'fault', reason: 'the read did not finish', since: null, data: null } }) },
    )
    return () => { live = false }
  }, [key])
  return got && got.key === key ? got.reply : null
}

/** The local date, stepping once at midnight (one timeout re-armed after each step; never an interval). */
function useToday(fixed?: string): string {
  const [t, setT] = useState(() => fixed ?? ymd(new Date()))
  useEffect(() => {
    if (fixed) {
      setT(fixed)
      return
    }
    const next = new Date()
    next.setHours(24, 0, 5, 0)
    const id = setTimeout(() => setT(ymd(new Date())), Math.max(1000, next.getTime() - Date.now()))
    return () => clearTimeout(id)
  }, [fixed, t])
  return t
}

const PHONE_MAX = 700

/** The phone form below 700 px of the page's own width, read once at mount from the window and then from the page. */
function useForm(ref: RefObject<HTMLElement | null>, forced?: 'desk' | 'phone'): 'desk' | 'phone' {
  const [form, setForm] = useState<'desk' | 'phone'>(forced ?? (typeof window !== 'undefined' && window.innerWidth < 900 ? 'phone' : 'desk'))
  useEffect(() => {
    if (forced) {
      setForm(forced)
      return
    }
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setForm(el.clientWidth > 0 && el.clientWidth < PHONE_MAX ? 'phone' : 'desk'))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, forced])
  return form
}

const calm = (): boolean =>
  typeof window === 'undefined' || document.documentElement.dataset.motion === 'calm' || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export interface MonthPageProps {
  port?: DayPort
  /** A fixed clock (the bench and the tests). Absent: the real date. */
  today?: string
  /** Read the existing stores for LIVE minutes and today's classes. Off on the bench, where every figure is SIMULATED. */
  live?: boolean
  form?: 'desk' | 'phone'
  initialMode?: AlmanacMode
  initialMonth?: string
  initialDrawer?: string | null
  initialMarks?: boolean
}

function useLive(today: string, on: boolean): DayData[] {
  const logs = usePlan((s) => (on ? s.state?.events ?? null : null))
  const classes = useLeft((s) => (on ? s.classes : null))
  useEffect(() => {
    if (!on) return
    const ph = useLeft.getState().phase
    if (Object.values(ph).every((p) => p === 'idle')) void useLeft.getState().load()
    if (usePlan.getState().today === null) void usePlan.getState().refresh()
  }, [on])
  return useMemo(() => (on ? liveDays(today, logs, classes) : []), [on, today, logs, classes])
}

const KIND_SET = new Set<Kind>(KINDS)

export function MonthPage({ port = DAY_PORT, today: fixedToday, live = false, form: forcedForm, initialMode = 'month', initialMonth, initialDrawer = null, initialMarks = false }: MonthPageProps) {
  const root = useRef<HTMLDivElement>(null)
  const form = useForm(root, forcedForm)
  const today = useToday(fixedToday)
  const [mode, setMode] = useState<AlmanacMode>(initialMode)
  const [month, setMonth] = useState(initialMonth ?? monthOf(today))
  const [drawer, setDrawer] = useState<string | null>(initialDrawer)
  // the drawer stays mounted through its exit, so focus can return to the day that opened it
  const lastDrawer = useRef<string | null>(initialDrawer)
  if (drawer) lastDrawer.current = drawer
  const [kindsOn, setKindsOn] = useState<ReadonlySet<Kind>>(KIND_SET)
  const [marksOpen, setMarksOpen] = useState(initialMarks)
  const [menu, setMenu] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const marksKey = useRef<HTMLButtonElement>(null)
  const menuAnchor = useRef<HTMLElement | null>(null)
  const slide = useRef<HTMLDivElement>(null)

  const year = month.slice(0, 4)
  const within = mode === 'year' ? year : month
  const key = `${within}:${version}`
  const monthReply = useRead(`m:${key}`, () => port.month(month))
  const gcalReply = useRead(`g:${key}`, () => port.gcal(month))
  const intakeReply = useRead(`i:${key}`, () => port.intake(month))
  const intentsReply = useRead(`n:${today}:${version}`, () => port.intents({ from: today, to: addDays(today, 90) }))
  const liveList = useLive(today, live)

  const days = useMemo(
    () => mergeDays(monthReply?.data, liveList, gcalReply?.data),
    [monthReply, liveList, gcalReply],
  )
  const exams = intakeReply?.data ?? undefined
  const pageState: LampState = pageLamp(days, monthReply ? [monthReply.state] : [])
  const reading = useMemo(() => monthReading(days, within, kindsOn, exams ?? []), [days, within, kindsOn, exams])

  // a month change slides the grid 8 px and fades it in 160 ms; a still page does not move (reduced motion, the calm setting)
  const first = useRef(true)
  const lastMonth = useRef(month)
  useEffect(() => {
    if (first.current) {
      first.current = false
      lastMonth.current = month
      return
    }
    const dir = month > lastMonth.current ? 1 : -1
    lastMonth.current = month
    if (!calm()) slide.current?.animate?.([{ opacity: 0.35, transform: `translateX(${8 * dir}px)` }, { opacity: 1, transform: 'none' }], { duration: 160, easing: 'ease-out' })
  }, [month])

  const step = useCallback((delta: -1 | 1) => setMonth((m) => addMonths(m, mode === 'year' ? 12 * delta : delta)), [mode])
  const goToday = useCallback(() => setMonth(monthOf(today)), [today])
  const onMode = useCallback((m: AlmanacMode) => { setMode(m); setNote(null) }, [])
  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  const runMenu = async (op: LogOp, date: string) => {
    setMenu(null)
    const r = await port.logs({ op, date })
    const applied = !!r.data?.applied && showsNumber(r.state)
    setNote(applied && r.data ? r.data.message : `${r.reason}${applied ? '' : '. Nothing was saved.'}`)
    if (applied) refresh()
  }

  const nextIntents = useMemo(
    () => (intentsReply?.data ?? []).filter((r): r is IntentRow & { due: string } => !!r.due && r.due >= today).slice(0, 3),
    [intentsReply, today],
  )

  const phone = form === 'phone'
  const statusReply = monthReply
  const emptyMonth = !!statusReply && showsNumber(statusReply.state) && reading.counted === false && days.every((d) => d.marks.length === 0)

  return (
    <div ref={root} className="mo" data-form={form} data-state={pageState} data-simulated={days.some((d) => d.state === 'simulated') ? 'true' : undefined}>
      <header className="mo-head">
        <div className="mo-title">
          <h1 className="mo-month">{mode === 'year' ? <span className="mo-year">{year}</span> : <>{monthLabel(month).split(' ')[0]} <span className="mo-year">{year}</span></>}</h1>
          <p className="mo-sub" role="status">
            {statusReply ? <Lamp state={statusReply.state} reason={statusReply.reason} /> : <span className="mo-reading">Reading the month</span>}
            {statusReply && (
              <span className="mo-why" aria-hidden="true">
                {emptyMonth ? 'Nothing logged this month yet. Tap a day to add one.' : statusReply.reason}
              </span>
            )}
          </p>
        </div>
        <div className="mo-keys">
          <span className="mo-step">
            <IconButton label={mode === 'year' ? 'Previous year' : 'Previous month'} grouped onClick={() => step(-1)}><ChevronLeft size={18} aria-hidden="true" /></IconButton>
            <IconButton label={mode === 'year' ? 'Next year' : 'Next month'} grouped onClick={() => step(1)}><ChevronRight size={18} aria-hidden="true" /></IconButton>
          </span>
          <Segmented<AlmanacMode>
            label="Calendar form" variant="choice" value={mode} onChange={onMode}
            options={[{ id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }, { id: 'year', label: 'Year' }]}
          />
          <Button grouped onClick={goToday} data-key="today">Today</Button>
          <span className="mo-google">
            <span className="mo-google-name">Google</span>
            {gcalReply ? <Lamp state={gcalReply.state} reason={gcalReply.reason} /> : <Lamp state="waiting" reason="not read yet" />}
          </span>
          <Button ref={marksKey} grouped aria-haspopup="dialog" aria-expanded={marksOpen} onClick={() => setMarksOpen((o) => !o)} data-key="marks">Marks</Button>
        </div>
      </header>

      <div className="mo-main" ref={slide}>
        <Almanac
          mode={mode} days={days} exams={exams} month={month} today={today} state={pageState} selected={drawer} kindsOn={kindsOn} form={form}
          onPick={(d) => { setMenu(null); setDrawer(d) }}
          onMonth={step}
          onMode={onMode}
          onToday={goToday}
          onAdd={(d) => void runMenu('addIntent', d)}
          onMenu={(d, el) => { menuAnchor.current = el; setMenu(d) }}
          onJump={(m) => { setMonth(m); setMode('month') }}
        />
      </div>

      <aside className="mo-side" aria-label={mode === 'year' ? 'Year reading' : 'Month reading'}>
        <header className="mo-side-head">
          <h2>{mode === 'year' ? 'Year reading' : 'Month reading'}</h2>
          <Lamp state={pageState} />
        </header>
        {reading.counted ? (
          <ul className="mo-kinds" aria-label="Marks by kind">
            {reading.perKind.map((r) => (
              <li key={r.kind} data-kind={r.kind}>
                <DayMark kind={r.kind} done decorative />
                <span className="mo-kind-word">{SHAPES[r.kind].word}</span>
                <span className="mo-run" aria-hidden="true">
                  {Array.from({ length: Math.min(12, r.done + r.planned) }, (_, i) => <i key={i} data-done={i < r.done ? 'true' : 'false'} />)}
                  {r.done + r.planned > 12 && <b>+</b>}
                </span>
                <span className="mo-kind-n">{r.done + r.planned}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mo-hollow">{statusReply && !showsNumber(statusReply.state) ? `No counts: ${statusReply.reason}.` : 'No counts to show yet.'}</p>
        )}
        <dl className="mo-pvd">
          <div><dt>Planned</dt><dd data-hollow={reading.counted ? undefined : 'true'}>{reading.counted ? reading.planned : NO_VALUE}</dd></div>
          <div><dt>Done</dt><dd data-hollow={reading.counted ? undefined : 'true'}>{reading.counted ? reading.done : NO_VALUE}</dd></div>
        </dl>
        <section className="mo-intents" aria-label="Next intents">
          <h3>Next intents due</h3>
          {intentsReply && showsNumber(intentsReply.state) && nextIntents.length > 0 ? (
            <ol>
              {nextIntents.map((r) => (
                <li key={r.id}>
                  <button type="button" className="mo-intent" onClick={() => setDrawer(r.due)}>
                    <DayMark kind="intent" done={false} decorative />
                    <span className="mo-intent-rule">{r.rule}</span>
                    <span className="mo-intent-due">{shortDate(r.due)}</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mo-hollow">{intentsReply ? (showsNumber(intentsReply.state) ? 'No intent is due soon.' : `${intentsReply.reason}.`) : 'Reading the intents.'}</p>
          )}
        </section>
        {FACES.map((f) => (
          <section key={f.id} className="mo-face" aria-label={f.title}><h3>{f.title}</h3><f.Body month={month} days={days} state={pageState} /></section>
        ))}
        {note && <p className="mo-note" role="status">{note}</p>}
      </aside>

      <Popover open={marksOpen} onClose={() => setMarksOpen(false)} anchor={marksKey} label="Marks" className="mo-pop">
        <MarksLegend on={kindsOn} onToggle={(k, next) => setKindsOn((s) => { const n = new Set(s); if (next) n.add(k); else n.delete(k); return n })} />
      </Popover>
      <Popover open={menu !== null} onClose={() => setMenu(null)} anchor={menuAnchor} label="Add to this day" className="mo-pop mo-menu">
        <div className="mo-menu-items">
          <Button grouped onClick={() => menu && void runMenu('addIntent', menu)}>Add intent</Button>
          <Button grouped onClick={() => menu && void runMenu('logDone', menu)}>Log something done</Button>
          <Button grouped onClick={() => menu && void runMenu('movePlanned', menu)}>Move planned here</Button>
        </div>
      </Popover>
      {lastDrawer.current && <DayDrawer date={lastDrawer.current} open={drawer !== null} onClose={() => setDrawer(null)} port={port} form={phone ? 'phone' : 'desk'} onChanged={refresh} />}
    </div>
  )
}

/** What the shell loads for Day / Month: the real port, the real stores, the real clock. */
export default function Month() {
  return <MonthPage live />
}
