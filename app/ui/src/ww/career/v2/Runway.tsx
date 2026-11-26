// Career / Runway (spec 20.8.6, package T02): every internship, job and application as dated rows ahead, soonest first. A flight board
// of the next 120 days (a tick every 7, a notch at each closing date, as tall as its stage is far), the five-stage table beneath it
// (rows 56 px, five a page) and the Up next plate. A closing date is a Readout that is LIVE only when the student confirmed it and the
// day is stamped; otherwise the notch is dashed and the cell says WAITING "unconfirmed". The logic of the classic Pipeline (next
// step, urgency order, doNextStep, campaigns) is imported, not rewritten.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { usePlan, type Application } from '../../../germoney/game/plan'
import { useGame } from '../../../germoney/game/store'
import { addDays } from '../../../germoney/game/util'
import { useStore } from '../../../lib/store'
import { Button, Drawer, Field, IconButton, PrimaryButton } from '../../../shared/kit'
import { AsciiEmptyState } from '../../../shared/art'
import { STAGE_WORD, STEPPER, inDays, nextStep, paginate, pipelineRows, type Due } from '../model'
import { useDeadlines } from '../useDeadlines'
import { doNextStep } from '../PipelineView'
import { flightNotches, flightTicks, stageCounts, stepNotch, appCellKey, HORIZON, type Notch } from './model'
import { STALE_WHY, cellReadFor, stampText, useCareerLocal, type Cell } from './store'
import { LampWord } from '../../left/LampWord'
import { Frame, Plate, Stamped, useKeys, useWidth, PHONE_BELOW } from './ui'
import { Ahead, ApplicationList, ThisApplication } from './ApplicationsV3'
import { lookV3Enabled } from '../../../shell/v3'

const PAGE = 5

export interface RunwayData {
  apps: Application[] | null
  due: Due[]
  today: string
  cells: Record<string, Cell>
}
export interface RunwayActions {
  setStatus: (id: string, s: Application['status']) => void
  confirm: (id: string, closes: string) => void
  unconfirm: (id: string) => void
  add: (d: { org: string; programme: string; closes: string; url: string }) => void
  next: () => void
  nextFor: (a: Application) => void
  confirmDue: (d: Due) => void
}
export interface RunwayProps {
  data: RunwayData
  actions: RunwayActions
  /** The campaigns panel (the classic Campaigns logic) shown in its drawer. */
  campaigns: ReactNode
  /** A fixed page width for the gallery frame. */
  width?: number
  initialDrawer?: 'add' | 'campaigns' | string | null
  simulated?: boolean
}

const dueDate = (today: string, d: Due) => addDays(today, d.days)

// ---------------------------------------------------------------------------------------------- the flight board

function FlightBoard({ notches, ticks, counts, hot, setHot, selected, onOpen, phone, loaded }: {
  notches: Notch[]; ticks: ReturnType<typeof flightTicks>; counts: number[]
  hot: string | null; setHot: (id: string | null) => void; selected: string | null; onOpen: (id: string) => void; phone: boolean; loaded: boolean
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const [at, setAt] = useState(0)
  const focus = (i: number) => { setAt(i); refs.current[i]?.focus() }
  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); focus(stepNotch(i, 1, notches.length)) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); focus(stepNotch(i, -1, notches.length)) }
    else if (e.key === 'Home') { e.preventDefault(); focus(0) }
    else if (e.key === 'End') { e.preventDefault(); focus(notches.length - 1) }
  }
  const lit = hot ?? selected
  const shown = notches.find((n) => n.id === lit) ?? notches[0]
  const max = Math.max(1, ...counts)
  const words = STEPPER.map((s) => STAGE_WORD[s])
  const caption = shown
    ? `${shown.org}: closes ${stampText(shown.closes)}, ${inDays(shown.days)} ahead, ${shown.confirmed ? 'confirmed' : 'unconfirmed (dashed)'}`
    : loaded ? 'No closing date in the next 120 days.' : 'Reading the applications.'
  if (phone) {
    return (
      <ol className="t2-board-list" aria-label="Next closing dates">
        {notches.slice(0, 5).map((n) => (
          <li key={n.id}>
            <button type="button" className="t2-board-li" data-confirmed={n.confirmed ? 'true' : 'false'} onClick={() => onOpen(n.id)}>
              <b>{inDays(n.days)}</b><span>{n.org}</span><small>{n.confirmed ? 'confirmed' : 'unconfirmed'}</small>
            </button>
          </li>
        ))}
        {notches.length === 0 && <li className="t2-quiet">{caption}</li>}
      </ol>
    )
  }
  return (
    <div className="t2-board">
      <div className="t2-axis" role="group" aria-label={`Closing dates over the next ${HORIZON} days, soonest first`}>
        <div className="t2-axis-months" aria-hidden="true">
          {ticks.filter((t) => t.month).map((t) => <span key={t.day} style={{ left: `${t.x * 100}%` }}>{t.month}</span>)}
        </div>
        <div className="t2-axis-zone">
          {notches.map((n, i) => (
            <button
              key={n.id}
              type="button"
              ref={(el) => { refs.current[i] = el }}
              className="t2-notch"
              style={{ left: `${n.x * 100}%` }}
              tabIndex={i === Math.min(at, notches.length - 1) ? 0 : -1}
              data-confirmed={n.confirmed ? 'true' : 'false'}
              data-hot={lit === n.id ? 'true' : undefined}
              aria-label={`${n.org}, closes ${stampText(n.closes)}, ${inDays(n.days)}, ${STAGE_WORD[STEPPER[n.stage]]}, ${n.confirmed ? 'confirmed' : 'unconfirmed'}`}
              onFocus={() => { setAt(i); setHot(n.id) }}
              onBlur={() => setHot(null)}
              onMouseEnter={() => setHot(n.id)}
              onMouseLeave={() => setHot(null)}
              onKeyDown={(e) => onKey(e, i)}
              onClick={() => onOpen(n.id)}
            >
              <i style={{ height: `${18 + n.stage * 14}px` }} />
            </button>
          ))}
        </div>
        <div className="t2-axis-line" aria-hidden="true">
          {ticks.map((t) => <i key={t.day} data-major={t.day % 28 === 0 ? 'true' : undefined} style={{ left: `${t.x * 100}%` }} />)}
        </div>
        <div className="t2-axis-days" aria-hidden="true">
          {ticks.filter((t) => t.day % 28 === 0).map((t) => <span key={t.day} style={{ left: `${t.x * 100}%` }}>{t.day === 0 ? 'today' : `+${t.day} d`}</span>)}
        </div>
        <p className="t2-board-read" role="status" aria-live="polite">{caption}</p>
      </div>
      <ul className="t2-towers" aria-label="Applications at each stage">
        {counts.map((c, i) => (
          <li key={words[i]} data-lit={c > 0 ? 'true' : 'false'}>
            <span className="t2-tower"><i style={{ height: c > 0 ? `${22 + (c / max) * 38}px` : '10px' }} /></span>
            <b>{loaded ? c : '--'}</b>
            <small>{words[i]}</small>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- the table

function Row({ a, cells, hot, setHot, selected, onOpen, setStatus }: {
  a: Application; cells: Record<string, Cell>; hot: string | null; setHot: (id: string | null) => void
  selected: string | null; onOpen: (id: string) => void; setStatus: (id: string, s: Application['status']) => void
}) {
  const at = STEPPER.indexOf(a.status as (typeof STEPPER)[number])
  const n = nextStep(a)
  const read = cellReadFor(cells, appCellKey(a.id), a.closes ?? '')
  const when = a.days_left === null ? 'no date' : a.days_left < 0 ? 'closed' : inDays(a.days_left)
  return (
    <li className="t2-row" data-row={a.id} data-hot={hot === a.id || selected === a.id ? 'true' : undefined} onMouseEnter={() => setHot(a.id)} onMouseLeave={() => setHot(null)}>
      <span className="t2-when" data-closed={a.days_left !== null && a.days_left < 0 ? 'true' : undefined}>{when}</span>
      <button type="button" className="t2-rowname" onClick={() => onOpen(a.id)} aria-label={`Open ${a.org}${a.programme ? `, ${a.programme}` : ''}`}>
        <b>{a.org}</b>
        <span>{a.status === 'not_eligible' ? `ruled out: ${a.reason || 'not eligible'}` : a.programme ? `${a.programme}. next: ${n.text}` : `next: ${n.text}`}</span>
      </button>
      <div className="t2-stages" role="group" aria-label={`${a.org}: stage`}>
        {STEPPER.map((s, i) => (
          <button key={s} type="button" aria-pressed={i === at} aria-label={`${a.org}: ${STAGE_WORD[s]}`} className="t2-stage" data-state={at < 0 ? 'todo' : i < at ? 'done' : i === at ? 'current' : 'todo'} onClick={() => setStatus(a.id, s)}>
            <span aria-hidden="true">{at >= 0 && i < at ? '✓' : i === at ? '●' : '○'}</span>
          </button>
        ))}
      </div>
      <Stamped label={`Closing date of ${a.org}`} read={a.closes ? read : { state: 'waiting', value: '', on: null }} fmt={(v) => stampText(v)} why={a.closes ? (read.stale ? STALE_WHY : 'unconfirmed') : 'no date yet'} className="t2-closing" />
    </li>
  )
}

// ---------------------------------------------------------------------------------------------- the view

export function RunwayView({ data, actions, campaigns, width, initialDrawer = null, simulated }: RunwayProps) {
  const [rootRef, w] = useWidth<HTMLDivElement>(width)
  const phone = w < PHONE_BELOW
  const { apps, due, today, cells } = data
  const loaded = apps !== null
  const rows = useMemo(() => pipelineRows(apps ? { applications: apps, pipeline: {}, due_soon: [], tasks: [], goals: [] } : null), [apps])
  const notches = useMemo(() => flightNotches(rows, today, cells), [rows, today, cells])
  const ticks = useMemo(() => flightTicks(today), [today])
  const counts = useMemo(() => stageCounts(rows), [rows])
  const [page, setPage] = useState(0)
  const p = paginate(rows, page, PAGE)
  const [hot, setHot] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(initialDrawer && initialDrawer !== 'add' && initialDrawer !== 'campaigns' ? initialDrawer : null)
  const [adding, setAdding] = useState(initialDrawer === 'add')
  const [camp, setCamp] = useState(initialDrawer === 'campaigns')
  const pager = p.pages > 1 ? (
    <nav className="t2-pager" aria-label="Applications, pages">
      <IconButton label="Previous applications" size="md" disabled={p.page === 0} aria-disabled={p.page === 0} onClick={() => p.page > 0 && setPage(p.page - 1)}><ChevronLeft size={18} aria-hidden="true" /></IconButton>
      <span role="status" aria-live="polite">{p.from} to {p.to} of {p.total}</span>
      <IconButton label="Next applications" size="md" disabled={p.page >= p.pages - 1} aria-disabled={p.page >= p.pages - 1} onClick={() => p.page < p.pages - 1 && setPage(p.page + 1)}><ChevronRight size={18} aria-hidden="true" /></IconButton>
    </nav>
  ) : null
  const opened = open ? rows.find((r) => r.id === open) ?? null : null
  const top = due[0]

  const openRow = useCallback((id: string) => {
    const i = rows.findIndex((r) => r.id === id)
    if (i >= 0) setPage(Math.floor(i / PAGE))
    setOpen(id)
  }, [rows])
  useKeys({ n: () => setAdding(true) })

  const approx = rows.filter((a) => a.status !== 'not_eligible' && a.closes && cellReadFor(cells, appCellKey(a.id), a.closes).state !== 'live').length
  const topKey = top ? (top.kind === 'application' ? appCellKey(top.ref) : `${top.kind}:${top.ref}`) : ''
  const topRead = top ? cellReadFor(cells, topKey, dueDate(today, top)) : null
  const state = !loaded ? 'waiting' : 'live'
  const v3 = lookV3Enabled()

  const boardPlate = (
    <Plate id="board" label="NEXT 120 DAYS" state={state} reason={loaded ? `next ${HORIZON} days` : 'applications not read yet'} className="t2-boardplate">
      <FlightBoard notches={notches} ticks={ticks} counts={counts} hot={hot} setHot={setHot} selected={open} onOpen={openRow} phone={phone} loaded={loaded} />
    </Plate>
  )
  const tablePlate = (
    <Plate id="table" label="APPLICATIONS" state={state} reason={loaded ? 'five a page, soonest first' : 'not read yet'} className="t2-tableplate" corner={pager}>
      {!loaded ? <p className="t2-quiet">WAITING: the applications store has not answered.</p> : rows.length === 0 ? (
        <div className="t2-empty"><AsciiEmptyState variant="tree" message="No applications yet." /><Button size="lg" onClick={() => setAdding(true)}>Add an application (N)</Button></div>
      ) : (
        <>
          <div className="t2-stagehead" aria-hidden="true"><div>{STEPPER.map((s) => <span key={s}>{STAGE_WORD[s]}</span>)}</div></div>
          <ul className="t2-rows" aria-label="Applications">
            {p.rows.map((a) => <Row key={a.id} a={a} cells={cells} hot={hot} setHot={setHot} selected={open} onOpen={openRow} setStatus={actions.setStatus} />)}
          </ul>
        </>
      )}
    </Plate>
  )
  const upPlate = (
    <Plate id="upnext" label="UP NEXT" state={top ? (topRead?.state === 'live' ? 'live' : 'waiting') : loaded ? 'live' : 'waiting'} reason={top ? 'soonest dated thing' : 'nothing dated ahead'} className="t2-upnext">
      {top ? (
        <>
          <p className="t2-upline"><b>{top.what}</b><span>{top.sub}</span></p>
          <Stamped label={`Date of ${top.what}`} read={topRead ?? { state: 'waiting', value: '', on: null }} fmt={(v) => stampText(v)} why={topRead?.stale ? STALE_WHY : 'unconfirmed'} />
          {topRead?.state !== 'live' && <Button size="md" onClick={() => actions.confirmDue(top)}>I checked this date today</Button>}
        </>
      ) : <p className="t2-quiet">No dated deadline ahead. Add an application with its closing date.</p>}
    </Plate>
  )
  // ---- v3: one list, one chosen application, what lies ahead (ApplicationsV3.tsx). The first row is chosen until another is, so the
  // second tray always answers "what do I do next" for the application that closes soonest.
  const chosen = rows.find((r) => r.id === open) ?? rows[0] ?? null
  const listNode = !loaded ? <p className="t2-quiet">WAITING: the applications store has not answered.</p>
    : rows.length === 0 ? <p className="t2-quiet">No applications yet. Add the first one with its closing date.</p>
    : <ApplicationList rows={rows} cells={cells} selected={chosen?.id ?? null} onPick={setOpen} />
  const aheadNode = (
    <Ahead
      top={top}
      onOpenTop={() => top && setOpen(top.ref)}
      onDoTop={actions.next}
      topDate={top ? (
        <>
          <Stamped label={`Date of ${top.what}`} read={topRead ?? { state: 'waiting', value: '', on: null }} fmt={(v) => stampText(v)} why={topRead?.stale ? STALE_WHY : 'not confirmed'} />
          {topRead?.state !== 'live' && <Button size="md" onClick={() => actions.confirmDue(top)}>I checked this date today</Button>}
        </>
      ) : null}
      board={<FlightBoard notches={notches} ticks={ticks} counts={counts} hot={hot} setHot={setHot} selected={chosen?.id ?? null} onOpen={setOpen} phone={phone} loaded={loaded} />}
      campaigns={campaigns}
    />
  )
  return (
    <Frame
      simulated={simulated} view="pipeline" ruler="APPLICATIONS" title="Applications" form={phone ? 'phone' : 'desk'} rootRef={rootRef} state={state}
      v3={{ ratio: [1.6, 1.25, 1], trays: [
        { job: 'APPLICATIONS', node: listNode, peek: { name: 'This application', lamp: top ? 'waiting' : 'live', note: top ? 'a date to confirm' : 'nothing dated' } },
        { job: 'THIS APPLICATION', node: <ThisApplication a={chosen} cells={cells} actions={actions} />, peek: { name: 'This application' } },
        { job: 'AHEAD', node: aheadNode, peek: { name: 'Ahead', lamp: state, note: loaded ? undefined : 'not read yet' } },
      ] }}
      sub={v3
        ? <>Your applications, soonest closing date first. Choose one to see what to do next.{loaded && approx ? ` ${approx} closing date${approx === 1 ? ' is' : 's are'} not confirmed.` : ''}</>
        : loaded ? <>{rows.length} application{rows.length === 1 ? '' : 's'}{approx ? `. ${approx} closing date${approx === 1 ? ' is' : 's are'} unconfirmed (dashed)` : ''}</> : 'Reading the applications store. Nothing is shown until it answers.'}
      keys={v3
        ? <PrimaryButton claimId="career-add" rank="workspace" size="lg" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" /> Add application (N)</PrimaryButton>
        : (
          <>
            <Button size="lg" onClick={() => setCamp(true)}>Campaigns</Button>
            <Button size="lg" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" /> Add application</Button>
            <PrimaryButton claimId="career-next" rank="workspace" when={!!top} size="lg" onClick={actions.next} disabledReason={top ? undefined : 'No dated deadline'}>Do next step</PrimaryButton>
          </>
        )}
      extra={
        <>
          <AddDrawer open={adding} onClose={() => setAdding(false)} onAdd={actions.add} />
          {!v3 && <Drawer open={camp} onClose={() => setCamp(false)} title="Campaigns" className="t2-drawer">{campaigns}</Drawer>}
          {!v3 && <RowDrawer a={opened} onClose={() => setOpen(null)} cells={cells} actions={actions} />}
        </>
      }
    >
      <div className="t2-runway">
        {boardPlate}
        {tablePlate}
        {upPlate}
      </div>
    </Frame>
  )
}

// ---------------------------------------------------------------------------------------------- drawers

const BLANK = { org: '', programme: '', closes: '', url: '' }
function AddDrawer({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: RunwayActions['add'] }) {
  const [d, setD] = useState(BLANK)
  return (
    <Drawer open={open} onClose={onClose} title="Add an application" className="t2-drawer">
      <div className="t2-form">
        <Field label="Organisation" value={d.org} onChange={(e) => setD({ ...d, org: e.target.value })} />
        <Field label="Programme" value={d.programme} onChange={(e) => setD({ ...d, programme: e.target.value })} />
        <Field label="Closes" kind="date" value={d.closes} onChange={(e) => setD({ ...d, closes: e.target.value })} hint="Leave empty if there is no date yet. It stays unconfirmed until you confirm it from the page." />
        <Field label="Link" placeholder="https://" value={d.url} onChange={(e) => setD({ ...d, url: e.target.value })} />
        <Button tone="primary" size="lg" disabledReason={d.org.trim() ? undefined : 'Type the organisation'} onClick={() => { onAdd({ ...d, org: d.org.trim(), programme: d.programme.trim(), url: d.url.trim() }); setD(BLANK); onClose() }}>Add application</Button>
      </div>
    </Drawer>
  )
}

function RowDrawer({ a, onClose, cells, actions }: { a: Application | null; onClose: () => void; cells: Record<string, Cell>; actions: RunwayActions }) {
  const read = a ? cellReadFor(cells, appCellKey(a.id), a.closes ?? '') : { state: 'waiting' as const, value: '', on: null, stale: false }
  return (
    <Drawer open={!!a} onClose={onClose} title={a ? a.org : 'Application'} className="t2-drawer">
      {a && (
        <div className="t2-form">
          <p className="t2-quiet">{a.programme || 'No programme named'}{a.url ? <> . <a href={a.url} target="_blank" rel="noreferrer">its page</a></> : null}</p>
          <Field label="Stage" kind="select" value={a.status} onChange={(e) => actions.setStatus(a.id, e.target.value as Application['status'])}>
            {(['idea', 'preparing', 'applied', 'interview', 'offer', 'rejected', 'not_eligible'] as const).map((s) => <option key={s} value={s}>{STAGE_WORD[s]}</option>)}
          </Field>
          <Stamped label="Closing date" read={a.closes ? read : { state: 'waiting', value: '', on: null }} fmt={(v) => stampText(v)} why={a.closes ? (read.stale ? STALE_WHY : 'unconfirmed') : 'no date yet'} />
          {a.closes && (read.state === 'live'
            ? <Button size="md" onClick={() => actions.unconfirm(a.id)}>Take the stamp off</Button>
            : <Button size="md" onClick={() => actions.confirm(a.id, a.closes!)}>I checked this date on the page today</Button>)}
          <p className="t2-quiet">Next step: {nextStep(a).text}</p>
          <Button size="md" onClick={() => actions.nextFor(a)}>Do this step</Button>
        </div>
      )}
    </Drawer>
  )
}

// ---------------------------------------------------------------------------------------------- the page

export default function Runway() {
  const view = usePlan((s) => s.applications)
  const loadApps = usePlan((s) => s.loadApplications)
  const loadRoad = usePlan((s) => s.loadRoad)
  const campaignsData = usePlan((s) => s.campaigns)
  const setStatus = usePlan((s) => s.setAppStatus)
  const upsert = usePlan((s) => s.upsertApp)
  const setTask = usePlan((s) => s.setTask)
  const today = useGame((s) => s.today)
  const due = useDeadlines()
  const cells = useCareerLocal((s) => s.cells)
  const confirmCell = useCareerLocal((s) => s.confirmCell)
  const clearCell = useCareerLocal((s) => s.clearCell)
  useEffect(() => { void loadRoad(); void loadApps() }, [loadRoad, loadApps])
  const toast = useStore.getState().toast
  const apps = view?.applications ?? null
  const actions: RunwayActions = useMemo(() => ({
    setStatus: (id, s) => void setStatus(id, s),
    confirm: (id, closes) => confirmCell(appCellKey(id), closes, useGame.getState().today),
    unconfirm: (id) => clearCell(appCellKey(id)),
    add: (d) => { void upsert({ id: `${d.org}-${d.programme}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60), org: d.org, programme: d.programme, closes: d.closes || null, url: d.url, status: 'idea' }) },
    next: () => { if (due[0]) void doNextStep(due[0], apps ?? [], { setTask: (t) => setTask(t), setStatus }, (u) => void window.open(u, '_blank', 'noopener')).then((m) => toast(m, 'live')) },
    nextFor: (a) => {
      const d: Due = { id: `app-${a.id}`, kind: 'application', what: a.org, sub: '', days: a.days_left ?? 0, confidence: a.verified ? 'set' : 'approximate', ref: a.id }
      void doNextStep(d, apps ?? [], { setTask: (t) => setTask(t), setStatus }, (u) => void window.open(u, '_blank', 'noopener')).then((m) => toast(m, 'live'))
    },
    confirmDue: (d) => confirmCell(d.kind === 'application' ? appCellKey(d.ref) : `${d.kind}:${d.ref}`, dueDate(useGame.getState().today, d), useGame.getState().today),
  }), [apps, due, setStatus, upsert, setTask, confirmCell, clearCell, toast])
  return <RunwayView data={{ apps, due, today, cells }} actions={actions} campaigns={<CampaignsPanel data={campaignsData} />} />
}

type CampaignsData = ReturnType<typeof usePlan.getState>['campaigns']
/** The classic Campaigns list: start, ship it, drop, with the same words and the same cap. */
export function CampaignsPanel({ data }: { data: CampaignsData }) {
  const act = usePlan((s) => s.campaign)
  const toast = useStore((s) => s.toast)
  const list = (data?.campaigns ?? []).filter((c) => c.status !== 'dropped')
  const order = { active: 0, suggested: 1, shipped: 2, dropped: 3 } as const
  list.sort((a, b) => order[a.status] - order[b.status])
  const run = async (id: string, op: 'start' | 'ship' | 'drop') => { const r = await act(id, op, ''); toast(r.say, r.ok ? 'live' : 'info') }
  if (!data) return <p className="t2-quiet">WAITING: the campaigns have not been read.</p>
  return (
    <div className="t2-form">
      <p className="t2-quiet">{data.active} of {data.cap} running. A campaign pulls its skill-tree nodes to the front until it ships.</p>
      {list.length === 0 && <p className="t2-quiet">No campaign yet.</p>}
      {list.map((c) => {
        const hasFinish = c.finish_line.trim().length > 0
        return (
          <div key={c.id} className="t2-camp" data-status={c.status}>
            <b>{c.title}</b>
            <span>{c.status === 'shipped' ? `shipped ${c.shipped ?? ''}` : `${c.left} node${c.left === 1 ? '' : 's'} left`}{hasFinish ? `. Finish line: ${c.finish_line}` : ''}</span>
            {c.status !== 'shipped' && <span className="t2-quiet"><LampWord state="waiting" /> The list says: about {c.hours_left} h, about {c.weeks} wk. Unconfirmed.</span>}
            <span className="t2-camp-keys">
              {hasFinish && c.status === 'suggested' && <Button size="md" disabledReason={data.active >= data.cap ? `${data.cap} already running` : undefined} onClick={() => void run(c.id, 'start')}>Start</Button>}
              {c.status === 'active' && <><Button size="md" disabledReason={c.ready_to_ship ? undefined : 'nodes left'} onClick={() => void run(c.id, 'ship')}>Ship it</Button><Button size="md" onClick={() => void run(c.id, 'drop')}>Drop</Button></>}
            </span>
          </div>
        )
      })}
    </div>
  )
}
