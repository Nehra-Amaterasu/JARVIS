// Invented rows for the T02 gallery states and the tests (stamped SIMULATED by the page when it is drawn from them). Nothing here is
// a real person, organisation, place or date of the owner's: the names are made up and the fixture clock is a plain Wednesday.
import type { Application, CertRow, Ladder, Goal } from '../../../germoney/game/plan'
import { addDays } from '../../../germoney/game/util'
import type { UniCol } from './Abroad'
import type { CostItem } from './model'
import type { NodeName } from './Ladder'
import { slug, type Cell, type FundingSource, type RoleProfile } from './store'

export const FIXTURE_TODAY = '2026-11-18'
const d = (n: number) => addDays(FIXTURE_TODAY, n)

const app = (id: string, org: string, programme: string, status: Application['status'], closes: number | null, extra: Partial<Application> = {}): Application => ({
  id, org, programme, url: '', opens: null, closes: closes === null ? null : d(closes), status, requirements: [], stipend: '', notes: '', reason: '', verified: false, source: 'invented',
  days_left: closes, opens_in: null, nodes: [], prep: status === 'preparing' ? [{ id: `${id}-p1`, title: 'Write the cover note', done: false }] : [], ...extra,
})

export const FIXTURE_APPS: Application[] = [
  app('northgate-intern', 'Northgate Labs', 'Summer internship', 'preparing', 9),
  app('quayside-grad', 'Quayside Systems', 'Graduate programme', 'idea', 23),
  app('lumen-research', 'Lumen Research Group', 'Research placement', 'applied', 41),
  app('ashford-design', 'Ashford Design Works', 'Junior engineer', 'interview', 64),
  app('vale-intern', 'Vale Instruments', 'Embedded internship', 'idea', 88),
  app('orchard-offer', 'Orchard Semiconductor', 'Trainee', 'offer', 111),
  app('quay-late', 'Quay Analytics', 'Data internship', 'idea', 190),
  app('fen-out', 'Fen Optics', 'Technician', 'not_eligible', 30, { reason: 'needs a licence you do not hold' }),
]

export const FIXTURE_CELLS: Record<string, Cell> = {
  'app:northgate-intern': { value: d(9), on: '2026-11-16' },
  'app:lumen-research': { value: d(41), on: '2026-11-10' },
  'northgate-university:course': { value: 'MSc Embedded Systems', on: '2026-11-15' },
  'northgate-university:language': { value: 'English', on: '2026-11-15' },
  'northgate-university:checked': { value: 'page opened', on: '2026-11-15' },
  'northgate-university:tuition': { value: 'none stated', on: '2026-11-15' },
}

export const FIXTURE_CERTS: CertRow[] = [
  { id: 'c1', name: 'Embedded C practitioner', issuer: 'Open Skills Board', cost_inr: 0, free_option: null, time_hours: 20, credibility: '4 of 5', linkedin_worthy: true, node_ids: ['n-c', 'n-rtos'], url: null, earned: { earned: '2026-10-03', url: 'https://example.org/c1' }, budget_fit: 'free' },
  { id: 'c2', name: 'Signal processing basics', issuer: 'Open Skills Board', cost_inr: 1000, free_option: 'audit free', time_hours: 40, credibility: '4 of 5', linkedin_worthy: false, node_ids: ['n-dsp'], url: 'https://example.org/c2', earned: null, budget_fit: 'in budget' },
  { id: 'c3', name: 'Hardware description course', issuer: 'Example Institute', cost_inr: 4500, free_option: null, time_hours: 60, credibility: '5 of 5', linkedin_worthy: true, node_ids: ['n-hdl'], url: null, earned: null, budget_fit: 'stretch' },
  { id: 'c4', name: 'Version control essentials', issuer: 'Example Institute', cost_inr: 0, free_option: null, time_hours: 6, credibility: '3 of 5', linkedin_worthy: false, node_ids: ['n-git'], url: 'https://example.org/c4', earned: { earned: '2026-09-21', url: 'https://example.org/c4' }, budget_fit: 'free' },
  ...Array.from({ length: 10 }, (_, i): CertRow => ({ id: `cx${i}`, name: `Course certificate ${i + 1}`, issuer: 'Example Institute', cost_inr: 800 * (i + 1), free_option: null, time_hours: 12, credibility: '3 of 5', linkedin_worthy: false, node_ids: ['n-misc'], url: null, earned: null, budget_fit: 'in budget' })),
]

export const FIXTURE_LADDER: Ladder = {
  vision: { title: 'A career that earns well and ethically', horizon: '10 years', band: 'long' },
  years: [
    { year: 2026, milestones: [{ id: 'm1', title: 'Finish the core embedded track' }, { id: 'm2', title: 'Ship one open project' }] },
    { year: 2027, milestones: [{ id: 'm3', title: 'A summer placement' }, { id: 'm4', title: 'Language level for study abroad' }, { id: 'm5', title: 'Apply to three programmes' }] },
    { year: 2028, milestones: [{ id: 'm6', title: 'Start the master\'s course' }] },
  ],
  year: 2026,
  quarter: { label: '2026 Q4', ends: '2026-12-31', goals: [{ serves: 'm1', title: 'Finish the signal processing module notes' }, { serves: 'm2', title: 'Publish the first release of the project' }] },
  month: { label: 'November 2026', ends: '2026-11-30', goals: [{ serves: 'm1', title: 'Finish the filter design set' }] },
  week: { ends: '2026-11-22', goals: [{ serves: null, title: 'Three focused sessions on the project' }] },
  reviews: [],
  review_due: true,
} as Ladder

export const FIXTURE_GOALS: Goal[] = [
  { id: 'g1', title: 'Study abroad', target: '2028', kind: 'long_term', milestones: [{ id: 'm4', title: 'Language level for study abroad', by: '2027-06', progress: 0.4, done: false, linked_nodes: ['n-lang'] }, { id: 'm5', title: 'Apply to three programmes', by: '2027-11', progress: 0.1, done: false, linked_nodes: [] }] },
]

export const FIXTURE_NODES: NodeName[] = [
  { id: 'n-c', name: 'Embedded C' }, { id: 'n-rtos', name: 'Real-time operating systems' }, { id: 'n-dsp', name: 'Signal processing' },
  { id: 'n-hdl', name: 'Hardware description' }, { id: 'n-git', name: 'Version control' }, { id: 'n-pcb', name: 'Board design' }, { id: 'n-lang', name: 'German language' },
]
export const FIXTURE_EVIDENCED: ReadonlySet<string> = new Set(['n-c', 'n-git'])
export const FIXTURE_ROLES: RoleProfile[] = [
  { id: 'embedded', title: 'Embedded engineer', tags: ['Embedded C', 'Real-time operating systems', 'Version control', 'Board design'] },
  { id: 'dsp', title: 'Signal engineer', tags: ['Signal processing', 'Embedded C', 'Hardware description'] },
  { id: 'verif', title: 'Verification engineer', tags: ['Hardware description', 'Version control'] },
  { id: 'pcb', title: 'Board designer', tags: ['Board design', 'Embedded C'] },
]
export const FIXTURE_TAGNODE: Record<string, string> = {
  'Embedded C': 'n-c', 'Real-time operating systems': 'n-rtos', 'Version control': 'n-git', 'Board design': 'n-pcb', 'Signal processing': 'n-dsp', 'Hardware description': 'n-hdl',
}

export const FIXTURE_FUNDING: FundingSource[] = [
  { id: 'f1', label: 'Family contribution', kind: 'family', inr: 600000, on: '2026-11-12' },
  { id: 'f2', label: 'A scholarship I found', kind: 'scholarship', inr: 250000, on: '2026-11-14', deadline: d(70) },
  { id: 'f3', label: 'Part-time work', kind: 'work', inr: 180000, on: '2026-11-14' },
]
export const FIXTURE_COST_ITEMS: CostItem[] = [
  { id: 'lang', label: 'Language exam', due: '2027-02', cur: 'EUR', bank: 150, custom: false, asOf: '2026-10-09' },
  { id: 'test', label: 'Entrance test', due: '2027-04', cur: 'EUR', bank: 120, custom: false, asOf: '2026-10-09' },
  { id: 'cert', label: 'Certificate exam', due: '2027-06', cur: 'INR', bank: 1000, custom: false, asOf: '2026-10-09' },
  { id: 'flight', label: 'A flight', due: '2027-08', cur: 'INR', bank: 60000, custom: true, asOf: null },
  { id: 'deposit', label: 'A deposit', due: '2027-09', cur: 'EUR', bank: 900, custom: false, asOf: '2026-10-09' },
  { id: 'visa', label: 'Visa fee', due: '2027-09', cur: 'EUR', bank: 75, custom: false, asOf: '2026-10-09' },
]
export const FIXTURE_COST_CELLS: Record<string, Cell> = {
  'cost:lang': { value: '150', on: '2026-11-16' },
  'cost:test': { value: '120', on: '2026-11-16' },
  'cost:cert': { value: '1000', on: '2026-11-16' },
}

export const FIXTURE_UNIS: UniCol[] = ['Northgate University', 'Quayside Institute of Technology', 'Ashford Polytechnic', 'Vale University of Applied Sciences'].map((name, i) => ({
  key: slug(name), name,
  uni: { name, program: 'MSc Embedded Systems', language: 'English', gpa: '', ects: '', prerequisites: 'an entrance test', portal: 'its portal', portalUrl: `https://example.org/${i}`, intake: 'winter' },
}))
