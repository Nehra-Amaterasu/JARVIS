// The Ledger drawer (spec 20.6.5, package L03): the spending log, the habits to reduce, a small if-then swap and a static Help list. A right
// drawer of 560 px on the desk and a bottom sheet on the phone, opened from Day / Body (key `l`). "A log you keep for yourself."
//
// What it never does: no run of days, no zeroing, no tally of good days; a count can fall; a heavy or unlogged day is a neutral cell; it claims nothing about
// any condition and never shows a line that appears only when a count is high. The Help list is the same for every student and every count and
// is the student's own text (nothing is pre-filled here). The stores are the null object until their routes exist: every figure then draws
// as a hollow form with the reason, and the forms say nothing was saved.
import { useCallback, useMemo, useState } from 'react'
import { Button, Chip, Drawer, Field, NO_VALUE } from '../../../shared/kit'
import { addDays, monthLabel, monthOf, shortDate } from '../../../shared/almanac'
import { showsNumber, type LampState } from '../../../shared/lamp'
import { LampWord } from '../today/Plate'
import { attempt, localGet, localSet, useRead } from '../week/hooks'
import type { PortReply } from '../ports'
import { HabitRibbon } from './HabitRibbon'
import { BANDS, countOn, monthTotal, parseAmount, ribbon, rolling7, shares, spendColumns } from './model'
import { LEDGER_STORES, type Habit, type HabitEvent, type LedgerStores, type SpendRow } from './stores'
import './ledger.css'

export interface LedgerDrawerProps {
  open: boolean
  onClose: () => void
  stores?: LedgerStores
  today: string
  form?: 'desk' | 'phone'
}

const HELP_KEY = 'ww.day.help'
const SWAP_KEY = 'ww.day.swap'

const parseList = (raw: string | null): string[] => {
  try {
    const v = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 8) : []
  } catch { return [] }
}

const readState = <T,>(r: PortReply<T> | null): { state: LampState; reason: string } => (r ? { state: r.state, reason: r.reason } : { state: 'waiting', reason: 'reading' })

/** The worse of two reads, for a section drawn from both: FAULT over WAITING over PLANNED over what can be shown. */
const WORSE: LampState[] = ['fault', 'waiting', 'planned']
const worse = (a: { state: LampState; reason: string }, b: { state: LampState; reason: string }) => {
  for (const s of WORSE) { if (a.state === s) return a; if (b.state === s) return b }
  return a
}

function Section({ title, state, reason, children }: { title: string; state: LampState; reason: string; children: React.ReactNode }) {
  return (
    <section className="lg-sec" data-lamp={state} aria-label={`${title}, ${state === 'live' ? reason : `${state}: ${reason}`}`}>
      <header className="lg-sec-head">
        <h3>{title}</h3>
        <LampWord state={state} />
        <span className="lg-why">{reason}</span>
      </header>
      {children}
    </section>
  )
}

function SpendBlock({ stores, today, version, bump }: { stores: LedgerStores; today: string; version: number; bump: () => void }) {
  const month = monthOf(today)
  const rowsR = useRead(`sp:${month}:${version}`, () => stores.spend.month(month), `sp:${month}`)
  const catsR = useRead(`sc:${version}`, () => stores.spend.categories(), 'sc')
  const st = readState(rowsR)
  const ready = !!rowsR && showsNumber(rowsR.state)
  const rows: SpendRow[] = rowsR?.data ?? []
  const cats = (catsR?.data ?? []).slice(0, 8)
  const [amount, setAmount] = useState('')
  const [cat, setCat] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [said, setSaid] = useState<string | null>(null)
  const cols = useMemo(() => spendColumns(rows, month), [rows, month])
  const sh = useMemo(() => shares(rows).slice(0, 5), [rows])
  const parsed = parseAmount(amount)
  const bad = amount.trim() !== '' && parsed === null

  const add = async () => {
    if (parsed === null) { setSaid('Type the amount as a number, for example 40 or 12.50.'); return }
    const r = await attempt(() => stores.spend.add({ date: today, amount: parsed, category: cat ?? cats[0] ?? 'other', note: note.trim() }), setSaid)
    if (!r) return
    const applied = !!r.data?.applied && showsNumber(r.state)
    setSaid(applied && r.data ? r.data.message : `${r.reason}${applied ? '' : '. Nothing was saved.'}`)
    if (applied) { setAmount(''); setNote(''); bump() }
  }

  return (
    <Section title="Spending log" state={st.state} reason={ready ? 'your own entries' : st.reason}>
      <p className="lg-total">
        <span className="dy-mono lg-total-n" data-hollow={ready ? undefined : 'true'}>{ready ? monthTotal(rows) : NO_VALUE}</span>
        <span className="lg-total-word">logged in {monthLabel(month)}</span>
      </p>
      <svg className="lg-strip" viewBox={`0 0 ${cols.length * 12} 44`} role="img" aria-label={ready ? `Spending this month, one dot per entry, ${rows.length} entries` : 'Spending this month: no figure'} focusable="false">
        {cols.map((c, i) => (
          <g key={c.date}>
            <rect className="lg-strip-slot" x={i * 12 + 1} y={0} width={9} height={44} rx={3} />
            {ready && c.dots.slice(0, 4).map((b, k) => <circle key={k} className="lg-strip-dot" cx={i * 12 + 5.5 + (k % 2 ? 2 : k ? -2 : 0)} cy={37 - b * 14 - (k > 1 ? 3 : 0)} r={2.4} />)}
          </g>
        ))}
      </svg>
      <p className="lg-legend">Dot height by amount, three bands: {BANDS.join(', ')}. Your own entries only; nothing is read from a bank.</p>
      {ready && sh.length > 0 && (
        <ul className="lg-shares" aria-label="Category shares of the month">
          {sh.map((s) => (
            <li key={s.category}><span className="lg-share-name">{s.category}</span><span className="lg-share-bar" aria-hidden="true"><i style={{ width: `${Math.round(s.frac * 100)}%` }} /></span><span className="dy-mono lg-share-n">{s.total}</span></li>
          ))}
        </ul>
      )}
      <div className="lg-form" role="group" aria-label="Add a spending entry">
        <Field label="Amount" kind="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={bad ? 'Error: type the amount as a number' : undefined} onKeyDown={(e) => { if (e.key === 'Enter') void add() }} />
        <Field label="Note (optional)" value={note} maxLength={60} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void add() }} />
        {cats.length > 0 && (
          <div className="lg-chips" role="group" aria-label="Category">
            {cats.map((c) => <Chip key={c} selected={(cat ?? cats[0]) === c} onClick={() => setCat(c)} grouped>{c}</Chip>)}
          </div>
        )}
        <Button tone="primary" size="lg" onClick={() => void add()} disabledReason={ready ? undefined : st.reason} data-act="add-spend">Add entry</Button>
      </div>
      <p className="lg-said" role="status">{said ?? ''}</p>
    </Section>
  )
}

function HabitBlock({ stores, today, version, bump }: { stores: LedgerStores; today: string; version: number; bump: () => void }) {
  const habitsR = useRead(`hb:${version}`, () => stores.habits.list(), 'hb')
  const eventsR = useRead(`he:${today}:${version}`, () => stores.habits.events(addDays(today, -27), today), `he:${today}`)
  const st = readState(habitsR)
  const listOk = !!habitsR && showsNumber(habitsR.state)
  // a count and a line are drawn only from an events read that answered: otherwise they are hollow and the section carries the worse state
  const ready = listOk && !!eventsR && showsNumber(eventsR.state)
  const sec = worse(st, readState(eventsR))
  const habits: Habit[] = (habitsR?.data ?? []).slice(0, 5)
  const events: HabitEvent[] = eventsR?.data ?? []
  const [chip, setChip] = useState('')
  const [said, setSaid] = useState<string | null>(null)

  const run = useCallback(async (go: () => Promise<PortReply<{ applied: boolean; message: string }>>) => {
    const r = await attempt(go, setSaid)
    if (!r) return
    const applied = !!r.data?.applied && showsNumber(r.state)
    setSaid(applied && r.data ? r.data.message : `${r.reason}${applied ? '' : '. Nothing was changed.'}`)
    if (applied) bump()
  }, [bump])

  return (
    <Section title="Habits to reduce" state={ready ? (eventsR?.state ?? st.state) : sec.state} reason={ready ? 'your own log' : sec.reason}>
      {habits.length === 0 ? (
        <p className="dy-empty">{ready ? 'No habit is named yet. You name it; the count is yours.' : `${st.reason}. A counter appears here when you name a habit.`}</p>
      ) : (
        <>
          <Field label="What led up to it (optional, used when you log)" value={chip} maxLength={40} onChange={(e) => setChip(e.target.value)} />
          <ul className="lg-habits">
            {habits.map((h) => {
              const n = ready ? countOn(events, h.id, today) : null
              const line = rolling7(ready ? events : [], h.id, today)
              const max = Math.max(1, ...line.map((d) => d.n))
              return (
                <li key={h.id} className="lg-habit">
                  <div className="lg-habit-row">
                    <span className="lg-habit-name">{h.name}</span>
                    <span className="dy-mono lg-habit-n" data-hollow={ready ? undefined : 'true'} aria-label={ready ? `${n} today` : 'no count today, not read'}>{ready ? n : NO_VALUE}</span>
                    {ready ? (
                      <svg className="lg-spark" viewBox="0 0 70 24" role="img" aria-label={`Last seven days: ${line.map((d) => d.n).join(', ')}, your own log`} focusable="false">
                        <polyline points={line.map((d, i) => `${i * 11 + 2},${22 - (d.n / max) * 18}`).join(' ')} />
                      </svg>
                    ) : (
                      <svg className="lg-spark" data-hollow="true" viewBox="0 0 70 24" role="img" aria-label="Last seven days: no line, the log is not read" focusable="false">
                        <line x1="2" y1="12" x2="68" y2="12" />
                      </svg>
                    )}
                    <Button grouped onClick={() => void run(() => stores.habits.log(h.id, today, chip.trim() || null))} disabledReason={ready ? undefined : sec.reason} data-act="log-habit">Log one</Button>
                    <Button grouped onClick={() => void run(() => stores.habits.undo(h.id, today))} disabled={!ready || n === 0} data-act="undo-habit">Undo last</Button>
                  </div>
                  <HabitRibbon cells={ribbon(events, h.id, today)} state={ready ? 'live' : 'waiting'} name={h.name} />
                  <LimitRow key={`${h.id}:${h.limit}`} habit={h} onSet={(l) => void run(() => stores.habits.setLimit(h.id, l))} />
                </li>
              )
            })}
          </ul>
        </>
      )}
      <p className="lg-said" role="status">{said ?? ''}</p>
    </Section>
  )
}

/** The limit the student set, editable in place; empty means none. It is a number the student chose, not a target the product sets. Enter or leaving the field keeps it. */
function LimitRow({ habit, onSet }: { habit: Habit; onSet: (l: number | null) => void }) {
  const [v, setV] = useState(habit.limit === null ? '' : String(habit.limit))
  const [bad, setBad] = useState(false)
  const keep = () => {
    const t = v.trim()
    const n = t === '' ? null : /^\d+$/.test(t) ? Number(t) : NaN
    if (n !== null && !Number.isInteger(n)) { setBad(true); return }
    setBad(false)
    if (n !== habit.limit) onSet(n)
  }
  return (
    <div className="lg-limit">
      <Field label="Your limit a day (optional)" inputMode="numeric" value={v} onChange={(e) => { setV(e.target.value); setBad(false) }}
        error={bad ? 'Error: type a whole number, or leave it empty' : undefined}
        onBlur={keep} onKeyDown={(e) => { if (e.key === 'Enter') keep() }} />
    </div>
  )
}

/** One small swap for the next cue: an editable if-then row the student can decline. Kept on this device only. */
function Swap() {
  const [cue, setCue] = useState(() => parseList(localGet(SWAP_KEY))[0] ?? '')
  const [swap, setSwap] = useState(() => parseList(localGet(SWAP_KEY))[1] ?? '')
  const save = (c: string, s: string) => localSet(SWAP_KEY, JSON.stringify([c, s]))
  return (
    <section className="lg-sec" aria-label="One small swap">
      <header className="lg-sec-head"><h3>Pick one small swap for the next cue</h3></header>
      <div className="lg-swap">
        <Field label="When" value={cue} maxLength={60} onChange={(e) => { setCue(e.target.value); save(e.target.value, swap) }} />
        <Field label="I will" value={swap} maxLength={60} onChange={(e) => { setSwap(e.target.value); save(cue, e.target.value) }} />
        <Button grouped onClick={() => { setCue(''); setSwap(''); save('', '') }} data-act="decline-swap">Not now</Button>
      </div>
    </section>
  )
}

/** A local list of numbers the student wants one key away. The same for every student and every count; nothing here is pre-filled. */
function Help() {
  const [list, setList] = useState(() => parseList(localGet(HELP_KEY)))
  const [v, setV] = useState('')
  const put = (next: string[]) => { setList(next); localSet(HELP_KEY, JSON.stringify(next)) }
  return (
    <section className="lg-sec lg-help" aria-label="Help">
      <header className="lg-sec-head"><h3>Help</h3><span className="lg-why">Your own list of numbers, kept on this device.</span></header>
      {list.length === 0 ? <p className="dy-empty">Nothing is listed. Add the numbers you want one key away.</p> : (
        <ul className="lg-help-list">
          {list.map((x, i) => (
            <li key={`${i}-${x}`}><span className="dy-mono">{x}</span><Button grouped onClick={() => put(list.filter((_, k) => k !== i))} aria-label={`Remove ${x}`}>Remove</Button></li>
          ))}
        </ul>
      )}
      <div className="lg-help-add">
        <Field label="Add to the list" value={v} maxLength={80} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && v.trim()) { put([...list, v.trim()].slice(0, 8)); setV('') } }} />
        <Button grouped onClick={() => { if (v.trim()) { put([...list, v.trim()].slice(0, 8)); setV('') } }}>Add</Button>
      </div>
    </section>
  )
}

export function LedgerDrawer({ open, onClose, stores = LEDGER_STORES, today, form = 'desk' }: LedgerDrawerProps) {
  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])
  return (
    <Drawer open={open} onClose={onClose} title="Ledger" place={form === 'phone' ? 'bottom' : 'right'} className="dy-sheet lg-sheet">
      <div className="lg" data-form={form}>
        <p className="lg-lead">A log you keep for yourself. {shortDate(today)}.</p>
        <SpendBlock stores={stores} today={today} version={version} bump={bump} />
        <HabitBlock stores={stores} today={today} version={version} bump={bump} />
        <Swap />
        <Help />
      </div>
    </Drawer>
  )
}
