/**
 * Well Wisher v1 in the window: the label, the Status screen (stats computed on the
 * server, each with its explanation), and the calisthenics quest card on Today that
 * logs a session set by set. Server answers are the shared real-shaped fixture plus
 * fictional Status and quest values; nothing here is about a real person.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LIVE from './fixtures/mission-live.json'
import { MissionRoot } from '../germoney/MissionRoot'
import { usePlan } from '../germoney/game/plan'
import { MISSION_TABS } from '../germoney/ui'
import { TABS, useStore, type Tab } from '../lib/store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const live = LIVE as Record<string, any>
const QUEST = {
  key: 'quest/fitness/push/2026-10-26', source: 'quest', slot: 'quest', node_id: null, node_name: null, branch: 'fitness',
  title: 'Body: calisthenics · Push: Wall push-up, 3 x 15 reps', minutes: 15, xp: 10, context: 'Level 1 of 7 on Push.',
  steps: ['Warm up', '3 sets', 'Log the numbers'], hint: 'Body in one line.', success_check: 'Every set at 15 reps or more.',
  why: '2 more days at this standard unlocks level 2 (Incline push-up)', done: false, verified: false,
  read_first: [], depends_on: [], primary: null, backup: null, pdfs: [],
  quest: { line: 'fitness', track: 'push', track_name: 'Push', level: 1, max_level: 7, sets: 3, target: 15, unit: 'reps', hits: [], need: 2, top: false },
}
const STATUS = {
  date: '2026-10-26', rank: { rank: 'E', have: { hours: 3, nodes: 0, proof: 0, projects: 0, certs: 0 },
    next: { rank: 'D', missing: [{ req: 'hours', name: 'focus hours logged', have: 3, need: 10 }, { req: 'nodes', name: 'skill-tree nodes mastered with a finished contract', have: 0, need: 1 }] } },
  level: { level: 2, into: 20, need: 120 }, xp: 120,
  stats: [
    { id: 'knowledge', name: 'Knowledge', value: 2, explain: '5 per node mastered (0) + 1 per finished contract (2) = 2.', inputs: {} },
    { id: 'focus', name: 'Focus', value: 3, unit: 'h', explain: 'Hours logged: 200 min = 3 h.', inputs: {} },
    { id: 'consistency', name: 'Consistency', value: 4, unit: '/30 days', explain: 'Days with a logged action: 4.', inputs: {} },
    { id: 'proof', name: 'Proof', value: 0, explain: 'Links: 0.', inputs: {} },
    { id: 'recall', name: 'Recall', value: 1, explain: 'Practice contracts: 1.', inputs: {} },
    { id: 'vitality', name: 'Vitality', value: 0, explain: 'Quest sessions: 0.', inputs: {} },
  ],
  not_counted: { xp_from_games: 40, xp_carried_over: 0, nodes_claimed: [], explain: 'Game XP has no logged action behind it.' },
  advice: ['Consistency is 4/30 days. One 15-minute contract today would count.'],
  domains: [{ id: 'fitness', name: 'Body: calisthenics', status: 'off', since: null, tracks: [] },
    { id: 'money', name: 'Money: skills for income', status: 'planned', why: 'Needs real evidence first.' }],
  rule: 'Every stat moves only with a logged action. The System suggests; you decide.',
}

const THREE = {
  date: '2026-10-26', mode: 'normal', n: 3, welcome_back: null, source: 'example',
  picks: [
    { key: 'pick/one', title: 'Ripple-carry adder', minutes: 45, score: 0.9, serves: 'y26-cpu', why: 'Serves Write a tiny CPU (due 2026-12-20) · Career: Example programme asks for it (35 days left)',
      frame: 'Contract: Ripple-carry adder. Done when: the testbench passes. One 45-minute sprint with that finish line.', engines: ['goal_ladder', 'career', 'personality'] },
    { key: 'pick/two', title: 'Karnaugh maps', minutes: 30, score: 0.4, serves: null, why: 'Keeps the plan moving; serves no dated goal',
      frame: 'Contract: Karnaugh maps. Done when: three maps solved.', engines: ['goal_ladder', 'personality'] },
  ],
  cap: { cap: 3, open: 1, room: 2, over: false, say: '1 of 3 projects open: room for 2 more.' },
  career_next: { title: 'Example programme', action: 'Draft the application', days_left: 35 },
}
const WEEKLY = {
  week: { start: '2026-10-20', end: '2026-10-26' }, totals: '4/7 active days, 180 minutes, 2 contracts finished; last week 3/7 days, 100 minutes',
  moved: ['Verilog: 2 contracts, 90 min this week (last week 1, 30 min)'], stalled: ['State machines: in progress, 0 min this week'],
  change: { rule: 'too_much', text: 'Next week: plan two contracts a day instead of three.' },
  say: 'Weekly review, 2026-10-20 to 2026-10-26: 4/7 active days. Next week: plan two contracts a day instead of three.',
}

let withStatus = true
const calls: { method: string; path: string; body: any }[] = []
function respond(body: unknown, status = 200) {
  return { ok: status < 400, status, statusText: status < 400 ? 'OK' : 'Not Found', json: async () => body, text: async () => JSON.stringify(body) }
}
vi.stubGlobal('fetch', async (url: string, init?: { method?: string; body?: string }) => {
  const path = url.split('?')[0]
  const method = init?.method ?? 'GET'
  calls.push({ method, path, body: init?.body ? JSON.parse(init.body) : null })
  if (path.startsWith('/api/kv')) return respond(path === '/api/kv' ? { keys: [] } : { value: null })
  if (path === '/api/mission/status') return withStatus ? respond(STATUS) : respond({ error: 'gone' }, 404)
  if (path === '/api/mission/today') return respond({ ...live.today, contracts: [...live.today.contracts, QUEST], three: THREE, weekly: WEEKLY })
  if (path === '/api/mission/quest/fitness' && method === 'PUT') return respond({ ok: true, say: 'Body: calisthenics is on.' })
  if (path === '/api/mission/quest/fitness/log') return respond({ ok: true, met: true, say: 'Standard met.' })
  const m = path.match(/^\/api\/mission\/([a-z]+)$/)
  if (m && method === 'GET' && m[1] in live) return respond(live[m[1]])
  return respond({ error: 'not in the fixture' }, 404)
})

const flush = async (n = 8) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)) }) }
let host: HTMLDivElement
let root: Root
const errors: unknown[] = []
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host, { onUncaughtError: (e) => errors.push(e), onCaughtError: (e) => errors.push(e) })
  errors.length = 0
  calls.length = 0
  withStatus = true
  usePlan.setState({ applications: null, campaigns: null, certs: null, ladder: null })
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})
async function show(tab: Tab) {
  useStore.setState({ tab })
  await act(async () => { root.render(createElement(MissionRoot)) })
  await flush()
}
function type(el: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => { set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement

describe('Well Wisher', () => {
  it('is the user-facing name, and Status is one of the docked screens', async () => {
    await show('mission')
    const nav = host.querySelector('.mission-nav')!
    expect(nav.getAttribute('aria-label')).toBe('Well Wisher')
    expect(nav.textContent).toContain('well_wisher')
    expect(nav.textContent).not.toContain('m:ss:on')
    expect(MISSION_TABS.some((t) => t.id === 'status' && t.screen === 'status')).toBe(true)
    expect(TABS.find((t) => t.id === 'status')?.dock).toBe(true)
  })

  it('Status shows every stat with how it was computed, the rank gap and the advice', async () => {
    await show('status')
    expect(errors).toEqual([])
    expect(host.querySelector('.mission-page.status')).not.toBeNull()
    const stats = host.querySelectorAll('.stat')
    expect(stats.length).toBe(6)
    for (const s of STATUS.stats) {
      const el = host.querySelector(`[data-stat="${s.id}"]`)!
      expect(el.textContent).toContain(s.name)
      expect(el.querySelector('.stat-explain')!.textContent).toBe(s.explain)
    }
    expect(host.textContent).toContain('focus hours logged: 3/10')
    expect(host.textContent).toContain('The System suggests')
    expect(host.textContent).toContain('40 XP from games')
    expect(host.textContent).toContain('planned')
  })

  it('turning the quest line on asks the server (the System never turns it on by itself)', async () => {
    await show('status')
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
    await act(async () => { button('Turn on').click() })
    await flush()
    const put = calls.find((c) => c.method === 'PUT' && c.path === '/api/mission/quest/fitness')
    expect(put?.body).toEqual({ on: true })
  })

  it('a missing Status answer is a readable card, not a crash', async () => {
    withStatus = false
    await show('status')
    expect(errors).toEqual([])
    expect(host.querySelector('.crash-card')).toBeNull()
    expect(host.textContent).toContain('The System is not answering')
  })

  it('Today shows the quest card and logs a session set by set', async () => {
    await show('mission')
    const card = host.querySelector('[data-quest="quest/fitness/push/2026-10-26"]')!
    expect(card).not.toBeNull()
    const inputs = [...card.querySelectorAll('input')].filter((i) => i.getAttribute('aria-label')?.startsWith('Set')) as HTMLInputElement[]
    expect(inputs.length).toBe(3)
    type(inputs[0], '15'); type(inputs[1], '16'); type(inputs[2], '14')
    await act(async () => { button('Log session').click() })
    await flush()
    const log = calls.find((c) => c.path === '/api/mission/quest/fitness/log')
    expect(log?.method).toBe('POST')
    expect(log?.body).toEqual({ track: 'push', sets: [15, 16, 14], proof: '' })
  })

  it("Today shows Today's 3 with each pick's framing and why, from the server", async () => {
    await show('mission')
    expect(errors).toEqual([])
    const card = host.querySelector('[aria-label="Today\'s 3"]')!
    expect(card).not.toBeNull()
    expect(card.textContent).toContain("Today's 2")
    expect([...card.querySelectorAll('li')].map((li) => li.getAttribute('data-key'))).toEqual(['pick/one', 'pick/two'])
    expect(card.querySelector('.three-frame')!.textContent).toBe(THREE.picks[0].frame)
    expect(card.querySelector('.three-why')!.textContent).toContain('Career: Example programme asks for it')
    expect(card.textContent).toContain('Next career step: Draft the application (35 days left).')
    expect(card.textContent).toContain('From the example inputs')
    expect(card.textContent).toContain('1 of 3 projects open')
  })

  it('Today shows the weekly review card, every line with its numbers, and reads it out', async () => {
    await show('mission')
    const card = host.querySelector('[aria-label="Weekly review"]')!
    expect(card).not.toBeNull()
    expect(card.textContent).toContain('4/7 active days, 180 minutes')
    expect(card.textContent).toContain('Verilog: 2 contracts, 90 min this week')
    expect(card.textContent).toContain('State machines: in progress, 0 min this week')
    expect(card.querySelector('.weekly-change')!.textContent).toBe(WEEKLY.change.text)
    await act(async () => { button('Read it to me').click() })
    await flush(2)
    expect(errors).toEqual([])
  })
})
