/**
 * The plan, in the window: a thin client of the server's plan engine
 * (/api/mission/*, rules in app/jarvis_app/germoney.py). The server is the one
 * writer of the plan state (@mission_v2), so the voice, the phone and this window
 * can never disagree. This store caches what the pages show and turns plan events
 * (a contract done, time logged, even by voice with the window closed) into the
 * Floor and the ledger of the game store, exactly once each.
 */
import { create } from 'zustand'
import { api, post } from '../../lib/api'
import { usePlayerStore } from '../stores/player-store'
import type { NodeRecord } from './tree'

export interface Res { id: string; title: string; kind: string; url: string; free: boolean; legal_pdf_url: string | null; why?: string }
export interface PlanContract {
  key: string
  source: 'tree' | 'academics' | 'practice'
  slot: 'library' | 'evening' | 'weekend' | 'extra'
  node_id: string | null
  node_name: string | null
  branch: string | null
  title: string
  minutes: number
  xp: number
  context: string
  steps: string[]
  hint: string
  success_check: string
  why: string
  done: boolean
  verified: boolean
  read_first: Res[]
  depends_on: { id: string; name: string; status: string; resource: Res | null }[]
  primary: Res | null
  backup: Res | null
  pdfs: { title: string; url: string }[]
  pyq_refs?: string[]
  /** Local study files (faculty notes, real past papers), opened through /api/mission/academics/file. */
  files?: StudyFile[]
  /** Real past-paper questions this contract asks for. */
  questions?: { id: string; question: string; marks: number | null; sitting: string; choice_group: string }[]
  /** The subject's pass rule, with the SEE marks still needed. */
  pass?: { see_needed_computed: number | null; see_max?: number } | null
  /** Which ladder milestone it serves ("why this today"). */
  serves?: { id: string; title: string; why: string } | null
  /** Novelty-first framing from his profile: the puzzle before the theory. */
  hook?: string
}
export interface WelcomeBack { idle_days: number; since: string; slipped: string[]; next_deadline: { org: string; programme: string; days_left: number } | null; refreshers: string[]; say: string }
export interface Ladder {
  vision: { title: string; horizon: string; band: string }
  years: { year: number; milestones: { id: string; title: string; kind?: string }[] }[]
  year: number
  quarter: { label: string; ends: string; goals: { serves: string | null; title: string }[] }
  month: { label: string; ends: string; goals: { serves: string | null; title: string }[] }
  week: { ends: string; goals: { serves: string | null; title: string }[] }
  reviews: { month: string; went_well: string; slipped: string; next: string }[]
  review_due: boolean
}
export interface Profile { traits: string[]; rules: string[]; style: { novelty_first: boolean; choices: number; sprint_minutes: number; wip_cap: number; quiet_hours: [string, string]; nudge_after_idle_days: number; welcome_back_after_days: number; refresh_after_days: number } }
export interface LearningEntry { id: string; date: string; what: string; minutes: number; tags: string[]; note: string; files: string[]; suggested_nodes: { id: string; name: string; score: number }[]; nodes: string[]; xp: number; via: string }
export interface StudyFile { title: string; path: string; pages: string | null; role: string; kind: string; allowed: boolean }
export interface Deadline { id: string; org: string; programme: string; closes: string | null; days_left: number | null; status: string; url: string; verified: boolean }
export interface Application {
  id: string; org: string; programme: string; url: string; opens: string | null; closes: string | null
  status: 'idea' | 'preparing' | 'applied' | 'interview' | 'offer' | 'rejected' | 'not_eligible'
  requirements: string[]; stipend: string; notes: string; reason: string; verified: boolean; source: string
  days_left: number | null; opens_in: number | null; nodes: { id: string; name: string; status: string }[]
  prep: { id: string; title: string; done: boolean }[]
}
export interface Goal { id: string; title: string; target: string; kind: string; milestones: { id: string; title: string; by: string | null; progress: number; done: boolean; linked_nodes: string[] }[] }
export interface ApplicationsView {
  applications: Application[]; pipeline: Record<string, string[]>; due_soon: Application[]
  tasks: { id: string; title: string; due: string | null; done?: boolean; days_left: number | null }[]; goals: Goal[]
}

/** Open a local study file: the API needs the token header, so fetch it and show the blob. */
export async function openStudyFile(path: string): Promise<void> {
  const { TOKEN } = await import('../../lib/api')
  const r = await fetch(`/api/mission/academics/file?path=${encodeURIComponent(path)}`, { headers: { 'X-Jarvis-Token': TOKEN } })
  if (!r.ok) throw new Error('That file is not available.')
  window.open(URL.createObjectURL(await r.blob()), '_blank', 'noopener')
}
export interface Block { id: string; kind: 'library' | 'evening' | 'protected' | 'weekend'; label: string; start: string; minutes: number; track?: string }
export interface ExamInfo {
  subject: { id: string; name: string; kind: 'current' | 'backlog'; exam_date: string | null; strategy: string } | null
  days_left: number | null
  date_kind: string | null
  forced: boolean
  queue: { id: string; name: string; kind: string; days_left: number | null; date_kind?: string; see_needed?: number | null; see_max?: number | null }[]
  advice: string | null
  /** The academics plan's phase for today (internals sprint, backlog-first build…). */
  phase: { n: number; name: string; days_left: number; anchor: string } | null
  milestone: string | null
  rescue_week: { week: string; library: string; evenings: string } | null
}
export interface Wins { contracts: number; minutes: number; xp: number; nodes: string[]; mastered: number; shipped: number }
export interface Today {
  date: string
  weekday: number
  track: string | null
  track_label: string | null
  blocks: Block[]
  contracts: PlanContract[]
  exam: ExamInfo | null
  note: string | null
  /** Internship deadlines within 14 days and prep tasks due this week. */
  deadlines?: Deadline[]
  /** Other contracts he may pick instead (his profile: a choice, not one fixed task). */
  alternatives?: PlanContract[]
  /** Set when he comes back after a gap. */
  welcome_back?: WelcomeBack | null
  wins: Wins
  wip: string[]
  wip_cap: number
  level: { level: number; into: number; need: number }
  xp: number
  bank_ready: boolean
  academics_ready: boolean
}
export interface PlanEvent {
  id: string
  t: number
  date: string
  kind: string
  minutes?: number
  track?: string
  rep?: 'silicon' | 'deutsch' | 'body' | null
  node?: string | null
  xp?: number
  verified?: boolean
  title?: string
  note?: string
  key?: string
}
export interface RotationDay { track: string; label: string; match: string[] }
export interface PlanState {
  xp: number
  career: string | null
  statuses: Record<string, string>
  nodes: Record<string, NodeRecord>
  contracts: Record<string, { done: string; proof: string; verified: boolean; xp: number; node: string | null }>
  events: PlanEvent[]
  rotation: Record<string, RotationDay>
  schedule: Record<string, { start: string; minutes: number; label?: string }>
  exam: { focus: { subject: string; until: string } | null; window_days: number }
  parking: { id: string; text: string; at: string; node?: string | null }[]
  campaigns: Record<string, { status: string; started?: string; shipped?: string; url?: string }>
  wip: string[]
  wip_cap: number
  budget: { cert_inr_month: number; cert_stretch_inr: number }
  certs: Record<string, { earned: string; url: string; node: string | null }>
  xp_migrated_from: number | null
  bank: { files: string[]; warnings: string[]; errors: string[]; nodes: number }
}
export interface Campaign {
  id: string
  node_id: string
  title: string
  finish_line: string
  linkedin_line: string
  ship_steps: string[]
  path: { id: string; name: string; status: string }[]
  left: number
  hours_left: number
  weeks: number
  weight: number
  status: 'suggested' | 'active' | 'shipped' | 'dropped'
  started?: string | null
  shipped?: string | null
  url?: string | null
  ready_to_ship: boolean
}
export interface CertRow {
  id: string; name: string; issuer: string; cost_inr: number | null; free_option: string | null; time_hours: number | null
  credibility: string; linkedin_worthy: boolean; node_ids: string[]; url: string | null
  earned: { earned: string; url: string } | null; budget_fit: 'free' | 'in budget' | 'stretch' | 'over budget'
}
export interface Subject { id: string; name: string; kind: string; exam_date: string | null; days_left: number | null; strategy: string; units: { n: number; title: string; exam_weight: number }[]; date_set_here?: boolean }
export interface Academics {
  missing?: boolean
  semester?: string | null
  subjects: Subject[]
  plan?: Record<string, unknown>
  calendar?: Record<string, string | null>
  rescue?: { subject: string | null; target: string } | null
  unresolved?: string[]
}
export interface Finding { node_id: string; name: string; cats: string[]; papers: { id: string; title: string; summary: string; published: string; url: string }[]; fetched: string | null; stale: boolean; error: string | null }

interface PlanStore {
  today: Today | null
  state: PlanState | null
  campaigns: { campaigns: Campaign[]; active: number; cap: number } | null
  certs: { certs: CertRow[]; budget: PlanState['budget'] } | null
  academics: Academics | null
  findings: Finding[] | null
  applications: ApplicationsView | null
  ladder: Ladder | null
  profile: Profile | null
  learning: LearningEntry[] | null
  offline: boolean
  choose: (key: string, alt: string) => Promise<{ ok: boolean; say: string }>
  loadLadder: () => Promise<void>
  review: (r: { went_well: string; slipped: string; next: string }) => Promise<void>
  loadProfile: () => Promise<void>
  saveProfile: (p: Partial<Profile>) => Promise<void>
  loadLearning: () => Promise<void>
  addLearning: (e: { what: string; minutes: number; note?: string; tags?: string[]; files?: { name: string; data: string }[] }) => Promise<{ ok: boolean; say: string }>
  correctLearning: (entry: string, nodes: string[]) => Promise<void>
  loadApplications: () => Promise<void>
  setAppStatus: (id: string, status: Application['status']) => Promise<void>
  upsertApp: (entry: Partial<Application> & { id: string }) => Promise<void>
  setTask: (task: { id?: string; title?: string; due?: string | null; done?: boolean }) => Promise<void>
  refresh: () => Promise<void>
  loadRoad: () => Promise<void>
  loadAcademics: () => Promise<void>
  loadFindings: (refresh?: boolean) => Promise<void>
  complete: (key: string, proof: string) => Promise<{ ok: boolean; say: string }>
  log: (entry: { minutes: number; track: string; note?: string; proof?: string; node?: string | null }) => Promise<{ ok: boolean; say: string }>
  node: (id: string, op: 'start' | 'pause' | 'master') => Promise<{ ok: boolean; say: string }>
  attribute: (id: string, a: { kind: 'cert' | 'project' | 'achievement'; text: string; url?: string; cert?: string | null }) => Promise<{ ok: boolean; say: string }>
  campaign: (id: string, op: 'start' | 'ship' | 'drop', url?: string) => Promise<{ ok: boolean; say: string }>
  earnCert: (cert: string, url: string) => Promise<{ ok: boolean; say: string }>
  park: (text: string, node?: string | null) => Promise<void>
  unpark: (id: string) => Promise<void>
  setCareer: (career: string | null) => Promise<void>
  setSettings: (s: { rotation?: Record<string, RotationDay>; schedule?: PlanState['schedule']; window_days?: number; budget?: Partial<PlanState['budget']> }) => Promise<void>
  setExamDate: (subject: string, date: string | null) => Promise<void>
  examFocus: (subject: string | null) => Promise<{ ok: boolean; say: string }>
  reroll: () => Promise<void>
}

/** Plan events are applied to the game store by whoever registers here (game/store.ts). */
let sink: ((events: PlanEvent[], examToday: boolean) => void) | null = null
export function onPlanEvents(fn: typeof sink) {
  sink = fn
}

export const usePlan = create<PlanStore>((set, get) => {
  const after = async <T,>(p: Promise<T>): Promise<T> => {
    const r = await p
    await get().refresh()
    return r
  }
  const fail = (e: unknown) => ({ ok: false, say: (e as Error).message || 'The server refused that.' })
  return {
    today: null,
    state: null,
    campaigns: null,
    certs: null,
    academics: null,
    findings: null,
    applications: null,
    ladder: null,
    profile: null,
    learning: null,
    offline: false,

    choose: (key, alt) => after(post<{ ok: boolean; say: string }>('/api/mission/choose', { key, alt })).catch(fail),
    loadLadder: async () => {
      try { set({ ladder: await api<Ladder>('/api/mission/ladder') }) } catch { /* keep the last */ }
    },
    review: async (r) => {
      await post('/api/mission/review', r).catch(() => {})
      await get().loadLadder()
    },
    loadProfile: async () => {
      try { set({ profile: await api<Profile>('/api/mission/profile') }) } catch { /* keep the last */ }
    },
    saveProfile: async (p) => {
      try { set({ profile: await api<Profile>('/api/mission/profile', { method: 'PUT', body: p }) }) } catch { /* keep the last */ }
      await get().refresh()
    },
    loadLearning: async () => {
      try { set({ learning: (await api<{ entries: LearningEntry[] }>('/api/mission/learning')).entries }) } catch { set({ learning: get().learning ?? [] }) }
    },
    addLearning: async (e) => {
      const r = await after(post<{ ok: boolean; say: string }>('/api/mission/learning', e)).catch(fail)
      await get().loadLearning()
      return r
    },
    correctLearning: async (entry, nodes) => {
      await api(`/api/mission/learning/${encodeURIComponent(entry)}/nodes`, { method: 'PUT', body: { nodes } }).catch(() => {})
      await get().loadLearning()
    },

    loadApplications: async () => {
      try { set({ applications: await api<ApplicationsView>('/api/mission/applications') }) } catch { /* keep the last */ }
    },
    setAppStatus: async (id, status) => {
      await post(`/api/mission/applications/${encodeURIComponent(id)}/status`, { status }).catch(() => {})
      await get().loadApplications()
      await get().refresh()
    },
    upsertApp: async (entry) => {
      await api('/api/mission/applications', { method: 'PUT', body: { entry } }).catch(() => {})
      await get().loadApplications()
    },
    setTask: async (task) => {
      await api('/api/mission/tasks', { method: 'PUT', body: { task } }).catch(() => {})
      await get().loadApplications()
      await get().refresh()
    },

    refresh: async () => {
      try {
        await usePlayerStore.getState().flushXp()
        const [today, state] = await Promise.all([api<Today>('/api/mission/today'), api<PlanState>('/api/mission/state')])
        if (!today || !Array.isArray(today.contracts) || !state || typeof state.xp !== 'number') throw new Error('not a plan')
        set({ today, state, offline: false })
        usePlayerStore.getState().syncXP(state.xp)
        sink?.(state.events ?? [], !!today.exam)
      } catch {
        set({ offline: true })
      }
    },

    loadRoad: async () => {
      try {
        const [campaigns, certs] = await Promise.all([
          api<PlanStore['campaigns']>('/api/mission/campaigns'), api<PlanStore['certs']>('/api/mission/certs')])
        set({ campaigns, certs })
      } catch { /* the Road shows what it has */ }
    },

    loadAcademics: async () => {
      try { set({ academics: await api<Academics>('/api/mission/academics') }) } catch { /* keep the last */ }
    },

    loadFindings: async (refresh = false) => {
      try {
        const r = await api<{ nodes: Finding[] }>(`/api/mission/findings${refresh ? '?refresh=true' : ''}`)
        set({ findings: Array.isArray(r?.nodes) ? r.nodes : [] })
      } catch { set({ findings: get().findings ?? [] }) }
    },

    complete: (key, proof) => after(post<{ ok: boolean; say: string }>('/api/mission/contract', { key, proof })).catch(fail),
    log: (entry) => after(post<{ ok: boolean; say: string }>('/api/mission/log', entry)).catch(fail),
    node: (id, op) => after(post<{ ok: boolean; say: string }>(`/api/mission/node/${encodeURIComponent(id)}/${op}`)).catch(fail),
    attribute: (id, a) => after(post<{ ok: boolean; say: string }>(`/api/mission/node/${encodeURIComponent(id)}/attribute`, a)).catch(fail),
    campaign: async (id, op, url = '') => {
      const r = await after(post<{ ok: boolean; say: string }>(`/api/mission/campaign/${op}`, { id, url })).catch(fail)
      await get().loadRoad()
      return r
    },
    earnCert: async (cert, url) => {
      const r = await after(post<{ ok: boolean; say: string }>('/api/mission/cert', { cert, url })).catch(fail)
      await get().loadRoad()
      return r
    },
    park: async (text, node = null) => { await after(post('/api/mission/parking', { text, node })).catch(() => {}) },
    unpark: async (id) => { await after(api(`/api/mission/parking/${encodeURIComponent(id)}`, { method: 'DELETE' })).catch(() => {}) },
    setCareer: async (career) => { await after(api('/api/mission/career', { method: 'PUT', body: { career } })).catch(() => {}) },
    setSettings: async (s) => {
      await after(api('/api/mission/settings', { method: 'PUT', body: s })).catch(() => {})
      await get().loadRoad()
    },
    setExamDate: async (subject, date) => {
      await after(api('/api/mission/academics/exam', { method: 'PUT', body: { subject, date } })).catch(() => {})
      await get().loadAcademics()
    },
    examFocus: (subject) => after(post<{ ok: boolean; say: string }>('/api/mission/exam', { subject })).catch(fail),
    reroll: async () => { await after(post('/api/mission/today/reroll')).catch(() => {}) },
  }
})

/** Mins → "1 h 30" / "45 min". */
export const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}` : `${m} min`)

/** "10:00" + 180 → "13:00". */
export function endOf(start: string, minutes: number): string {
  const [h, m] = start.split(':').map(Number)
  const t = h * 60 + m + minutes
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}
