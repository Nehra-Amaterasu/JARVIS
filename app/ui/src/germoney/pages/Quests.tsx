/**
 * Mission → Quests (quests.tsx). Boss fights, the daily micro-quests, weekly
 * milestones and side quests — every completion behind the proof gate.
 *
 * Daily quests come from the deterministic engine (same day + rank = same quests).
 * "Generate with local AI" asks Qwen on this machine instead; the result is cached
 * for the day and drawn in amber, because the model wrote it.
 */
import { BookOpen, ChevronDown, Crosshair, ExternalLink, Lightbulb, Lock, Skull, Sparkles, Sword, Target } from 'lucide-react'
import { useMemo, useState } from 'react'
import { getQuestHints } from '../data/quest-hints'
import { useDailyQuests, type DisplayQuest } from '../hooks'
import { usePlayerStore, type BossFight } from '../stores/player-store'
import { useProofStore } from '../stores/proof-store'
import { MissionHeader, ProofGate, ProofView, useFx } from '../ui'

type CardQuest = { id: string; title: string; desc: string; reward: string; phase?: string }

const WEEKLY: CardQuest[] = [
  { id: 'wq1', phase: 'Month 1-2', title: 'The Adder Milestone', desc: 'Design a 4-bit Ripple Carry Adder. Simulate all edge cases.', reward: '+200 XP' },
  { id: 'wq2', phase: 'Month 3-4', title: 'The ALU Project', desc: 'Design a Parameterized ALU (Add, Sub, AND, OR) with a self-checking testbench.', reward: '+200 XP' },
  { id: 'wq3', phase: 'Month 5-6', title: 'Traffic Light FSM', desc: 'Design a Moore FSM for a 4-way traffic light intersection.', reward: '+200 XP' },
  { id: 'wq4', phase: 'Month 7-8', title: 'UART Transmitter', desc: 'Implement a UART TX module in Verilog that sends "Hello".', reward: '+300 XP' },
  { id: 'wq5', phase: 'Month 9-10', title: 'SystemVerilog OOP', desc: 'Write a SystemVerilog class to generate randomized packets.', reward: '+300 XP' },
  { id: 'wq6', phase: 'Month 11-12', title: 'RISC-V Datapath', desc: 'Implement the instruction fetch and decode stage of RISC-V.', reward: '+500 XP' },
]
const SIDE: CardQuest[] = [
  { id: 'sq1', title: 'The Gate Gauntlet', desc: 'Solve 5 years of GATE ECE Digital Logic past papers.', reward: 'Interview Stamina' },
  { id: 'sq2', title: 'Open Source Silicon', desc: 'Complete the Tiny Tapeout "Blink an LED" tutorial.', reward: 'Silicon Trait' },
  { id: 'sq3', title: 'University Shortlist', desc: 'Create an Excel sheet mapping TU9 universities, their MS ECE requirements, and deadlines.', reward: 'Application Readiness' },
]

export function QuestsPage() {
  const bosses = usePlayerStore((s) => s.player.bosses)
  const { quests, source, error, generate, useEngine } = useDailyQuests()
  const completed = usePlayerStore((s) => s.player.completedQuests)
  const doneToday = quests.filter((q) => completed.includes(q.id)).length
  return (
    <div className="mission-page">
      <MissionHeader n="M2" title="Quests" sub="Minimum 3 daily quests. Every completion needs proof."
        right={<span className={`pill ${doneToday >= 3 ? 'live' : ''}`}><i className="led" />{doneToday}/{quests.length} today</span>} />

      <div className="sec-title fault"><Skull size={15} /><span>Milestone exams</span><em className="mono">boss fights · +200 XP · deadline by month</em></div>
      <div className="boss-row">
        {bosses.map((b) => <BossCard key={b.id} boss={b} />)}
      </div>

      <div className="sec-title"><Crosshair size={15} /><span>Daily micro-quests</span>
        {source === 'ai' && <span className="pill sim"><Sparkles size={10} />AI · local</span>}
        <span style={{ flex: 1 }} />
        {source === 'ai'
          ? <button className="btn sm ghost" onClick={useEngine}>Use the engine's set</button>
          : <button className="btn sm" disabled={source === 'loading'} onClick={() => void generate()}>
              <Sparkles size={12} />{source === 'loading' ? 'Qwen is writing…' : 'Generate with local AI'}</button>}
      </div>
      {error && <p className="muted small" style={{ margin: '-6px 0 10px' }}>Local AI unavailable ({error}). Showing the engine's quests.</p>}
      <div className="quest-grid">
        {quests.map((q) => <QuestCard key={q.id} quest={q} ai={source === 'ai'} />)}
      </div>

      <div className="sec-title"><Target size={15} /><span>Weekly milestones</span></div>
      <div className="quest-grid">{WEEKLY.map((q) => <QuestCard key={q.id} quest={q} weekly />)}</div>

      <div className="sec-title"><BookOpen size={15} /><span>Side quests</span></div>
      <div className="quest-grid">{SIDE.map((q) => <QuestCard key={q.id} quest={q} />)}</div>
    </div>
  )
}

function QuestCard({ quest, weekly, ai }: { quest: DisplayQuest | CardQuest; weekly?: boolean; ai?: boolean }) {
  const completed = usePlayerStore((s) => s.player.completedQuests.includes(quest.id))
  const completeQuest = usePlayerStore((s) => s.completeQuest)
  const addProof = useProofStore((s) => s.addProof)
  const proof = useProofStore((s) => s.proofs[quest.id])
  const burst = useFx((s) => s.burst)
  const [open, setOpen] = useState(false)
  const [gate, setGate] = useState(false)
  const [showProof, setShowProof] = useState(false)
  const intel = useMemo(() => getQuestHints(quest), [quest.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const phase = 'phase' in quest ? quest.phase : undefined
  return (
    <section className={`card quest ${weekly ? 'weekly' : ''} ${completed ? 'done' : ''} ${ai ? 'ai' : ''}`}>
      <button className="quest-head" onClick={() => setOpen(!open)}>
        <span className="quest-title">{quest.title}</span>
        <ChevronDown size={15} className={open ? 'flip' : ''} />
      </button>
      {phase && <span className="mono muted">[{phase}]</span>}
      <p className={`quest-desc ${open ? '' : 'clamp'}`}>{quest.desc}</p>
      {open && (
        <div className="intel fade-in">
          <span className="eyebrow"><Lightbulb size={11} /> How to crack it</span>
          <ul>{intel.hints.map((h, i) => <li key={i}>{h}</li>)}</ul>
          <span className="eyebrow"><BookOpen size={11} /> Knowledge</span>
          <div className="links">{intel.resources.map((r, i) => (
            <a key={i} href={r.url} target="_blank" rel="noreferrer"><ExternalLink size={11} />{r.label}</a>
          ))}</div>
        </div>
      )}
      <div className="quest-foot">
        <span className="dot reward">{quest.reward}</span>
        {completed
          ? <button className="pill live" onClick={() => setShowProof(!showProof)}><Lock size={10} />Proof locked</button>
          : gate ? <button className="btn sm ghost" onClick={() => setGate(false)}>Close</button>
            : <button className="btn sm primary" onClick={() => setGate(true)}>Complete</button>}
      </div>
      {gate && !completed && (
        <ProofGate onCancel={() => setGate(false)} onConfirm={(p) => {
          addProof({ questId: quest.id, type: p.type, value: p.value })
          // Award what the card promises ("+200 XP"); non-XP rewards ("Silicon
          // Trait") keep the standard 25.
          const xp = parseInt(quest.reward.replace(/[^0-9]/g, ''), 10)
          const award = Number.isNaN(xp) ? 25 : xp
          completeQuest(quest.id, false, award)
          burst(`+${award} XP`)
          setGate(false)
        }} />
      )}
      {completed && showProof && proof && <ProofView proof={proof} />}
    </section>
  )
}

function BossCard({ boss }: { boss: BossFight }) {
  const completeQuest = usePlayerStore((s) => s.completeQuest)
  const addProof = useProofStore((s) => s.addProof)
  const proof = useProofStore((s) => s.proofs[boss.id])
  const fx = useFx()
  const [gate, setGate] = useState(false)
  const [showProof, setShowProof] = useState(false)
  return (
    <section className={`card boss ${boss.completed ? 'done' : ''}`}>
      <div className="boss-name"><Skull size={18} /><span className="display">{boss.name}</span></div>
      <span className="mono muted">Deadline: month {boss.monthDue}</span>
      <p className="small muted">Failure debuff: side quests locked until cleared. Three consecutive failures roll back the phase.</p>
      {boss.completed ? (
        <>
          <button className="pill live" onClick={() => setShowProof(!showProof)}><Lock size={10} />Defeated</button>
          {showProof && proof && <ProofView proof={proof} />}
        </>
      ) : gate ? (
        <ProofGate tone="fault" onCancel={() => setGate(false)} onConfirm={(p) => {
          addProof({ questId: boss.id, type: p.type, value: p.value })
          completeQuest(boss.id, true)
          fx.burst('+200 XP', 'fault')
          fx.boss()
          setGate(false)
        }} />
      ) : (
        <button className="btn sm danger" onClick={() => setGate(true)}><Sword size={13} />Engage</button>
      )}
    </section>
  )
}
