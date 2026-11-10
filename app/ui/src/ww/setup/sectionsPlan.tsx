/**
 * Setup sections that edit the plan store's own settings, plus the doorways and the app-level ones:
 * Rotation (SU1), Dates link row (SU16), Certificate budget (SU9), How the plan works (SU10), Calibration (SU11),
 * Career settings (SU12), Connections (SU13), Backup (SU14), Phone row (SU15), Appearance (SU17).
 * Rotation, budget, career and style share the one save model (saveModel.ts); the rest save by their own action.
 */
import { useEffect, useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { post, TOKEN } from '../../lib/api'
import { useStore } from '../../lib/store'
import { loadBank } from '../../germoney/data/bank'
import { usePlan, type PlanState, type RotationDay } from '../../germoney/game/plan'
import { usePlayerStore } from '../../germoney/stores/player-store'
import { Calibration } from '../../germoney/pages/Calibration'
import { loadPhone, phoneStatus, type PhoneView } from '../../lib/phone'
import { Button, Field, Fold, PrimaryButton, Segmented } from '../kit'
import { readTheme, setTheme, THEMES, type ThemeId } from '../frame/theme'
import { openOverlay } from '../frame/overlayRegistry'
import { LinkRow, SetupCard, useDraft } from './forms'
import { applyMotion, readMotion, setMotion, setTabBadges, tabBadgesOn, type MotionChoice } from './appearance'
import { useSetup } from './saveModel'
import type { ExamRow } from './inputs'

/* ---- SU1 Rotation ---- */
const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
type Sched = PlanState['schedule']
interface Rot { rotation: Record<string, RotationDay>; schedule: Sched }

export function RotationSection() {
  const [r, set] = useDraft<Rot | undefined>('rotation')
  if (!r) return (
    <SetupCard n="SU1" anchor="rotation" title="Rotation" hint="Five library days, a different track each; the plan picks up next week where it stopped.">
      <p className="su-empty">The plan has not answered yet, so there is no rotation to show.</p>
    </SetupCard>
  )
  const setDay = (k: string, patch: Partial<RotationDay>) => set({ ...r, rotation: { ...r.rotation, [k]: { ...r.rotation[k], ...patch } } })
  const setSlot = (k: string, patch: Partial<Sched[string]>) => set({ ...r, schedule: { ...r.schedule, [k]: { ...r.schedule[k], ...patch } } })
  return (
    <SetupCard n="SU1" anchor="rotation" title="Rotation" dirtyId="rotation"
      hint="Five library days, a different track each; the plan picks up next week where it stopped. The words are matched against node branches.">
      {['1', '2', '3', '4', '5'].map((k) => (
        <div key={k} className="su-row" role="group" aria-label={DAY_NAMES[Number(k)]}>
          <div className="su-row-fields">
            <Field label={`${DAY_NAMES[Number(k)]} track`} value={r.rotation[k]?.label ?? ''} onChange={(e) => setDay(k, { label: e.target.value })} />
            <Field label={`${DAY_NAMES[Number(k)]} matches`} hint="Words, separated by commas" value={(r.rotation[k]?.match ?? []).join(', ')}
              onChange={(e) => setDay(k, { match: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
          </div>
        </div>
      ))}
      {(['library', 'evening', 'protected', 'weekend'] as const).map((k) => (
        <div key={k} className="su-row-fields" role="group" aria-label={`${k} block`}>
          <Field label={`${k} starts`} kind="time" value={r.schedule[k]?.start ?? ''} onChange={(e) => setSlot(k, { start: e.target.value })} />
          <Field label={`${k} length`} kind="number" min={15} max={480} unit="min" value={r.schedule[k]?.minutes ?? 60} onChange={(e) => setSlot(k, { minutes: Number(e.target.value) })} />
        </div>
      ))}
    </SetupCard>
  )
}

/* ---- SU16 Dates (a link row to O1, not a card) ---- */
export function DatesRow() {
  const rows = useSetup((s) => (('exams' in s.draft ? s.draft.exams : s.base.exams) as ExamRow[] | undefined) ?? [])
  const dirty = useSetup((s) => 'exams' in s.draft)
  const tentative = rows.filter((x) => x.approx).length
  const line = rows.length === 0 ? 'No paper on the date sheet yet.' : `${rows.length} paper${rows.length === 1 ? '' : 's'}, ${tentative} tentative.${dirty ? ' Unsaved changes.' : ''}`
  return (
    <LinkRow anchor="dates" title="Dates" line={line}>
      <Button onClick={() => openOverlay('date')}>Edit the date sheet</Button>
    </LinkRow>
  )
}

/* ---- SU9 Certificate budget ---- */
export function BudgetSection() {
  const [b, set] = useDraft<PlanState['budget'] | undefined>('budget')
  if (!b) return <SetupCard n="SU9" anchor="budget" title="Certificate budget"><p className="su-empty">The plan has not answered yet.</p></SetupCard>
  return (
    <SetupCard n="SU9" anchor="budget" title="Certificate budget" dirtyId="budget" hint="What you will spend on certificates. The Career workspace only suggests what fits.">
      <div className="su-row-fields">
        <Field label="Per month" kind="number" min={0} unit="rupees" value={b.cert_inr_month} onChange={(e) => set({ ...b, cert_inr_month: Number(e.target.value) })} />
        <Field label="Stretch for a credible one" kind="number" min={0} unit="rupees" value={b.cert_stretch_inr} onChange={(e) => set({ ...b, cert_stretch_inr: Number(e.target.value) })} />
      </div>
    </SetupCard>
  )
}

/* ---- SU10 How the plan works with you ---- */
type Style = NonNullable<ReturnType<typeof usePlan.getState>['profile']>['style']
export function StyleSection() {
  const [st, set] = useDraft<Style | undefined>('style')
  const rules = usePlan((s) => s.profile?.rules) ?? []
  if (!st) return <SetupCard n="SU10" anchor="style" title="How the plan works with you"><p className="su-empty">The profile has not answered yet.</p></SetupCard>
  const n = (k: keyof Style) => (e: { target: { value: string } }) => set({ ...st, [k]: Number(e.target.value) })
  return (
    <SetupCard n="SU10" anchor="style" title="How the plan works with you" dirtyId="style" hint="How the plan talks to you and shapes the day.">
      <label className="su-check">
        <input type="checkbox" checked={st.novelty_first} onChange={(e) => set({ ...st, novelty_first: e.target.checked })} />
        Puzzle first, theory after
      </label>
      <div className="su-row-fields">
        <Field label="Choices per slot" kind="number" min={1} max={4} value={st.choices} onChange={n('choices')} />
        <Field label="In progress at most" kind="number" min={1} max={6} value={st.wip_cap} onChange={n('wip_cap')} />
        <Field label="Nudge after idle days" kind="number" min={1} max={30} value={st.nudge_after_idle_days} onChange={n('nudge_after_idle_days')} />
        <Field label="Quiet from" kind="time" value={st.quiet_hours[0]} onChange={(e) => set({ ...st, quiet_hours: [e.target.value, st.quiet_hours[1]] })} />
        <Field label="Quiet until" kind="time" value={st.quiet_hours[1]} onChange={(e) => set({ ...st, quiet_hours: [st.quiet_hours[0], e.target.value] })} />
      </div>
      {rules.length > 0 && <ul className="su-rules">{rules.map((x) => <li key={x}>{x}</li>)}</ul>}
    </SetupCard>
  )
}

/* ---- SU11 Calibration ---- the existing wizard, unchanged, behind a closed fold ---- */
export function CalibrationSection() {
  return (
    <SetupCard n="SU11" anchor="calibration" title="Calibration" hint="Objective, skills and timeline. A three-step wizard; it saves itself when you finish it.">
      <Fold title="Open the calibration wizard" level={3} lazy>
        <div className="su-embedded"><Calibration onDone={() => {}} /></div>
      </Fold>
    </SetupCard>
  )
}

/* ---- SU12 Career settings ---- */
export function CareerSection() {
  const [c, set] = useDraft<string | undefined>('career')
  const careers = loadBank().careers
  return (
    <SetupCard n="SU12" anchor="career" title="Career settings" dirtyId="career" hint="Weights which nodes come first and glow on the Tree. Either path works; switch any time.">
      <Field label="Career" kind="select" value={c ?? ''} onChange={(e) => set(e.target.value)}>
        <option value="">Both (best weight of either)</option>
        {careers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </Field>
    </SetupCard>
  )
}

/* ---- SU13 Connections: disabled, each with its reason (plan section 7) ---- */
const CONNECTIONS: [string, string][] = [
  ['College mail and Classroom', 'Waits on a one-hour test: can your college account authorise this app? Fallback: a watched folder.'],
  ['Calendar file (.ics)', 'A calendar file to import on the phone: not built.'],
  ['Yaadash link', 'Records are written to a staging folder for Yaadash to read. The reading side is not built here.'],
]
export function ConnectionsSection() {
  return (
    <SetupCard n="SU13" anchor="connections" title="Connections" hint="Links to other places. None is on, and each row says why.">
      <ul className="su-connections">
        {CONNECTIONS.map(([name, why]) => (
          <li key={name} className="su-connection" data-connection={name}>
            <Button size="sm" disabledReason={why}>{name}</Button>
          </li>
        ))}
      </ul>
    </SetupCard>
  )
}

/* ---- SU14 Backup ---- */
export function BackupSection() {
  const toast = useStore((s) => s.toast)
  const resetProgress = usePlayerStore((s) => s.resetProgress)
  const pick = useRef<HTMLInputElement>(null)
  const exportData = () => {
    void fetch('/api/germoney/export', { headers: { 'X-Jarvis-Token': TOKEN } }).then((r) => r.blob()).then((b) => {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(b)
      a.download = `well-wisher-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(a.href)
    })
  }
  const importData = async (f: File) => {
    let data: Record<string, unknown>
    try {
      data = JSON.parse(await f.text())
    } catch {
      return toast('That file is not a Well Wisher backup.', 'fault')
    }
    openOverlay('confirm', {
      title: 'Restore this backup',
      body: `Replace Well Wisher data with the ${Object.keys(data).length} record(s) in ${f.name}?`,
      confirmLabel: 'Restore',
      destructive: true,
      onConfirm: async () => {
        const r = await post<{ imported: number }>('/api/germoney/import', data)
        toast(`Imported ${r.imported} record(s). Reloading.`, 'live')
        window.setTimeout(() => window.location.reload(), 900)
      },
    })
  }
  return (
    <SetupCard n="SU14" anchor="backup" title="Backup" hint="A snapshot of everything, including the plan, is also taken daily and 14 are kept on this laptop.">
      <div className="su-actions">
        <Button onClick={exportData}><Download size={14} aria-hidden="true" />Backup</Button>
        <Button onClick={() => pick.current?.click()}><Upload size={14} aria-hidden="true" />Restore</Button>
        <input ref={pick} type="file" accept="application/json" hidden aria-label="Backup file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importData(f); e.target.value = '' }} />
        <Button tone="danger" onClick={() => openOverlay('confirm', {
          title: 'Factory reset',
          body: 'Wipe the window-side progress (the Floor, Marks, logs, workouts)? The plan and the daily backups stay.',
          confirmLabel: 'Wipe it',
          destructive: true,
          onConfirm: () => { resetProgress(); window.setTimeout(() => window.location.reload(), 600) },
        })}>Factory reset</Button>
      </div>
    </SetupCard>
  )
}

/* ---- SU15 Phone: one status line and a button; the steps live in O2 only ---- */
export function PhoneRow({ primaryWhenUnpaired = false }: { primaryWhenUnpaired?: boolean }) {
  const [v, setV] = useState<PhoneView | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    const go = () => loadPhone().then((x) => alive && (setV(x), setFailed(false))).catch(() => alive && setFailed(true))
    void go()
    const t = window.setInterval(go, 8000)
    return () => { alive = false; window.clearInterval(t) }
  }, [])
  const paired = v?.devices.length ?? 0
  const line = failed ? 'The phone status did not load.'
    : !v ? 'Checking the phone.'
    : paired > 0 ? `Paired: ${v.devices.map((d) => d.name).join(', ')}. Listener ${phoneStatus(v).text}.`
    : `Not paired. Listener ${phoneStatus(v).text}.`
  return (
    <LinkRow anchor="phone" title="Phone" line={line}>
      <PrimaryButton claimId="setup-pair" rank="workspace" when={primaryWhenUnpaired && !!v && paired === 0} onClick={() => openOverlay('phone')}>
        {paired > 0 ? 'Phone' : 'Pair phone'}
      </PrimaryButton>
    </LinkRow>
  )
}

/* ---- SU17 Appearance ---- */
const THEME_LABEL: Record<ThemeId, string> = { ash: 'Ash', paper: 'Paper', indigo: 'Indigo' }
export function AppearanceSection() {
  const [theme, setT] = useState<ThemeId>(readTheme())
  const [motion, setM] = useState<MotionChoice>(readMotion())
  const [badges, setB] = useState(tabBadgesOn())
  useEffect(() => applyMotion(motion), []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <SetupCard n="SU17" anchor="appearance" title="Appearance" hint="Applied at once and kept on this machine. These are not part of Save changes.">
      <Segmented label="Theme" variant="choice" value={theme} onChange={(id) => { setT(id); void setTheme(id) }}
        options={THEMES.map((id) => ({ id, label: THEME_LABEL[id] }))} />
      <Segmented<MotionChoice> label="Motion" variant="choice" value={motion} onChange={(id) => { setM(id); setMotion(id) }}
        options={[{ id: 'auto', label: 'Auto' }, { id: 'full', label: 'Full' }, { id: 'calm', label: 'Calm' }]} />
      <Segmented label="Tab badges" variant="choice" value={badges ? 'on' : 'off'} onChange={(id) => { setB(id === 'on'); setTabBadges(id === 'on') }}
        options={[{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }]} />
      <div className="su-actions">
        <Button size="sm" disabledReason="Glass follows this machine's frame-rate check. A manual override is not built.">Glass</Button>
        <Button size="sm" disabledReason="High contrast is not built.">Contrast</Button>
      </div>
      <Fold title="Which Well Wisher opens" level={3}>
        <p className="su-hint">This new Well Wisher is behind a switch while the old one stays safe through the exams. Going back reloads the window.</p>
        <Button size="sm" onClick={() => { try { localStorage.setItem('ww.workspace', 'off') } catch { /* blocked */ } window.location.reload() }}>Go back to the old Well Wisher</Button>
      </Fold>
    </SetupCard>
  )
}

