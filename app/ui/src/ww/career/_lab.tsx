// The Career lab (chunk 11): the REAL Frame with the REAL CareerPage in it, fed fictional rows, no network.
// e2e/career.spec.ts builds this module in memory (like the kitchen sink) and loads it into a static page, so the
// "no scroll" and "hit area" checks run against the centre column the frame really gives the page, not a guess.
// Nothing in the app imports this file. Every name below is invented.
import { createRoot, type Root } from 'react-dom/client'
import { Frame } from '../frame/Frame'
import { useFrame } from '../frame/frameStore'
import { usePlan, type Application, type CertRow, type Campaign } from '../../germoney/game/plan'
import { useGame } from '../../germoney/game/store'
import { CareerPage } from './CareerPage'
import { CAREER_VIEWS } from './model'

const none = async () => {}
const stub = (name: string) => () => <p className="empty">{name} is not part of this lab.</p>

const STATUSES: Application['status'][] = ['preparing', 'idea', 'applied', 'preparing', 'interview', 'idea', 'preparing', 'offer', 'preparing', 'idea', 'rejected', 'not_eligible']
const apps: Application[] = STATUSES.map((status, i) => ({
  id: `app-${i}`, org: `Example Institute ${i + 1}`, programme: `Summer programme ${String.fromCharCode(65 + i)}`, url: i % 3 ? '' : 'https://example.org/apply', opens: null,
  closes: null, status, requirements: [], stipend: '', notes: '', reason: status === 'not_eligible' ? 'needs a later study year' : '', verified: i % 2 === 0, source: '',
  days_left: status === 'not_eligible' ? null : 3 + i * 6, opens_in: null, nodes: [],
  prep: status === 'preparing' ? [{ id: `p-${i}-1`, title: 'send the documents', done: false }, { id: `p-${i}-2`, title: 'ask for a reference', done: true }] : [],
}))
const certs: CertRow[] = Array.from({ length: 30 }, (_, i) => ({
  id: `cert-${i}`, name: `Example certificate ${String(i + 1).padStart(2, '0')}: a deliberately long name that has to be clipped`, issuer: 'Example Academy', cost_inr: i % 5 === 0 ? null : 500 * (i + 1),
  free_option: null, time_hours: 8 + i, credibility: `${(i % 5) + 1}/5`, linkedin_worthy: i % 4 === 0, node_ids: [], url: null, earned: i === 2 ? { earned: '2026-10-01', url: 'https://example.org/c' } : null,
  budget_fit: (['free', 'in budget', 'stretch', 'over budget'] as const)[i % 4],
}))
const campaigns: Campaign[] = Array.from({ length: 5 }, (_, i) => ({
  id: `camp-${i}`, node_id: `n-${i}`, title: `Example campaign ${i + 1}`, finish_line: i === 3 ? '' : 'Publish a small project and write it up', linkedin_line: '', ship_steps: [], path: [], left: 3 + i, hours_left: 10 + i,
  weeks: 2, weight: 1, status: i === 0 ? 'active' : 'suggested', ready_to_ship: false,
}))

export interface LabOptions {
  /** A view to open on; the default is the page's own (Pipeline). */
  view?: string
}

function seed() {
  usePlan.setState({
    loadRoad: none, loadApplications: none, loadLadder: none,
    applications: {
      applications: apps, pipeline: {}, due_soon: [],
      tasks: [{ id: 't1', title: 'Order the transcripts', due: '2026-11-25', days_left: 15, done: false }],
      goals: [{ id: 'g1', title: 'A long goal', target: 'someday', kind: 'long_term', milestones: Array.from({ length: 7 }, (_, i) => ({ id: `m${i}`, title: `Milestone ${i + 1}`, by: `2027-0${(i % 9) + 1}`, progress: i / 7, done: false, linked_nodes: [] })) }],
    },
    campaigns: { campaigns, active: 1, cap: 3 },
    certs: { certs, budget: { cert_inr_month: 2000, cert_stretch_inr: 6000 } },
    ladder: {
      vision: { title: 'A fictional vision', horizon: '2035', band: 'wide' },
      years: [{ year: 2026, milestones: [{ id: 'y1', title: 'Year milestone one' }, { id: 'y2', title: 'Year milestone two' }, { id: 'y3', title: 'Year milestone three' }, { id: 'y4', title: 'Year milestone four' }] }], year: 2026,
      quarter: { label: 'Q4', ends: '2026-12-31', goals: [1, 2, 3, 4, 5].map((n) => ({ serves: null, title: `Quarter goal ${n}` })) },
      month: { label: 'November', ends: '2026-11-30', goals: [1, 2].map((n) => ({ serves: null, title: `Month goal ${n}` })) },
      week: { ends: '2026-11-15', goals: [1].map((n) => ({ serves: null, title: `Week goal ${n}` })) },
      reviews: [], review_due: false,
    },
    state: { parking: Array.from({ length: 6 }, (_, i) => ({ id: `i${i}`, text: `A parked idea number ${i + 1}`, at: '2026-11-01' })) } as never,
  } as never)
  const g = useGame.getState().g
  useGame.setState({
    loaded: true, today: '2026-11-10',
    g: {
      ...g, marks: 300, warChest: { saved: 30000, log: [], custom: [{ id: 'c1', label: 'A flight', inr: 40000, due: '2027-12' }] },
      trials: { 'goethe-a1': { stage: 1, updated: '2026-11-01', examDate: '2027-01-20' } },
      shop: Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, label: `Example reward ${i + 1}`, cost: 60 + i * 40, kind: 'reward' as const })),
    },
  } as never)
}

let root: Root | null = null
export function mountLab(el: HTMLElement, opts: LabOptions = {}): void {
  seed()
  useFrame.setState({ ws: 'career', view: opts.view ?? null, chosen: true })
  root?.unmount()
  root = createRoot(el)
  root.render(<Frame loaded legacyTab="campaign" pages={{ study: stub('Study'), tree: stub('Tree'), life: stub('Life'), career: CareerPage, focus: stub('Focus'), setup: stub('Setup') }} />)
}
export const labViews = CAREER_VIEWS.map((v) => v.id)
