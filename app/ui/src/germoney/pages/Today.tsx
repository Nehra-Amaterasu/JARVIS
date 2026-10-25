/**
 * Mission → Today. One screen for the day: the blocks (library, protected rest,
 * evening practice), the contracts the plan made for them (from the skill tree
 * and the academics, each with what to read first, steps, a hint and a check),
 * the small wins so far, the Floor, and the latest papers on what you're learning.
 *
 * Absorbs: HQ, Contracts, Schedule, the Floor, Boot Camp, Overdrive/Sunday.
 */
import { BookOpen, Box, CalendarDays, Check, ChevronDown, Dumbbell, ExternalLink, FileText, Languages, Lightbulb, Lock, Mic, ParkingCircle, RefreshCw, Sparkles, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api, post } from '../../lib/api'
import { useStore } from '../../lib/store'
import { CARD_BY_ID } from '../game/decks'
import * as E from '../game/engine'
import { Marks, Shields, StreakFlame } from '../game/kit'
import { endOf, mins, openStudyFile, usePlan, type PlanContract } from '../game/plan'
import { gameBrief, useGame } from '../game/store'
import { prettyDate } from '../game/util'
import { DAILY_ITEMS, SUNDAY_ITEMS, useChecklistStore } from '../stores/checklist-store'
import { usePlayerStore } from '../stores/player-store'
import { CheckRow, daysSince, EMPTY, MissionHeader, NeonBar } from '../ui'
import { SchedulePage } from './Schedule'
import { QuestCards } from './Status'

const REP_ICON = { silicon: Zap, deutsch: Languages, body: Dumbbell } as const

export function TodayPage() {
  const today = usePlan((s) => s.today)
  const offline = usePlan((s) => s.offline)
  const g = useGame((s) => s.g)
  const day = useGame((s) => s.today)
  const xp = usePlayerStore((s) => s.player.xp)
  const lv = E.levelInfo(xp)
  const streak = E.streakInfo(g, day)
  useEffect(() => { void usePlan.getState().refresh() }, [])

  const sub = today
    ? [prettyDate(today.date, true), today.exam?.phase ? `Exam plan · ${today.exam.phase.name}` : today.exam ? `Exam mode · ${today.exam.subject?.name}` : today.track_label].filter(Boolean).join(' · ')
    : prettyDate(day, true)
  return (
    <div className="mission-page today">
      <MissionHeader n="M1" title="Today" sub={sub}
        right={<div className="hq-pills">
          <span className="pill"><i className="led" />Level {lv.level}</span>
          <StreakFlame n={streak.current} kept={streak.todayKept} /><Shields n={g.shields} /><Marks n={g.marks} />
        </div>} />
      {offline && <div className="card warn small">The plan server isn't answering. The Floor still works; contracts come back when it does.</div>}
      {today && !today.bank_ready && !today.contracts.length && <div className="card small">The skill-tree bank hasn't landed yet, so the plan has no contracts to give. The Floor and Focus still work.</div>}
      {today?.note && <p className="muted small">{today.note}</p>}

      <WelcomeBackCard />
      <Wins />
      <Deadlines />
      <Comeback />
      <div className="today-grid">
        <section className="today-main">
          {today?.exam && <ExamBanner />}
          <TodaysThree />
          <Blocks />
          <QuestCards />
          <ParkIdea />
        </section>
        <aside className="today-side">
          <FloorCard />
          <WeeklyReview />
          <LearnCard />
          <HabitsCard />
          <ProofCard />
          <Brief />
          <Findings />
          <Rituals />
        </aside>
      </div>
      <details className="card today-cal">
        <summary><CalendarDays size={14} /> Calendar and free blocks</summary>
        <div className="embedded"><SchedulePage /></div>
      </details>
    </div>
  )
}

/* ------------------------------------------------------------------ small wins */
function Wins() {
  const t = usePlan((s) => s.today)
  const g = useGame((s) => s.g)
  const day = useGame((s) => s.today)
  if (!t) return null
  const w = t.wins
  const total = t.contracts.length
  const done = t.contracts.filter((c) => c.done).length
  const reps = E.REPS.filter((r) => g.days[day]?.reps[r]).length
  const line = done === total && total ? 'Everything on today\'s list is done. Good day.'
    : done ? `${done} down. Keep the next one small.` : 'Start with the smallest one; momentum does the rest.'
  return (
    <section className="card wins" aria-label="Today's wins">
      <div className="wins-row">
        <div><span className="dot">{done}/{total}</span><span className="eyebrow">Contracts</span></div>
        <div><span className="dot">{mins(w.minutes)}</span><span className="eyebrow">Logged</span></div>
        <div><span className="dot">+{w.xp}</span><span className="eyebrow">XP today</span></div>
        <div><span className="dot">{reps}/3</span><span className="eyebrow">Floor</span></div>
        <div><span className="dot">{t.wip.length}/{t.wip_cap}</span><span className="eyebrow">In progress</span></div>
      </div>
      <NeonBar progress={total ? done / total : 0} tone={done === total && total ? 'live' : 'chrome'} />
      <p className="muted small">{line}</p>
    </section>
  )
}

/** After a gap: no drama. What slipped, said plainly, and a small first win. */
function WelcomeBackCard() {
  const wb = usePlan((s) => s.today?.welcome_back)
  if (!wb) return null
  return (
    <section className="card welcome-back">
      <b>Welcome back.</b>
      <p className="small">{wb.idle_days} days away, and that's fine. Start with the smallest contract below; refreshers for anything that faded are in the evening block.</p>
      {wb.slipped.length > 0 && <p className="small muted">What slipped: {wb.slipped.join('; ')}.</p>}
      {wb.next_deadline && <p className="small muted">Next deadline: {wb.next_deadline.org} · {wb.next_deadline.programme}, {wb.next_deadline.days_left} days out.</p>}
    </section>
  )
}

/** Internship deadlines within 14 days, and prep tasks due this week. */
function Deadlines() {
  const d = usePlan((s) => s.today?.deadlines) ?? EMPTY
  const setTask = usePlan((s) => s.setTask)
  const setTab = useStore((s) => s.setTab)
  if (!d.length) return null
  return (
    <section className="card deadlines">
      <div className="card-head"><span className="card-title"><CalendarDays size={14} />Coming up</span>
        <button className="link-btn" onClick={() => setTab('campaign')}>Pipeline</button></div>
      {d.map((x) => (
        <div key={x.id} className="log-row small">
          <span className={`mono ${x.days_left !== null && x.days_left <= 3 ? 'fault' : ''}`}>{x.days_left === 0 ? 'today' : `${x.days_left} d`}</span>
          <span>{x.status === 'task' ? x.programme : `${x.org} · ${x.programme}`}{x.verified ? '' : ' (date to verify)'}</span>
          {x.status === 'task'
            ? <button className="btn sm ghost" onClick={() => void setTask({ id: x.id, done: true })}><Check size={12} />Done</button>
            : x.url ? <a href={x.url} target="_blank" rel="noreferrer">open</a> : <span />}
        </div>))}
    </section>
  )
}

/** Rule 1, v2: two weeks without a commit is a friendly nudge, never a lock. */
function Comeback() {
  const last = usePlayerStore((s) => s.player.lastCommitDate)
  const setTab = useStore((s) => s.setTab)
  const since = daysSince(last)
  if (since === null || since < 14) return null
  return (
    <section className="card comeback">
      <Sparkles size={16} />
      <div><b>{since} days since your last commit.</b> <span className="muted small">One small push gets the streak of proof going again: a README fix counts.</span></div>
      <button className="btn sm" onClick={() => setTab('terminal')}>Log it</button>
    </section>
  )
}

function ExamBanner() {
  const e = usePlan((s) => s.today?.exam)
  if (!e) return null
  return (
    <section className="card exam-banner">
      <div className="card-head"><span className="card-title"><BookOpen size={14} />{e.phase ? e.phase.name : `Exam mode · ${e.subject?.name}`}</span>
        <span className="mono muted">{e.phase ? `${e.phase.days_left} days to ${prettyDate(e.phase.anchor)}` : e.days_left !== null ? `${e.days_left} days left` : ''}</span></div>
      {e.advice && <p className="small">{e.advice}</p>}
      {e.milestone && <p className="small"><b>Next milestone:</b> {e.milestone}</p>}
      {e.rescue_week && <p className="small muted"><b>Maths rescue, week {e.rescue_week.week}:</b> {e.rescue_week.library} <i>Evenings: {e.rescue_week.evenings}</i></p>}
      {e.queue.length > 0 && <div className="exam-queue">{e.queue.slice(0, 6).map((q) => (
        <span key={q.id} className={`chip ${q.kind === 'backlog' ? 'backlog' : ''}`}>{q.name}{q.days_left !== null ? ` · ${q.days_left} d` : ' · date TBC'}{q.see_needed != null ? ` · pass: ${q.see_needed}/${q.see_max ?? 60}` : ''}</span>))}</div>}
    </section>
  )
}

/* ------------------------------------------------------------------ the day's blocks */
function Blocks() {
  const t = usePlan((s) => s.today)
  const reroll = usePlan((s) => s.reroll)
  if (!t) return <div className="card"><div className="empty">Planning the day…</div></div>
  return (
    <>
      {t.blocks.map((b) => {
        const items = t.contracts.filter((c) => c.slot === b.kind || (b.kind === 'weekend' && c.slot === 'weekend'))
        return (
          <section key={b.id} className={`card block block-${b.kind}`}>
            <div className="card-head">
              <span className="card-title">{b.label}</span>
              <span className="mono muted">{b.start}–{endOf(b.start, b.minutes)} · {mins(b.minutes)}</span>
            </div>
            {b.kind === 'protected'
              ? <p className="muted small">Protected. Friends, a walk, nothing at all. The plan never puts work here.</p>
              : items.length ? items.map((c) => <ContractCard key={c.key} c={c} />)
                : <p className="muted small">Nothing planned here. {b.kind === 'evening' ? 'Finish something today and tomorrow evening has spaced practice on it.' : ''}</p>}
          </section>
        )
      })}
      <Alternatives />
      <button className="link-btn small" onClick={() => void reroll()}><RefreshCw size={12} />Rebuild today's plan</button>
    </>
  )
}

/** A choice, not one fixed task: swap the first open library contract for another. */
function Alternatives() {
  const t = usePlan((s) => s.today)
  const choose = usePlan((s) => s.choose)
  const toast = useStore((s) => s.toast)
  const first = t?.contracts.find((c) => c.slot === 'library' && c.source === 'tree' && !c.done)
  if (!t?.alternatives?.length || !first) return null
  return (
    <section className="card alternatives">
      <span className="eyebrow">Not feeling "{first.title}"? Pick one of these instead</span>
      {t.alternatives.map((a) => (
        <div key={a.key} className="log-row small"><span className="mono">{mins(a.minutes)}</span>
          <span><b>{a.title}</b> · {a.node_name}{a.serves ? ` · for ${a.serves.title}` : ''}</span>
          <button className="btn sm ghost" onClick={() => void choose(first.key, a.key).then((r) => toast(r.say, r.ok ? 'live' : 'fault'))}>Swap in</button></div>))}
    </section>
  )
}

function ContractCard({ c }: { c: PlanContract }) {
  const complete = usePlan((s) => s.complete)
  const toast = useStore((s) => s.toast)
  const [open, setOpen] = useState(false)
  const [proof, setProof] = useState('')
  const [busy, setBusy] = useState(false)
  const finish = async () => {
    setBusy(true)
    const r = await complete(c.key, proof.trim())
    setBusy(false)
    toast(r.say, r.ok ? 'live' : 'fault')
  }
  return (
    <article className={`contract ${c.done ? 'done' : ''} ${open ? 'open' : ''}`}>
      <button className="contract-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        {c.done ? <Check size={16} className={c.verified ? 'verified' : 'claimed'} /> : <span className="c-dot" />}
        <span className="c-title"><b>{c.title}</b>
          <span className="mono muted small">{c.node_name ? `${c.node_name} · ` : ''}{mins(c.minutes)} · +{c.xp} XP{c.why ? ` · ${c.why}` : ''}</span>
          {c.serves && <span className="small c-serves">For: {c.serves.title} <span className="muted">({c.serves.why})</span></span>}</span>
        <ChevronDown size={15} className="c-chev" />
      </button>
      {open && (
        <div className="contract-body fade-in">
          {c.hook && <p className="c-hook"><b>{c.hook}</b></p>}
          {c.context && <p>{c.context}</p>}
          {c.read_first.length > 0 && (
            <div className="c-sec"><span className="eyebrow"><BookOpen size={11} /> Read first</span>
              {c.read_first.map((r, i) => (
                <a key={`${r.id}${i}`} className="c-res" href={r.url} target="_blank" rel="noreferrer">
                  {r.title}<ExternalLink size={11} /><span className="muted small">{r.why}{r.free ? '' : ' · paid'}</span></a>))}
            </div>)}
          {c.depends_on.length > 0 && (
            <p className="small muted">Builds on: {c.depends_on.map((d) => `${d.name}${d.status === 'mastered' ? ' ✓' : ''}`).join(', ')}</p>)}
          {c.steps.length > 0 && <ol className="c-steps">{c.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
          {(c.files ?? []).filter((f) => f.allowed).length > 0 && (
            <div className="c-sec"><span className="eyebrow"><FileText size={11} /> Your files</span>
              {(c.files ?? []).filter((f) => f.allowed).map((f) => (
                <button key={f.path} className="link-btn c-res" onClick={() => void openStudyFile(f.path).catch((e) => toast((e as Error).message, 'fault'))}>
                  {f.title}{f.pages ? ` · pp. ${f.pages}` : ''}</button>))}
            </div>)}
          {c.pass?.see_needed_computed != null && <p className="small"><b>To pass:</b> {c.pass.see_needed_computed} of {c.pass.see_max ?? 60} in the SEE.</p>}
          {c.hint && <p className="c-hint"><Lightbulb size={12} /> {c.hint}</p>}
          {c.success_check && <p className="c-check"><b>Done when:</b> {c.success_check}</p>}
          {(c.backup || c.pdfs.length > 0) && (
            <p className="small muted">{c.backup && <>Backup: <a href={c.backup.url} target="_blank" rel="noreferrer">{c.backup.title}</a></>}
              {c.pdfs.map((p) => <span key={p.url}> · <FileText size={11} /> <a href={p.url} target="_blank" rel="noreferrer">{p.title} (legal PDF)</a></span>)}</p>)}
          {!c.done && (
            <div className="field-row">
              <input className="field" placeholder="Proof: a link (GitHub, HDLBits profile, photo URL) or a short note" value={proof} onChange={(e) => setProof(e.target.value)} />
              <button className="btn sm primary" disabled={busy} onClick={() => void finish()}>Done</button>
            </div>)}
          {!c.done && <p className="muted small">A link counts as verified (cyan); a note is your word (amber). Both count.</p>}
        </div>)}
    </article>
  )
}

function ParkIdea() {
  const park = usePlan((s) => s.park)
  const toast = useStore((s) => s.toast)
  const n = usePlan((s) => s.state?.parking.length ?? 0)
  const [text, setText] = useState('')
  return (
    <section className="card park">
      <div className="card-head"><span className="card-title"><ParkingCircle size={14} />Parking lot</span><span className="mono muted">{n} parked</span></div>
      <p className="muted small">A new idea mid-contract? Park it here and keep going. Ideas wait on the Road; nothing is lost.</p>
      <div className="field-row">
        <input className="field" placeholder="e.g. build a tiny GPU in Verilog" value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { void park(text.trim()); setText(''); toast('Parked.', 'live') } }} />
        <button className="btn sm" disabled={!text.trim()} onClick={() => { void park(text.trim()); setText(''); toast('Parked.', 'live') }}>Park</button>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ the Floor + supply drop */
function FloorCard() {
  const g = useGame((s) => s.g)
  const today = useGame((s) => s.today)
  const markRep = useGame((s) => s.markRep)
  const unmarkRep = useGame((s) => s.unmarkRep)
  const mode = E.modeOn(g, today)
  const rest = E.isRestDay(g, today)
  const day = g.days[today]
  const secured = E.isSecured(g, today)
  return (
    <section className={`card floor-card ${secured ? 'secured' : ''}`}>
      <div className="card-head">
        <span className="card-title">The Floor{mode === 'exam' ? ' · exam days: study rep only' : mode === 'recovery' ? ' · recovery: any one rep' : ''}</span>
        <span className="mono muted">{secured ? 'secured' : rest ? 'rest day' : '~45 min'}</span>
      </div>
      <div className="floor-row compact">
        {E.REPS.map((r) => {
          const mark = day?.reps[r]
          const Icon = REP_ICON[r]
          return (
            <button key={r} className={`rep-tile ${mark ? (mark.verified ? 'verified' : 'claimed') : 'open'} ${mode === 'exam' && r !== 'silicon' ? 'dim' : ''}`}
              onClick={() => (mark ? (!mark.verified && !secured ? unmarkRep(r) : undefined) : markRep(r, 'manual', false))}
              title={mark ? (mark.verified ? 'Verified' : 'Claimed: click to undo') : 'Tap to claim it (amber). Contracts, Focus and Drill tick it for you.'}>
              <Icon size={18} />
              <span className="rt-label">{mode === 'exam' && r === 'silicon' ? 'Study' : E.REP_LABEL[r]}</span>
              <span className="rt-state mono">{mark ? (mark.verified ? 'verified' : 'claimed') : 'open'}</span>
            </button>
          )
        })}
      </div>
      <SupplyDrop />
    </section>
  )
}

function SupplyDrop() {
  const g = useGame((s) => s.g)
  const today = useGame((s) => s.today)
  const openChest = useGame((s) => s.openChest)
  const secured = E.isSecured(g, today)
  const loot = g.chests[today]
  if (!secured) return <div className="crate locked"><Lock size={16} /><span className="rt-hint">Secure the floor to open today's supply drop.</span></div>
  if (!loot) return <button className="crate ready" onClick={() => openChest()}><Box size={18} /><span className="rt-label">Open supply drop</span></button>
  const card = CARD_BY_ID[loot.card]
  return (
    <div className={`crate opened ${loot.legendary ? 'legendary' : ''}`}>
      <div className="loot"><Marks n={loot.marks} />{loot.shield && <span className="pill live">+1 shield</span>}{loot.booster && <span className="pill">+1 booster</span>}</div>
      {card && <div className="loot-intel"><b>{card.front}</b><span>{card.back}</span></div>}
    </div>
  )
}

/* ------------------------------------------------------------------ Well Wisher */
/** Today's 3: chosen on the server by the goal ladder, career and personality engines. */
function TodaysThree() {
  const t = usePlan((s) => s.today)
  const three = t?.three
  if (!three || !three.picks.length) return null
  const done = new Set(t.contracts.filter((c) => c.done).map((c) => c.key))
  return (
    <section className="card three" aria-label="Today's 3">
      <div className="card-head">
        <span className="card-title"><Sparkles size={14} />Today's {three.picks.length}</span>
        <span className="mono muted small">{three.mode === 'recovery' ? 'easy restart' : 'goal ladder · career · personality'}</span>
      </div>
      {three.welcome_back && <p className="small">{three.welcome_back}</p>}
      {three.source === 'example' && <p className="muted small">From the example inputs: your own engine-inputs.json isn't there yet.</p>}
      <ol className="three-list">
        {three.picks.map((p) => (
          <li key={p.key} className={done.has(p.key) ? 'done' : ''} data-key={p.key}>
            <div className="log-row small"><b>{done.has(p.key) ? <Check size={12} /> : null}{p.title}</b><span className="mono muted">{mins(p.minutes)}</span></div>
            <p className="small three-frame">{p.frame}</p>
            <p className="muted small three-why">{p.why}</p>
          </li>))}
      </ol>
      {three.career_next && <p className="muted small">Next career step: {three.career_next.action} ({three.career_next.days_left} days left).</p>}
      <p className="muted small">{three.cap.say}</p>
    </section>
  )
}

/** The weekly review (insight engine): every line carries its numbers. */
function WeeklyReview() {
  const w = usePlan((s) => s.today?.weekly)
  const core = useStore((s) => s.core)
  const toast = useStore((s) => s.toast)
  if (!w) return null
  const read = async () => {
    if (core?.running) {
      try {
        await post('/api/core/speak', { text: w.say })
        return toast('JARVIS is reading the weekly review.', 'live')
      } catch { /* fall through */ }
    }
    toast(w.say, 'info')
  }
  return (
    <section className="card weekly" aria-label="Weekly review">
      <div className="card-head"><span className="card-title"><CalendarDays size={14} />Weekly review</span>
        <span className="mono muted small">{prettyDate(w.week.start)} – {prettyDate(w.week.end)}</span></div>
      <p className="small">{w.totals}.</p>
      {w.moved.length > 0 && <div className="small"><span className="eyebrow">Moved</span>{w.moved.map((m) => <div key={m}>{m}</div>)}</div>}
      {w.stalled.length > 0 && <div className="small muted"><span className="eyebrow">Stalled</span>{w.stalled.map((m) => <div key={m}>{m}</div>)}</div>}
      <p className="small weekly-change"><b>{w.change.text}</b></p>
      <button className="btn sm" onClick={() => void read()}><Mic size={13} />Read it to me</button>
      <p className="muted small">By voice: "Jarvis, weekly review".</p>
    </section>
  )
}

export interface BodyAnswer {
  status: string; say: string
  habits: { id: string; target: string; per_week: number; done_this_week: number; today_done: boolean; on_track: boolean; met: boolean }[]
  focus: { id: string; name: string; text: string }
}

/** Body & life (ww_body.py): habits counted per week from taps, plus this week's upgrade. */
export function HabitsCard() {
  const [b, setB] = useState<BodyAnswer | null>(null)
  const toast = useStore((s) => s.toast)
  useEffect(() => {
    let live = true
    api<BodyAnswer>('/api/mission/body').then((r) => { if (live) setB(r) }).catch(() => undefined)
    return () => { live = false }
  }, [])
  if (!b || b.status !== 'ok') return null
  const tap = async (id: string, done: boolean) => {
    try {
      setB(await post<BodyAnswer>(`/api/mission/habit/${encodeURIComponent(id)}`, { done }))
    } catch {
      toast('Could not save that habit.', 'fault')
    }
  }
  return (
    <section className="card habits" aria-label="This week">
      <div className="card-head"><span className="card-title"><Dumbbell size={14} />This week</span></div>
      {b.habits.map((h) => (
        <label key={h.id} className={`habit-row small ${h.on_track ? '' : 'behind'}`}>
          <input type="checkbox" checked={h.today_done} onChange={(e) => void tap(h.id, e.target.checked)} />
          <span className="habit-name">{h.target || h.id}</span>
          <span className="mono">{h.done_this_week}/{h.per_week}</span>
        </label>
      ))}
      <p className="small"><span className="eyebrow">Upgrade · {b.focus.name}</span>{b.focus.text}</p>
    </section>
  )
}

export interface LearnAnswer {
  status: string; say: string; source?: string
  new: { id: string; title: string; body: string; quiz: string[] } | null
  due: { id: string; title: string; question: string; box: number }[]
  progress?: { seen: number; total: number }
}

/** Daily knowledge program (ww_learning.py): one new concept, then spaced recall.
 *  Answer the recall from memory first; reading the answer is not the exercise. */
export function LearnCard() {
  const [l, setL] = useState<LearnAnswer | null>(null)
  const toast = useStore((s) => s.toast)
  useEffect(() => {
    let live = true
    api<LearnAnswer>('/api/mission/learn').then((r) => { if (live) setL(r) }).catch(() => undefined)
    return () => { live = false }
  }, [])
  if (!l || l.status !== 'ok') return null
  const mark = async (id: string, op: 'seen' | 'recall', ok?: boolean) => {
    try {
      setL(await post<LearnAnswer>(`/api/mission/learn/${id}/${op}`, op === 'recall' ? { ok } : {}))
    } catch {
      toast('Could not save that answer.', 'fault')
    }
  }
  return (
    <section className="card learn" aria-label="Knowledge of the day">
      <div className="card-head"><span className="card-title"><Lightbulb size={14} />Knowledge of the day</span>
        {l.progress && <span className="mono muted small">{l.progress.seen}/{l.progress.total}</span>}</div>
      {l.new && (
        <div className="learn-new">
          <b>{l.new.title}</b>
          <p className="small">{l.new.body}</p>
          <button className="btn sm" onClick={() => void mark(l.new!.id, 'seen')}><Check size={13} />Read it</button>
        </div>
      )}
      {l.due.map((d) => (
        <div key={d.id} className="learn-due small">
          <span className="eyebrow">Recall · {d.title}</span>
          <div>{d.question}</div>
          <div className="row">
            <button className="btn sm" onClick={() => void mark(d.id, 'recall', true)}>I knew it</button>
            <button className="btn sm ghost" onClick={() => void mark(d.id, 'recall', false)}>I didn't</button>
          </div>
        </div>
      ))}
      {!l.new && l.due.length === 0 && <p className="muted small">{l.say}</p>}
      {l.source === 'example' && <p className="muted small">Example concepts: add LEARN.md to use your own.</p>}
    </section>
  )
}

export interface ProofAnswer {
  status: string; configured?: boolean; say: string; error?: string | null
  current_streak?: number; today_done?: boolean; active_last_30?: number
  strip?: { date: string; commits: number }[]; suggestion?: { kind: string; text: string }
}

/** GitHub proof streak (ww_proof.py): public activity only, and never a generated commit. */
export function ProofCard() {
  const [p, setP] = useState<ProofAnswer | null>(null)
  useEffect(() => {
    let live = true
    // The server caches GitHub for 30 min, so opening Today never burns the hourly API allowance.
    api<ProofAnswer>('/api/mission/engine/proof').then((r) => { if (live) setP(r) }).catch(() => undefined)
    return () => { live = false }
  }, [])
  if (!p || p.status !== 'ok') return null
  return (
    <section className="card proof" aria-label="GitHub proof">
      <div className="card-head"><span className="card-title"><Box size={14} />Proof of work</span>
        {p.configured && <span className="mono small">{p.current_streak} day streak</span>}</div>
      {p.strip && (
        <div className="proof-strip" aria-label="last 30 days">
          {p.strip.map((d) => <i key={d.date} title={`${d.date}: ${d.commits}`} className={d.commits ? 'on' : ''} />)}
        </div>
      )}
      <p className="small">{p.configured ? (p.today_done ? 'Today is green.' : p.suggestion?.text) : p.say}</p>
      {p.error && <p className="muted small">{p.error}</p>}
      {p.configured && <p className="muted small">{p.active_last_30} of the last 30 days active · public repos only</p>}
    </section>
  )
}

function Brief() {
  const g = useGame((s) => s.g)
  const t = usePlan((s) => s.today)
  const core = useStore((s) => s.core)
  const toast = useStore((s) => s.toast)
  const brief = useMemo(() => gameBrief(), [g, t]) // eslint-disable-line react-hooks/exhaustive-deps
  const speak = async () => {
    useGame.getState().logBrief()
    if (core?.running) {
      try {
        await post('/api/core/speak', { text: brief.text })
        return toast('JARVIS is briefing you.', 'live')
      } catch { /* fall through */ }
    }
    toast(brief.text, 'info')
  }
  return (
    <section className="card brief">
      <p className="small">{brief.text}</p>
      <button className="btn sm" onClick={() => void speak()}><Mic size={13} />Brief me</button>
      <p className="muted small">By voice, window open or closed: "what's today's contract", "explain this contract", "I finished it".</p>
    </section>
  )
}

/* ------------------------------------------------------------------ latest findings */
function Findings() {
  const findings = usePlan((s) => s.findings)
  const load = usePlan((s) => s.loadFindings)
  useEffect(() => { void load() }, [load])
  return (
    <section className="card findings">
      <div className="card-head"><span className="card-title"><Sparkles size={14} />Latest findings</span>
        <button className="link-btn" onClick={() => void load(true)} aria-label="Refresh findings"><RefreshCw size={12} /></button></div>
      {findings === null && <p className="muted small">Fetching…</p>}
      {findings?.length === 0 && <p className="muted small">Start a node on the Tree and its newest arXiv papers show up here once a day.</p>}
      {findings?.map((f) => (
        <div key={f.node_id} className="finding">
          <span className="eyebrow">{f.name} · {f.cats.join(', ')}{f.stale ? ` · ${f.error ? 'offline, showing' : 'from'} ${f.fetched ?? 'never'}` : ''}</span>
          {f.papers.length === 0 && <span className="muted small">{f.error ? 'Offline and nothing cached yet.' : 'Nothing new.'}</span>}
          {f.papers.slice(0, 2).map((p) => <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="small">{p.title}</a>)}
        </div>))}
    </section>
  )
}

/* ------------------------------------------------------------------ rituals (restored from the old HQ) */
/** Overdrive (optional stretch items, reset daily) and the Sunday debrief (reset weekly). Collapsed by default. */
function Rituals() {
  const daily = useChecklistStore((s) => s.daily)
  const weekly = useChecklistStore((s) => s.weekly)
  const toggleDaily = useChecklistStore((s) => s.toggleDaily)
  const toggleWeekly = useChecklistStore((s) => s.toggleWeekly)
  const dDone = DAILY_ITEMS.filter((i) => daily[i.id]).length
  const wDone = SUNDAY_ITEMS.filter((i) => weekly[i.id]).length
  return (
    <details className="card">
      <summary className="card-title">Rituals · Overdrive {dDone}/{DAILY_ITEMS.length} · Sunday debrief {wDone}/{SUNDAY_ITEMS.length}</summary>
      <p className="muted small">Overdrive is optional: the Floor keeps the streak. It resets at midnight; the Sunday debrief resets weekly.</p>
      <span className="eyebrow">Overdrive</span>
      {DAILY_ITEMS.map((i) => <CheckRow key={i.id} label={i.label} checked={!!daily[i.id]} onToggle={() => toggleDaily(i.id)} />)}
      <span className="eyebrow">Sunday debrief</span>
      {SUNDAY_ITEMS.map((i) => <CheckRow key={i.id} label={i.label} checked={!!weekly[i.id]} onToggle={() => toggleWeekly(i.id)} />)}
    </details>
  )
}
