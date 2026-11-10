/**
 * Setup's data layer (plan 4.9, chunk 12): the types of the engine-inputs sections and the two calls the
 * old Settings drawer already used, GET /api/mission/inputs and PUT /api/mission/inputs/{section}.
 * No new route: the page only replaces the JSON editors with forms over the same payloads.
 */
import { api } from '../../lib/api'

export interface ExamRow {
  id?: string
  subject: string
  title: string
  code?: string
  date: string
  start?: string | null
  end?: string | null
  units: number[]
  may_miss?: boolean
  difficulty?: 'easy' | 'normal' | 'hard'
  target?: number | null
  max?: number
  kind?: 'end_sem' | 'backlog' | 'cie' | 'other'
  approx?: boolean
  pattern?: unknown[]
  pattern_source?: string
}
export interface DeadlineRow { id?: string; title?: string; item?: string; date: string; kind?: string }
export interface ProfileInputs { traits?: string[]; weak_points?: string[]; prefers?: string[]; github?: string | null; [k: string]: unknown }
export interface StudyInputs { weekday_minutes?: number; weekend_minutes?: number; exam_evening_minutes?: number; build_cap_exam?: number; build_cap?: number }
export interface UnitRow { n: number; title: string; exam_weight?: 'high' | 'med' | 'low'; topics?: string[] }
export interface BankRow { unit?: number; topic?: string; question: string; marks?: number; section?: string }
export interface SubjectRow { id: string; name: string; units?: UnitRow[]; question_bank?: BankRow[] }
export interface GoalRow { id: string; horizon: string; metric: string; target?: number | string | null; deadline?: string | null }
export interface SlotRow { day: string; start: string; end: string; subject: string; kind?: string }
export interface TimetableInputs { section?: string; room?: string; slots: SlotRow[] }
export interface AttendanceInputs { threshold: number; scope: 'per_subject' | 'overall'; confirmed?: boolean }

export interface InputsRaw {
  exams?: ExamRow[]
  deadlines?: DeadlineRow[]
  profile?: ProfileInputs
  study?: StudyInputs
  subjects?: SubjectRow[]
  goals?: GoalRow[]
  timetable?: TimetableInputs
  attendance_rule?: AttendanceInputs
}
export interface InputsAnswer { raw: InputsRaw; inputs: { source: string; warnings: string[] } }
export interface SaveAnswer { saved: string; dropped: string[] }

export const loadInputs = () => api<InputsAnswer>('/api/mission/inputs')
export const putSection = (section: string, value: unknown) => api<SaveAnswer>(`/api/mission/inputs/${section}`, { method: 'PUT', body: { value } })

export const DEFAULTS = {
  exams: [] as ExamRow[],
  deadlines: [] as DeadlineRow[],
  profile: {} as ProfileInputs,
  study: {} as StudyInputs,
  subjects: [] as SubjectRow[],
  goals: [] as GoalRow[],
  timetable: { slots: [] } as TimetableInputs,
  attendance_rule: { threshold: 0.75, scope: 'per_subject', confirmed: false } as AttendanceInputs,
}

/** The sections of engine-inputs.json the page edits, in the order of the plan's index. */
export const INPUT_SECTIONS = ['exams', 'subjects', 'goals', 'timetable', 'attendance_rule', 'deadlines', 'study', 'profile'] as const
export type InputSection = (typeof INPUT_SECTIONS)[number]

/** Sections that are not in engine-inputs.json: their own routes, saved through the plan store. */
export const PLAN_SECTIONS = ['rotation', 'budget', 'career', 'style'] as const
export type PlanSection = (typeof PLAN_SECTIONS)[number]
export type SectionId = InputSection | PlanSection

export const SECTION_LABEL: Record<SectionId, string> = {
  exams: 'Date sheet', subjects: 'Subjects', goals: 'Goals', timetable: 'Timetable', attendance_rule: 'Attendance rule',
  deadlines: 'Deadlines', study: 'Study time', profile: 'About you', rotation: 'Rotation', budget: 'Certificate budget',
  career: 'Career settings', style: 'How the plan works',
}

export const lines = (v?: string[]) => (v ?? []).join('\n')
export const unlines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)
