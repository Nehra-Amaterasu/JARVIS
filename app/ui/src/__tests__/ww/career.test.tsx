// Chunk 11: the Career workspace (plan 8.1 "Career (career.test.tsx)", 4.7). Fictional fixtures throughout.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mount, resetHtml } from './_stubs'
import { PrimaryOwner } from '../../ww/kit'
import { CareerPage } from '../../ww/career/CareerPage'
import { useDueNow } from '../../ww/career/useDeadlines'
import { CAREER_VIEWS, buildDeadlines, chestRows, dueNowCount, nextStep, paginate, pipelineRows, rowsThatFit, stageIndex } from '../../ww/career/model'
import { useFrame } from '../../ww/frame/frameStore'
import { usePlan, type Application, type ApplicationsView, type CertRow, type Campaign } from '../../germoney/game/plan'
import { useGame } from '../../germoney/game/store'

const TODAY = '2026-11-10'
const app = (o: Partial<Application> & { id: string }): Application => ({
  org: 'Org', programme: 'Programme', url: '', opens: null, closes: null, status: 'preparing', requirements: [], stipend: '', notes: '', reason: '', verified: true, source: '',
  days_left: null, opens_in: null, nodes: [], prep: [], ...o,
})
const view = (applications: Application[], tasks: ApplicationsView['tasks'] = []): ApplicationsView => ({ applications, pipeline: {}, due_soon: [], tasks, goals: [] })
const cert = (i: number, o: Partial<CertRow> = {}): CertRow => ({ id: `c${i}`, name: `Certificate ${String(i).padStart(2, '0')}`, issuer: 'Example Academy', cost_inr: 500 * i, free_option: null, time_hours: 10, credibility: '4/5', linkedin_worthy: false, node_ids: [], url: null, earned: null, budget_fit: 'in budget', ...o })
const camp = (id: string, o: Partial<Campaign> = {}): Campaign => ({ id, node_id: 'n', title: `Campaign ${id}`, finish_line: 'Publish the thing', linkedin_line: '', ship_steps: [], path: [], left: 3, hours_left: 12, weeks: 2, weight: 1, status: 'suggested', ready_to_ship: false, ...o })

const noop = async () => {}
let m: ReturnType<typeof mount> | null = null
const calls = { setTask: vi.fn(async () => {}), setAppStatus: vi.fn(async () => {}), earnCert: vi.fn(async () => ({ ok: true, say: 'Saved.' })), campaign: vi.fn(async () => ({ ok: true, say: 'Done.' })) }

function seed(p: Partial<ReturnType<typeof usePlan.getState>> = {}) {
  usePlan.setState({
    loadRoad: noop, loadApplications: noop, loadLadder: noop, setTask: calls.setTask, setAppStatus: calls.setAppStatus, earnCert: calls.earnCert, campaign: calls.campaign,
    applications: view([]), campaigns: { campaigns: [], active: 0, cap: 3 }, certs: { certs: [], budget: { cert_inr_month: 2000, cert_stretch_inr: 6000 } }, ladder: null, state: null, ...p,
  } as never)
}
function render() {
  m = mount(<PrimaryOwner><CareerPage /></PrimaryOwner>)
}
const q = (s: string) => document.querySelector<HTMLElement>(s)
const qa = (s: string) => [...document.querySelectorAll<HTMLElement>(s)]
const click = (el: Element | null) => act(() => void (el as HTMLElement).click())
const view_ = (label: string) => click(qa('[role=radio]').find((r) => r.textContent === label)!)
function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  for (const f of Object.values(calls)) f.mockClear()
  useFrame.setState({ ws: 'career', view: null })
  useGame.setState({ today: TODAY, g: { ...useGame.getState().g, marks: 120, warChest: { saved: 20000, log: [], custom: [] }, trials: {} } })
  seed()
  try {
    localStorage.clear()
  } catch { /* none */ }
})
afterEach(() => {
  m?.unmount()
  m = null
  vi.unstubAllGlobals()
  resetHtml()
  document.body.innerHTML = ''
})

describe('Career: views', () => {
  it('views are Pipeline, Certificates, Abroad, Money, Plan; opening Career always starts on Pipeline', () => {
    expect(CAREER_VIEWS.map((v) => v.label)).toEqual(['Pipeline', 'Certificates', 'Abroad', 'Money', 'Plan'])
    // the old Road page remembered its last tab under this key; Career must not read it
    localStorage.setItem('ww.road.tab', 'money')
    render()
    expect(qa('[role=radio]').map((r) => r.textContent)).toEqual(['Pipeline', 'Certificates', 'Abroad', 'Money', 'Plan'])
    expect(qa('[role=radio]').find((r) => r.getAttribute('aria-checked') === 'true')!.textContent).toBe('Pipeline')
    expect(q('[data-view=pipeline]')).not.toBeNull()
    // leave and come back: still Pipeline
    view_('Money')
    expect(q('[data-view=money]')).not.toBeNull()
    m!.unmount()
    render()
    expect(q('[data-view=pipeline]')).not.toBeNull()
  })
  it('a deep link names the view: the frame view wins over the Pipeline default', () => {
    useFrame.setState({ view: 'abroad' })
    render()
    expect(q('[data-view=abroad]')).not.toBeNull()
  })
  it('no view declares more than one workspace primary, and Pipeline with a deadline has exactly one', () => {
    seed({ applications: view([app({ id: 'a', org: 'Org A', days_left: 4, status: 'preparing' })]) })
    render()
    expect(qa('[data-primary]')).toHaveLength(1)
    expect(q('[data-primary]')!.textContent).toBe('Do next step')
    for (const v of ['Certificates', 'Abroad', 'Money', 'Plan']) {
      view_(v)
      expect(qa('[data-primary]'), v).toHaveLength(0)
    }
  })
})

describe('Career: Pipeline', () => {
  const apps = [
    app({ id: 'far', org: 'Org Far', programme: 'Summer track', days_left: 40, status: 'preparing', prep: [{ id: 'p1', title: 'draft the statement', done: false }] }),
    app({ id: 'soon', org: 'Org Soon', programme: 'Spring track', days_left: 5, status: 'preparing', verified: false, prep: [{ id: 'p2', title: 'send documents', done: false }] }),
    app({ id: 'idea', org: 'Org Idea', programme: 'Open call', days_left: 20, status: 'idea' }),
    app({ id: 'sent', org: 'Org Sent', programme: 'Track', days_left: 2, status: 'applied' }),
    app({ id: 'no', org: 'Org No', programme: 'Track', status: 'not_eligible', reason: 'needs a degree year' }),
  ]
  it('Do next step targets the soonest deadline; the tab badge equals the due-now count', () => {
    const v = view(apps, [{ id: 't1', title: 'Ask for a reference', due: '2026-11-30', days_left: 20, done: false }])
    const trialDates = [{ id: 'goethe-a1', name: 'Goethe A1', date: '2026-11-12' }, { id: 'ielts', name: 'IELTS', date: '2027-01-01' }]
    const due = buildDeadlines(v, trialDates, TODAY)
    // applied rows no longer ask anything of the closing date; undated rows are not deadlines
    expect(due.map((d) => d.what)).toEqual(['Goethe A1', 'Org Soon', 'Org Idea', 'Ask for a reference', 'Org Far', 'IELTS'])
    expect(due[0].days).toBe(2)
    expect(dueNowCount(due)).toBe(2) // 2 d and 5 d; 20 d is not due now
    seed({ applications: v })
    useGame.setState({ g: { ...useGame.getState().g, trials: { 'goethe-a1': { stage: 0, updated: TODAY, examDate: '2026-11-12' } } } })
    render()
    // the first Up next row is the soonest deadline and the primary button belongs to the same card
    const up = q('[data-card=CA1]')!
    expect(up.querySelector('.ww-row-title')!.textContent).toContain('Goethe')
    expect(up.querySelector('[data-primary]')!.textContent).toBe('Do next step')
    expect(up.textContent).toContain('2 d')
    expect(up.textContent).toMatch(/2 due now/)
    // the tab badge hook reads the same set
    let badge = -1
    function Probe() {
      badge = useDueNow()
      return null
    }
    m!.unmount()
    m = mount(<Probe />)
    expect(badge).toBe(2)
  })
  it('Do next step on an application ticks the first undone prep item', () => {
    seed({ applications: view([apps[1], apps[0]]) })
    render()
    expect(q('[data-card=CA1] .ww-row-title')!.textContent).toBe('Org Soon')
    click(q('[data-card=CA1] [data-primary]'))
    expect(calls.setTask).toHaveBeenCalledWith({ id: 'p2', done: true })
  })
  it('each pipeline row shows a stage stepper and a next action (CAREER-STATUS-03)', () => {
    seed({ applications: view(apps) })
    render()
    const rows = qa('[data-card=CA2] .cr-approw')
    expect(rows).toHaveLength(apps.length)
    for (const r of rows) {
      expect(r.querySelector('.cr-stepper, .cr-stepper-end'), r.textContent ?? '').not.toBeNull()
      expect(r.textContent).toMatch(/next: |ruled out: /)
    }
    const soon = rows.find((r) => r.textContent!.includes('Org Soon'))!
    expect(soon.textContent).toContain('next: send documents')
    expect(soon.textContent).toContain('confidence: approximate')
    expect(soon.querySelector('.cr-stepper')!.getAttribute('aria-label')).toBe('Org Soon: Preparing, step 2 of 5')
    expect(soon.querySelector('[aria-current=step]')!.textContent).toContain('Preparing')
    // the most urgent open row comes first, the ruled-out one last
    expect(rows[0].textContent).toContain('Org Sent')
    expect(rows[rows.length - 1].textContent).toContain('ruled out: needs a degree year')
  })
  it('a campaign with no finish line hides that line and offers no Start', () => {
    seed({ campaigns: { active: 0, cap: 3, campaigns: [camp('a'), camp('b', { finish_line: '' }), camp('c', { finish_line: '   ' })] } })
    render()
    const rows = qa('[data-card=CA3] .ww-row')
    const by = (id: string) => rows.find((r) => r.textContent!.includes(`Campaign ${id}`))!
    expect(by('a').textContent).toContain('finish line: Publish the thing')
    expect(by('a').textContent).toContain('Start')
    for (const id of ['b', 'c']) {
      expect(by(id).textContent).not.toContain('finish line:')
      expect(by(id).textContent).not.toMatch(/\bStart\b/)
      expect(by(id).textContent).toContain('Set a finish line')
    }
  })
  it('an empty answer is said in words, not drawn as zero rows', () => {
    render()
    expect(q('[data-card=CA1]')!.textContent).toContain('No dated deadline ahead')
    expect(q('[data-card=CA2]')!.textContent).toContain('No applications yet')
    expect(qa('[data-card=CA1] [data-primary]')).toHaveLength(0)
  })
})

describe('Career: Certificates', () => {
  const certs = Array.from({ length: 30 }, (_, i) => cert(i + 1))
  it('the certificate list pages through every row (all N of N reachable)', () => {
    seed({ certs: { certs, budget: { cert_inr_month: 2000, cert_stretch_inr: 6000 } } })
    render()
    view_('Certificates')
    const seen = new Set<string>()
    let pages = 0
    for (;;) {
      pages++
      qa('[data-card=CA4] [data-cert]').forEach((r) => seen.add(r.getAttribute('data-cert')!))
      expect(q('.cr-list')!.scrollHeight).toBeGreaterThanOrEqual(0)
      const next = qa('[data-pager] button').find((b) => b.getAttribute('aria-label')!.startsWith('Next'))!
      if (next.getAttribute('aria-disabled') === 'true') break
      click(next)
      expect(pages).toBeLessThan(20)
    }
    expect(seen.size).toBe(30)
    expect(q('[data-pager-text]')!.textContent).toMatch(/of 30$/)
    expect(pages).toBeGreaterThan(1)
  })
  it('Mark earned is aria-disabled until a link is typed', () => {
    seed({ certs: { certs: certs.slice(0, 3), budget: { cert_inr_month: 2000, cert_stretch_inr: 6000 } } })
    render()
    view_('Certificates')
    const row = q('[data-cert=c1]')!
    const btn = () => [...row.querySelectorAll('button')].find((b) => b.textContent!.includes('Mark earned'))!
    expect(btn().getAttribute('aria-disabled')).toBe('true')
    click(btn())
    expect(calls.earnCert).not.toHaveBeenCalled()
    type(row.querySelector('input')!, 'https://example.org/c/1')
    expect(btn().getAttribute('aria-disabled')).toBeNull()
    click(btn())
    expect(calls.earnCert).toHaveBeenCalledWith('c1', 'https://example.org/c/1')
  })
  it('earned certificates are named once, and a bank with none says so', () => {
    seed({ certs: { certs: [cert(1, { earned: { earned: '2026-10-01', url: 'https://example.org' } }), cert(2)], budget: { cert_inr_month: 2000, cert_stretch_inr: 6000 } } })
    render()
    view_('Certificates')
    expect(q('[data-earned]')!.textContent).toContain('Certificate 01')
    expect(qa('[data-cert]').map((r) => r.getAttribute('data-cert'))).toEqual(['c2'])
  })
})

describe('Career: Abroad, Money, Plan', () => {
  it('Abroad has Trials and Universities as two cards; every trial reaches by paging', () => {
    render()
    view_('Abroad')
    expect(q('[data-card=CA5]')).not.toBeNull()
    expect(q('[data-card=CA6]')).not.toBeNull()
    const seen = new Set<string>()
    for (let i = 0; i < 20; i++) {
      qa('[data-trial]').forEach((r) => seen.add(r.getAttribute('data-trial')!))
      const next = qa('[data-pager] button').filter((b) => b.getAttribute('aria-label')!.startsWith('Next trials'))[0]
      if (!next || next.getAttribute('aria-disabled') === 'true') break
      click(next)
    }
    expect(seen.size).toBeGreaterThanOrEqual(8)
  })
  it('War chest shows rupees only and Rewards shows game currency only', () => {
    useGame.setState({ g: { ...useGame.getState().g, shop: [{ id: 'r1', label: 'A quiet evening', cost: 80, kind: 'reward' }, { id: 'r2', label: 'A big one', cost: 900, kind: 'reward' }] } })
    render()
    view_('Money')
    const chest = q('[data-card=CA7]')!
    expect(chest.textContent).toContain('₹')
    expect(chest.textContent).not.toMatch(/\bDM\b|Marks/)
    view_('Plan')
    const rewards = q('[data-card=CA11]')!
    expect(rewards.textContent).toMatch(/120 DM/)
    expect(rewards.textContent).not.toContain('₹')
    expect(qa('[data-card=CA7]')).toHaveLength(0)
  })
  it('Rewards ask twice before spending, and say how many DM short', () => {
    const buy = vi.fn(() => null)
    useGame.setState({ buy, g: { ...useGame.getState().g, shop: [{ id: 'r1', label: 'A quiet evening', cost: 80, kind: 'reward' }, { id: 'r2', label: 'A big one', cost: 900, kind: 'reward' }] } } as never)
    render()
    view_('Plan')
    const rows = qa('[data-card=CA11] .ww-row')
    const big = rows.find((r) => r.textContent!.includes('A big one'))!
    expect(big.textContent).toContain('780 DM short')
    expect(big.querySelector('button')!.getAttribute('aria-disabled')).toBe('true')
    const quiet = rows.find((r) => r.textContent!.includes('A quiet evening'))!
    click(quiet.querySelector('button'))
    expect(buy).not.toHaveBeenCalled()
    click([...quiet.querySelectorAll('button')].find((b) => b.textContent!.startsWith('Spend'))!)
    expect(buy).toHaveBeenCalledWith('r1')
  })
  it('Goals are read-only with an Edit link to Setup > Goals', () => {
    seed({
      applications: { ...view([]), goals: [{ id: 'g', title: 'Long goal', target: 'big', kind: 'long_term', milestones: [{ id: 'm1', title: 'First milestone', by: '2027-03', progress: 0.5, done: false, linked_nodes: [] }] }] },
    })
    render()
    view_('Plan')
    const goals = q('[data-card=CA9]')!
    expect(goals.textContent).toContain('First milestone')
    expect(goals.textContent).toContain('50 %')
    expect(goals.querySelectorAll('input, textarea, select')).toHaveLength(0)
    const edit = [...goals.querySelectorAll('button')].find((b) => b.textContent === 'Edit goals')!
    click(edit)
    expect(useFrame.getState().ws).toBe('setup')
    expect(useFrame.getState().view).toBe('goals')
  })
  it('Plan has four cards and removing a parked idea calls the store', () => {
    const unpark = vi.fn(async () => {})
    seed({ state: { parking: [{ id: 'i1', text: 'Try a small radio kit', at: '2026-11-01' }] } as never, unpark })
    render()
    view_('Plan')
    expect(qa('[data-card]').map((c) => c.getAttribute('data-card')).sort()).toEqual(['CA10', 'CA11', 'CA8', 'CA9'])
    click(q('[aria-label^="Remove idea"]'))
    expect(unpark).toHaveBeenCalledWith('i1')
  })
})

describe('Career: the pure part', () => {
  it('paginate covers every item exactly once and clamps the page', () => {
    const items = Array.from({ length: 23 }, (_, i) => i)
    const seen: number[] = []
    for (let p = 0; p < paginate(items, 0, 5).pages; p++) seen.push(...paginate(items, p, 5).rows)
    expect(seen).toEqual(items)
    expect(paginate(items, 99, 5)).toMatchObject({ page: 4, from: 21, to: 23, total: 23 })
    expect(paginate([], 0, 5)).toMatchObject({ pages: 1, from: 0, to: 0 })
    expect(paginate(items, 0, 0).rows).toHaveLength(1) // a size under 1 still shows a row
  })
  it('rowsThatFit never returns less than 1 and falls back where nothing is measured', () => {
    expect(rowsThatFit(0, 56, 7)).toBe(7)
    expect(rowsThatFit(300, 0, 7)).toBe(7)
    expect(rowsThatFit(20, 56, 7)).toBe(1)
    expect(rowsThatFit(230, 56, 7)).toBe(4)
  })
  it('nextStep is taken from the data: the first undone prep item, else the stage', () => {
    expect(nextStep(app({ id: 'x', status: 'preparing', prep: [{ id: 'a', title: 'one', done: true }, { id: 'b', title: 'two', done: false }] }))).toMatchObject({ kind: 'prep', text: 'two', prepId: 'b' })
    expect(nextStep(app({ id: 'x', status: 'preparing', url: 'https://example.org' })).kind).toBe('submit')
    expect(nextStep(app({ id: 'x', status: 'applied' })).kind).toBe('wait')
    expect(nextStep(app({ id: 'x', status: 'rejected' })).kind).toBe('closed')
    expect(stageIndex('offer')).toBe(4)
    expect(stageIndex('rejected')).toBeNull()
  })
  it('pipelineRows lists every application once, ruled-out last', () => {
    const v = view([app({ id: 'a', status: 'not_eligible' }), app({ id: 'b', days_left: 9 }), app({ id: 'c', days_left: 3 }), app({ id: 'd' })])
    expect(pipelineRows(v).map((a) => a.id)).toEqual(['c', 'b', 'd', 'a'])
  })
  it('chestRows keeps running totals by due month and converts euros at the rate', () => {
    const rows = chestRows({ saved: 0, custom: [{ id: 'z', label: 'Flight', inr: 40000, due: '2027-01' }], rate: 100, today: TODAY })
    expect(rows.map((r) => r.due)).toEqual([...rows.map((r) => r.due)].sort())
    expect(rows[rows.length - 1].run).toBe(rows.reduce((a, r) => a + r.inr, 0))
    expect(rows.find((r) => r.id === 'z')).toMatchObject({ custom: true, inr: 40000, eur: null })
    expect(rows.find((r) => r.id === 'visa')).toMatchObject({ inr: 7500, eur: '€75' })
  })
})

describe('Career: layout rules that need no browser', () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../ww/career/career.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  it('no rule scrolls: no overflow auto or scroll anywhere in the stylesheet', () => {
    expect(css).not.toMatch(/overflow(-[xy])?\s*:\s*(auto|scroll)/)
  })
  it('the list box and the root hide overflow, so a long list can only be paged', () => {
    expect(css).toMatch(/\.ww-career\s*\{[^}]*overflow:\s*hidden/)
    expect(css).toMatch(/\.cr-list\s*\{[^}]*overflow:\s*hidden/)
  })
})
