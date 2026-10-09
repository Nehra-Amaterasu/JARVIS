/**
 * Mission → Campaign: the year on one map. Twelve monthly bosses across four acts,
 * today's position, and Season Two on the horizon. Select a boss to see its lore,
 * its deliverable broken into steps, every hit you have landed, and — when the
 * work is done — the kill.
 */
import { CheckSquare, ExternalLink, Skull, Square, Swords } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../lib/store'
import { Sigil } from '../game/art'
import { ACTS, SEASON_TWO, type DatedBoss } from '../game/campaign'
import { CONTRACT_BY_ID } from '../game/contracts'
import * as E from '../game/engine'
import { HpBar } from '../game/kit'
import { useGame } from '../game/store'
import { prettyDate, prettyMonth } from '../game/util'
import { LEVELS } from '../stores/player-store'
import { MissionHeader, ProofGate } from '../ui'

const KIND_LABEL: Partial<Record<E.EventKind, string>> = { contract: 'contract', focus: 'Crucible', floor: 'floor secured', operation: 'operation won', drill: 'drill', log: 'logged' }

export function CampaignPage() {
  const g = useGame((s) => s.g)
  const today = useGame((s) => s.today)
  const flag = useGame((s) => s.flag)
  const bosses = useMemo(() => E.datedBosses(g), [g])
  const current = E.currentBoss(g, today)
  const [sel, setSel] = useState(current.id)
  useEffect(() => flag('campaignSeen'), [flag])
  const boss = bosses.find((b) => b.id === sel) ?? current
  const defeated = bosses.filter((b) => g.bosses[b.id]?.defeatedAt).length

  return (
    <div className="mission-page campaign">
      <MissionHeader n="M3" title="Campaign" sub={`Season One · Year Zero · ${prettyMonth(bosses[0].start)} → ${prettyMonth(bosses[11].start)}`}
        right={<span className="pill"><i className="led" />{defeated} / 12 defeated</span>} />

      <section className="card season-map">
        <div className="acts">
          {ACTS.map((a) => (
            <div key={a.id} className="act">
              <div className="act-head"><span className="mono">ACT {a.id}</span><b>{a.name}</b><span className="muted small">{a.blurb}</span></div>
              <div className="act-nodes">
                {bosses.filter((b) => b.month >= a.months[0] && b.month <= a.months[1]).map((b) => {
                  const st = E.bossState(b, g, today)
                  const isNow = today >= b.start && today <= b.deadline
                  return (
                    <button key={b.id} className={`map-node ${st.status} ${b.id === boss.id ? 'sel' : ''} ${isNow ? 'now' : ''}`} onClick={() => setSel(b.id)}>
                      <Sigil {...b.sigil} size={54} hp={st.hp / st.hpMax} defeated={st.status === 'defeated'} escaped={st.status === 'escaped'} />
                      <span className="mn-month mono">{prettyMonth(b.start)}</span>
                      <span className="mn-name">{b.name.replace(/^The /, '')}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          <div className="act horizon">
            <div className="act-head"><span className="mono">SEASON TWO</span><b>The Gauntlet</b><span className="muted small">Applications. Shown, not fought — yet.</span></div>
            <div className="act-nodes">
              {SEASON_TWO.map((s) => (
                <div key={s.id} className="map-node horizon-node"><span className="mn-month mono">{s.when}</span><span className="mn-name">{s.name.replace(/^The /, '')}</span><span className="muted small">{s.what}</span></div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <BossDetail boss={boss} />
    </div>
  )
}

function BossDetail({ boss }: { boss: DatedBoss }) {
  const g = useGame((s) => s.g)
  const today = useGame((s) => s.today)
  const defeat = useGame((s) => s.defeatBoss)
  const toggle = useGame((s) => s.toggleFlag)
  const toast = useStore((s) => s.toast)
  const [gate, setGate] = useState(false)
  const st = E.bossState(boss, g, today)
  const hits = g.ledger
    .filter((e) => e.date >= boss.start && (!st.defeatedAt || e.date <= st.defeatedAt))
    .map((e) => ({ e, dmg: E.eventDamage(e, boss) }))
    .filter((h) => h.dmg > 0)
    .slice(-12).reverse()
  const reward = E.defeatReward(boss, st.hp, st.hpMax)
  const rankName = boss.reward.rank ? LEVELS.find((l) => l.level === boss.reward.rank)?.rank : null
  const exam = E.examDaysBetween(g, boss.start, boss.deadline)
  const steps = boss.steps.map((s, i) => ({ s, done: !!g.flags[`step:${boss.id}:${i}`], key: `step:${boss.id}:${i}` }))
  return (
    <section className={`card boss-detail ${st.status}`}>
      <div className="bd-hero">
        <Sigil {...boss.sigil} size={168} hp={st.hp / st.hpMax} defeated={st.status === 'defeated'} escaped={st.status === 'escaped'} />
        <div className="bd-id">
          <span className="eyebrow">Month {boss.month} · {boss.epithet}</span>
          <h2 className="display bd-name">{boss.name}</h2>
          <p className="bd-lore">{boss.lore}</p>
          <p className="bd-taunt">“{st.status === 'defeated' ? boss.taunts.defeated : st.status === 'escaped' ? boss.taunts.escaped : boss.taunts.start}”</p>
          <HpBar hp={st.hp} max={st.hpMax} segments={30} />
          <div className="bd-meta mono">
            <span>{st.hp} / {st.hpMax} HP</span>
            <span>{prettyDate(boss.start)} → {prettyDate(boss.deadline, true)}{exam ? ` (+${exam} exam days)` : ''}</span>
            <span className={st.status === 'escaped' ? 'fault' : ''}>{st.status === 'defeated' ? `defeated ${prettyDate(st.defeatedAt!)}${st.ambush ? ' · ambush' : ''}` : st.status === 'escaped' ? 'escaped — still killable' : st.status === 'upcoming' ? 'upcoming' : `${st.daysLeft} days left`}</span>
          </div>
        </div>
      </div>

      <div className="bd-grid">
        <div>
          <span className="eyebrow"><Skull size={11} /> The kill — deliverable</span>
          <p className="bd-deliverable">{boss.deliverable}</p>
          <span className="eyebrow">Steps</span>
          <div className="bd-steps">
            {steps.map((x, i) => (
              <button key={x.key} className={`bd-step ${x.done ? 'done' : ''}`} onClick={() => toggle(x.key)}>
                {x.done ? <CheckSquare size={15} /> : <Square size={15} />}<span>{i + 1}. {x.s}</span>
              </button>
            ))}
          </div>
          <span className="eyebrow">Why it matters</span>
          <p className="muted">{boss.why}</p>
          <div className="links">{boss.resources.map((r) => <a key={r.url} href={r.url} target="_blank" rel="noreferrer"><ExternalLink size={11} />{r.label}</a>)}</div>
        </div>
        <div>
          <span className="eyebrow"><Swords size={11} /> Hits landed</span>
          {hits.length === 0 ? <p className="muted small">Nothing yet. Contracts on this boss's track, Crucible time, drill sessions and every secured day chip its HP.</p> : (
            <div className="hit-log">{hits.map(({ e, dmg }, i) => (
              <div key={i} className="hit"><span className="dot fault">−{dmg}</span><span>{KIND_LABEL[e.kind] ?? e.kind}{e.kind === 'contract' && e.ref ? ` · ${CONTRACT_BY_ID[e.ref]?.title ?? e.ref}` : e.kind === 'focus' ? ` · ${e.amount} min` : ''}</span><span className="mono muted">{prettyDate(e.date)}</span></div>
            ))}</div>
          )}
          <span className="eyebrow" style={{ marginTop: 14 }}>Reward</span>
          <p className="bd-reward mono">+{reward.xp} XP · +{reward.marks} DM · title “{boss.reward.title}”{rankName ? ` · rank ${boss.reward.rank}: ${rankName}` : ''}{reward.ambush && st.status !== 'defeated' ? ' · AMBUSH bonus active (+20%)' : ''}</p>
          {st.status === 'active' || st.status === 'escaped' ? (
            gate ? (
              <ProofGate tone="fault" onCancel={() => setGate(false)} onConfirm={(p) => {
                const r = defeat(boss.id, p)
                setGate(false)
                if (!r) toast('That boss cannot be fought right now.', 'fault')
              }} />
            ) : <button className="btn danger" onClick={() => setGate(true)}><Skull size={14} />Deliver the kill — {boss.proofHint}</button>
          ) : st.status === 'upcoming' ? <p className="muted small">Arrives {prettyDate(boss.start, true)}. You can study ahead — damage counts from its first day.</p>
            : <span className="pill live"><i className="led" />Defeated</span>}
        </div>
      </div>
    </section>
  )
}
