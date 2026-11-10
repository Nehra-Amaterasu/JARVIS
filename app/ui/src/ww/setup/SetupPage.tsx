/**
 * The Setup workspace (plan 4.9, C6). One index, eighteen sections in the plan's order, one save model.
 *
 *   SU1 Rotation  SU16 Dates (link row to the Date sheet)  SU2 Subjects  SU3 Goals  SU4 Timetable
 *   SU5 Attendance rule  SU6 Deadlines  SU7 Study time  SU8 About you  SU9 Certificate budget
 *   SU10 How the plan works  SU11 Calibration  SU12 Career settings  SU13 Connections  SU15 Phone (link row)
 *   SU14 Backup  SU17 Appearance  SU18 Question harvester
 *
 * Why the order differs from the numbers: the plan numbered sections as they were found, and 4.9's picture shows
 * the order the owner reads them in. The index and the page follow the picture.
 *
 * One save model (saveModel.ts): a form edits a draft, a section with a draft shows "Unsaved" and Discard, the
 * sticky bar says "Save N changes", and the Setup tab carries the frame's static dirty dot. Leaving: the drafts
 * live in a module store, so switching to Study and back loses nothing; closing the window with drafts asks
 * (beforeunload). That is a deliberate narrowing of "leaving asks": the frame owns workspace switches, and a
 * switch that cannot lose anything needs no question.
 *
 * Primary (plan 3.3): Save when dirty, else Pair phone while unpaired, else none.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { usePlan } from '../../germoney/game/plan'
import { Banner, Button, PrimaryButton } from '../kit'
import { useFrame } from '../frame/frameStore'
import { openOverlay } from '../frame/overlayRegistry'
import { SetupCard } from './forms'
import { Harvester } from './Harvester'
import { dirtyIds, useSetup } from './saveModel'
import { SECTION_LABEL } from './inputs'
import {
  AboutSection, AttendanceSection, DeadlinesSection, GoalsSection, StudySection, SubjectsSection, TimetableSection,
} from './sectionsInputs'
import {
  AppearanceSection, BackupSection, BudgetSection, CalibrationSection, CareerSection, ConnectionsSection, DatesRow, PhoneRow, RotationSection, StyleSection,
} from './sectionsPlan'
import { applyMotion, readMotion } from './appearance'
import './setup.css'

export const INDEX: readonly [anchor: string, label: string][] = [
  ['rotation', 'Rotation'], ['dates', 'Dates'], ['subjects', 'Subjects'], ['goals', 'Goals'], ['timetable', 'Timetable'],
  ['attendance', 'Attendance rule'], ['deadlines', 'Deadlines'], ['study', 'Study time'], ['about', 'About you'],
  ['budget', 'Certificate budget'], ['style', 'How the plan works'], ['calibration', 'Calibration'], ['career', 'Career settings'],
  ['connections', 'Connections'], ['phone', 'Phone'], ['backup', 'Backup'], ['appearance', 'Appearance'], ['harvester', 'Question harvester'],
]

/** The sections that read engine-inputs.json render only once it has been read: editing a default and saving it would overwrite the file. */
function InputGate({ children }: { children: ReactNode }) {
  const load = useSetup((s) => s.load)
  const refresh = useSetup((s) => s.refresh)
  if (load === 'ready') return <>{children}</>
  if (load === 'loading') return <p className="su-empty" data-su-gate="loading">Reading engine-inputs.json.</p>
  return (
    <Banner tone="fault" action={<Button size="sm" onClick={() => void refresh()}>Retry</Button>}>
      <span data-su-gate="unavailable">{'engine-inputs.json did not load, so these sections are not editable. Nothing was changed.'}</span>
    </Banner>
  )
}

export function goToSection(anchor: string): void {
  const el = document.getElementById(`su-${anchor}`)
  if (!el) return
  el.scrollIntoView?.({ block: 'start' })
  el.focus({ preventScroll: true })
}

export function SetupPage() {
  const refresh = useSetup((s) => s.refresh)
  const syncPlan = useSetup((s) => s.syncPlan)
  const saveAll = useSetup((s) => s.saveAll)
  const saving = useSetup((s) => s.saving)
  const report = useSetup((s) => s.report)
  const source = useSetup((s) => s.source)
  const load = useSetup((s) => s.load)
  const draft = useSetup((s) => s.draft)
  const dirty = dirtyIds(draft)
  const n = dirty.length
  const planState = usePlan((s) => s.state)
  const planProfile = usePlan((s) => s.profile)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    applyMotion(readMotion())
    void refresh()
  }, [refresh])
  useEffect(() => { syncPlan() }, [planState, planProfile, syncPlan])
  // the frame's static dot on the Setup tab
  useEffect(() => { useFrame.getState().setDirty('setup', n > 0) }, [n])
  useEffect(() => () => useFrame.getState().setDirty('setup', false), [])
  useEffect(() => {
    if (n === 0) return
    const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [n])

  return (
    <div className="su-page" data-page="setup">
      <nav className="su-index" aria-label="Setup sections">
        <ol>
          {INDEX.map(([a, label]) => (
            <li key={a}>
              <button type="button" className="su-index-btn ww-tap" data-index={a} onClick={() => goToSection(a)}>
                {label}
                {sectionDirty(a, dirty) && <span className="su-dot" role="img" aria-label="unsaved changes" />}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="su-main">
        <div className="su-savebar" role="region" aria-label="Save">
          <span className="su-savebar-text" data-save-state={n > 0 ? 'dirty' : 'clean'}>
            {n === 0 ? 'Save: nothing to save' : `${n} section${n === 1 ? '' : 's'} changed: ${dirty.map((d) => SECTION_LABEL[d]).join(', ')}`}
          </span>
          {n > 0 && (
            <Button size="sm" onClick={() => openOverlay('confirm', {
              title: 'Discard all changes?',
              body: `${n} unsaved section${n === 1 ? '' : 's'} will go back to what is saved.`,
              confirmLabel: 'Discard',
              destructive: true,
              onConfirm: () => useSetup.getState().discard(),
            })}>Discard all</Button>
          )}
          <PrimaryButton claimId="setup-save" rank="workspace" when={n > 0} loading={saving} disabled={n === 0}
            onClick={() => void saveAll()}>{n === 0 ? 'Save' : `Save ${n} change${n === 1 ? '' : 's'}`}</PrimaryButton>
        </div>
        {report && (report.failed.length > 0 || report.dropped.length > 0 || report.saved.length > 0) && (
          <div className="su-report" role="status" data-save-report="">
            {report.saved.length > 0 && <p>{`Saved: ${report.saved.map((d) => SECTION_LABEL[d]).join(', ')}. The engines use it from now on.`}</p>}
            {report.failed.map((f) => <p key={f.id}>{`Error: ${SECTION_LABEL[f.id]} was not saved: ${f.why}.`}</p>)}
            {report.dropped.map((d) => <p key={d}>{`Ignored by the server: ${d}`}</p>)}
          </div>
        )}
        {load === 'ready' && source !== 'private' && (
          <p className="su-hint" data-su-example="">Right now the engines read the fictional example. The first save here makes engine-inputs.json yours.</p>
        )}

        <div data-su-group="rotation"><RotationSection /></div>
        <DatesRow />
        <InputGate>
          <SubjectsSection />
          <GoalsSection />
          <TimetableSection />
          <AttendanceSection />
          <DeadlinesSection />
          <StudySection />
          <AboutSection />
        </InputGate>
        <BudgetSection />
        <StyleSection />
        <CalibrationSection />
        <CareerSection />
        <ConnectionsSection />
        <PhoneRow primaryWhenUnpaired={n === 0} />
        <BackupSection />
        <AppearanceSection />
        <Harvester />
      </div>
    </div>
  )
}

const SECTION_OF_ANCHOR: Record<string, string[]> = {
  rotation: ['rotation'], dates: ['exams'], subjects: ['subjects'], goals: ['goals'], timetable: ['timetable'], attendance: ['attendance_rule'],
  deadlines: ['deadlines'], study: ['study'], about: ['profile'], budget: ['budget'], style: ['style'], career: ['career'],
}
function sectionDirty(anchor: string, dirty: string[]): boolean {
  return (SECTION_OF_ANCHOR[anchor] ?? []).some((s) => dirty.includes(s))
}

export { SetupCard }
export default SetupPage
