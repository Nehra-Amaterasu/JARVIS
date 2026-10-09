/**
 * Mission → Trials: every certificate, exam and document on the path, as a board.
 * Each shows what it is worth for the admit AND for a job, what it costs (with the
 * source and the date that figure was checked), and when to take it.
 */
import { Award, CalendarClock, ExternalLink } from 'lucide-react'
import type { CSSProperties } from 'react'
import { TRACKS } from '../game/characters'
import { TrackTag } from '../game/kit'
import { useGame } from '../game/store'
import { TRIALS, type TrialDef } from '../game/trials'
import { daysBetween, prettyDate } from '../game/util'
import { MissionHeader } from '../ui'

const money = (amount: number, currency: 'INR' | 'EUR') => (currency === 'INR' ? `₹${amount.toLocaleString('en-IN')}` : `€${amount.toLocaleString('en-IN')}`)

export function TrialsPage() {
  const g = useGame((s) => s.g)
  const today = useGame((s) => s.today)
  const passed = TRIALS.filter((t) => (g.trials[t.id]?.stage ?? -1) >= t.stages.length - 1).length
  const upcoming = TRIALS.map((t) => ({ t, d: g.trials[t.id]?.examDate })).filter((x) => x.d && x.d >= today).sort((a, b) => a.d!.localeCompare(b.d!))[0]
  return (
    <div className="mission-page">
      <MissionHeader n="M4" title="Trials" sub="Certificates, exams and the paperwork that gates Germany."
        right={<span className="pill"><Award size={12} />{passed} / {TRIALS.length} passed</span>} />
      {upcoming && (
        <section className="card trial-next"><CalendarClock size={20} /><div><b>{upcoming.t.name}</b>
          <span className="mono muted"> · {prettyDate(upcoming.d!, true)} · in {daysBetween(today, upcoming.d!)} days</span></div></section>
      )}
      <p className="muted small trials-note">Fees change. Every figure shows its source and the day it was checked — verify on the official page before you pay.
        Certificates open interview doors; projects and fundamentals win the interview.</p>
      <div className="trial-grid">{TRIALS.filter((t) => !t.optional).map((t) => <TrialCard key={t.id} t={t} />)}</div>
      <div className="sec-title"><span>Optional — only if funded</span></div>
      <div className="trial-grid">{TRIALS.filter((t) => t.optional).map((t) => <TrialCard key={t.id} t={t} />)}</div>
    </div>
  )
}

function TrialCard({ t }: { t: TrialDef }) {
  const st = useGame((s) => s.g.trials[t.id])
  const setStage = useGame((s) => s.setTrialStage)
  const setDate = useGame((s) => s.setTrialDate)
  const stage = st?.stage ?? -1
  const done = stage >= t.stages.length - 1
  return (
    <section className={`card trial ${done ? 'passed' : ''}`} style={{ '--tint': TRACKS[t.track].tint } as CSSProperties}>
      <div className="tr-head"><TrackTag track={t.track} /><span className="chip mono">{t.kind}</span>{done && <span className="pill live"><i className="led" />Passed</span>}</div>
      <div className="tr-name">{t.name}</div>
      <span className="mono muted small">{t.issuer}</span>
      <div className="tr-worth">
        <div><span className="eyebrow">For the admit</span><p>{t.admit}</p></div>
        <div><span className="eyebrow">For a job</span><p>{t.job}</p></div>
      </div>
      <div className="tr-facts">
        {t.cost ? <div><span className="eyebrow">Cost</span><b className="dot">{money(t.cost.amount, t.cost.currency)}</b><span className="muted small">{t.cost.note} — {t.cost.source}, checked {prettyDate(t.cost.asOf, true)}</span></div>
          : <div><span className="eyebrow">Cost</span><span className="muted small">Check the official page.</span></div>}
        <div><span className="eyebrow">When</span><span className="small">{t.when}</span></div>
        <div><span className="eyebrow">Prep</span><span className="small">{t.prep}</span></div>
      </div>
      <div className="stepper" role="group" aria-label={`${t.name} progress`}>
        {t.stages.map((s, i) => (
          <button key={s} className={`step ${i <= stage ? 'on' : ''} ${i === stage ? 'cur' : ''}`} onClick={() => setStage(t.id, i === stage ? i - 1 : i)} title={s}>
            <i /><span>{s}</span>
          </button>
        ))}
      </div>
      <div className="tr-foot">
        <label className="mono small muted">Exam / deadline <input type="date" className="field sm" value={st?.examDate ?? ''} onChange={(e) => setDate(t.id, e.target.value)} /></label>
        <span className="mono small">+{t.reward.xp} XP · +{t.reward.marks} DM</span>
      </div>
      <div className="links">{t.links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noreferrer"><ExternalLink size={11} />{l.label}</a>)}</div>
    </section>
  )
}
