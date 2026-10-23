/**
 * Mission → Calibration: the onboarding wizard (onboarding.tsx). Three steps —
 * objective, honest skill ratings, timeline. (Mission v2: contracts come from the
 * skill tree now; the objective is shown on the Road. Lives in the settings drawer.)
 */
import { useState } from 'react'
import { useStore } from '../../lib/store'
import AsyncStorage from '../platform'
import { ONBOARDING_KEY } from '../hooks'
import type { GoalPreset, OnboardingData, SkillKey } from '../hooks'
import { MissionHeader } from '../ui'

const GOALS: { preset: GoalPreset; label: string; detail: string }[] = [
  { preset: 'tu9-vlsi', label: 'MS in Germany (TU9) — VLSI', detail: 'The prime directive. Munich, Aachen, Dresden.' },
  { preset: 'iit-mtech', label: 'IIT M.Tech', detail: 'GATE-first assault on the home front.' },
  { preset: 'industry', label: 'Industry Direct', detail: 'Skip the degree. Ship silicon now.' },
  { preset: 'custom', label: 'Custom Objective', detail: 'Declare your own target below.' },
]
const SKILLS: { key: SkillKey; label: string }[] = [
  { key: 'digitalLogic', label: 'Digital Logic' }, { key: 'verilog', label: 'Verilog / HDL' },
  { key: 'programming', label: 'Programming' }, { key: 'math', label: 'Math' }, { key: 'german', label: 'German' },
]
const RATINGS = ['None', 'Basic', 'Solid', 'Strong']
const STEPS = [
  { title: 'Declare your objective', sub: 'No target, no trajectory. Pick the hill you will take.' },
  { title: 'Skill assessment', sub: 'Rate yourself honestly. The engine punishes weakness with reps.' },
  { title: 'Timeline & commitment', sub: 'Deadlines are weapons. Aim yours.' },
]

export function Calibration({ onDone }: { onDone?: () => void }) {
  const setTab = useStore((s) => s.setTab)
  const toast = useStore((s) => s.toast)
  const [step, setStep] = useState(0)
  const [preset, setPreset] = useState<GoalPreset>('tu9-vlsi')
  const [custom, setCustom] = useState('')
  const [skills, setSkills] = useState<Record<SkillKey, number>>({ digitalLogic: 1, verilog: 0, programming: 1, math: 1, german: 0 })
  const [year, setYear] = useState(2028)
  const [hours, setHours] = useState(20)

  const label = preset === 'custom' ? (custom.trim() || 'Custom Objective') : GOALS.find((g) => g.preset === preset)!.label
  const save = async () => {
    const data: OnboardingData = { goal: { preset, label }, skills, targetYear: year, weeklyHours: hours, completedAt: new Date().toISOString() }
    await AsyncStorage.setItem(ONBOARDING_KEY, JSON.stringify(data))
    toast('Calibration saved. Your objective heads the Road.', 'live')
    if (onDone) onDone()
    else setTab('mission')
  }
  return (
    <div className="mission-page calib">
      <MissionHeader n={`Step ${step + 1}/3`} title="Calibration" sub={STEPS[step].sub} />
      <section className="card calib-card">
        <div className="display calib-title">{STEPS[step].title}</div>
        {step === 0 && (
          <div className="choice-grid">
            {GOALS.map((g) => (
              <button key={g.preset} className={`choice ${preset === g.preset ? 'on' : ''}`} onClick={() => setPreset(g.preset)}>
                <b>{g.label}</b><span>{g.detail}</span>
              </button>
            ))}
            {preset === 'custom' && <input className="field" placeholder="Your objective" value={custom} onChange={(e) => setCustom(e.target.value)} />}
          </div>
        )}
        {step === 1 && (
          <div className="skill-rate">
            {SKILLS.map((s) => (
              <div key={s.key} className="rate-row">
                <span>{s.label}</span>
                <div className="seg">{RATINGS.map((r, i) => (
                  <button key={r} className={skills[s.key] === i ? 'on' : ''} onClick={() => setSkills({ ...skills, [s.key]: i })}>{r}</button>
                ))}</div>
              </div>
            ))}
          </div>
        )}
        {step === 2 && (
          <div className="skill-rate">
            <div className="rate-row"><span>Target intake (winter semester)</span>
              <div className="seg">{[2027, 2028, 2029].map((y) => <button key={y} className={year === y ? 'on' : ''} onClick={() => setYear(y)}>WS {y}</button>)}</div></div>
            <div className="rate-row"><span>Weekly hours you will actually give</span>
              <div className="seg">{[10, 20, 30].map((h) => <button key={h} className={hours === h ? 'on' : ''} onClick={() => setHours(h)}>{h === 30 ? '30h+' : `${h}h`}</button>)}</div></div>
            <div className="brief"><span className="eyebrow">// Mission brief</span>
              <p>{label}, intake WS {year}, {hours}h a week. Weakest: {SKILLS.filter((s) => skills[s.key] === Math.min(...Object.values(skills))).map((s) => s.label).join(', ')}.</p></div>
          </div>
        )}
        <div className="calib-nav">
          {step > 0 && <button className="btn ghost" onClick={() => setStep(step - 1)}>Back</button>}
          <span style={{ flex: 1 }} />
          {step < 2 ? <button className="btn primary" onClick={() => setStep(step + 1)}>Next</button>
            : <button className="btn live" onClick={() => void save()}>Lock it in</button>}
        </div>
      </section>
    </div>
  )
}
