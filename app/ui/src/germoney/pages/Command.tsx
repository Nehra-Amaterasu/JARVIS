/**
 * Mission → HQ. The game's home: who you are (level, rank, streak, Marks), what
 * today needs (the Floor), what it pays (the supply drop), and what is hunting
 * you (this month's boss). Everything the phone app's dashboard did is still here
 * — Rule 1, the heatmap, the Sunday ritual, backup/restore — below the fold.
 *
 * Design reasons: docs/design/mission-game.md.
 */
import { Box, Calendar, ChevronRight, Download, Dumbbell, Flame, Languages, Lock, Mic, ShieldAlert, Swords, Upload, Zap } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { post, TOKEN } from '../../lib/api'
import { useStore } from '../../lib/store'
import { Portrait, Sigil } from '../game/art'
import { NPCS } from '../game/characters'
import { CARD_BY_ID } from '../game/decks'
import * as E from '../game/engine'
import { HpBar, Marks, Radar, Shields, StreakFlame, TrackTag, XpRing } from '../game/kit'
import { weeklyOffers } from '../game/operations'
import { gameBrief, useGame, useTodayContracts } from '../game/store'
import { daysBetween, prettyDate, weekStart } from '../game/util'
import { useGithub, useOnboarding } from '../hooks'
import { DAILY_ITEMS, SUNDAY_ITEMS, useChecklistStore } from '../stores/checklist-store'
import { LEVELS, usePlayerStore } from '../stores/player-store'
import { BurnHeatmap, CheckRow, confirmDialog, daysSince, MissionHeader, NeonBar } from '../ui'
import { Calibration } from './Calibration'

const REP_ICON = { silicon: Zap, deutsch: Languages, body: Dumbbell } as const

export function CommandPage() {
  const [onboarding, reloadOnboarding] = useOnboarding()
  const g = useGame((s) => s.g)
  const today = useGame((s) => s.today)
  const player = usePlayerStore((s) => s.player)
  const setTab = useStore((s) => s.setTab)
  const contracts = useTodayContracts()

  if (onboarding === undefined) return <div className="empty">Loading…</div>
  if (onboarding === null) return <Calibration onDone={reloadOnboarding} />

  const lv = E.levelInfo(player.xp)
  const rank = LEVELS.find((l) => l.level === player.level) ?? LEVELS[0]
  const streak = E.streakInfo(g, today)
  const mode = E.modeOn(g, today)
  const dayN = Math.max(1, daysBetween(g.firstPlay, today) + 1)

  return (
    <div className="mission-page hq">
      <MissionHeader n="M1" title="HQ" sub={`Season One · Year Zero · day ${dayN} · ${onboarding.goal.label}`}
        right={<div className="hq-pills">
          {mode === 'exam' && <span className="pill sim"><i className="led" />Exam mode</span>}
          {mode === 'recovery' && <span className="pill sim"><i className="led" />Recovery</span>}
          <span className={`pill ${player.isPurgatoryActive ? 'fault' : streak.todaySecured ? 'live' : ''}`}><i className="led" />
            {player.isPurgatoryActive ? 'Purgatory' : streak.todaySecured ? 'Floor secured' : E.isRestDay(g, today) ? 'Rest day' : 'Floor open'}</span>
        </div>} />

      <div className="hq-grid">
        {/* ---------------------------------------------------------------- operative */}
        <section className="card operative">
          <XpRing level={lv.level} progress={lv.progress} />
          <div className="op-id">
            <span className="eyebrow">Operative · Rank {player.level} / 10 · {rank.phase}</span>
            <div className="display op-name"><span className="chrome-text">Aman</span></div>
            <div className="op-rank">{rank.rank}</div>
            <div className="op-xp mono">{lv.into.toLocaleString()} / {lv.need.toLocaleString()} XP to level {lv.level + 1}</div>
            <NeonBar progress={lv.progress} />
          </div>
          <div className="op-stats">
            <div><StreakFlame n={streak.current} kept={streak.todayKept} /><span className="eyebrow">Streak · best {streak.best}</span></div>
            <div><Shields n={g.shields} /><span className="eyebrow">Shields</span></div>
            <div><Marks n={g.marks} /><span className="eyebrow">Marks</span></div>
            <div><span className="dot">{E.momentum(g, today)}</span><span className="eyebrow">Momentum</span></div>
          </div>
          <Handler />
        </section>

        <BossMini />

        <FloorCard />

        {/* ---------------------------------------------------------------- today's contracts */}
        <section className="card hq-contracts">
          <div className="card-head"><span className="card-title"><Swords size={14} />Today's contracts</span>
            <button className="link-btn" onClick={() => setTab('quests')}>Open <ChevronRight size={13} /></button></div>
          {contracts.length === 0 && <p className="muted small">{E.isRestDay(g, today) ? 'Rest day. No contracts — recover. The streak is safe.' : 'No contracts today.'}</p>}
          {contracts.map((c) => {
            const done = !!g.contracts[c.key]
            return (
              <button key={c.key} className={`hq-contract ${done ? 'done' : ''}`} onClick={() => setTab('quests')}>
                <Portrait npc={c.def.npc} size={40} />
                <span className="hc-body"><span className="hc-title">{c.def.title}</span>
                  <span className="mono muted">{NPCS[c.def.npc].name} · {c.def.minutes} min · {c.def.xp} XP</span></span>
                <TrackTag track={c.def.track} />
              </button>
            )
          })}
        </section>

        <OperationMini />
        <BootCamp />

        {/* ---------------------------------------------------------------- attributes + investment */}
        <section className="card attrs">
          <div className="card-head"><span className="card-title">Attributes · last 28 days</span></div>
          <Attributes />
        </section>
        <Investment />

        <RuleOne />
        <section className="card span2"><HeatmapCard /></section>
        <Rituals />
        <SystemCard />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ handler (JARVIS) */
function Handler() {
  const g = useGame((s) => s.g)
  const today = useGame((s) => s.today)
  const logBrief = useGame((s) => s.logBrief)
  const core = useStore((s) => s.core)
  const toast = useStore((s) => s.toast)
  const brief = useMemo(() => gameBrief(), [g, today]) // eslint-disable-line react-hooks/exhaustive-deps
  const speak = async () => {
    logBrief()
    if (core?.running) {
      try {
        await post('/api/core/speak', { text: brief.text })
        toast('JARVIS is briefing you.', 'live')
        return
      } catch { /* fall through to text */ }
    }
    toast('JARVIS is asleep — here is the brief in text.', 'info')
  }
  return (
    <div className="handler">
      <Portrait npc="jarvis" size={46} />
      <p className="handler-line">{brief.text}</p>
      <button className="btn sm" onClick={() => void speak()} title="JARVIS reads the brief aloud"><Mic size={13} />Brief me</button>
    </div>
  )
}

/* ------------------------------------------------------------------ the boss of the month */
function BossMini() {
  const g = useGame((s) => s.g)
  const today = useGame((s) => s.today)
  const setTab = useStore((s) => s.setTab)
  const b = E.currentBoss(g, today)
  const st = E.bossState(b, g, today)
  const taunt = st.status === 'defeated' ? b.taunts.defeated : st.status === 'escaped' ? b.taunts.escaped : st.hp < st.hpMax * 0.35 ? b.taunts.low : st.hp < st.hpMax ? b.taunts.hurt : b.taunts.start
  return (
    <section className={`card boss-mini ${st.status}`}>
      <Sigil {...b.sigil} size={104} hp={st.hp / st.hpMax} defeated={st.status === 'defeated'} escaped={st.status === 'escaped'} />
      <div className="bm-body">
        <span className="eyebrow">{st.status === 'upcoming' ? `Arrives ${prettyDate(b.start)}` : st.status === 'defeated' ? 'Defeated' : st.status === 'escaped' ? 'Escaped — still standing' : `Boss of the month · ${st.daysLeft} days left`}</span>
        <div className="display bm-name">{b.name}</div>
        <p className="bm-taunt">“{taunt}”</p>
        <HpBar hp={st.hp} max={st.hpMax} />
        <div className="bm-foot mono"><span>{st.hp} / {st.hpMax} HP</span>
          <button className="link-btn" onClick={() => setTab('campaign')}>Campaign <ChevronRight size={13} /></button></div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ the floor + supply drop */
function FloorCard() {
  const g = useGame((s) => s.g)
  const today = useGame((s) => s.today)
  const markRep = useGame((s) => s.markRep)
  const unmarkRep = useGame((s) => s.unmarkRep)
  const mode = E.modeOn(g, today)
  const rest = E.isRestDay(g, today)
  const day = g.days[today]
  const secured = E.isSecured(g, today)
  const needed = mode === 'exam' ? ['silicon'] : E.REPS
  return (
    <section className={`card floor-card span2 ${secured ? 'secured' : ''}`}>
      <div className="card-head">
        <span className="card-title"><Flame size={14} />The Floor{mode === 'exam' ? ' · exam mode' : mode === 'recovery' ? ' · recovery (any one rep)' : ''}</span>
        <span className="mono muted">{secured ? 'secured — the streak lives' : rest ? 'rest day — optional' : 'three reps · ~45 min · resets 00:00'}</span>
      </div>
      <div className="floor-row">
        {E.REPS.map((r) => {
          const mark = day?.reps[r]
          const Icon = REP_ICON[r]
          const dim = !needed.includes(r)
          return (
            <button key={r} className={`rep-tile ${mark ? (mark.verified ? 'verified' : 'claimed') : 'open'} ${dim ? 'dim' : ''}`}
              onClick={() => (mark ? (!mark.verified && !secured ? unmarkRep(r) : undefined) : markRep(r, 'manual', false))}
              title={mark ? (mark.verified ? 'Verified by the app' : secured ? 'Claimed' : 'Claimed — click to undo') : 'Tap to claim it done (drawn amber). Doing it through the Crucible, Drill or a contract marks it verified.'}>
              <Icon size={22} />
              <span className="rt-label">{mode === 'exam' && r === 'silicon' ? 'Exam study' : E.REP_LABEL[r]}</span>
              <span className="rt-state mono">{mark ? (mark.verified ? `verified · ${mark.source.replace(/^contract:.*/, 'contract')}` : `claimed · ${mark.source}`) : 'open'}</span>
              <span className="rt-hint">{E.REP_HINT[r]}</span>
            </button>
          )
        })}
        <SupplyDrop />
      </div>
    </section>
  )
}

function SupplyDrop() {
  const g = useGame((s) => s.g)
  const today = useGame((s) => s.today)
  const openChest = useGame((s) => s.openChest)
  const [justOpened, setJustOpened] = useState(false)
  const secured = E.isSecured(g, today)
  const loot = g.chests[today]
  if (!secured) {
    return (<div className="crate locked"><Lock size={22} /><span className="rt-label">Supply drop</span><span className="rt-hint">Secure the floor to open today's crate.</span></div>)
  }
  if (!loot) {
    return (
      <button className="crate ready" onClick={() => { if (openChest()) setJustOpened(true) }}>
        <Box size={26} /><span className="rt-label">Open supply drop</span><span className="rt-hint">Marks, sometimes a shield or a booster, always one piece of Intel.</span>
      </button>
    )
  }
  const card = CARD_BY_ID[loot.card]
  return (
    <div className={`crate opened ${justOpened ? 'pop' : ''} ${loot.legendary ? 'legendary' : ''}`}>
      <span className="eyebrow">{loot.legendary ? 'Legendary drop' : "Today's drop"}</span>
      <div className="loot"><Marks n={loot.marks} />{loot.shield && <span className="pill live">+1 shield</span>}{loot.booster && <span className="pill">+1 booster</span>}</div>
      {card && <div className="loot-intel"><span className="eyebrow">Intel</span><b>{card.front}</b><span>{card.back}</span></div>}
    </div>
  )
}

/* ------------------------------------------------------------------ weekly operation */
function OperationMini() {
  const g = useGame((s) => s.g)
  const today = useGame((s) => s.today)
  const setTab = useStore((s) => s.setTab)
  const week = weekStart(today)
  const op = E.operationProgress(g, week, today)
  return (
    <section className={`card op-mini ${op?.st.status ?? ''}`}>
      <div className="card-head"><span className="card-title"><Calendar size={14} />This week's operation</span>
        <button className="link-btn" onClick={() => setTab('quests')}>{op ? 'Details' : 'Choose'} <ChevronRight size={13} /></button></div>
      {op ? (
        <>
          <div className="om-title"><Portrait npc={op.def.npc} size={34} /><b>{op.def.title}</b>{op.st.status === 'won' && <span className="pill live">won</span>}</div>
          <p className="muted small">{op.def.brief}</p>
          <NeonBar progress={op.value / op.n} tone={op.done ? 'live' : 'chrome'} />
          <div className="mono muted small">{op.value} / {op.n} {op.def.goal?.unit ?? ''} · stake {op.st.stake ?? 0} DM · ends Sunday</div>
        </>
      ) : (
        <>
          <p className="muted small">Commit to one of this week's three operations. Stake 50 DM — win it back plus the reward.</p>
          <div className="om-offers">{weeklyOffers(week).map((o) => <span key={o.id} className="chip"><TrackTag track={o.track} />{o.title}</span>)}</div>
        </>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ boot camp */
function BootCamp() {
  const g = useGame((s) => s.g)
  const today = useGame((s) => s.today)
  const claim = useGame((s) => s.claimBoot)
  const b = E.bootDay(g, today)
  if (!b) return null
  return (
    <section className="card boot">
      <div className="card-head"><span className="card-title">Boot Camp · day {b.n} of 7</span><span className="mono muted">+40 XP · +30 DM</span></div>
      <div className="boot-dots">{Array.from({ length: 7 }, (_, i) => <i key={i} className={i < b.n - 1 || b.claimed ? 'on' : i === b.n - 1 ? 'now' : ''} />)}</div>
      <div className="boot-task"><Portrait npc="jarvis" size={34} /><div><b>{b.day.title}</b><p className="muted small">{b.day.task}</p></div></div>
      {b.claimed ? <span className="pill live"><i className="led" />Done</span>
        : <button className="btn sm primary" disabled={!b.done} onClick={() => claim()}>{b.done ? 'Claim reward' : 'Detected automatically when you do it'}</button>}
    </section>
  )
}

/* ------------------------------------------------------------------ attributes */
function Attributes() {
  const g = useGame((s) => s.g)
  const today = useGame((s) => s.today)
  const a = E.attributes(g, today)
  const rows: [keyof typeof a, string][] = [['SIL', 'Silicon hours vs target'], ['DEU', 'German hours vs target'], ['VIT', 'Training days vs target'], ['CAP', 'Career & paperwork actions'], ['WIL', 'Days the system was honoured']]
  return (
    <div className="attr-wrap">
      <Radar values={a} />
      <div className="attr-rows">
        {rows.map(([k, label]) => (
          <div key={k} className="attr-row"><span className="mono">{k}</span><NeonBar progress={a[k] / 100} tone={a[k] >= 70 ? 'live' : 'chrome'} /><span className="dot small">{a[k]}</span><span className="muted small">{label}</span></div>
        ))}
      </div>
    </div>
  )
}

function Investment() {
  const g = useGame((s) => s.g)
  const inv = E.investment(g)
  return (
    <section className="card invest">
      <span className="eyebrow">Invested so far</span>
      <div className="metrics">
        {[{ v: `${inv.hours}h`, l: 'Hours' }, { v: inv.contracts, l: 'Contracts' }, { v: inv.days, l: 'Days secured' }, { v: inv.bosses, l: 'Bosses' }, { v: inv.cards, l: 'Cards' }]
          .map((m) => <div key={m.l}><span className="dot">{m.v}</span><span className="eyebrow">{m.l}</span></div>)}
      </div>
      <p className="muted small">{inv.hours > 0 ? `Walking away now abandons ${inv.hours} hours of work.` : 'Every hour you put in shows up here — and stays.'}</p>
    </section>
  )
}

/* ------------------------------------------------------------------ Rule 1, heatmap, rituals (from the phone app) */
function RuleOne() {
  const player = usePlayerStore((s) => s.player)
  const { summary } = useGithub()
  const since = daysSince(player.lastCommitDate) ?? 14
  const remaining = Math.max(0, 14 - since)
  const warn = remaining <= 3
  return (
    <section className={`card ${warn ? 'warn' : ''}`}>
      <div className="card-head"><span className="card-title"><ShieldAlert size={14} />Rule 1 · GitHub integrity</span>
        {summary && <span className="pill live"><i className="led" />github</span>}</div>
      <div className={`dot big ${warn ? 'fault' : ''}`}>{player.lastCommitDate ? `${remaining} days left` : 'No commits logged'}</div>
      <p className="muted small">14 days without a commit drops your rank by 1 and locks you in Purgatory.
        {summary ? ` Last public push: ${summary.lastContribution ?? '—'}.` : ' Link GitHub in Proof for automatic tracking.'}</p>
    </section>
  )
}

function HeatmapCard() {
  const { summary } = useGithub()
  return <BurnHeatmap github={summary} />
}

function Rituals() {
  const daily = useChecklistStore((s) => s.daily)
  const weekly = useChecklistStore((s) => s.weekly)
  const toggleDaily = useChecklistStore((s) => s.toggleDaily)
  const toggleWeekly = useChecklistStore((s) => s.toggleWeekly)
  return (
    <>
      <section className="card">
        <div className="card-head"><span className="card-title">Overdrive · stretch directives</span><span className="mono muted">optional · resets 00:00</span></div>
        <p className="muted small">The original heroic day. Not required — the Floor keeps the streak. Do these on strong days.</p>
        {DAILY_ITEMS.map((i) => <CheckRow key={i.id} label={i.label} checked={!!daily[i.id]} onToggle={() => toggleDaily(i.id)} />)}
      </section>
      <section className="card">
        <div className="card-head"><span className="card-title">Sunday debrief</span><span className="mono muted">resets weekly</span></div>
        {SUNDAY_ITEMS.map((i) => <CheckRow key={i.id} label={i.label} checked={!!weekly[i.id]} onToggle={() => toggleWeekly(i.id)} />)}
      </section>
    </>
  )
}

function SystemCard() {
  const resetProgress = usePlayerStore((s) => s.resetProgress)
  const setTab = useStore((s) => s.setTab)
  const toast = useStore((s) => s.toast)
  const importRef = useRef<HTMLInputElement>(null)
  const exportData = () => {
    void fetch('/api/germoney/export', { headers: { 'X-Jarvis-Token': TOKEN } })
      .then((r) => r.blob())
      .then((b) => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(b)
        a.download = `mission-germoney-${new Date().toISOString().slice(0, 10)}.json`
        a.click()
        URL.revokeObjectURL(a.href)
      })
  }
  const importData = async (f: File) => {
    try {
      const data = JSON.parse(await f.text())
      confirmDialog('Import backup', `Replace Mission data with the ${Object.keys(data).length} record(s) in ${f.name}?`, 'Import', async () => {
        const r = await post<{ imported: number }>('/api/germoney/import', data)
        toast(`Imported ${r.imported} record(s). Reloading…`, 'live')
        window.setTimeout(() => window.location.reload(), 900)
      }, false)
    } catch {
      toast('That file is not a Mission Germoney backup.', 'fault')
    }
  }
  return (
    <section className="card span2 system-card">
      <div className="danger-row">
        <button className="btn sm" onClick={exportData}><Download size={13} />Backup</button>
        <button className="btn sm" onClick={() => importRef.current?.click()}><Upload size={13} />Restore</button>
        <input ref={importRef} type="file" accept="application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importData(f); e.target.value = '' }} />
        <button className="btn sm ghost" onClick={() => setTab('armory')}>Settings & modes</button>
        <span style={{ flex: 1 }} />
        <button className="btn sm ghost" onClick={() => setTab('calibration')}>Recalibrate</button>
        <button className="btn sm danger" onClick={() => confirmDialog('Factory reset', 'Wipe ALL Mission progress — rank, XP, the game, quests, logs, workouts, failures, proofs? (Daily backups in app/data/germoney/backups still exist.)', 'Wipe it', () => { resetProgress(); toast('Mission progress wiped. Reloading…', 'fault'); window.setTimeout(() => window.location.reload(), 900) })}>Factory reset</button>
      </div>
    </section>
  )
}
