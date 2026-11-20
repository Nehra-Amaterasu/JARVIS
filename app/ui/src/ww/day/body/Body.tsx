// Day / Body (spec 20.6.4, package L03): the body and routine strip on one canvas. The gym session log with its seven-day strip on the left;
// on the right Water (eight drops and a gauge), Reminders you set, and Class reminders. The Ledger drawer (spending and habits) opens from the
// key in the head or with `l`.
//
// Honest by construction: the gym log is the Forge store's own sessions (LIVE once read). Water, the reminders and the class reminders have
// no store yet, so they answer WAITING or PLANNED through their adapters and draw hollow forms with the reason; a drop pressed while its
// store is not connected says so and saves nothing. No calorie, weight, amount or condition is mentioned: reminders are the student's own,
// "Reminders you set. Not medical advice."
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { Button, Chip, Drawer, IconButton, NO_VALUE } from '../../../shared/kit'
import { shortDate } from '../../../shared/almanac'
import { showsNumber, type LampState } from '../../../shared/lamp'
import { LampWord, TodayPlate } from '../today/Plate'
import { useAttendance } from '../../life/useLife'
import { useWorkoutStore } from '../../../germoney/stores/workout-store'
import { DAY_PORT, type DayPort, type ReminderRow } from '../ports'
import { LedgerDrawer } from '../ledger/LedgerDrawer'
import { LEDGER_STORES, type LedgerStores } from '../ledger/stores'
import { attempt, localGet, localSet, useForm, useRead, useToday } from '../week/hooks'
import type { RackClass } from '../week/model'
import { DEFAULT_GOAL, DROPS, clampGoal, lastWeekCount, monthRail, nextClass, recentSessions, remindAt, sessionStrip, tapDrop, type SessionLike } from './model'
import { WaterGauge } from './WaterGauge'
import '../../../styles/design/primitive.css'
import '../today/today.css'
import '../week/base.css'
import './body.css'

// the session builder is the existing Forge page: it needs room (muscles, exercises, sets), so it opens in a drawer and loads only then
const Forge = lazy(() => import('../../../germoney/pages/Forge').then((m) => ({ default: m.ForgePage })))

const GOAL_KEY = 'ww.day.water.goal'
const BEFORE = ['5', '10', '15'] as const
type Before = (typeof BEFORE)[number]

export interface BodyPageProps {
  port?: DayPort
  stores?: LedgerStores
  today?: string
  /** The wall clock for "next class" (the bench passes a fixed one). */
  now?: Date
  form?: 'desk' | 'phone'
  /** The Forge store's sessions; null while they are being read. */
  sessions?: readonly SessionLike[] | null
  /** The sessions are invented (the bench). */
  simulated?: boolean
  /** Today's classes from the timetable, for the class reminders. null while the timetable has not been read (or could not be). */
  classes?: readonly RackClass[] | null
  /** The sessions could not be read (the store threw): the Gym plate says FAULT with this reason instead of waiting for ever. */
  sessionsFault?: string | null
  initialLedger?: boolean
  initialLog?: boolean
}

const KINDS_OK = (s: LampState) => showsNumber(s)

export function BodyPage({ port = DAY_PORT, stores = LEDGER_STORES, today: fixedToday, now, form: forcedForm, sessions = null, sessionsFault = null, simulated = false, classes = [], initialLedger = false, initialLog = false }: BodyPageProps) {
  const root = useRef<HTMLDivElement>(null)
  const form = useForm(root, forcedForm)
  const today = useToday(fixedToday)
  const [ledger, setLedger] = useState(initialLedger)
  const [log, setLog] = useState(initialLog)
  const [version, setVersion] = useState(0)
  const [said, setSaid] = useState<string | null>(null)
  const [goal, setGoal] = useState(() => { const n = Number(localGet(GOAL_KEY)); return n ? clampGoal(n) : DEFAULT_GOAL })
  const [before, setBefore] = useState<Before>('10')
  const water = useRead(`wa:${today}:${version}`, () => stores.water.read(today), `wa:${today}`)
  const reminders = useRead(`re:${today}`, () => port.reminders(today))
  const intents = useRead(`in:${today}`, () => port.intents({ from: today, to: today }))

  // `l` opens the Ledger (never while typing, never with a modifier)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'l' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      if (document.querySelector('.ww-sheet[data-state="open"]')) return // another drawer is open: its keys are its own
      e.preventDefault()
      setLedger(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const gymState: LampState = sessionsFault && sessions === null ? 'fault' : sessions === null ? 'waiting' : simulated ? 'simulated' : 'live'
  const gymReason = sessionsFault && sessions === null ? sessionsFault : sessions === null ? 'reading your sessions' : simulated ? 'invented rows, not your records' : 'sessions you logged'
  const strip = useMemo(() => sessionStrip(sessions ?? [], today), [sessions, today])
  const recent = useMemo(() => recentSessions(sessions ?? []), [sessions])
  const rail = useMemo(() => monthRail(sessions ?? [], today), [sessions, today])

  const waterOk = !!water && showsNumber(water.state)
  const count = waterOk ? water!.data?.count ?? 0 : null
  const wState: LampState = water ? water.state : 'waiting'
  const wReason = water ? water.reason : 'reading'

  const tap = async (i: number) => {
    if (!waterOk || count === null) { setSaid(`${wReason}. Nothing was saved.`); return }
    const r = await attempt(() => stores.water.set(today, tapDrop(count, i)), setSaid)
    if (!r) return
    const applied = !!r.data?.applied && showsNumber(r.state)
    setSaid(applied && r.data ? r.data.message : `${r.reason}${applied ? '' : '. Nothing was saved.'}`)
    if (applied) setVersion((v) => v + 1)
  }
  const setGoalTo = useCallback((n: number) => { const g = clampGoal(n); setGoal(g); localSet(GOAL_KEY, String(g)) }, [])

  const nowMin = (now ?? new Date()).getHours() * 60 + (now ?? new Date()).getMinutes()
  const next = classes ? nextClass(classes, nowMin) : null
  const remRows: ReminderRow[] = reminders && KINDS_OK(reminders.state) ? reminders.data ?? [] : []
  const nextIntent = intents && KINDS_OK(intents.state) ? intents.data?.[0] ?? null : null
  const sessionsWeek = lastWeekCount(strip)

  const gym = (
    <TodayPlate id="gym" label="Gym" state={gymState} reason={gymReason}>
      <div className="by-gym">
        <p className="by-count">
          <span className="dy-mono by-count-n" data-hollow={KINDS_OK(gymState) ? undefined : 'true'}>{KINDS_OK(gymState) ? sessionsWeek : NO_VALUE}</span>
          <span className="by-count-word">session{sessionsWeek === 1 ? '' : 's'} in the last 7 days</span>
        </p>
        <ol className="by-week" aria-label="The last seven days, sessions logged each day">
          {strip.map((d) => (
            <li key={d.iso} className="by-day" data-today={d.iso === today ? 'true' : undefined} data-hollow={KINDS_OK(gymState) ? undefined : 'true'}
              aria-label={KINDS_OK(gymState) ? `${shortDate(d.iso)}: ${d.count === 0 ? 'no session' : `${d.count} session${d.count === 1 ? '' : 's'}`}` : `${shortDate(d.iso)}: no figure`}>
              <span className="by-day-name">{d.label}</span>
              <span className="by-day-dots" aria-hidden="true">{KINDS_OK(gymState) && d.count > 0 ? Array.from({ length: Math.min(3, d.count) }, (_, k) => <i key={k} />) : <b />}</span>
            </li>
          ))}
        </ol>
        {recent.length > 0 && KINDS_OK(gymState) ? (
          <ul className="by-log" aria-label="Recent sessions, newest first">
            {recent.map((r) => (
              <li key={r.id}><span className="dy-mono by-log-date">{shortDate(r.date)}</span><span className="by-log-what">{r.muscles}</span><span className="dy-mono by-log-sets">{r.sets > 0 ? `${r.sets} sets` : 'no sets typed'}</span></li>
            ))}
          </ul>
        ) : (
          <p className="dy-empty">{KINDS_OK(gymState) ? 'No session is logged yet. Rest days are fine; log one when you do one.' : `${gymReason}.`}</p>
        )}
        <div className="by-rail" role="img" data-hollow={KINDS_OK(gymState) ? undefined : 'true'}
          aria-label={KINDS_OK(gymState) ? `The last four weeks: ${rail.days} day${rail.days === 1 ? '' : 's'} with a session` : 'The last four weeks: no figure'}>
          <span className="by-rail-label" aria-hidden="true">Last four weeks</span>
          {rail.rows.map((row, r) => (
            <div key={r} className="by-rail-row" aria-hidden="true">
              {row.map((d) => <i key={d.iso} data-on={KINDS_OK(gymState) && d.count > 0 ? 'true' : undefined} data-today={d.iso === today ? 'true' : undefined} />)}
            </div>
          ))}
        </div>
        <p className="by-next" data-hollow={nextIntent ? undefined : 'true'}>
          <span className="by-next-label">Next session</span>
          <span>{nextIntent ? nextIntent.rule : intents ? (KINDS_OK(intents.state) ? 'nothing is set for today' : intents.reason) : 'reading the intents'}</span>
        </p>
        <div className="by-gym-keys">
          <Button tone="primary" size="lg" onClick={() => setLog(true)} data-act="log-session">Log a session</Button>
          <Button grouped onClick={() => setLedger(true)} data-open="ledger" aria-keyshortcuts="l">Ledger</Button>
        </div>
      </div>
    </TodayPlate>
  )

  const waterPlate = (
    <TodayPlate id="water" label="Water" state={wState} reason={wReason}>
      <div className="by-water">
        <div className="by-water-top">
          <WaterGauge count={count} goal={goal} state={wState} />
          <span className="by-goal" role="group" aria-label="Goal, drops a day">
            <IconButton label="Goal: one fewer drop" grouped disabled={goal <= 1} onClick={() => setGoalTo(goal - 1)}><Minus size={16} aria-hidden="true" /></IconButton>
            <span className="dy-mono by-goal-n" aria-live="polite">goal {goal}</span>
            <IconButton label="Goal: one more drop" grouped disabled={goal >= DROPS} onClick={() => setGoalTo(goal + 1)}><Plus size={16} aria-hidden="true" /></IconButton>
          </span>
        </div>
        <div className="by-drops" role="group" aria-label="Water drops, tap to fill">
          {Array.from({ length: DROPS }, (_, i) => {
            const on = count !== null && i < count
            return (
              <button key={i} type="button" className="by-drop dy-raised" data-on={on ? 'true' : 'false'} data-beyond={i >= goal ? 'true' : undefined} data-waiting={waterOk ? undefined : 'true'}
                aria-pressed={waterOk ? on : undefined} aria-disabled={waterOk ? undefined : true} aria-label={`Drop ${i + 1}${waterOk ? (on ? ', filled' : ', empty') : ', not connected'}`} onClick={() => void tap(i)}>
                <svg viewBox="0 0 16 20" width={18} height={22} aria-hidden="true" focusable="false"><path d="M8 1.5C8 1.5 2.5 8 2.5 12.2A5.5 5.5 0 0 0 13.5 12.2C13.5 8 8 1.5 8 1.5Z" /></svg>
              </button>
            )
          })}
        </div>
      </div>
      <p className="dy-note" role="status">{said ?? (waterOk ? 'Tap a drop to fill it; tap the last filled one to remove one.' : '')}</p>
    </TodayPlate>
  )

  const remPlate = (
    <TodayPlate id="reminders" label="Reminders" state={reminders ? reminders.state : 'waiting'} reason={reminders ? reminders.reason : 'reading'}>
      <p className="dy-note">Reminders you set. Not medical advice.</p>
      {remRows.length > 0 ? (
        <ul className="td-rems">{remRows.slice(0, 3).map((r) => <li key={r.id}><span className="td-mono">{r.time}</span>{r.label}</li>)}</ul>
      ) : (
        <ul className="td-rems" data-hollow="true" aria-label="No reminders to show">
          <li><span className="td-mono">– –:– –</span><span className="td-dash" /></li>
          <li><span className="td-mono">– –:– –</span><span className="td-dash" /></li>
        </ul>
      )}
    </TodayPlate>
  )

  const classPlate = (
    <TodayPlate id="class-reminders" label="Class reminders" state="planned" reason="arrives with the reminder engine">
      <div className="by-class">
        <Button grouped data-act="remind-class" disabledReason="No reminder is sent until the reminder engine arrives">Remind me before a class</Button>
        <div className="by-before" role="group" aria-label="Minutes before a class">
          {BEFORE.map((b) => <Chip key={b} selected={before === b} onClick={() => setBefore(b)} grouped>{b} min</Chip>)}
        </div>
      </div>
      <p className="dy-note">
        {next ? <>Next class: <span className="dy-mono">{next.start}</span>, {next.name}. A reminder would show at <span className="dy-mono">{remindAt(next.start, Number(before))}</span>.</> : (classes === null ? 'The timetable has not been read yet, so no class is named.' : 'No class is left on today\'s timetable.')}
      </p>
    </TodayPlate>
  )

  return (
    <div ref={root} className="dy by" data-form={form} data-simulated={simulated ? 'true' : undefined}>
      <header className="dy-head">
        <div className="dy-head-text">
          <h1 className="dy-title">Body <small>{shortDate(today)}</small></h1>
          <p className="dy-sub" role="status"><LampWord state={gymState} /><span className="dy-why">gym sessions you logged; the rest is waiting on its stores</span></p>
        </div>
      </header>
      <div className="dy-main by-main">
        <div className="dy-cell by-left">{gym}</div>
        <div className="by-right">
          <div className="dy-cell by-water-cell">{waterPlate}</div>
          <div className="dy-cell">{remPlate}</div>
          <div className="dy-cell">{classPlate}</div>
        </div>
      </div>
      <Drawer open={log} onClose={() => setLog(false)} title="Gym session" className="dy-sheet by-sheet">
        <Suspense fallback={<p role="status" className="dy-note">Opening the session builder.</p>}>{log && <Forge />}</Suspense>
      </Drawer>
      <LedgerDrawer open={ledger} onClose={() => setLedger(false)} stores={stores} today={today} form={form} />
    </div>
  )
}

/** What the shell loads for Day / Body: the real port, the real stores, the real clock. */
export default function Body() {
  const sessions = useWorkoutStore((s) => s.sessions)
  const loaded = useWorkoutStore((s) => s.isLoaded)
  const [fault, setFault] = useState<string | null>(null)
  useEffect(() => {
    Promise.resolve(useWorkoutStore.getState().hydrate()).catch(() => setFault('the sessions could not be read'))
  }, [])
  const attendance = useAttendance()
  // null until the timetable answers (and when it cannot): the reminders then say it was not read instead of saying no class is left
  const classes: RackClass[] | null = useMemo(() => (attendance.data?.status === 'ok' ? attendance.data.today.map((c) => ({ id: c.id, start: c.start, end: c.end, name: c.name, room: c.room, status: c.status })) : null), [attendance.data])
  return <BodyPage sessions={loaded ? sessions : null} sessionsFault={fault} classes={classes} />
}
