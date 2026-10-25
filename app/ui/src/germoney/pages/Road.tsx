/**
 * Mission → Road: the long view. Campaigns (multi-week arcs to a career
 * milestone, each with a finish line and a ship step; three at most at once),
 * certificates against the monthly budget, the parking lot of ideas, the Germany
 * paperwork (Trials), the War Chest, the reward shop, and the Season One record.
 *
 * Absorbs: Campaign, Trials, Armory (shop, War Chest), Syllabus's Germany pages.
 */
import { Award, Flag, GraduationCap, Map as MapIcon, ParkingCircle, Rocket, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStore } from '../../lib/store'
import { BOSSES } from '../game/campaign'
import * as E from '../game/engine'
import { Marks, Radar } from '../game/kit'
import { MissionBoundary } from '../Boundary'
import { usePlan, type Campaign } from '../game/plan'
import { useGame } from '../game/store'
import { prettyDate } from '../game/util'
import { TARGET_UNIVERSITIES } from '../data/universities'
import { EMPTY, MissionHeader, NeonBar } from '../ui'
import { Achievements, Shop, WarChest } from './Armory'
import { TrialsPage } from './Trials'

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

export function RoadPage() {
  const loadRoad = usePlan((s) => s.loadRoad)
  const g = useGame((s) => s.g)
  useEffect(() => { void loadRoad() }, [loadRoad])
  return (
    <div className="mission-page road">
      <MissionHeader n="M5" title="Road" sub="Campaigns to a career milestone, certificates, Germany, the money." right={<Marks n={g.marks} size="lg" />} />
      <MissionBoundary small name="Ladder"><LadderView /></MissionBoundary>
      <MissionBoundary small name="Internships"><Internship /></MissionBoundary>
      <MissionBoundary small name="Campaigns"><Campaigns /></MissionBoundary>
      <MissionBoundary small name="Goals"><Goals /></MissionBoundary>
      <MissionBoundary small name="Certificates"><Certs /></MissionBoundary>
      <MissionBoundary small name="Parking lot"><Parking /></MissionBoundary>
      <div className="sec-title"><GraduationCap size={15} /><span>Germany paperwork and exams</span></div>
      <MissionBoundary small name="Trials"><div className="embedded"><TrialsPage /></div></MissionBoundary>
      <MissionBoundary small name="War Chest"><WarChest /></MissionBoundary>
      <MissionBoundary small name="Shop"><Shop /></MissionBoundary>
      <MissionBoundary small name="The record"><Record /></MissionBoundary>
      <MissionBoundary small name="Achievements"><Achievements /></MissionBoundary>
      <MissionBoundary small name="Universities"><Universities /></MissionBoundary>
      <MissionBoundary small name="Season one"><SeasonOne /></MissionBoundary>
    </div>
  )
}

function Campaigns() {
  const data = usePlan((s) => s.campaigns)
  const act = usePlan((s) => s.campaign)
  const toast = useStore((s) => s.toast)
  const [ship, setShip] = useState<Record<string, string>>({})
  if (!data) return <section className="card"><div className="empty">Loading campaigns…</div></section>
  const active = data.campaigns.filter((c) => c.status === 'active')
  const suggested = data.campaigns.filter((c) => c.status === 'suggested').slice(0, 6)
  const shipped = data.campaigns.filter((c) => c.status === 'shipped')
  const run = async (c: Campaign, op: 'start' | 'ship' | 'drop') => {
    const r = await act(c.id, op, ship[c.id] ?? '')
    toast(r.say, r.ok ? 'live' : 'info')
  }
  const card = (c: Campaign) => {
    const done = c.path.filter((p) => p.status === 'mastered').length
    return (
      <article key={c.id} className={`card campaign ${c.status}`}>
        <div className="card-head"><span className="card-title"><Flag size={14} />{c.title}</span>
          <span className="mono muted">{c.status === 'shipped' ? `shipped ${c.shipped}` : `${c.left} node${c.left === 1 ? '' : 's'} · ~${c.hours_left} h · ~${c.weeks} wk`}</span></div>
        <p className="small"><b>Finish line:</b> {c.finish_line}</p>
        <NeonBar progress={c.path.length ? done / c.path.length : 0} tone={c.status === 'shipped' ? 'live' : 'chrome'} />
        <div className="camp-path">{c.path.map((p) => <span key={p.id} className={`chip ${p.status}`}>{p.name}</span>)}</div>
        <ol className="small c-steps">{c.ship_steps.map((s) => <li key={s}>{s}</li>)}</ol>
        {c.status === 'shipped' && c.url && <a href={c.url} target="_blank" rel="noreferrer" className="small">{c.url}</a>}
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
      <div className="camp-grid">{active.map(card)}</div>
      {suggested.length > 0 && <><span className="eyebrow">Suggested for your career (highest weight first)</span><div className="camp-grid">{suggested.map(card)}</div></>}
      {shipped.length > 0 && <><span className="eyebrow">Shipped</span><div className="camp-grid">{shipped.map(card)}</div></>}
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
      {goals.length ? <ul className="np-list">{goals.slice(0, 6).map((x, i) => <li key={i}>{x.title}</li>)}</ul> : <span className="muted small">Nothing derived yet.</span>}</div>)
  return (
    <>
      <div className="sec-title"><Flag size={15} /><span>The ladder</span><em className="mono">{l.vision.horizon}: {l.vision.title} ({l.vision.band})</em></div>
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

/** The summer-2027 internship campaign: a pipeline of dated applications (stored privately by the server). */
function Internship() {
  const v = usePlan((s) => s.applications)
  const load = usePlan((s) => s.loadApplications)
  const setStatus = usePlan((s) => s.setAppStatus)
  const setTask = usePlan((s) => s.setTask)
  const upsert = usePlan((s) => s.upsertApp)
  const [draft, setDraft] = useState({ org: '', programme: '', closes: '', url: '' })
  useEffect(() => { void load() }, [load])
  if (!v) return null
  const goal = v.goals.find((x) => x.id === 'internship-2027')
  const live = v.applications.filter((a) => a.status !== 'not_eligible')
  const out = v.applications.filter((a) => a.status === 'not_eligible')
  return (
    <>
      <div className="sec-title"><Rocket size={15} /><span>{goal?.title ?? 'Summer 2027 internship'}</span><em className="mono">{goal?.target}</em></div>
      <section className="card internship">
        <div className="pipeline">{STAGES.filter((s) => s !== 'not_eligible').map((s) => (
          <div key={s} className="pipe-col"><span className="eyebrow">{s} · {v.pipeline[s]?.length ?? 0}</span></div>))}</div>
        {live.map((a) => (
          <div key={a.id} className="app-row">
            <span className={`mono ${a.days_left !== null && a.days_left <= 14 && a.days_left >= 0 ? 'fault' : ''}`}>
              {a.days_left === null ? 'no date' : a.days_left < 0 ? 'closed' : `${a.days_left} d`}{a.opens_in && a.opens_in > 0 ? ` · opens in ${a.opens_in} d` : ''}</span>
            <span><b>{a.url ? <a href={a.url} target="_blank" rel="noreferrer">{a.org}</a> : a.org}</b> · {a.programme}{a.verified ? '' : ' · verify the date'}
              {a.stipend && <span className="muted small"> · {a.stipend}</span>}
              {a.requirements.length > 0 && <span className="muted small"><br />Needs: {a.requirements.join('; ')}</span>}
              {a.notes && <span className="muted small"><br />{a.notes}</span>}</span>
            <select className="field sm" value={a.status} aria-label={`Status of ${a.org}`} onChange={(e) => void setStatus(a.id, e.target.value as typeof a.status)}>
              {STAGES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>
          </div>))}
        {v.tasks.length > 0 && <><span className="eyebrow">Prep checklist</span>
          {v.tasks.map((t) => (
            <label key={t.id} className="check small"><input type="checkbox" checked={!!t.done} onChange={(e) => void setTask({ id: t.id, done: e.target.checked })} />
              {t.title}{t.due ? ` · due ${t.due}` : ''}</label>))}</>}
        <div className="field-row">
          <input className="field" placeholder="Organisation" value={draft.org} onChange={(e) => setDraft({ ...draft, org: e.target.value })} />
          <input className="field" placeholder="Programme" value={draft.programme} onChange={(e) => setDraft({ ...draft, programme: e.target.value })} />
          <input className="field sm" type="date" value={draft.closes} onChange={(e) => setDraft({ ...draft, closes: e.target.value })} aria-label="Closes" />
          <input className="field" placeholder="https://…" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
          <button className="btn sm" disabled={!draft.org.trim()} onClick={() => {
            void upsert({ id: `${draft.org}-${draft.programme}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60), org: draft.org.trim(), programme: draft.programme.trim(),
              closes: draft.closes || null, url: draft.url.trim(), status: 'idea' })
            setDraft({ org: '', programme: '', closes: '', url: '' })
          }}>Add</button>
        </div>
        {out.length > 0 && <details><summary className="muted small">Ruled out ({out.length})</summary>
          {out.map((a) => <div key={a.id} className="log-row small"><span className="mono">no</span><span>{a.org} · {a.programme}</span><span className="muted">{a.reason}</span></div>)}</details>}
        <p className="muted small">Deadlines within 14 days show on Today, and JARVIS answers "what internship deadlines are coming up".</p>
      </section>
    </>
  )
}

/** Long-term goals (e.g. the ₹1 crore career): milestones that fill in as their tree nodes are mastered. */
function Goals() {
  const goals = (usePlan((s) => s.applications?.goals) ?? EMPTY).filter((x) => x.kind === 'long_term')
  if (!goals.length) return null
  return (
    <>{goals.map((gl) => (
      <section key={gl.id} className="card">
        <div className="card-head"><span className="card-title"><Flag size={14} />{gl.title}</span><span className="mono muted small">{gl.target}</span></div>
        {gl.milestones.length === 0 && <p className="muted small">No milestones yet: each one links to the tree nodes that earn it.</p>}
        {gl.milestones.map((m) => (
          <div key={m.id} className="log-row small"><span className="mono">{m.by ?? ''}</span><span>{m.title}</span>
            <span className={`mono ${m.done ? 'live' : ''}`}>{Math.round(m.progress * 100)} %</span></div>))}
      </section>))}</>
  )
}

function Certs() {
  const data = usePlan((s) => s.certs)
  const earn = usePlan((s) => s.earnCert)
  const toast = useStore((s) => s.toast)
  const [url, setUrl] = useState<Record<string, string>>({})
  if (!data) return null
  const b = data.budget
  const earned = data.certs.filter((c) => c.earned)
  const open = data.certs.filter((c) => !c.earned)
  return (
    <>
      <div className="sec-title"><Award size={15} /><span>Certificates</span><em className="mono">budget {inr(b.cert_inr_month)}/month · up to {inr(b.cert_stretch_inr)} for very credible ones</em></div>
      <section className="card certs">
        {earned.length > 0 && <p className="small"><b>Earned:</b> {earned.map((c) => c.name).join(', ')}</p>}
        <div className="cert-table">
          {open.slice(0, 30).map((c) => (
            <div key={c.id} className={`cert-row fit-${c.budget_fit.replace(' ', '-')}`}>
              <span>{c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.name}</a> : c.name}<span className="muted small"> · {c.issuer}</span></span>
              <span className="mono small">{c.cost_inr ? inr(c.cost_inr) : 'free'}</span>
              <span className={`pill ${c.budget_fit === 'over budget' ? 'fault' : c.budget_fit === 'stretch' ? 'sim' : 'live'}`}>{c.budget_fit}</span>
              <span className="muted small">{typeof c.credibility === 'number' ? `credibility ${c.credibility}/5` : c.credibility}{c.linkedin_worthy ? ' · LinkedIn-worthy' : ''}{c.time_hours ? ` · ~${c.time_hours} h` : ''}</span>
              <span className="field-row">
                <input className="field sm" placeholder="certificate link" value={url[c.id] ?? ''} onChange={(e) => setUrl({ ...url, [c.id]: e.target.value })} />
                <button className="btn sm ghost" onClick={() => void earn(c.id, url[c.id] ?? '').then((r) => toast(r.say, r.ok ? 'live' : 'fault'))}>Earned</button>
              </span>
            </div>))}
        </div>
        <p className="muted small">"In budget" fits one month; "stretch" is over the month but credible enough (4/5 or more) to be worth saving up for. Prices are as reported in the bank: check before paying.</p>
      </section>
    </>
  )
}

function Parking() {
  const parking = usePlan((s) => s.state?.parking) ?? EMPTY
  const unpark = usePlan((s) => s.unpark)
  return (
    <>
      <div className="sec-title"><ParkingCircle size={15} /><span>Parking lot</span><em className="mono">ideas waiting their turn</em></div>
      <section className="card">
        {parking.length === 0 && <p className="muted small">Empty. When a new idea arrives mid-contract, park it from Today (or say "park an idea: …").</p>}
        {parking.slice().reverse().map((p) => (
          <div key={p.id} className="log-row small"><span className="mono">{p.at}</span><span>{p.text}</span>
            <button className="icon-btn" aria-label="Remove idea" onClick={() => void unpark(p.id)}><Trash2 size={13} /></button></div>))}
      </section>
    </>
  )
}

function Universities() {
  return (
    <details className="card">
      <summary className="small">Target universities ({TARGET_UNIVERSITIES.length})</summary>
      {TARGET_UNIVERSITIES.map((u) => (
        <div key={u.name} className="log-row small"><b>{u.name}</b><span>{u.program} · {u.language}</span>
          <a href={u.portalUrl} target="_blank" rel="noreferrer">{u.portal}</a></div>))}
      <p className="muted small">Check each programme page before applying: languages, tuition and deadlines change.</p>
    </details>
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
  const a = E.attributes(g, today)
  const inv = E.investment(g)
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
