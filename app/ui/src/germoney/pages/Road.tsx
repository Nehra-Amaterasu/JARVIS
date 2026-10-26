/**
 * Mission → Road: the long view. Campaigns (multi-week arcs to a career
 * milestone, each with a finish line and a ship step; three at most at once),
 * certificates against the monthly budget, the parking lot of ideas, the Germany
 * paperwork (Trials), the War Chest, the reward shop, and the Season One record.
 *
 * Absorbs: Campaign, Trials, Armory (shop, War Chest), Syllabus's Germany pages.
 *
 * Layout: the next dated deadline first (internships, prep tasks, Germany exams),
 * then six tabs. Only the open tab is mounted: the page used to render all thirteen
 * sections (30 certificate rows, 6 suggested campaigns, the trials grid, the radar)
 * in one scroll of several screens; now one screen holds one job.
 */
import { Award, CalendarClock, ChevronDown, Flag, GraduationCap, Map as MapIcon, ParkingCircle, Plus, Rocket, Trash2, Trophy, Wallet, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useStore, type Tab } from '../../lib/store'
import { BOSSES } from '../game/campaign'
import * as E from '../game/engine'
import { Marks, Radar } from '../game/kit'
import { MissionBoundary } from '../Boundary'
import { usePlan, type Application, type Campaign } from '../game/plan'
import { useGame } from '../game/store'
import { TRIALS } from '../game/trials'
import { daysBetween, prettyDate } from '../game/util'
import { TARGET_UNIVERSITIES } from '../data/universities'
import { EMPTY, MissionHeader, NeonBar } from '../ui'
import { Achievements, Shop, WarChest } from './Armory'
import { TrialsPage } from './Trials'
import './status-career.css'

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

type RoadTab = 'career' | 'certs' | 'germany' | 'money' | 'plan' | 'record'
const ROAD_TABS: { id: RoadTab; label: string; icon: typeof Rocket }[] = [
  { id: 'career', label: 'Career', icon: Rocket },
  { id: 'certs', label: 'Certificates', icon: Award },
  { id: 'germany', label: 'Germany · MS', icon: GraduationCap },
  { id: 'money', label: 'Money', icon: Wallet },
  { id: 'plan', label: 'Plan', icon: Flag },
  { id: 'record', label: 'Record', icon: Trophy },
]
const TAB_KEY = 'ww.road.tab'

/** Old tab ids land on the part of Road that absorbed them; otherwise the last tab he had open. */
function firstTab(appTab: Tab): RoadTab {
  if (appTab === 'trials') return 'germany'
  if (appTab === 'armory') return 'money'
  try {
    const saved = localStorage.getItem(TAB_KEY)
    if (ROAD_TABS.some((t) => t.id === saved)) return saved as RoadTab
  } catch { /* private window: start on Career */ }
  return 'career'
}

interface Due { id: string; what: string; sub: string; days: number; tab: RoadTab; url?: string }

/** Every dated thing ahead, soonest first: open applications, prep tasks, Germany exam dates. */
function useDeadlines(): Due[] {
  const apps = usePlan((s) => s.applications)
  const trials = useGame((s) => s.g.trials)
  const today = useGame((s) => s.today)
  return useMemo(() => {
    const out: Due[] = []
    for (const a of apps?.applications ?? EMPTY) {
      // Once applied, the closing date no longer asks anything of him.
      if (a.days_left === null || a.days_left < 0 || (a.status !== 'idea' && a.status !== 'preparing')) continue
      out.push({ id: `app-${a.id}`, what: a.org, sub: `${a.programme || 'application'} closes`, days: a.days_left, tab: 'career', url: a.url || undefined })
    }
    for (const t of apps?.tasks ?? EMPTY) {
      if (t.done || t.days_left === null || t.days_left < 0) continue
      out.push({ id: `task-${t.id}`, what: t.title, sub: 'prep task due', days: t.days_left, tab: 'career' })
    }
    for (const t of TRIALS) {
      const d = trials[t.id]?.examDate
      if (d && d >= today) out.push({ id: `trial-${t.id}`, what: t.name, sub: 'Germany: exam or deadline', days: daysBetween(today, d), tab: 'germany' })
    }
    return out.sort((a, b) => a.days - b.days)
  }, [apps, trials, today])
}

const inDays = (n: number) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `${n} d`)

export function RoadPage() {
  const loadRoad = usePlan((s) => s.loadRoad)
  const loadApplications = usePlan((s) => s.loadApplications)
  const g = useGame((s) => s.g)
  const appTab = useStore((s) => s.tab)
  const [tab, setTabState] = useState<RoadTab>(() => firstTab(appTab))
  // The page loads what the tabs read once, so switching tabs never refetches.
  useEffect(() => { void loadRoad(); void loadApplications() }, [loadRoad, loadApplications])
  const due = useDeadlines()
  const nextOf = useMemo(() => {
    const m: Partial<Record<RoadTab, number>> = {}
    for (const d of due) if (m[d.tab] === undefined) m[d.tab] = d.days
    return m
  }, [due])
  const setTab = (t: RoadTab) => {
    setTabState(t)
    try { localStorage.setItem(TAB_KEY, t) } catch { /* not remembered, still works */ }
  }
  return (
    <div className="mission-page road">
      <MissionHeader n="M5" title="Road" sub="Campaigns to a career milestone, certificates, Germany, the money." right={<Marks n={g.marks} size="lg" />} />
      <UpNext due={due} onOpen={setTab} />
      <div className="road-tabs" role="tablist" aria-label="Road">
        {ROAD_TABS.map((t, i) => (
          <button key={t.id} role="tab" id={`road-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="road-panel"
            className={`road-tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
            <i className="mono rt-n" aria-hidden>{String(i + 1).padStart(2, '0')}</i><t.icon size={14} aria-hidden /><span>{t.label}</span>
            {nextOf[t.id] !== undefined && <em className={`mono ${nextOf[t.id]! <= 14 ? 'soon' : ''}`}>{inDays(nextOf[t.id]!)}</em>}
          </button>))}
      </div>
      <div className="road-panel" id="road-panel" role="tabpanel" aria-labelledby={`road-tab-${tab}`}>
        {tab === 'career' && <>
          <MissionBoundary small name="Internships"><Internship /></MissionBoundary>
          <MissionBoundary small name="Campaigns"><Campaigns /></MissionBoundary>
        </>}
        {tab === 'certs' && <MissionBoundary small name="Certificates"><Certs /></MissionBoundary>}
        {tab === 'germany' && <>
          <MissionBoundary small name="Trials"><div className="embedded"><TrialsPage /></div></MissionBoundary>
          <MissionBoundary small name="Universities"><Universities /></MissionBoundary>
        </>}
        {tab === 'money' && <>
          <MissionBoundary small name="War Chest"><WarChest /></MissionBoundary>
          <MissionBoundary small name="Shop"><Shop /></MissionBoundary>
        </>}
        {tab === 'plan' && <>
          <MissionBoundary small name="Ladder"><LadderView /></MissionBoundary>
          <MissionBoundary small name="Goals"><Goals /></MissionBoundary>
          <MissionBoundary small name="Parking lot"><Parking /></MissionBoundary>
        </>}
        {tab === 'record' && <>
          <MissionBoundary small name="The record"><Record /></MissionBoundary>
          <MissionBoundary small name="Achievements"><Achievements /></MissionBoundary>
          <MissionBoundary small name="Season one"><SeasonOne /></MissionBoundary>
        </>}
      </div>
    </div>
  )
}

/** The most urgent dated thing, big; the next three beside it. Tapping one opens its tab. */
function UpNext({ due, onOpen }: { due: Due[]; onOpen: (t: RoadTab) => void }) {
  const [top, ...rest] = due
  return (
    <section className="card road-next" aria-label="Next deadlines">
      {top ? <>
        <button className={`rn-first ${top.days <= 14 ? 'soon' : ''}`} onClick={() => onOpen(top.tab)}>
          <span className="rn-days"><b>{top.days === 0 ? '0' : top.days}</b><em>{top.days === 0 ? 'today' : top.days === 1 ? 'day' : 'days'}</em></span>
          <span className="rn-what"><span className="eyebrow"><CalendarClock size={11} aria-hidden /> Next deadline</span>
            <b title={top.what}>{top.what}</b><span className="muted small" title={top.sub}>{top.sub}</span></span>
        </button>
        <DayStrip due={due} />
        {rest.length > 0 && (
          <ul className="rn-rest">{rest.slice(0, 3).map((d) => (
            <li key={d.id}><button onClick={() => onOpen(d.tab)} title={`${d.what} · ${d.sub}`}>
              <span className={`mono rn-d ${d.days <= 14 ? 'soon' : ''}`}>{inDays(d.days)}</span>
              <span className="rn-t">{d.what}</span></button></li>))}
          </ul>)}
      </> : <p className="muted small rn-none">No dated deadline ahead. Add an application with its closing date under Career, or an exam date under Germany.</p>}
    </section>
  )
}

/**
 * The next 30 days as 30 dots, today first: every dated thing lights its day, the
 * soonest one in the accent, so the gap to it reads at a glance. Week starts get a
 * taller tick. 30 spans, no layout reads.
 */
const STRIP = 30
function DayStrip({ due }: { due: Due[] }) {
  const marks = useMemo(() => {
    const m = new Map<number, number>()
    for (const d of due) if (d.days < STRIP) m.set(d.days, (m.get(d.days) ?? 0) + 1)
    return m
  }, [due])
  const first = due[0]?.days
  return (
    <span className="rn-strip" aria-label={`${marks.size} dated days in the next ${STRIP}`}>
      {Array.from({ length: STRIP }, (_, i) => (
        <i key={i} className={`${i === 0 ? 'now' : ''} ${marks.has(i) ? 'due' : ''} ${i === first ? 'first' : ''} ${i % 7 === 0 ? 'wk' : ''}`}
          title={marks.has(i) ? `${inDays(i)}: ${marks.get(i)} due` : undefined} />))}
      <em className="mono">30 d</em>
    </span>
  )
}

/** Disclosure that mounts its content only once opened (the heavy lists stay unrendered until asked for). */
function Fold({ label, count, open: start = false, children }: { label: string; count?: number; open?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(start)
  return (
    <div className={`fold ${open ? 'open' : ''}`}>
      <button className="fold-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronDown size={14} className="fold-chev" aria-hidden /><span className="eyebrow">{label}</span>
        {count !== undefined && <span className="mono muted small">{count}</span>}
      </button>
      {open && <div className="fold-body">{children}</div>}
    </div>
  )
}

function Campaigns() {
  const data = usePlan((s) => s.campaigns)
  const act = usePlan((s) => s.campaign)
  const toast = useStore((s) => s.toast)
  const [ship, setShip] = useState<Record<string, string>>({})
  const groups = useMemo(() => {
    const all = data?.campaigns ?? EMPTY
    return {
      active: all.filter((c) => c.status === 'active'),
      suggested: all.filter((c) => c.status === 'suggested').slice(0, 6),
      shipped: all.filter((c) => c.status === 'shipped'),
    }
  }, [data])
  if (!data) return <section className="card"><div className="empty">Loading campaigns…</div></section>
  const { active, suggested, shipped } = groups
  const run = async (c: Campaign, op: 'start' | 'ship' | 'drop') => {
    const r = await act(c.id, op, ship[c.id] ?? '')
    toast(r.say, r.ok ? 'live' : 'info')
  }
  const card = (c: Campaign) => {
    const done = c.path.filter((p) => p.status === 'mastered').length
    return (
      <article key={c.id} className={`card campaign ${c.status}`}>
        <div className="card-head"><span className="card-title"><Flag size={14} /><span className="ellipsis" title={c.title}>{c.title}</span></span>
          <span className="mono muted nowrap">{c.status === 'shipped' ? `shipped ${c.shipped}` : `${c.left} node${c.left === 1 ? '' : 's'} · ~${c.hours_left} h · ~${c.weeks} wk`}</span></div>
        <p className="small clamp-2" title={c.finish_line}><b>Finish line:</b> {c.finish_line}</p>
        <NeonBar progress={c.path.length ? done / c.path.length : 0} tone={c.status === 'shipped' ? 'live' : 'chrome'} />
        <div className="camp-path">{c.path.map((p) => <span key={p.id} className={`chip ${p.status}`} title={`${p.name} · ${p.status.replace('_', ' ')}`}>{p.name}</span>)}</div>
        {c.ship_steps.length > 0 && (c.status === 'active'
          ? <ol className="small c-steps">{c.ship_steps.map((s) => <li key={s}>{s}</li>)}</ol>
          : <details className="c-steps-fold small"><summary className="muted">Ship steps ({c.ship_steps.length})</summary>
              <ol className="c-steps">{c.ship_steps.map((s) => <li key={s}>{s}</li>)}</ol></details>)}
        {c.status === 'shipped' && c.url && <a href={c.url} target="_blank" rel="noreferrer" className="small ellipsis" title={c.url}>{c.url}</a>}
        {c.status === 'active' && (
          <div className="field-row">
            <input className="field" placeholder="GitHub link when it ships" value={ship[c.id] ?? ''} onChange={(e) => setShip({ ...ship, [c.id]: e.target.value })} />
            <button className="btn sm primary" disabled={!c.ready_to_ship && !(ship[c.id] ?? '').trim()} onClick={() => void run(c, 'ship')}><Rocket size={13} />Ship it</button>
            <button className="btn sm ghost" onClick={() => void run(c, 'drop')}><X size={13} />Drop</button>
          </div>)}
        {c.status === 'suggested' && <button className="btn sm" disabled={active.length >= data.cap} onClick={() => void run(c, 'start')}>Start this campaign</button>}
      </article>
    )
  }
  return (
    <>
      <div className="sec-title"><MapIcon size={15} /><span>Campaigns</span><em className="mono">{active.length} of {data.cap} running · finish one before starting another</em></div>
      {active.length === 0 && <p className="muted small">No campaign yet. Pick one below: it pulls its nodes to the front of your contracts until it ships.</p>}
      {active.length > 0 && <div className="camp-grid">{active.map(card)}</div>}
      {suggested.length > 0 && <Fold label="Suggested for your career (highest weight first)" count={suggested.length} open={active.length === 0}>
        <div className="camp-grid">{suggested.map(card)}</div></Fold>}
      {shipped.length > 0 && <Fold label="Shipped" count={shipped.length}><div className="camp-grid">{shipped.map(card)}</div></Fold>}
    </>
  )
}

/** The goal ladder: the fixed vision → this year's milestones → quarter, month and week (re-derived), and the monthly review. */
function LadderView() {
  const l = usePlan((s) => s.ladder)
  const load = usePlan((s) => s.loadLadder)
  const review = usePlan((s) => s.review)
  const toast = useStore((s) => s.toast)
  const [r, setR] = useState({ went_well: '', slipped: '', next: '' })
  useEffect(() => { void load() }, [load])
  if (!l) return null
  const yr = l.years.find((y) => y.year === l.year)
  const rung = (label: string, goals: { title: string }[]) => (
    <div className="rung"><span className="eyebrow">{label}</span>
      {goals.length ? <ul className="np-list">{goals.slice(0, 6).map((x, i) => <li key={i} className="clamp-2" title={x.title}>{x.title}</li>)}</ul> : <span className="muted small">Nothing derived yet.</span>}</div>)
  return (
    <>
      <div className="sec-title"><Flag size={15} /><span>The ladder</span><em className="mono ellipsis" title={`${l.vision.horizon}: ${l.vision.title} (${l.vision.band})`}>{l.vision.horizon}: {l.vision.title} ({l.vision.band})</em></div>
      <section className="card ladder">
        <div className="rungs">
          {rung(`${l.year} milestones`, yr?.milestones ?? [])}
          {rung(`${l.quarter.label} (to ${l.quarter.ends})`, l.quarter.goals)}
          {rung(l.month.label, l.month.goals)}
          {rung(`This week (to ${l.week.ends})`, l.week.goals)}
        </div>
        <p className="muted small">The vision stays fixed. The quarter, month and week are re-derived from progress every time you look; each contract on Today says which of these it serves.</p>
        <details open={l.review_due}><summary className="small">{l.review_due ? 'Monthly review due' : 'Monthly review'}</summary>
          <div className="field-row">
            <input className="field" placeholder="What went well" value={r.went_well} onChange={(e) => setR({ ...r, went_well: e.target.value })} />
            <input className="field" placeholder="What slipped (said plainly)" value={r.slipped} onChange={(e) => setR({ ...r, slipped: e.target.value })} />
            <input className="field" placeholder="One change for next month" value={r.next} onChange={(e) => setR({ ...r, next: e.target.value })} />
            <button className="btn sm" onClick={() => void review(r).then(() => { toast('Review saved.', 'live'); setR({ went_well: '', slipped: '', next: '' }) })}>Save</button>
          </div>
          {l.reviews.slice().reverse().slice(0, 3).map((x) => <p key={x.month} className="small muted">{x.month}: {x.went_well}{x.slipped ? ` · slipped: ${x.slipped}` : ''}{x.next ? ` · next: ${x.next}` : ''}</p>)}
        </details>
      </section>
    </>
  )
}

const STAGES = ['idea', 'preparing', 'applied', 'interview', 'offer', 'rejected', 'not_eligible'] as const

/** Soonest open deadline first; undated next; closed ones last. */
function byUrgency(a: Application, b: Application): number {
  const rank = (x: Application) => (x.days_left === null ? 1e6 : x.days_left < 0 ? 2e6 - x.days_left : x.days_left)
  return rank(a) - rank(b)
}

/** The summer-2027 internship campaign: a pipeline of dated applications (stored privately by the server). */
function Internship() {
  const v = usePlan((s) => s.applications)
  const setStatus = usePlan((s) => s.setAppStatus)
  const setTask = usePlan((s) => s.setTask)
  const upsert = usePlan((s) => s.upsertApp)
  const [draft, setDraft] = useState({ org: '', programme: '', closes: '', url: '' })
  const lists = useMemo(() => {
    const all = v?.applications ?? EMPTY
    return {
      live: all.filter((a) => a.status !== 'not_eligible').sort(byUrgency),
      out: all.filter((a) => a.status === 'not_eligible'),
      tasks: (v?.tasks ?? EMPTY).slice().sort((a, b) => Number(!!a.done) - Number(!!b.done) || (a.days_left ?? 1e6) - (b.days_left ?? 1e6)),
    }
  }, [v])
  if (!v) return <section className="card"><div className="empty">Loading applications…</div></section>
  const goal = v.goals.find((x) => x.id === 'internship-2027')
  const { live, out, tasks } = lists
  return (
    <>
      <div className="sec-title"><Rocket size={15} /><span>{goal?.title ?? 'Summer 2027 internship'}</span><em className="mono ellipsis" title={goal?.target}>{goal?.target}</em></div>
      <section className="card internship">
        <div className="pipeline-strip" aria-label="Pipeline">{STAGES.filter((s) => s !== 'not_eligible').map((s) => (
          <span key={s} className={`ps-stage ${(v.pipeline[s]?.length ?? 0) > 0 ? 'has' : ''}`}><b className="mono">{v.pipeline[s]?.length ?? 0}</b>{s}</span>))}</div>
        {live.length === 0 && <p className="muted small">No applications yet. Add the first one below with its closing date.</p>}
        {live.map((a) => {
          const soon = a.days_left !== null && a.days_left <= 14 && a.days_left >= 0
          const meta = [a.requirements.length > 0 ? `Needs: ${a.requirements.join('; ')}` : '', a.notes].filter(Boolean).join(' · ')
          return (
            <div key={a.id} className="app-row">
              <span className={`mono app-when ${soon ? 'fault' : ''}`}>
                {a.days_left === null ? 'no date' : a.days_left < 0 ? 'closed' : inDays(a.days_left)}{a.opens_in && a.opens_in > 0 ? <em> · opens in {a.opens_in} d</em> : null}</span>
              <span className="app-main">
                <span className="app-title" title={`${a.org} · ${a.programme}`}><b>{a.url ? <a href={a.url} target="_blank" rel="noreferrer">{a.org}</a> : a.org}</b> · {a.programme}
                  {!a.verified && <span className="muted"> · verify the date</span>}{a.stipend && <span className="muted"> · {a.stipend}</span>}</span>
                {meta && <span className="muted small clamp-2" title={meta}>{meta}</span>}
              </span>
              <select className="field sm" value={a.status} aria-label={`Status of ${a.org}`} onChange={(e) => void setStatus(a.id, e.target.value as typeof a.status)}>
                {STAGES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>
            </div>)
        })}
        {tasks.length > 0 && <Fold label="Prep checklist" count={tasks.filter((t) => !t.done).length} open={tasks.some((t) => !t.done && t.days_left !== null && t.days_left <= 7)}>
          {tasks.map((t) => (
            <label key={t.id} className="check small task-row"><input type="checkbox" checked={!!t.done} onChange={(e) => void setTask({ id: t.id, done: e.target.checked })} />
              <span className="ellipsis" title={t.title}>{t.title}</span>{t.due && <span className="mono muted nowrap">due {t.due}</span>}</label>))}
        </Fold>}
        <Fold label="Add an application">
          <div className="field-row">
            <input className="field" placeholder="Organisation" value={draft.org} onChange={(e) => setDraft({ ...draft, org: e.target.value })} />
            <input className="field" placeholder="Programme" value={draft.programme} onChange={(e) => setDraft({ ...draft, programme: e.target.value })} />
            <input className="field sm" type="date" value={draft.closes} onChange={(e) => setDraft({ ...draft, closes: e.target.value })} aria-label="Closes" />
            <input className="field" placeholder="https://…" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
            <button className="btn sm" disabled={!draft.org.trim()} onClick={() => {
              void upsert({ id: `${draft.org}-${draft.programme}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60), org: draft.org.trim(), programme: draft.programme.trim(),
                closes: draft.closes || null, url: draft.url.trim(), status: 'idea' })
              setDraft({ org: '', programme: '', closes: '', url: '' })
            }}><Plus size={13} />Add</button>
          </div>
        </Fold>
        {out.length > 0 && <Fold label="Ruled out" count={out.length}>
          {out.map((a) => <div key={a.id} className="log-row small"><span className="mono">no</span><span className="ellipsis" title={`${a.org} · ${a.programme}`}>{a.org} · {a.programme}</span><span className="muted clamp-2" title={a.reason}>{a.reason}</span></div>)}</Fold>}
        <p className="muted small">Deadlines within 14 days show on Today, and JARVIS answers "what internship deadlines are coming up".</p>
      </section>
    </>
  )
}

/** Long-term goals (e.g. the ₹1 crore career): milestones that fill in as their tree nodes are mastered. */
function Goals() {
  const all = usePlan((s) => s.applications?.goals) ?? EMPTY
  const goals = useMemo(() => all.filter((x) => x.kind === 'long_term'), [all])
  if (!goals.length) return null
  return (
    <>{goals.map((gl) => (
      <section key={gl.id} className="card goal-card">
        <div className="card-head"><span className="card-title"><Flag size={14} /><span className="ellipsis" title={gl.title}>{gl.title}</span></span><span className="mono muted small nowrap">{gl.target}</span></div>
        {gl.milestones.length === 0 && <p className="muted small">No milestones yet: each one links to the tree nodes that earn it.</p>}
        {gl.milestones.map((m) => (
          <div key={m.id} className="log-row small"><span className="mono">{m.by ?? ''}</span><span className="clamp-2" title={m.title}>{m.title}</span>
            <span className={`mono ${m.done ? 'live' : ''}`}>{Math.round(m.progress * 100)} %</span></div>))}
      </section>))}</>
  )
}

const CERT_FIRST = 12

function Certs() {
  const data = usePlan((s) => s.certs)
  const earn = usePlan((s) => s.earnCert)
  const toast = useStore((s) => s.toast)
  const [url, setUrl] = useState<Record<string, string>>({})
  const [all, setAll] = useState(false)
  const split = useMemo(() => {
    const certs = data?.certs ?? EMPTY
    return { earned: certs.filter((c) => c.earned), open: certs.filter((c) => !c.earned).slice(0, 30) }
  }, [data])
  if (!data) return <section className="card"><div className="empty">Loading certificates…</div></section>
  const b = data.budget
  const { earned, open } = split
  const shown = all ? open : open.slice(0, CERT_FIRST)
  return (
    <>
      <div className="sec-title"><Award size={15} /><span>Certificates</span><em className="mono">budget {inr(b.cert_inr_month)}/month · up to {inr(b.cert_stretch_inr)} for very credible ones</em></div>
      <section className="card certs">
        {earned.length > 0 && <p className="small"><b>Earned:</b> {earned.map((c) => c.name).join(', ')}</p>}
        <div className="cert-table">
          {shown.map((c) => {
            const meta = [c.issuer, typeof c.credibility === 'number' ? `credibility ${c.credibility}/5` : c.credibility, c.linkedin_worthy ? 'LinkedIn-worthy' : '', c.time_hours ? `~${c.time_hours} h` : '']
              .filter(Boolean).join(' · ')
            return (
              <div key={c.id} className={`cert-row fit-${c.budget_fit.replace(' ', '-')}`}>
                <span className="cert-main">
                  <span className="ellipsis cert-name" title={c.name}>{c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.name}</a> : c.name}</span>
                  <span className="muted small ellipsis" title={meta}>{meta}</span>
                </span>
                <span className="mono small cert-cost">{c.cost_inr ? inr(c.cost_inr) : 'free'}</span>
                <span className={`pill ${c.budget_fit === 'over budget' ? 'fault' : c.budget_fit === 'stretch' ? 'sim' : 'live'}`}>{c.budget_fit}</span>
                <span className="cert-earn">
                  <input className="field sm" placeholder="certificate link" aria-label={`Link for ${c.name}`} value={url[c.id] ?? ''} onChange={(e) => setUrl({ ...url, [c.id]: e.target.value })} />
                  <button className="btn sm ghost" onClick={() => void earn(c.id, url[c.id] ?? '').then((r) => toast(r.say, r.ok ? 'live' : 'fault'))}>Earned</button>
                </span>
              </div>)
          })}
        </div>
        {open.length > CERT_FIRST && <button className="btn sm ghost cert-more" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${open.length}`}</button>}
        <p className="muted small">"In budget" fits one month; "stretch" is over the month but credible enough (4/5 or more) to be worth saving up for. Prices are as reported in the bank: check before paying.</p>
      </section>
    </>
  )
}

function Parking() {
  const parking = usePlan((s) => s.state?.parking) ?? EMPTY
  const unpark = usePlan((s) => s.unpark)
  const list = useMemo(() => parking.slice().reverse(), [parking])
  return (
    <>
      <div className="sec-title"><ParkingCircle size={15} /><span>Parking lot</span><em className="mono">ideas waiting their turn</em></div>
      <section className="card">
        {list.length === 0 && <p className="muted small">Empty. When a new idea arrives mid-contract, park it from Today (or say "park an idea: …").</p>}
        {list.map((p) => (
          <div key={p.id} className="log-row small"><span className="mono">{p.at}</span><span className="clamp-2" title={p.text}>{p.text}</span>
            <button className="icon-btn" aria-label="Remove idea" onClick={() => void unpark(p.id)}><Trash2 size={13} /></button></div>))}
      </section>
    </>
  )
}

function Universities() {
  return (
    <section className="card unis">
      <div className="card-head"><span className="card-title"><GraduationCap size={14} />Target universities</span><span className="mono muted small">{TARGET_UNIVERSITIES.length}</span></div>
      {TARGET_UNIVERSITIES.map((u) => (
        <div key={u.name} className="uni-row small"><b className="ellipsis" title={u.name}>{u.name}</b><span className="ellipsis muted" title={`${u.program} · ${u.language}`}>{u.program} · {u.language}</span>
          <a href={u.portalUrl} target="_blank" rel="noreferrer" className="nowrap">{u.portal}</a></div>))}
      <p className="muted small">Check each programme page before applying: languages, tuition and deadlines change.</p>
    </section>
  )
}

/** The monthly bosses of Season One, kept as the record they are. */
function SeasonOne() {
  const g = useGame((s) => s.g)
  const won = BOSSES.filter((b) => g.bosses[b.id]?.defeatedAt)
  const contracts = g.ledger.filter((e) => e.kind === 'contract').length
  return (
    <details className="card">
      <summary className="small">Season One record (the old monthly bosses)</summary>
      <p className="small">{won.length ? `Defeated: ${won.map((b) => `${b.name} (${prettyDate(g.bosses[b.id].defeatedAt!)})`).join(', ')}.` : 'No bosses defeated in the old season.'} {contracts} contracts in the ledger.</p>
      <p className="muted small">Bosses were replaced by campaigns built from the skill tree. Their deliverables (an adder, an ALU, a UART, a RISC-V core) are projects on tree nodes now.</p>
    </details>
  )
}

/* ------------------------------------------------------------------ the record (restored from the old HQ) */
/** Attributes over the last 28 days (the radar) and everything invested so far. */
function Record() {
  const g = useGame((s) => s.g)
  const today = useGame((s) => s.today)
  const a = useMemo(() => E.attributes(g, today), [g, today])
  const inv = useMemo(() => E.investment(g), [g])
  const rows: [keyof typeof a, string][] = [['SIL', 'Silicon hours vs target'], ['DEU', 'German hours vs target'], ['VIT', 'Training days vs target'], ['CAP', 'Career and paperwork actions'], ['WIL', 'Days the system was honoured']]
  return (
    <section className="card">
      <div className="card-head"><span className="card-title">The record · last 28 days</span></div>
      <div className="attr-wrap">
        <Radar values={a} />
        <div className="attr-rows">
          {rows.map(([k, label]) => (
            <div key={k} className="attr-row"><span className="mono">{k}</span><NeonBar progress={a[k] / 100} tone={a[k] >= 70 ? 'live' : 'chrome'} /><span className="dot small">{a[k]}</span><span className="muted small">{label}</span></div>
          ))}
        </div>
      </div>
      <span className="eyebrow">Invested so far</span>
      <div className="metrics">
        {[{ v: `${inv.hours}h`, l: 'Hours' }, { v: inv.contracts, l: 'Contracts' }, { v: inv.days, l: 'Days secured' }, { v: inv.bosses, l: 'Bosses' }, { v: inv.cards, l: 'Drill cards' }]
          .map((m) => <div key={m.l}><span className="dot">{m.v}</span><span className="eyebrow">{m.l}</span></div>)}
      </div>
    </section>
  )
}
