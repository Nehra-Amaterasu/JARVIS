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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, post } from '../../lib/api'
import { useStore } from '../../lib/store'
import { usePlan, type PlanContract } from '../game/plan'
import { EMPTY, MissionHeader } from '../ui'
import './status-career.css'

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
      {view && (
        <div className="status-grid">
          <div className="status-main">
            <RankCard view={view} />
            <StatsCard view={view} />
            <QuestCards onLogged={load} />
          </div>
          <aside className="status-side">
            {view.advice.length > 0 && (
              <section className="card status-advice">
                <div className="card-head"><span className="card-title"><Lightbulb size={14} />The System suggests</span></div>
                <ul>{view.advice.map((a) => <li key={a}>{a}</li>)}</ul>
                <p className="small muted">Suggestions only. Nothing changes until you act on one.</p>
              </section>
            )}
            <section className="card status-domains">
              <div className="card-head"><span className="card-title"><Dumbbell size={14} />Quest lines</span><span className="mono muted small">optional</span></div>
              {view.domains.map((d) => (
                <div key={d.id} className={`domain domain-${d.status}`}>
                  <div className="domain-head">
                    <b className="domain-name" title={d.name}>{d.name}</b>
                    <span className={`domain-state mono ${d.status}`}>{d.status}</span>
                    {d.status !== 'planned' && (
                      <button className="btn sm ghost" onClick={() => void toggle(d.id, d.status !== 'on')}>{d.status === 'on' ? 'Turn off' : 'Turn on'}</button>
                    )}
                  </div>
                  {d.status === 'planned' && d.why && <p className="small muted domain-why"><Lock size={11} /> {d.why}</p>}
                  {d.tracks && d.status === 'on' && d.tracks.length > 0 && (
                    <ul className="domain-tracks small">
                      {d.tracks.map((t) => (
                        <li key={t.id} title={`${t.name}: ${t.level_name}`}>
                          <span className="dt-name">{t.name}</span>
                          <span className="mono">{t.level}/{t.max_level}</span>
                          <span className="muted dt-level">{t.level_name} · earned {t.earned}{t.start_level > 1 ? ` · started at ${t.start_level}` : ''}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </section>
            <details className="card small status-not-counted">
              <summary><span className="card-title">Not counted</span>
                <span className="mono muted">{view.not_counted.xp_from_games + view.not_counted.xp_carried_over} XP</span></summary>
              <p className="muted">{view.not_counted.explain}</p>
              <p className="mono">{view.not_counted.xp_from_games} XP from games · {view.not_counted.xp_carried_over} XP carried over
                {view.not_counted.nodes_claimed.length > 0 && ` · claimed without a contract: ${view.not_counted.nodes_claimed.join(', ')}`}</p>
            </details>
          </aside>
        </div>
      )}
    </div>
  )
}

/** The System window: the rank big and calm, the level as one thin line, and what the next rank still needs. */
function RankCard({ view }: { view: StatusView }) {
  const nxt = view.rank.next
  const lv = view.level
  const met = nxt ? nxt.missing.filter((m) => m.have >= m.need).length : 0
  return (
    <section className="card status-rank" aria-label="Rank">
      <div className="sw-rank">
        <span className="eyebrow">Rank</span>
        <span className="sw-dial">
          <DotRing progress={lv.need ? lv.into / lv.need : 0} />
          <b className="sw-letter">{view.rank.rank}</b>
        </span>
        <span className="sw-level mono"><b>LV {lv.level}</b> · {lv.into}/{lv.need} XP to {lv.level + 1}</span>
      </div>
      <div className="sw-next">
        <div className="sw-next-head"><span className="eyebrow">{nxt ? `Next: rank ${nxt.rank}` : 'Top rank'}</span>
          {nxt && <span className="mono muted small">{met}/{nxt.missing.length} met</span>}</div>
        {nxt ? (
          <ul className="rank-missing">
            {nxt.missing.map((m) => {
              const done = m.have >= m.need
              return (
                <li key={m.req} className={done ? 'met' : ''}>
                  <span className="rm-box" aria-hidden>{done ? <Check size={12} strokeWidth={2.6} /> : null}</span>
                  <span className="rm-text" title={m.name}>{m.name}: <b className="mono">{m.have}/{m.need}</b></span>
                  <DotMeter progress={m.need ? m.have / m.need : 1} />
                </li>
              )
            })}
          </ul>
        ) : <p className="small">Every requirement met.</p>}
        <p className="small muted sw-rule">A rank needs proof. XP raises the level, never the rank.</p>
      </div>
    </section>
  )
}

/**
 * The level as a ring of 40 dots around the rank letter, Nothing-glyph style: lit dots
 * are XP into this level. Static SVG, so it costs one paint; no animation of its own.
 */
const RING = 40
const RING_DOTS = Array.from({ length: RING }, (_, i) => {
  const a = (i / RING) * Math.PI * 2 - Math.PI / 2
  return { x: 60 + Math.cos(a) * 54, y: 60 + Math.sin(a) * 54 }
})
function DotRing({ progress }: { progress: number }) {
  const lit = Math.round(Math.max(0, Math.min(1, progress)) * RING)
  return (
    <svg className="sw-ring" viewBox="0 0 120 120" aria-hidden>
      {RING_DOTS.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={i < lit ? 2.4 : 1.6} className={i < lit ? 'lit' : ''} />)}
    </svg>
  )
}

/** Progress as twelve dots (lit = done), the dot-matrix twin of a bar. */
function DotMeter({ progress, n = 12 }: { progress: number; n?: number }) {
  const lit = Math.round(Math.max(0, Math.min(1, progress)) * n)
  return <span className="dot-meter" aria-hidden>{Array.from({ length: n }, (_, i) => <i key={i} className={i < lit ? 'lit' : ''} />)}</span>
}

/** Stat tiles: the value at a glance, how it was computed one tap away. */
function StatsCard({ view }: { view: StatusView }) {
  return (
    <section className="card status-stats" aria-label="Stats">
      <div className="card-head"><span className="card-title"><Activity size={14} />Stats</span><span className="mono muted small">from logged work, {view.date}</span></div>
      <div className="stat-grid">
        {view.stats.map((s, i) => (
          <details key={s.id} className="stat" data-stat={s.id}>
            <summary>
              <span className="stat-name eyebrow" title={s.name}><i className="mono">{String(i + 1).padStart(2, '0')}</i>{s.name}</span>
              <span className="stat-value"><b>{s.value}</b>{s.unit && <em className="mono">{s.unit}</em>}</span>
              <span className="stat-how mono">how</span>
            </summary>
            <p className="small muted stat-explain">{s.explain}</p>
          </details>
        ))}
      </div>
    </section>
  )
}

/** Today's quest contracts (slot 'quest'), each with a set-by-set log. */
export function QuestCards({ onLogged }: { onLogged?: () => void | Promise<void> }) {
  const contracts = usePlan((s) => s.today?.contracts) ?? EMPTY
  const quests = useMemo(() => contracts.filter((c) => c.source === 'quest' && c.quest), [contracts])
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
