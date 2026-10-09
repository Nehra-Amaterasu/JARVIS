/**
 * Mission → Proof (social-proof.tsx): evidence of work. Your public GitHub activity
 * (also feeds Rule 1 automatically), recent repositories, and build-in-public post
 * drafts written ONLY from your real numbers — by the local model (amber) or by the
 * deterministic template when it can't.
 */
import { Check, Copy, ExternalLink, GitBranch, RefreshCw, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { post } from '../../lib/api'
import { useStore } from '../../lib/store'
import { useGithub } from '../hooks'
import { LEVELS, usePlayerStore } from '../stores/player-store'
import { BurnHeatmap, MissionHeader } from '../ui'

interface Post { platform: string; text: string }

export function ProofPage() {
  const player = usePlayerStore((s) => s.player)
  const { user, summary, error, loading, refresh, link } = useGithub()
  const toast = useStore((s) => s.toast)
  const [name, setName] = useState('')
  const [posts, setPosts] = useState<{ list: Post[]; ai: boolean } | null>(null)
  const [drafting, setDrafting] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)

  const info = LEVELS.find((l) => l.level === player.level) ?? LEVELS[0]
  const days28 = (summary?.days ?? []).filter((d) => Date.now() - new Date(d.date).getTime() < 28 * 86_400_000)
  const stats = {
    rank: info.rank, level: player.level, requirement: info.req, streak: summary?.currentStreak ?? 0,
    contributions: summary?.total ?? player.commitsCount, activeDays: days28.length,
    repoNames: (summary?.repos ?? []).filter((r) => !r.fork).slice(0, 5).map((r) => r.name),
    quests: player.completedQuests.length, staminaHours: player.staminaHours, germanHours: player.germanHours,
  }
  const fallback = (): Post[] => {
    const repos = stats.repoNames.slice(0, 3).join(', ') || 'private work'
    return [
      { platform: 'LINKEDIN', text: `Progress report on the road to a VLSI Master's in Germany.\n\nRank ${stats.level} — ${stats.rank}. ${stats.contributions} commits in recent public activity, a ${stats.streak}-day streak, ${stats.activeDays} active days in the last 28. ${stats.quests} quests completed, ${stats.staminaHours}h of deep work and ${stats.germanHours}h of German study logged.\n\nCurrent objective: ${stats.requirement}\n\nActive repositories: ${repos}. Building in public — the commit log is the résumé.` },
      { platform: 'X', text: `Rank ${stats.level} — ${stats.rank}. ${stats.streak}-day streak, ${stats.quests} quests down, ${stats.germanHours}h German. Next: ${stats.requirement.slice(0, 90)}. Building in public.` },
      { platform: 'COMMIT', text: `feat(rank-${stats.level}): ${stats.streak}d streak, ${stats.contributions} commits, ${stats.quests} quests cleared` },
    ]
  }
  const draft = async () => {
    setDrafting(true)
    try {
      const r = await post<{ posts: Post[] }>('/api/germoney/ai/posts', stats)
      setPosts({ list: r.posts, ai: true })
    } catch {
      setPosts({ list: fallback(), ai: false })
    } finally {
      setDrafting(false)
    }
  }
  return (
    <div className="mission-page">
      <MissionHeader n="M12" title="Proof" sub="Evidence of work. The commit log is the résumé." />
      <div className="germany-grid">
        <section className="card">
          <div className="card-head"><span className="card-title"><GitBranch size={14} style={{ marginRight: 8 }} />GitHub</span>
            {user && <button className="btn sm ghost icon" aria-label="Refresh GitHub" onClick={refresh}><RefreshCw size={13} className={loading ? 'spin' : ''} /></button>}</div>
          {!user ? (
            <form className="gate-row" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void link(name.trim()) }}>
              <input className="field" placeholder="GitHub username" value={name} onChange={(e) => setName(e.target.value)} />
              <button className="btn primary">Link</button>
            </form>
          ) : (
            <>
              <div className="metrics">
                <div><span className="dot">{summary?.currentStreak ?? '—'}</span><span className="eyebrow">Streak</span></div>
                <div><span className="dot">{summary?.total ?? '—'}</span><span className="eyebrow">Recent commits</span></div>
                <div><span className="dot">{days28.length}</span><span className="eyebrow">Active / 28d</span></div>
              </div>
              <p className="muted small">@{user} · public events (last ~90 days). No token is stored; Rule 1 now runs on these real dates.
                <button className="link-btn" onClick={() => void link('')}>Unlink</button></p>
              {error && <div className="banner fault-banner">{error}</div>}
            </>
          )}
        </section>
        <section className="card"><BurnHeatmap github={summary} /></section>
        <section className="card span2">
          <div className="card-head"><span className="card-title">Repositories</span></div>
          {!summary?.repos?.length && <div className="empty">{user ? 'No public repositories found.' : 'Link GitHub to see them.'}</div>}
          <div className="repo-grid">
            {summary?.repos?.map((r) => (
              <a key={r.name} className="repo" href={r.url} target="_blank" rel="noreferrer">
                <b>{r.name}</b>{r.fork && <span className="pill">fork</span>}<p className="small muted">{r.description ?? 'No description.'}</p>
                <span className="mono muted">{r.language ?? '—'} · ★ {r.stars} · {r.updatedAt?.slice(0, 10)}</span>
              </a>
            ))}
          </div>
        </section>
        <section className="card span2">
          <div className="card-head"><span className="card-title">Build in public · post drafter</span>
            <button className="btn sm" disabled={drafting} onClick={() => void draft()}><Sparkles size={12} />{drafting ? 'Composing from your numbers…' : 'Draft posts'}</button></div>
          <p className="muted small">Drafts use only the numbers on this screen — nothing invented. Edit before posting; JARVIS never posts for you.</p>
          {posts && <span className={`pill ${posts.ai ? 'sim' : ''}`}>{posts.ai ? 'written by local AI' : 'template (local AI unavailable)'}</span>}
          <div className="post-grid">
            {posts?.list.map((p, i) => (
              <div key={i} className={`post ${posts.ai ? 'ai' : ''}`}>
                <div className="post-head"><span className="eyebrow">{p.platform}</span><span className="mono muted">{p.text.length} chars</span>
                  <button className="btn sm ghost icon" aria-label="Copy draft" onClick={() => { void navigator.clipboard.writeText(p.text); setCopied(i); toast('Draft copied.', 'info'); window.setTimeout(() => setCopied(null), 1500) }}>
                    {copied === i ? <Check size={13} /> : <Copy size={13} />}</button></div>
                <p>{p.text}</p>
              </div>
            ))}
          </div>
          {summary && <a className="small" href={`https://github.com/${user}`} target="_blank" rel="noreferrer"><ExternalLink size={11} /> github.com/{user}</a>}
        </section>
      </div>
    </div>
  )
}
