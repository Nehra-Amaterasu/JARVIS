/**
 * Mission → Contracts. Three a day, each from a person, each hyper-specific, each
 * with Intel. The week's operation is chosen here too. Completion always needs
 * proof — a link or photo is drawn as verified (cyan), a note as claimed (amber).
 *
 * The local model can still improvise extra side quests (amber: the model wrote them).
 */
import { BookOpen, ChevronDown, Dices, Lock, Skull, Sparkles, Swords, Target } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../../lib/store'
import { Portrait } from '../game/art'
import { BOSSES } from '../game/campaign'
import { NPCS, npcLine } from '../game/characters'
import type { DailyContract } from '../game/contracts'
import * as E from '../game/engine'
import { IntelCard, TrackTag } from '../game/kit'
import { OPERATION_BY_ID, STAKE, weeklyOffers } from '../game/operations'
import { useGame, useTodayContracts } from '../game/store'
import { hashString, weekStart } from '../game/util'
import { useDailyQuests, type DisplayQuest } from '../hooks'
import { usePlayerStore } from '../stores/player-store'
import { useProofStore } from '../stores/proof-store'
import { MissionHeader, NeonBar, ProofGate, ProofView, confirmDialog, useFx } from '../ui'

export function QuestsPage() {
  const contracts = useTodayContracts()
  const g = useGame((s) => s.g)
  const today = useGame((s) => s.today)
  const done = contracts.filter((c) => g.contracts[c.key]).length
  const next = E.contractsDoneOn(g, today) + 1
  const mult = E.xpMultiplier(g, today)
  return (
    <div className="mission-page">
      <MissionHeader n="M2" title="Contracts" sub="Three a day from the people who decide your year. Proof on every one."
        right={<span className={`pill ${done === contracts.length && contracts.length ? 'live' : ''}`}><i className="led" />{done}/{contracts.length} today</span>} />

      <div className="sec-title"><Swords size={15} /><span>Today</span>
        <em className="mono">next completion pays ×{E.comboMult(next)}{mult !== 1 ? ` · debuff ×${mult}` : ''} · one of today's contracts is secretly critical</em></div>
      {contracts.length === 0 && (
        <section className="card rest-card"><Portrait npc="jarvis" size={56} />
          <div><b>{E.isRestDay(g, today) ? 'Rest day.' : 'Nothing today.'}</b>
            <p className="muted">No contracts on the rest day — doc 09's rule: recover, return stronger. The streak is safe. If you want to work anyway, the Crucible and Drill still pay.</p></div>
        </section>
      )}
      <div className="contract-grid">
        {contracts.map((c) => <ContractCard key={c.key} c={c} />)}
      </div>

      <Operations />
      <Improvised />
    </div>
  )
}

function ContractCard({ c }: { c: DailyContract }) {
  const g = useGame((s) => s.g)
  const today = useGame((s) => s.today)
  const complete = useGame((s) => s.completeContract)
  const reroll = useGame((s) => s.reroll)
  const proof = useProofStore((s) => s.proofs[c.key])
  const toast = useStore((s) => s.toast)
  const [intel, setIntel] = useState(false)
  const [gate, setGate] = useState(false)
  const [showProof, setShowProof] = useState(false)
  const rec = g.contracts[c.key]
  const npc = NPCS[c.def.npc]
  const line = npcLine(c.def.npc, rec ? 'praise' : 'assign', hashString(c.key))
  const activeIds = E.activeBosses(g, today).map((b) => b.id)
  const prepares = BOSSES.find((b) => c.def.bosses?.includes(b.id) && activeIds.includes(b.id))
  return (
    <section className={`card contract ${rec ? 'done' : ''} ${rec?.crit ? 'crit' : ''}`}>
      <div className="ct-head">
        <Portrait npc={c.def.npc} size={58} speaking={!rec} />
        <div className="ct-who"><b>{npc.name}</b><span className="mono muted">{npc.role}</span>
          <p className="ct-line">“{line}”</p></div>
      </div>
      <div className="ct-title display">{c.def.title}</div>
      <p className="ct-task">{c.def.task}</p>
      <div className="ct-chips">
        <TrackTag track={c.def.track} />
        <span className="chip mono">{c.def.minutes} min</span>
        <span className="chip mono">{rec ? `+${rec.xp}` : c.def.xp} XP</span>
        <span className="chip mono">DM {rec ? rec.marks : Math.round(c.def.xp / 2)}</span>
        {prepares && <span className="chip fault-chip"><Skull size={11} />hits {prepares.name}</span>}
        {rec?.crit && <span className="chip sim-chip">CRITICAL ×2</span>}
      </div>
      <button className="ct-intel-btn" onClick={() => setIntel(!intel)}><BookOpen size={12} />Intel<ChevronDown size={13} className={intel ? 'flip' : ''} /></button>
      {intel && <IntelCard intel={c.def.intel} />}
      <div className="quest-foot">
        {rec ? (
          <button className={`pill ${rec.verified ? 'live' : 'sim'}`} onClick={() => setShowProof(!showProof)}><Lock size={10} />{rec.verified ? 'Verified' : 'Claimed'}</button>
        ) : gate ? (
          <button className="btn sm ghost" onClick={() => setGate(false)}>Close</button>
        ) : (
          <>
            <button className="btn sm ghost" disabled={g.marks < E.REROLL_COST || c.def.id === 'exam'} title={`Swap this contract for another (${E.REROLL_COST} DM)`}
              onClick={() => confirmDialog('Reroll contract', `Spend ${E.REROLL_COST} DM to swap "${c.def.title}" for another ${npc.name} contract?`, 'Reroll', () => { if (!reroll(c.key)) toast('Not enough Marks.', 'fault') }, false)}>
              <Dices size={13} />{E.REROLL_COST} DM</button>
            <button className="btn sm primary" onClick={() => setGate(true)}>Complete</button>
          </>
        )}
      </div>
      {gate && !rec && (
        <ProofGate onCancel={() => setGate(false)} onConfirm={(p) => {
          const r = complete(c.key, p)
          setGate(false)
          if (r) toast(`${c.def.title}: +${r.xp} XP · +${r.marks} DM${r.crit ? ' · CRITICAL' : ''}${r.nth > 1 ? ` · combo ×${E.comboMult(r.nth)}` : ''}`, 'live')
        }} />
      )}
      {rec && showProof && proof && <ProofView proof={proof} />}
    </section>
  )
}

/* ------------------------------------------------------------------ weekly operations */
function Operations() {
  const g = useGame((s) => s.g)
  const today = useGame((s) => s.today)
  const choose = useGame((s) => s.chooseOperation)
  const submitProof = useGame((s) => s.submitOperationProof)
  const toast = useStore((s) => s.toast)
  const [proof, setProof] = useState('')
  const week = weekStart(today)
  const op = E.operationProgress(g, week, today)
  const offers = weeklyOffers(week)
  return (
    <>
      <div className="sec-title"><Target size={15} /><span>This week's operation</span><em className="mono">commit to one · stake {STAKE} DM · ends Sunday 23:59</em></div>
      {op ? (
        <section className={`card op-active ${op.st.status}`}>
          <div className="ct-head"><Portrait npc={op.def.npc} size={58} />
            <div className="ct-who"><b>{op.def.title}</b><span className="mono muted">{NPCS[op.def.npc].name} · reward {op.def.reward.xp} XP · {op.def.reward.marks} DM</span>
              <p className="ct-line">{op.def.brief}</p></div></div>
          <NeonBar progress={op.value / op.n} tone={op.done ? 'live' : 'chrome'} />
          <div className="mono muted small">{op.def.goal ? `${op.value} / ${op.n} ${op.def.goal.unit}` : op.done ? 'proof submitted' : 'needs proof'} · stake {op.st.stake ?? 0} DM · {op.st.status}</div>
          {!op.def.goal && !op.done && op.st.status === 'active' && (
            <div className="field-row">
              <input className="field" placeholder="Link to the commit / files, or a short note" value={proof} onChange={(e) => setProof(e.target.value)} />
              <button className="btn sm primary" disabled={proof.trim().length < 4} onClick={() => { submitProof(proof.trim()); setProof('') }}>Submit</button>
            </div>
          )}
        </section>
      ) : (
        <div className="op-offers">
          {offers.map((o) => (
            <section key={o.id} className="card op-offer">
              <div className="ct-head"><Portrait npc={o.npc} size={52} />
                <div className="ct-who"><b>{o.title}</b><span className="mono muted">{NPCS[o.npc].name}</span></div></div>
              <p className="ct-task">{o.brief}</p>
              <div className="ct-chips"><span className="chip mono">+{o.reward.xp} XP</span><span className="chip mono">+{o.reward.marks} DM</span><span className="chip mono">stake {STAKE} DM</span></div>
              <button className="btn sm primary" onClick={() => confirmDialog('Commit to operation', `${o.title}: ${o.brief}\n\nStake ${Math.min(STAKE, g.marks)} DM now. Complete it by Sunday to get the stake back plus +${o.reward.xp} XP and +${o.reward.marks} DM. Fail and the stake is gone.`, 'Commit', () => {
                const err = choose(o.id)
                if (err) toast(err, 'fault')
              }, false)}>Commit</button>
            </section>
          ))}
        </div>
      )}
      {Object.entries(g.operations).filter(([w]) => w < week).slice(-4).reverse().length > 0 && (
        <div className="op-history mono muted small">
          {Object.entries(g.operations).filter(([w]) => w < week).slice(-4).reverse().map(([w, st]) => (
            <span key={w} className={st.status === 'won' ? 'live' : 'fault'}>{w}: {OPERATION_BY_ID[st.chosen ?? '']?.title ?? '—'} · {st.status}</span>
          ))}
        </div>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ improvised by the local model */
function Improvised() {
  const [open, setOpen] = useState(false)
  const { quests, source, error, generate } = useDailyQuests()
  return (
    <>
      <div className="sec-title"><Sparkles size={15} /><span>Improvised side quests</span>
        <em className="mono">written by the local model · amber · pay the standard XP</em>
        <span style={{ flex: 1 }} />
        <button className="btn sm ghost" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && (
        <>
          <div className="row-line">
            <button className="btn sm" disabled={source === 'loading'} onClick={() => void generate()}><Sparkles size={12} />{source === 'loading' ? 'Qwen is writing…' : 'Ask JARVIS to improvise'}</button>
            {error && <span className="muted small">Local AI unavailable ({error}).</span>}
          </div>
          {source === 'ai' && <div className="quest-grid">{quests.map((q) => <SideQuest key={q.id} quest={q} />)}</div>}
        </>
      )}
    </>
  )
}

function SideQuest({ quest }: { quest: DisplayQuest }) {
  const completed = usePlayerStore((s) => s.player.completedQuests.includes(quest.id))
  const completeQuest = usePlayerStore((s) => s.completeQuest)
  const addProof = useProofStore((s) => s.addProof)
  const burst = useFx((s) => s.burst)
  const [gate, setGate] = useState(false)
  return (
    <section className={`card quest ai ${completed ? 'done' : ''}`}>
      <span className="quest-title">{quest.title}</span>
      <p className="quest-desc">{quest.desc}</p>
      <div className="quest-foot"><span className="dot reward">{quest.reward}</span>
        {completed ? <span className="pill sim"><Lock size={10} />Done</span>
          : <button className="btn sm" onClick={() => setGate(!gate)}>{gate ? 'Close' : 'Complete'}</button>}</div>
      {gate && !completed && <ProofGate onCancel={() => setGate(false)} onConfirm={(p) => {
        addProof({ questId: quest.id, type: p.type, value: p.value })
        const xp = parseInt(quest.reward.replace(/[^0-9]/g, ''), 10)
        completeQuest(quest.id, false, Number.isNaN(xp) ? 25 : xp)
        burst(`+${Number.isNaN(xp) ? 25 : xp} XP`, 'sim')
        setGate(false)
      }} />}
    </section>
  )
}

