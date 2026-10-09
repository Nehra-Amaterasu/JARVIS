/**
 * Mission → Syllabus (knowledge.tsx): the skill tree with prerequisites,
 * certifications and resources; the Germany plan (TU9 targets, costs, timeline);
 * career verticals; and live intel — newest arXiv papers for your rank's topic,
 * plus resources curated by the local model on demand (amber: inferred).
 */
import { ChevronDown, ExternalLink, RefreshCw, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { CAREER_VERTICALS, ROADMAP_COSTS, ROADMAP_TIMELINE, SKILL_BRANCHES, TARGET_UNIVERSITIES, type Skill } from '../data/knowledge-base'
import { useLiveIntel } from '../hooks'
import { MissionHeader } from '../ui'

type View = 'tree' | 'germany' | 'careers' | 'live'

export function SyllabusPage() {
  const [view, setView] = useState<View>('tree')
  return (
    <div className="mission-page">
      <MissionHeader n="M5" title="Syllabus" sub="The 24-month VLSI curriculum and the road to a TU9 admit."
        right={<div className="seg">
          {([['tree', 'Skill tree'], ['germany', 'Germany'], ['careers', 'Careers'], ['live', 'Live intel']] as [View, string][]).map(([v, l]) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{l}</button>
          ))}
        </div>} />
      {view === 'tree' && <SkillTree />}
      {view === 'germany' && <Germany />}
      {view === 'careers' && <Careers />}
      {view === 'live' && <LiveIntel />}
    </div>
  )
}

function SkillTree() {
  return (
    <div className="branch-list">
      {SKILL_BRANCHES.map((b) => (
        <section key={b.id} className="card branch" style={{ ['--branch' as string]: b.accentColor }}>
          <div className="branch-head"><span className="display" style={{ color: b.accentColor }}>{b.name}</span><span className="muted small">{b.tagline}</span></div>
          {b.skills.map((s) => <SkillRow key={s.id} skill={s} />)}
        </section>
      ))}
    </div>
  )
}

function SkillRow({ skill }: { skill: Skill }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`skill ${open ? 'open' : ''}`}>
      <button className="skill-head" onClick={() => setOpen(!open)}>
        <span className="mono muted">{skill.id}</span><b>{skill.name}</b><span className="mono muted">{skill.timeToProficiency}</span>
        <ChevronDown size={14} className={open ? 'flip' : ''} />
      </button>
      {open && (
        <div className="skill-body fade-in">
          <p>{skill.why}</p>
          {skill.prerequisites.length > 0 && <><span className="eyebrow">Prerequisites</span><p className="mono small">{skill.prerequisites.join(' · ')}</p></>}
          {skill.certification && <><span className="eyebrow">Certification</span><p className="small">{skill.certification}</p></>}
          <span className="eyebrow">Resources · cost {skill.cost}</span>
          <div className="links">{skill.resources.map((r) => (
            <a key={r.url + r.label} href={r.url} target="_blank" rel="noreferrer"><ExternalLink size={11} />{r.label}<em className={r.tier}>{r.tier}</em></a>
          ))}</div>
        </div>
      )}
    </div>
  )
}

function Germany() {
  return (
    <div className="germany-grid">
      <section className="card span2">
        <div className="card-head"><span className="card-title">Target universities · TU9</span></div>
        <div className="uni-grid">
          {TARGET_UNIVERSITIES.map((u) => (
            <div key={u.name} className="uni">
              <b>{u.name}</b><span className="small">{u.program}</span>
              <div className="kv small"><span>Language</span><span>{u.language}</span><span>GPA</span><span>{u.gpa}</span><span>ECTS</span><span>{u.ects}</span><span>Intake</span><span>{u.intake}</span></div>
              <p className="muted small">{u.prerequisites}</p>
              <a href={u.portalUrl} target="_blank" rel="noreferrer"><ExternalLink size={11} />{u.portal}</a>
            </div>
          ))}
        </div>
      </section>
      <section className="card">
        <div className="card-head"><span className="card-title">Roadmap costs</span></div>
        {ROADMAP_COSTS.map((c) => <div key={c.label} className="row-line"><span>{c.label}</span><span className="mono">{c.amount}</span><span className="muted small">{c.note}</span></div>)}
      </section>
      <section className="card">
        <div className="card-head"><span className="card-title">Timeline → WS 2028</span></div>
        {ROADMAP_TIMELINE.map((p) => (
          <div key={p.window} className="timeline-row"><span className="mono">{p.window}</span><ul>{p.actions.map((a) => <li key={a}>{a}</li>)}</ul></div>
        ))}
      </section>
    </div>
  )
}

function Careers() {
  return (
    <div className="career-grid">
      {CAREER_VERTICALS.map((c) => (
        <section key={c.id} className="card career">
          <span className="mono muted">{String(c.id).padStart(2, '0')}</span>
          <div className="display" style={{ color: c.accentColor }}>{c.name}</div>
          <p className="small">{c.endgame}</p>
          <span className="eyebrow">Core responsibilities</span><p className="small muted">{c.responsibilities}</p>
          <span className="eyebrow">Target companies</span><p className="small">{c.targetCompanies.join(' · ')}</p>
          <div className="kv small"><span>EU</span><span>{c.salaryEU}</span><span>US</span><span>{c.salaryUS}</span></div>
        </section>
      ))}
    </div>
  )
}

function LiveIntel() {
  const { topic, papers, items, state, error, loadPapers, curate } = useLiveIntel()
  return (
    <div className="germany-grid">
      <section className="card span2">
        <div className="card-head"><span className="card-title">Latest papers · arXiv</span>
          <span className="mono muted">topic for your rank: {topic}</span>
          <button className="btn sm ghost icon" aria-label="Refresh papers" onClick={() => void loadPapers()}><RefreshCw size={13} /></button></div>
        {state === 'loading' && !papers && <div className="empty">Pulling papers…</div>}
        {error && state === 'error' && <div className="banner fault-banner">{error}</div>}
        {papers?.map((p) => (
          <a key={p.id} className="paper" href={p.url} target="_blank" rel="noreferrer">
            <b>{p.title}</b><span className="mono muted">{p.published.slice(0, 10)} · {p.authors.join(', ')}</span><p className="small muted">{p.summary}</p>
          </a>
        ))}
      </section>
      <section className="card span2">
        <div className="card-head"><span className="card-title">Curated for your rank</span>
          <button className="btn sm" disabled={state === 'loading'} onClick={() => void curate()}><Sparkles size={12} />{state === 'loading' ? 'Qwen is curating…' : 'Curate with local AI'}</button></div>
        {!items && <p className="muted small">Ask the local model for 3-6 high-signal resources on “{topic}”. Its picks are suggestions — search each one before trusting it.</p>}
        {items?.map((it) => (
          <div key={it.title} className="intel-item ai">
            <span className="pill sim">{it.type}</span><b>{it.title}</b><p className="small muted">{it.why}</p>
            <a href={`https://www.google.com/search?q=${encodeURIComponent(it.searchQuery)}`} target="_blank" rel="noreferrer"><ExternalLink size={11} />search: {it.searchQuery}</a>
          </div>
        ))}
      </section>
    </div>
  )
}
