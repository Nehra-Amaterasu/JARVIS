/**
 * Mission settings, in a drawer (not a tab): the career, the weekly library
 * rotation and the day's times, exam dates (internals, end-sem, the backlog block
 * TBC), the certificate budget, the game's own settings (rest day, nudges,
 * recovery), calibration, and backup / restore.
 */
import { Download, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { post, TOKEN } from '../../lib/api'
import { useStore } from '../../lib/store'
import { loadBank } from '../data/bank'
import { usePlan, type RotationDay } from '../game/plan'
import { usePlayerStore } from '../stores/player-store'
import { confirmDialog, useDrawer } from '../ui'
import { SettingsCard } from './Armory'
import { Calibration } from './Calibration'

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']

export function SettingsDrawer() {
  const open = useDrawer((s) => s.open)
  const toggle = useDrawer((s) => s.toggle)
  useEffect(() => {
    if (!open) return
    void usePlan.getState().loadAcademics()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') toggle(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, toggle])
  if (!open) return null
  return (
    <div className="drawer-scrim" onClick={() => toggle(false)}>
      <aside className="drawer card" role="dialog" aria-modal="true" aria-label="Mission settings" onClick={(e) => e.stopPropagation()}>
        <div className="card-head"><span className="card-title">Mission settings</span>
          <button className="icon-btn" aria-label="Close" onClick={() => toggle(false)}><X size={16} /></button></div>
        <Career />
        <Rotation />
        <Exams />
        <Budget />
        <ProfileSec />
        <SettingsCard />
        <details><summary className="small">Calibration (objective, skills, timeline)</summary><div className="embedded"><Calibration onDone={() => toggle(false)} /></div></details>
        <Backup />
      </aside>
    </div>
  )
}

function Career() {
  const bank = loadBank()
  const career = usePlan((s) => s.state?.career ?? null)
  const set = usePlan((s) => s.setCareer)
  return (
    <section className="set-sec">
      <b>Career</b>
      <p className="muted small">Weights which nodes come first and glow on the Tree. Balanced job + MS: either works; switch any time.</p>
      <select className="field" value={career ?? ''} onChange={(e) => void set(e.target.value || null)}>
        <option value="">Both (best weight of either)</option>
        {bank.careers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </section>
  )
}

function Rotation() {
  const state = usePlan((s) => s.state)
  const save = usePlan((s) => s.setSettings)
  const [rot, setRot] = useState<Record<string, RotationDay> | null>(null)
  const [sched, setSched] = useState<Record<string, { start: string; minutes: number; label?: string }> | null>(null)
  useEffect(() => {
    if (state) { setRot(state.rotation); setSched(state.schedule) }
  }, [state])
  if (!rot || !sched) return null
  return (
    <section className="set-sec">
      <b>Weekly library rotation</b>
      <p className="muted small">Five library days, a different track each; the plan picks up next week where it stopped. "Matches" are words found in node branches.</p>
      {['1', '2', '3', '4', '5'].map((k) => (
        <div key={k} className="field-row">
          <span className="mono small" style={{ width: 80 }}>{DAYS[Number(k)]}</span>
          <input className="field" value={rot[k]?.label ?? ''} onChange={(e) => setRot({ ...rot, [k]: { ...rot[k], label: e.target.value } })} aria-label={`${DAYS[Number(k)]} label`} />
          <input className="field" value={(rot[k]?.match ?? []).join(', ')} onChange={(e) => setRot({ ...rot, [k]: { ...rot[k], match: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } })} aria-label={`${DAYS[Number(k)]} matches`} />
        </div>))}
      {(['library', 'evening', 'protected', 'weekend'] as const).map((k) => (
        <div key={k} className="field-row">
          <span className="mono small" style={{ width: 80 }}>{k}</span>
          <input className="field sm" type="time" value={sched[k]?.start ?? ''} onChange={(e) => setSched({ ...sched, [k]: { ...sched[k], start: e.target.value } })} aria-label={`${k} start`} />
          <input className="field sm" type="number" min={15} max={480} value={sched[k]?.minutes ?? 60} onChange={(e) => setSched({ ...sched, [k]: { ...sched[k], minutes: Number(e.target.value) } })} aria-label={`${k} minutes`} />
        </div>))}
      <button className="btn sm" onClick={() => void save({ rotation: rot, schedule: sched })}>Save rotation</button>
    </section>
  )
}

function Exams() {
  const ac = usePlan((s) => s.academics)
  const setDate = usePlan((s) => s.setExamDate)
  const save = usePlan((s) => s.setSettings)
  const window_ = usePlan((s) => s.state?.exam.window_days ?? 14)
  if (!ac) return null
  if (ac.missing) return <section className="set-sec"><b>Exams</b><p className="muted small">academics.json isn't there yet (data/app/germoney/academics/).</p></section>
  const cal = ac.calendar ?? {}
  return (
    <section className="set-sec">
      <b>Exams</b>
      <p className="muted small">Dates you set here win over the academics file and survive its rewrites.</p>
      {(['internals_start', 'end_sem_start', 'backlog_block_start'] as const).map((k) => (
        <div key={k} className="field-row">
          <span className="small" style={{ width: 160 }}>{k.replace(/_/g, ' ')}</span>
          <input className="field sm" type="date" value={cal[k] ?? ''} onChange={(e) => void setDate(`calendar:${k}`, e.target.value || null)} aria-label={k} />
        </div>))}
      {ac.subjects.map((s) => (
        <div key={s.id} className="field-row">
          <span className="small" style={{ width: 220 }}>{s.name}{s.kind === 'backlog' ? ' (backlog)' : ''}</span>
          <input className="field sm" type="date" value={s.date_set_here ? s.exam_date ?? '' : ''} onChange={(e) => void setDate(s.id, e.target.value || null)} aria-label={`${s.name} exam date`} />
          <span className="muted small">{s.exam_date ? `${s.days_left} d` : 'TBC'}</span>
        </div>))}
      <label className="small">Exam mode starts this many days before an exam (when the plan has no phase for the day)
        <input className="field sm" type="number" min={1} max={60} value={window_} onChange={(e) => void save({ window_days: Number(e.target.value) })} /></label>
    </section>
  )
}

function Budget() {
  const b = usePlan((s) => s.state?.budget)
  const save = usePlan((s) => s.setSettings)
  if (!b) return null
  return (
    <section className="set-sec">
      <b>Certificate budget</b>
      <div className="field-row">
        <label className="small">₹ per month <input className="field sm" type="number" defaultValue={b.cert_inr_month} onBlur={(e) => void save({ budget: { cert_inr_month: Number(e.target.value) } })} /></label>
        <label className="small">₹ stretch for credible ones <input className="field sm" type="number" defaultValue={b.cert_stretch_inr} onBlur={(e) => void save({ budget: { cert_stretch_inr: Number(e.target.value) } })} /></label>
      </div>
    </section>
  )
}

/** How the plan talks to him and shapes the day (private profile.json; no test scores). */
function ProfileSec() {
  const p = usePlan((s) => s.profile)
  const load = usePlan((s) => s.loadProfile)
  const save = usePlan((s) => s.saveProfile)
  useEffect(() => { void load() }, [load])
  if (!p) return null
  const st = p.style
  return (
    <section className="set-sec">
      <b>How the plan works with you</b>
      <label className="check small"><input type="checkbox" checked={st.novelty_first} onChange={(e) => void save({ style: { ...st, novelty_first: e.target.checked } })} />Puzzle first, theory after</label>
      <div className="field-row">
        <label className="small">Choices per slot <input className="field sm" type="number" min={1} max={4} defaultValue={st.choices} onBlur={(e) => void save({ style: { ...st, choices: Number(e.target.value) } })} /></label>
        <label className="small">In progress at most <input className="field sm" type="number" min={1} max={6} defaultValue={st.wip_cap} onBlur={(e) => void save({ style: { ...st, wip_cap: Number(e.target.value) } })} /></label>
        <label className="small">Nudge after idle days <input className="field sm" type="number" min={1} max={30} defaultValue={st.nudge_after_idle_days} onBlur={(e) => void save({ style: { ...st, nudge_after_idle_days: Number(e.target.value) } })} /></label>
        <label className="small">Quiet from <input className="field sm" type="time" defaultValue={st.quiet_hours[0]} onBlur={(e) => void save({ style: { ...st, quiet_hours: [e.target.value, st.quiet_hours[1]] } })} /></label>
        <label className="small">to <input className="field sm" type="time" defaultValue={st.quiet_hours[1]} onBlur={(e) => void save({ style: { ...st, quiet_hours: [st.quiet_hours[0], e.target.value] } })} /></label>
      </div>
      <ul className="np-list small muted">{p.rules.map((r) => <li key={r}>{r}</li>)}</ul>
    </section>
  )
}

function Backup() {
  const toast = useStore((s) => s.toast)
  const resetProgress = usePlayerStore((s) => s.resetProgress)
  const importRef = useRef<HTMLInputElement>(null)
  const exportData = () => {
    void fetch('/api/germoney/export', { headers: { 'X-Jarvis-Token': TOKEN } }).then((r) => r.blob()).then((b) => {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(b)
      a.download = `mission-germoney-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(a.href)
    })
  }
  const importData = async (f: File) => {
    try {
      const data = JSON.parse(await f.text())
      confirmDialog('Import backup', `Replace Mission data with the ${Object.keys(data).length} record(s) in ${f.name}?`, 'Import', async () => {
        const r = await post<{ imported: number }>('/api/germoney/import', data)
        toast(`Imported ${r.imported} record(s). Reloading…`, 'live')
        window.setTimeout(() => window.location.reload(), 900)
      }, false)
    } catch {
      toast('That file is not a Well Wisher (Mission Germoney) backup.', 'fault')
    }
  }
  return (
    <section className="set-sec">
      <b>Backup</b>
      <p className="muted small">A snapshot of everything (including the plan) is also taken daily, 14 kept, in data/app/germoney/backups.</p>
      <div className="field-row">
        <button className="btn sm" onClick={exportData}><Download size={13} />Backup</button>
        <button className="btn sm" onClick={() => importRef.current?.click()}><Upload size={13} />Restore</button>
        <input ref={importRef} type="file" accept="application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importData(f); e.target.value = '' }} />
        <span style={{ flex: 1 }} />
        <button className="btn sm danger" onClick={() => confirmDialog('Factory reset', 'Wipe the window-side Mission progress (the Floor, Marks, logs, workouts)? The plan and the daily backups stay.', 'Wipe it', () => { resetProgress(); toast('Wiped. Reloading…', 'fault'); window.setTimeout(() => window.location.reload(), 900) })}>Factory reset</button>
      </div>
    </section>
  )
}
