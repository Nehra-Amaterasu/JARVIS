// Career (plan 4.7, chunk 11): the pure part. Nothing here touches a store or the DOM, so every rule
// the contract tests name (soonest deadline, due-now count, next action, paging) is checked on plain data.
import type { Application, ApplicationsView } from '../../germoney/game/plan'
import { CHEST_ITEMS, toInr } from '../../germoney/game/trials'
import { daysBetween, fromKey, MONTHS } from '../../germoney/game/util'

export const CAREER_VIEWS = [
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'certs', label: 'Certificates' },
  { id: 'abroad', label: 'Abroad' },
  { id: 'money', label: 'Money' },
  { id: 'plan', label: 'Plan' },
] as const
export type CareerView = (typeof CAREER_VIEWS)[number]['id']
export const isCareerView = (v: unknown): v is CareerView => CAREER_VIEWS.some((x) => x.id === v)

/**
 * "Due now" is a closing date 14 days away or sooner. 14 is the number the old Road page already used for
 * its "soon" colour and for the Today deadline line, so the tab badge, the Up next count and Today agree.
 */
export const DUE_NOW_DAYS = 14

export type DueKind = 'application' | 'task' | 'trial'
export interface Due {
  id: string
  kind: DueKind
  what: string
  sub: string
  days: number
  /** 'set' when the date is verified or the owner typed it, 'approximate' when the bank flags it to check. */
  confidence: 'set' | 'approximate'
  url?: string
  /** application id, task id or trial id */
  ref: string
}

export interface TrialDate {
  id: string
  name: string
  date: string | null | undefined
}

export const daysFrom = (today: string, key: string): number => daysBetween(today, key)

/**
 * Every dated thing ahead, soonest first: open applications (idea or preparing; once applied the closing
 * date asks nothing), undone prep tasks, Germany exam dates. Same set as the old Road page's UpNext,
 * so nothing that was a deadline there stops being one.
 */
export function buildDeadlines(view: ApplicationsView | null, trials: TrialDate[], today: string): Due[] {
  const out: Due[] = []
  for (const a of view?.applications ?? []) {
    if (a.days_left === null || a.days_left < 0 || (a.status !== 'idea' && a.status !== 'preparing')) continue
    out.push({ id: `app-${a.id}`, kind: 'application', what: a.org, sub: `${a.programme || 'application'} closes`, days: a.days_left, confidence: a.verified ? 'set' : 'approximate', url: a.url || undefined, ref: a.id })
  }
  for (const t of view?.tasks ?? []) {
    if (t.done || t.days_left === null || t.days_left < 0) continue
    out.push({ id: `task-${t.id}`, kind: 'task', what: t.title, sub: 'prep task due', days: t.days_left, confidence: 'set', ref: t.id })
  }
  for (const t of trials) {
    if (t.date && t.date >= today) out.push({ id: `trial-${t.id}`, kind: 'trial', what: t.name, sub: 'Germany: exam or deadline', days: daysFrom(today, t.date), confidence: 'set', ref: t.id })
  }
  return out.sort((a, b) => a.days - b.days || a.id.localeCompare(b.id))
}

/** The number on the Career tab: how many deadlines are 14 days away or sooner. */
export const dueNowCount = (due: Due[]): number => due.filter((d) => d.days <= DUE_NOW_DAYS).length

export const inDays = (n: number): string => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `${n} d`)

// ---- the pipeline row: a stage stepper and a next action on every row (CAREER-STATUS-03)
export const STEPPER = ['idea', 'preparing', 'applied', 'interview', 'offer'] as const
export type StepStage = (typeof STEPPER)[number]
export const STAGE_WORD: Record<Application['status'], string> = {
  idea: 'Idea',
  preparing: 'Preparing',
  applied: 'Applied',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  not_eligible: 'Not eligible',
}

/** Where the row stands on the five-step stepper; null for the two ends that are not steps. */
export function stageIndex(status: Application['status']): number | null {
  const i = (STEPPER as readonly string[]).indexOf(status)
  return i < 0 ? null : i
}

export type NextKind = 'decide' | 'prep' | 'submit' | 'wait' | 'interview' | 'reply' | 'closed'
export interface NextStep {
  kind: NextKind
  /** The words on the row, after "next:". */
  text: string
  /** For 'prep': the checklist item this step ticks off. */
  prepId?: string
}

/**
 * The next action for one application, taken from the data and never made up: the first prep item that
 * is not done, else the stage's own step. A row that has nothing to do says so ("wait for a reply").
 */
export function nextStep(a: Application): NextStep {
  switch (a.status) {
    case 'idea':
      return { kind: 'decide', text: 'decide whether to apply' }
    case 'preparing': {
      const p = a.prep.find((x) => !x.done)
      if (p) return { kind: 'prep', text: p.title, prepId: p.id }
      return { kind: 'submit', text: a.url ? 'submit the application' : 'submit, then mark it applied' }
    }
    case 'applied':
      return { kind: 'wait', text: 'wait for a reply' }
    case 'interview':
      return { kind: 'interview', text: 'prepare for the interview' }
    case 'offer':
      return { kind: 'reply', text: 'reply to the offer' }
    default:
      return { kind: 'closed', text: 'nothing to do' }
  }
}

/** Soonest open deadline first; undated next; closed ones last (the old Road order). */
export function byUrgency(a: Application, b: Application): number {
  const rank = (x: Application) => (x.days_left === null ? 1e6 : x.days_left < 0 ? 2e6 - x.days_left : x.days_left)
  return rank(a) - rank(b)
}

/** Live applications by urgency, then the ruled-out ones, so every application is reachable from one pager. */
export function pipelineRows(view: ApplicationsView | null): Application[] {
  const all = view?.applications ?? []
  return [...all.filter((a) => a.status !== 'not_eligible').sort(byUrgency), ...all.filter((a) => a.status === 'not_eligible')]
}

// ---- paging: the plan's answer to a long list on a canvas that does not scroll
export interface PageOf<T> {
  rows: T[]
  page: number
  pages: number
  /** 1-based, for "6 to 10 of 23"; both 0 when empty. */
  from: number
  to: number
  total: number
}
export function paginate<T>(items: readonly T[], page: number, size: number): PageOf<T> {
  const n = Math.max(1, Math.floor(size))
  const pages = Math.max(1, Math.ceil(items.length / n))
  const p = Math.min(Math.max(0, page), pages - 1)
  const rows = items.slice(p * n, p * n + n)
  return { rows, page: p, pages, from: rows.length ? p * n + 1 : 0, to: rows.length ? p * n + rows.length : 0, total: items.length }
}

/** How many fixed-height rows fit in a box. Never below 1: a list with a row it cannot show is a dead end. */
export const rowsThatFit = (boxPx: number, rowPx: number, fallback: number): number => (boxPx > 0 && rowPx > 0 ? Math.max(1, Math.floor(boxPx / rowPx)) : fallback)

// ---- money (rupees only)
export const inr = (n: number): string => `₹${Math.round(n).toLocaleString('en-IN')}`

export interface ChestRow {
  id: string
  label: string
  inr: number
  due: string
  /** where the figure came from; euro figures are converted at the rate and the euro amount stays in the title attribute */
  src: string
  eur: string | null
  custom: boolean
  run: number
  perMonth: number
}
export interface ChestInput {
  saved: number
  custom: { id: string; label: string; inr: number; due: string }[]
  rate: number
  today: string
}
/** The War Chest table with running totals, sorted by due month; same arithmetic as the old Armory card. */
export function chestRows({ saved, custom, rate, today }: ChestInput): ChestRow[] {
  const base = [
    ...CHEST_ITEMS.map((c) => ({ id: c.id, label: c.label, inr: toInr(c.cost, rate), due: c.due, src: c.cost.source, eur: c.cost.currency === 'EUR' ? `€${c.cost.amount.toLocaleString('en-IN')}` : null, custom: false })),
    ...custom.map((c) => ({ id: c.id, label: c.label, inr: c.inr, due: c.due, src: 'your estimate', eur: null, custom: true })),
  ].sort((a, b) => a.due.localeCompare(b.due))
  const now = fromKey(today)
  let run = 0
  return base.map((r) => {
    run += r.inr
    const [y, m] = r.due.split('-').map(Number)
    const months = Math.max(1, (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth()))
    return { ...r, run, perMonth: Math.max(0, (run - saved) / months) }
  })
}
export const dueMonth = (due: string): string => `${MONTHS[Number(due.slice(5, 7)) - 1]} ${due.slice(0, 4)}`
