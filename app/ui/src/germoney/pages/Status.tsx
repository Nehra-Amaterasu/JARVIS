/**
 * Well Wisher → Status: the System's window. Everything here is computed on the
 * server (app/jarvis_app/wellwisher.py) from logged actions only: each stat shows
 * the numbers it came from and how. Rank needs proof (hours, nodes mastered with a
 * finished contract, links), never XP. The System suggests; he decides, so the
 * quest lines are off until he turns one on.
 *
 * QuestCards is also shown on Today: one small session a day, logged set by set.
 */
import { Activity, Check, Dumbbell, Lightbulb, Lock } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api, post } from '../../lib/api'
import { useStore } from '../../lib/store'
import { usePlan, type PlanContract } from '../game/plan'
import { EMPTY, MissionHeader, NeonBar } from '../ui'

export interface Stat { id: string; name: string; value: number; unit?: string; explain: string; inputs: Record<string, number> }
export interface StatusView {
  date: string
  rank: { rank: string; have: Record<string, number>; next: { rank: string; missing: { req: string; name: string; have: number; need: number }[] } | null }
  level: { level: number; into: number; need: number }
  xp: number
  stats: Stat[]
  not_counted: { xp_from_games: number; xp_carried_over: number; nodes_claimed: string[]; explain: string }
  advice: string[]
  domains: { id: string; name: string; status: 'on' | 'off' | 'planned'; why?: string; since?: string | null
    tracks?: { id: string; name: string; level: number; max_level: number; earned: number; start_level: number; level_name: string }[] }[]
  rule: string
}

export function StatusPage() {
  const [view, setView] = useState<StatusView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const toast = useStore((s) => s.toast)
  const load = useCallback(async () => {
    try {
      setView(await api<StatusView>('/api/mission/status'))
      setError(null)
    } catch (e) {
      setError((e as Error).message || 'The System is not answering.')
    }
  }, [])
  useEffect(() => { void load() }, [load])
  const toggle = async (id: string, on: boolean) => {
    try {
      const r = await api<{ ok: boolean; say: string }>(`/api/mission/quest/${id}`, { method: 'PUT', body: { on } })
      toast(r.say, 'live')
    } catch (e) {
      toast((e as Error).message, 'fault')
    }
    await Promise.all([load(), usePlan.getState().refresh()])
  }
  return (
    <div className="mission-page status">
      <MissionHeader n="M14" title="Status" sub={view?.rule ?? 'Every stat moves only with a logged action. The System suggests; you decide.'}
        right={view && <div className="hq-pills"><span className="pill"><i className="led" />Rank {view.rank.rank}</span>
          <span className="pill">Level {view.level.level} · {view.xp} XP</span></div>} />
      {error && <div className="card warn small">The System is not answering ({error}). Your logged work is safe on the server.</div>}
      {!view && !error && <div className="card"><div className="empty">Reading your record…</div></div>}
      {view && <>
        <RankCard view={view} />
        <section className="card status-stats" aria-label="Stats">
          <div className="card-head"><span className="card-title"><Activity size={14} />Stats</span><span className="mono muted small">from logged work, {view.date}</span></div>
          <div className="stat-grid">
            {view.stats.map((s) => (
              <div key={s.id} className="stat" data-stat={s.id}>
                <div className="stat-head"><b>{s.name}</b> <span className="mono stat-value">{s.value}{s.unit ? ` ${s.unit}` : ''}</span></div>
                <p className="small muted stat-explain">{s.explain}</p>
              </div>
            ))}
          </div>
        </section>
        {view.advice.length > 0 && (
          <section className="card status-advice">
            <div className="card-head"><span className="card-title"><Lightbulb size={14} />The System suggests</span></div>
            <ul>{view.advice.map((a) => <li key={a}>{a}</li>)}</ul>
            <p className="small muted">Suggestions only. Nothing changes until you act on one.</p>
          </section>
        )}
        <QuestCards onLogged={load} />
        <section className="card status-domains">
          <div className="card-head"><span className="card-title"><Dumbbell size={14} />Quest lines</span><span className="mono muted small">optional</span></div>
          {view.domains.map((d) => (
            <div key={d.id} className={`domain domain-${d.status}`}>
              <div className="domain-head">
                <b>{d.name}</b> <span className="mono muted small">{d.status}</span>
                {d.status !== 'planned' && (
                  <button className="btn sm ghost" onClick={() => void toggle(d.id, d.status !== 'on')}>{d.status === 'on' ? 'Turn off' : 'Turn on'}</button>
                )}
              </div>
              {d.status === 'planned' && <p className="small muted"><Lock size={12} /> {d.why}</p>}
              {d.tracks && d.status === 'on' && (
                <ul className="small">
                  {d.tracks.map((t) => (
                    <li key={t.id}>{t.name}: level {t.level}/{t.max_level} ({t.level_name}) · earned {t.earned}
                      {t.start_level > 1 ? <span className="muted"> · started at {t.start_level}</span> : null}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
        <section className="card small status-not-counted">
          <div className="card-head"><span className="card-title">Not counted</span></div>
          <p className="muted">{view.not_counted.explain}</p>
          <p className="mono">{view.not_counted.xp_from_games} XP from games · {view.not_counted.xp_carried_over} XP carried over
            {view.not_counted.nodes_claimed.length > 0 && ` · claimed without a contract: ${view.not_counted.nodes_claimed.join(', ')}`}</p>
        </section>
      </>}
    </div>
  )
}

function RankCard({ view }: { view: StatusView }) {
  const nxt = view.rank.next
  return (
    <section className="card status-rank" aria-label="Rank">
      <div className="card-head"><span className="card-title">Rank {view.rank.rank}</span>
        <span className="mono muted small">{nxt ? `next: ${nxt.rank}` : 'top rank'}</span></div>
      {nxt ? (
        <ul className="rank-missing">
          {nxt.missing.map((m) => (
            <li key={m.req}>
              <span className="small">{m.name}: <b className="mono">{m.have}/{m.need}</b></span>
              <NeonBar progress={Math.min(1, m.have / m.need)} />
            </li>
          ))}
        </ul>
      ) : <p className="small">Every requirement met.</p>}
      <p className="small muted">A rank needs proof. XP raises the level, never the rank.</p>
    </section>
  )
}

/** Today's quest contracts (slot 'quest'), each with a set-by-set log. */
export function QuestCards({ onLogged }: { onLogged?: () => void | Promise<void> }) {
  const contracts = usePlan((s) => s.today?.contracts) ?? EMPTY
  const quests = contracts.filter((c) => c.source === 'quest' && c.quest)
  if (!quests.length) return null
  return (
    <section className="card quest-cards" aria-label="Today's quest">
      <div className="card-head"><span className="card-title"><Dumbbell size={14} />Today's quest</span><span className="mono muted small">optional</span></div>
      {quests.map((c) => <QuestCard key={c.key} c={c} onLogged={onLogged} />)}
    </section>
  )
}

function QuestCard({ c, onLogged }: { c: PlanContract; onLogged?: () => void | Promise<void> }) {
  const q = c.quest!
  const toast = useStore((s) => s.toast)
  const [sets, setSets] = useState<string[]>(() => Array.from({ length: q.sets }, () => ''))
  const [proof, setProof] = useState('')
  const [busy, setBusy] = useState(false)
  const unit = q.unit === 'seconds' ? 's' : 'reps'
  const submit = async () => {
    const nums = sets.map((s) => Number(s)).filter((n, i) => sets[i].trim() !== '' && Number.isFinite(n))
    if (!nums.length) { toast('Enter what you did in at least one set.', 'fault'); return }
    setBusy(true)
    try {
      const r = await post<{ ok: boolean; say: string }>(`/api/mission/quest/${q.line}/log`, { track: q.track, sets: nums, proof: proof.trim() })
      toast(r.say, 'live')
      setSets(Array.from({ length: q.sets }, () => ''))
    } catch (e) {
      toast((e as Error).message, 'fault')
    }
    setBusy(false)
    await Promise.all([usePlan.getState().refresh(), onLogged?.()])
  }
  return (
    <article className={`contract quest ${c.done ? 'done' : ''}`} data-quest={c.key}>
      <div className="contract-head">
        {c.done ? <Check size={16} className={c.verified ? 'verified' : 'claimed'} /> : <span className="c-dot" />}
        <span className="c-title"><b>{c.title}</b>
          <span className="mono muted small">{q.track_name} · level {q.level}/{q.max_level} · {c.minutes} min · +{c.xp} XP · {c.why}</span></span>
      </div>
      <div className="contract-body">
        <ol className="small">{c.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        <p className="small muted">{c.hint}</p>
        <div className="quest-sets">
          {sets.map((v, i) => (
            <label key={i} className="small">Set {i + 1}
              <input className="input sm" inputMode="numeric" aria-label={`Set ${i + 1} (${unit})`} value={v}
                onChange={(e) => setSets(sets.map((x, k) => (k === i ? e.target.value.replace(/[^0-9]/g, '') : x)))} placeholder={`${q.target} ${unit}`} />
            </label>
          ))}
          <input className="input sm" placeholder="Link (optional: a video or note)" aria-label="Proof link" value={proof} onChange={(e) => setProof(e.target.value)} />
          <button className="btn sm" disabled={busy} onClick={() => void submit()}>{c.done ? 'Log another session' : 'Log session'}</button>
        </div>
        <p className="small muted">Standard: {q.sets} x {q.target} {unit}. {q.top ? 'Top level.' : `Met on ${q.hits.length} of ${q.hits.length + q.need} days needed for level ${q.level + 1}.`}</p>
      </div>
    </article>
  )
}
