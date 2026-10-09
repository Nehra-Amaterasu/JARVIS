/**
 * Mission → Interrogation (failure-analysis.tsx): what happened, energy 1-5, root
 * cause — then a verdict and ONE intervention for tomorrow. The verdict comes from
 * the LOCAL model (amber: inferred) or, if it can't answer, from the rule table the
 * phone app used (plain). Patterns are computed from your own log, no AI.
 */
import { Skull } from 'lucide-react'
import { useState } from 'react'
import { post } from '../../lib/api'
import type { FailureAnalysis } from '../platform'
import { FAILURE_CATEGORIES, useFailureStore, type FailureCategory } from '../stores/failure-store'
import { MissionHeader } from '../ui'

const FALLBACK: Record<FailureCategory, { verdict: string; intervention: string }> = {
  energy: { verdict: 'A dead battery is a planning failure wearing a costume. Fix the input.', intervention: 'Lights out 90 minutes earlier tonight. No screens in bed. Attack the first quest at full charge before noon.' },
  planning: { verdict: 'You did not fail today. You failed last night when you set no target.', intervention: 'Before you sleep, write ONE hyper-specific task for tomorrow with a defined "done" state. Vague goals are how you freeze.' },
  distraction: { verdict: 'Your attention was for sale and something cheap outbid the mission.', intervention: 'Phone in another room. One 25-minute locked block, no exceptions. Distraction is a habit — break the loop once and repeat.' },
  overreach: { verdict: 'You aimed at a mountain, tripped on the first step, and called it fate.', intervention: 'Cut tomorrow’s scope by half. Ship the smallest working piece. Momentum compounds; heroics collapse.' },
  external: { verdict: 'The world will always interfere. Operatives who matter execute anyway.', intervention: 'Identify the one controllable variable in today’s wreck and pre-empt it tomorrow. Blame is a luxury you cannot afford.' },
  avoidance: { verdict: 'You knew exactly what to do and chose comfort. That is the whole story.', intervention: 'Name the task you dodged. Do that one first tomorrow, before anything easy. Discomfort is the price of the mission.' },
}

export function InterrogationPage() {
  const addEntry = useFailureStore((s) => s.addEntry)
  const getPatterns = useFailureStore((s) => s.getPatterns)
  const entries = useFailureStore((s) => s.entries)
  const [what, setWhat] = useState('')
  const [energy, setEnergy] = useState<number | null>(null)
  const [category, setCategory] = useState<FailureCategory | null>(null)
  const [thinking, setThinking] = useState(false)
  const [result, setResult] = useState<FailureAnalysis | null>(null)
  const can = what.trim().length > 0 && energy !== null && category !== null && !thinking

  const submit = async () => {
    if (!can) return
    setThinking(true)
    setResult(null)
    let analysis: FailureAnalysis
    try {
      const r = await post<FailureAnalysis>('/api/germoney/ai/failure', { whatHappened: what.trim(), energy, category })
      analysis = { ...r, source: 'local-ai' }
    } catch {
      analysis = { rootCause: what.trim(), category: category!, ...FALLBACK[category!], source: 'rules' }
    }
    addEntry({ whatHappened: what.trim(), energy: energy!, category: category!, analysis })
    setResult(analysis)
    setThinking(false)
  }
  const p = getPatterns()
  return (
    <div className="mission-page">
      <MissionHeader n="M11" title="Interrogation" sub="Root cause, not the excuse." />
      <div className="term-grid">
        <section className="card interro">
          <span className="eyebrow">Q1 // What happened?</span>
          <textarea className="field area" maxLength={280} placeholder="Be specific. What did you skip, and when?" value={what} onChange={(e) => setWhat(e.target.value)} />
          <span className="eyebrow">Q2 // Energy level?</span>
          <div className="seg">{[1, 2, 3, 4, 5].map((n) => <button key={n} className={energy === n ? 'on' : ''} onClick={() => setEnergy(n)}>{n}</button>)}</div>
          <span className="eyebrow">Q3 // Root cause?</span>
          <div className="cat-grid">{FAILURE_CATEGORIES.map((c) => <button key={c} className={`chip ${category === c ? 'on' : ''}`} onClick={() => setCategory(c)}>{c}</button>)}</div>
          <button className="btn danger power" disabled={!can} onClick={() => void submit()}><Skull size={15} />{thinking ? 'Interrogating…' : 'Submit to interrogation'}</button>
          {result && (
            <div className={`verdict fade-in ${result.source === 'local-ai' ? 'ai' : ''}`}>
              <span className={`pill ${result.source === 'local-ai' ? 'sim' : ''}`}>{result.source === 'local-ai' ? 'verdict · local AI' : 'verdict · rule table'}</span>
              <div className="display verdict-line">{result.verdict}</div>
              <span className="eyebrow">Root cause</span><p>{result.rootCause}</p>
              <span className="eyebrow">Tomorrow's intervention</span><p>{result.intervention}</p>
            </div>
          )}
        </section>
        <section className="card">
          <div className="card-head"><span className="card-title">Pattern log</span><span className="mono muted">rule-based · no AI</span></div>
          <div className="metrics">
            <div><span className="dot">{p.totalFailures}</span><span className="eyebrow">Logged</span></div>
            <div><span className="dot">{p.avgEnergy || '—'}</span><span className="eyebrow">Avg energy</span></div>
            <div><span className="dot small-dot">{p.topCategory ?? '—'}</span><span className="eyebrow">Top cause</span></div>
            <div><span className="dot small-dot">{p.worstDay ?? '—'}</span><span className="eyebrow">Worst day</span></div>
          </div>
          {p.repeatOffender && <div className="banner fault-banner">Repeat offender: {p.topCategoryCount}× {p.repeatCategory}. This is a pattern, not bad luck.</div>}
          <span className="eyebrow" style={{ display: 'block', margin: '14px 0 6px' }}>Recent failures</span>
          {entries.slice(0, 6).map((e) => (
            <div key={e.id} className="log-item">
              <div className="mono"><span className="muted">{new Date(e.date).toLocaleDateString()}</span> [{e.category.toUpperCase()}] energy {e.energy}</div>
              <p>{e.whatHappened}</p>
              {e.analysis && <p className="muted small">→ {e.analysis.intervention}</p>}
            </div>
          ))}
          {entries.length === 0 && <div className="empty">No failures logged. Either you're perfect or you're not logging.</div>}
        </section>
      </div>
    </div>
  )
}
