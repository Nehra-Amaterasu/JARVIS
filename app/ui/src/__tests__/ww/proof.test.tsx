// Chunk 9: the Proof panel (plan 4.10, 8.1 "Proof") and the Record overlay (4.12 O4). Every fixture is fictional.
// The five routes are answered by a stub fetch, so what is checked is what the panel does with an answer: the
// order of the ten cards, the full rank list, a button under each suggestion, the honest 4-week slot, Recent by day.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { mount, resetHtml } from './_stubs'
import { PrimaryOwner } from '../../ww/kit'
import { sectionOrder } from '../../ww/kit/Section'
import { ProofPanel, PROOF_CARDS } from '../../ww/proof'
import { sourceLine, dayLabel, minutesLabel, STAT_NEXT } from '../../ww/proof/proofData'
import { RecordBody } from '../../ww/overlays/Record'
import { registeredOverlay } from '../../ww/frame/overlayRegistry'
import { resetFrameStore, useFrame } from '../../ww/frame/frameStore'
import { useFailureStore } from '../../germoney/stores/failure-store'
import { useGame } from '../../germoney/game/store'
import * as E from '../../germoney/game/engine'
// the plan's list (8.1 Proof) plus the engines' own words (ww_base.SHAME)
const SHAME_IN_UI = new RegExp(String.raw`streak (is )?(lost|broken)|you missed|don't break|session (failed|lost)|\b(lazy|failed|failure|wasted|pathetic|useless|no excuses?)\b`, 'i')

type Json = Record<string, unknown>
const stat = (id: string, name: string, value: number, unit?: string) => ({ id, name, value, unit, explain: `${name} is counted from logged work.` })
const week = (start: string, end: string, days_logged: number, mean: number | null) => ({ start, end, days_logged, mean })

const STATUS: Json = {
  date: '2026-11-10',
  rank: { rank: 'E' },
  level: { level: 3, into: 40, need: 100 },
  xp: 340,
  stats: [stat('knowledge', 'Knowledge', 0), stat('focus', 'Focus', 4, 'h'), stat('consistency', 'Consistency', 6, '/30 days'), stat('proof', 'Proof', 0), stat('recall', 'Recall', 2), stat('vitality', 'Vitality', 0)],
  not_counted: { xp_from_games: 20, xp_carried_over: 0, nodes_claimed: [], explain: 'XP from games has no logged action behind it.' },
  domains: [
    { id: 'fitness', name: 'Fitness', status: 'off' },
    { id: 'money', name: 'Money: skills for income', status: 'planned', why: 'Needs a source of real evidence first.' },
  ],
}

const V2: Json = {
  date: '2026-11-10',
  series: [
    { id: 'water', name: 'Glasses of water', want: 'more', weeks: [week('a', 'b', 0, null), week('c', 'd', 3, 4), week('e', 'f', 0, null), week('g', 'h', 5, 6)], points: [4, 6], weeks_with_data: 2, enough_for_line: true },
    { id: 'snacks', name: 'Junk snacks', want: 'less', weeks: [week('a', 'b', 0, null), week('c', 'd', 0, null), week('e', 'f', 0, null), week('g', 'h', 2, 3)], points: [3], weeks_with_data: 1, enough_for_line: false },
    { id: 'read', name: 'Pages read', want: 'more', weeks: [week('a', 'b', 0, null), week('c', 'd', 0, null), week('e', 'f', 0, null), week('g', 'h', 0, null)], points: [], weeks_with_data: 0, enough_for_line: false },
  ],
  weeks_note: 'A line needs 2 weeks with logged days; a week with none is left out, never drawn as 0.',
  consistency: { window_days: 28, counters: [{ id: 'water', name: 'Glasses of water', logged: 8, asked: 8, hit: 6, ratio: 0.75, need: 0 }], hit: 6, asked: 8, ratio: 0.75, rule: 'A day counts when the counter was logged that day.' },
  rank: {
    rank: 'E', next: 'D', target: 'D', top: false, met: 1, of: 2,
    requirements: [
      { req: 'hours', name: 'focus hours logged', have: 4, need: 10, met: false },
      { req: 'nodes', name: 'skill-tree nodes mastered with a finished contract', have: 1, need: 1, met: true },
    ],
  },
  suggestions: [
    { id: 'consistency', text: 'Consistency is 6/30 days. One 15-minute contract today would count.', go: { ws: 'study', view: null, label: 'Go to Study' }, basis: 'a rule' },
    { id: 'unproven', text: 'Some nodes are marked mastered without a finished contract.', go: { ws: 'tree', view: null, label: 'Go to Tree' }, basis: 'a rule' },
    { id: 'quest', text: 'Optional: the calisthenics quest line adds one 15-minute session a day.', go: { card: 'P4', label: 'Show quest lines' }, basis: 'a rule' },
  ],
  recent: [
    { date: '2026-11-10', count: 4, xp: 40, minutes: 65, rows: [{ kind: 'contract', label: 'Unit 2 problems', xp: 30, minutes: 45, link: false }, { kind: 'log', label: 'reading', xp: 10, minutes: 20, link: true }], more: 0, zero_xp: { count: 2, minutes: 10, kinds: ['quest'] } },
    { date: '2026-11-08', count: 1, xp: 20, minutes: 30, rows: [{ kind: 'contract', label: 'Older contract', xp: 20, minutes: 30, link: false }], more: 0, zero_xp: { count: 0, minutes: 0, kinds: [] } },
  ],
  wins: [{ date: '2026-11-06', kind: 'node', what: 'Mastered', label: 'n.alpha', link: false, xp: 50 }],
  advice: [
    { id: 'if-then-plan', text: 'Write the plan as a sentence with a trigger.', source: { author: 'A. Author', work: 'A paper about plans', year: 1999, kind: 'journal article' }, strength: 'theory', strength_note: 'an explanation put forward', limit: 'Short studies only.' },
    { id: 'own-and-not-own', text: 'Sort today into what is up to you.', source: { author: 'Epictetus', work: 'Enchiridion, section 1', year: 125, kind: 'primary text' }, strength: 'philosophy', strength_note: 'a view argued by a thinker', limit: 'Not a finding.' },
  ],
}

const WEEKLY: Json = { status: 'ok', week: { start: '2026-11-04', end: '2026-11-10' }, totals: '3/7 active days, 120 minutes, 2 contracts finished', moved: ['Silicon: 2 contracts, 90 min this week'], stalled: [], change: { rule: 'keep', text: 'Next week: keep the plan.' }, say: '' }
const SESSIONS: Json = { status: 'ok', say: 'Building today: 40 minutes across 1 session.', today_minutes: 40, week_minutes: 150, week_areas: { aankhen: 90, 'well-wisher': 60 }, model: { explain: 'Commits less than 90 min apart are one session.' } }
const GITHUB: Json = { status: 'ok', configured: true, user: 'someone', fetched: '2026-11-10 09:00', active_last_30: 12, today_done: false, suggestion: { kind: 'problem', text: 'Solve one problem and commit it.' }, say: '' }

let answers: Record<string, unknown>
let calls: string[]
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)) })
function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    const p = String(path)
    calls.push(p)
    const a = answers[p]
    if (a instanceof Error) return { ok: false, status: 500, statusText: a.message, json: async () => ({ detail: a.message }) }
    return { ok: true, status: 200, statusText: 'OK', json: async () => (p in answers ? a : {}) }
  }))
}

let m: ReturnType<typeof mount> | null = null
const text = () => document.body.textContent ?? ''
async function open(mode: 'pinned' | 'rail' | 'sheet' = 'pinned') {
  m = mount(<PrimaryOwner><ProofPanel mode={mode} /></PrimaryOwner>)
  await settle()
}
beforeEach(() => {
  answers = {
    '/api/mission/status': STATUS, '/api/mission/status/v2': V2, '/api/mission/weekly': WEEKLY,
    '/api/mission/engine/sessions': SESSIONS, '/api/mission/engine/proof': GITHUB,
  }
  calls = []
  stubFetch()
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  Element.prototype.scrollIntoView = vi.fn()
  useFailureStore.setState({ entries: [], isLoaded: true })
  resetFrameStore()
})
afterEach(() => {
  m?.unmount()
  m = null
  vi.unstubAllGlobals()
  resetHtml()
  document.body.innerHTML = ''
})

describe('the ten cards', () => {
  it('renders Rank, Suggests, Stats, Quest lines, Weekly review, Building, Proof of work, Wins, Recent, What got in the way in that order', async () => {
    await open()
    const cards = [...document.querySelectorAll('[data-card]')]
    expect(cards.map((c) => c.getAttribute('data-card'))).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10'])
    expect(cards.map((c) => c.querySelector('.ww-card-title')?.textContent)).toEqual([
      'Rank', 'The System suggests', 'Stats', 'Quest lines', 'Weekly review', 'Building hours', 'Proof of work', 'Wins', 'Recent', 'What got in the way',
    ])
    expect(sectionOrder(document.body)).toEqual(PROOF_CARDS.map((c) => c.id))
  })

  it('every card is a real heading under the panel, not a styled div', async () => {
    await open()
    expect(document.querySelectorAll('[data-card] h3.ww-card-title')).toHaveLength(10)
  })
})

describe('P1 Rank', () => {
  it('lists every requirement of the next rank, met and unmet, each with a word and a meter', async () => {
    await open()
    const rows = [...document.querySelectorAll('[data-card="P1"] [data-req]')]
    expect(rows.map((r) => r.getAttribute('data-req'))).toEqual(['hours', 'nodes'])
    expect(rows.map((r) => r.getAttribute('data-met'))).toEqual(['false', 'true'])
    expect(rows[0].textContent).toContain('Open')
    expect(rows[0].textContent).toContain('4/10')
    expect(rows[1].textContent).toContain('Met')
    expect(rows.every((r) => r.querySelector('[role="meter"]'))).toBe(true)
    expect(document.querySelector('[data-rank-head]')?.textContent).toBe('Rank D needs 2 things; 1 met.')
    expect(document.querySelector('[role="img"][aria-label="Rank E"]')).not.toBeNull()
  })
  it('says "not counted" in a fold rather than hiding the XP it leaves out', async () => {
    await open()
    expect(document.querySelector('[data-card="P1"]')?.textContent).toContain('Not counted (20 XP)')
  })
})

describe('P2 The System suggests', () => {
  it('gives each suggestion a button that switches to its place', async () => {
    await open('pinned')
    const items = [...document.querySelectorAll('[data-suggestion]')]
    expect(items).toHaveLength(3)
    expect(items.every((li) => li.querySelector('button'))).toBe(true)
    const click = (label: string) => act(() => void ([...document.querySelectorAll('[data-card="P2"] button')].find((b) => b.textContent === label) as HTMLButtonElement).click())
    click('Go to Tree')
    expect(useFrame.getState().ws).toBe('tree')
    click('Go to Study')
    expect(useFrame.getState().ws).toBe('study')
  })
  it('a suggestion whose place is inside the panel moves focus to that card', async () => {
    await open('pinned')
    act(() => void ([...document.querySelectorAll('[data-card="P2"] button')].find((b) => b.textContent === 'Show quest lines') as HTMLButtonElement).click())
    expect(document.activeElement?.closest('[data-card]')?.getAttribute('data-card')).toBe('P4')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })
  it('closes the sheet when it sends you to a workspace, but not when the panel is pinned', async () => {
    useFrame.setState({ proofOpen: true })
    await open('rail')
    act(() => void ([...document.querySelectorAll('[data-card="P2"] button')].find((b) => b.textContent === 'Go to Tree') as HTMLButtonElement).click())
    expect(useFrame.getState().proofOpen).toBe(false)
    useFrame.setState({ proofOpen: true })
    m?.unmount()
    await open('pinned')
    act(() => void ([...document.querySelectorAll('[data-card="P2"] button')].find((b) => b.textContent === 'Go to Tree') as HTMLButtonElement).click())
    expect(useFrame.getState().proofOpen).toBe(true)
  })
  it('names the source of every advice line: author, year, work, kind, strength and limit', async () => {
    await open()
    const lines = [...document.querySelectorAll('[data-advice]')]
    expect(lines).toHaveLength(2)
    expect(lines[0].querySelector('[data-source]')?.textContent).toBe('Source: A. Author, 1999. A paper about plans (journal article)')
    expect(lines[1].querySelector('[data-source]')?.textContent).toContain('Epictetus, 125 CE')
    for (const l of lines) expect(l.textContent).toMatch(/Strength: .* Limit: /)
  })
  it('with no suggestions and no advice it says so instead of leaving a blank', async () => {
    answers['/api/mission/status/v2'] = { ...V2, suggestions: [], advice: [] }
    await open()
    expect(document.querySelector('[data-card="P2"]')?.textContent).toContain('Nothing to suggest today')
    expect(document.querySelector('[data-card="P2"]')?.textContent).toContain('nothing is shown rather than an unsourced line')
  })
})

describe('P3 Stats and the 4-week slot', () => {
  it('shows six tiles; a 0 shows its next step and a non-zero does not', async () => {
    await open()
    const tiles = [...document.querySelectorAll('[data-card="P3"] .ww-stat')]
    expect(tiles).toHaveLength(6)
    const byLabel = (l: string) => tiles.find((t) => t.textContent?.startsWith(l))!
    expect(byLabel('Knowledge').textContent).toContain(`Next: ${STAT_NEXT.knowledge}`)
    expect(byLabel('Vitality').textContent).toContain(`Next: ${STAT_NEXT.vitality}`)
    expect(byLabel('Focus').textContent).not.toContain('Next:')
  })
  it('is honest about the 4 weeks: a line only from 2 weeks, one week as words, none as "No days logged yet", never a 0', async () => {
    await open()
    const rows = Object.fromEntries([...document.querySelectorAll('[data-counter]')].map((r) => [r.getAttribute('data-counter')!, r]))
    expect(rows.water.querySelector('.ww-spark svg')).not.toBeNull()
    expect(rows.water.textContent).toContain('2 of 4 weeks logged')
    expect(rows.snacks.querySelector('.ww-spark')).toBeNull()
    expect(rows.snacks.textContent).toContain('1 of 4 weeks logged (3 a day), too few for a line')
    expect(rows.read.querySelector('.ww-spark')).toBeNull()
    expect(rows.read.textContent).toContain('No days logged yet')
    expect(rows.read.textContent).not.toMatch(/\b0 a day\b|\b0 of 4\b/)
  })
  it('the sparkline for two weeks with a gap between them draws exactly the two points, not four', async () => {
    await open()
    const spark = document.querySelector('[data-counter="water"] .ww-spark')!
    expect(spark.getAttribute('aria-label')).toBe('Glasses of water, 2 weeks: from 4 to 6')
    expect(spark.querySelector('polyline')?.getAttribute('points')?.trim().split(' ')).toHaveLength(2)
  })
  it('shows the consistency number with its days, and says how far away it is when there is not enough', async () => {
    await open()
    expect(document.querySelector('[data-consistency]')?.textContent).toBe('Counters on their line: 6 of 8 judged days (75 %).')
    m?.unmount()
    answers['/api/mission/status/v2'] = { ...V2, consistency: { ...(V2.consistency as Json), ratio: null, hit: 0, asked: 0, counters: [{ id: 'water', name: 'w', logged: 3, asked: 3, hit: 2, ratio: null, need: 4 }] } }
    await open()
    expect(document.querySelector('[data-consistency]')?.textContent).toBe('Counters on their line: not enough days yet (3 of 7 judged days on the fullest counter).')
  })
  it('keeps the six tiles when only the v2 route fails, and says the lines are unavailable', async () => {
    answers['/api/mission/status/v2'] = new Error('v2 down')
    await open()
    expect(document.querySelectorAll('[data-card="P3"] .ww-stat')).toHaveLength(6)
    expect(document.querySelector('[data-card="P3"]')?.textContent).toContain('The 4-week lines are not available')
  })
})

describe('P5 Weekly review and the one primary', () => {
  it('takes the fill as "Open review" while the panel is a sheet, and exactly one control holds it', async () => {
    await open('rail')
    const prim = document.querySelectorAll('[data-primary]')
    expect(prim).toHaveLength(1)
    expect(prim[0].textContent).toBe('Open review')
    expect(document.querySelector('[data-review="open"]')).toBeNull()
    act(() => void (prim[0] as HTMLButtonElement).click())
    expect(document.querySelector('[data-review="open"]')?.textContent).toContain('Silicon: 2 contracts')
    expect(document.querySelector('[data-review="open"]')?.textContent).toContain('Nothing went quiet.')
    expect(document.querySelectorAll('[data-primary]')[0].textContent).toBe('Close review')
  })
  it('owns no primary when pinned: the same button is drawn quiet', async () => {
    await open('pinned')
    expect(document.querySelectorAll('[data-primary]')).toHaveLength(0)
    expect(([...document.querySelectorAll('[data-card="P5"] button')].find((b) => b.textContent === 'Open review') as HTMLElement).className).not.toContain('primary')
  })
  it('puts the month in one line from the Consistency stat', async () => {
    await open()
    expect(document.querySelector('[data-review="month"]')?.textContent).toBe('Month: 6 of 30 days had a logged action.')
  })
})

describe('P9 Recent', () => {
  it('groups by day, newest first, with totals, and collapses the zero-XP rows into one line', async () => {
    await open()
    const folds = [...document.querySelectorAll('[data-card="P9"] .ww-fold')]
    expect(folds).toHaveLength(2)
    expect(folds[0].querySelector('.ww-fold-btn')?.textContent).toContain('10 Nov')
    expect(folds[0].querySelector('.ww-fold-btn')?.textContent).toContain('4 entries · 40 XP · 1 h 5 min')
    expect(folds[1].querySelector('.ww-fold-btn')?.textContent).toContain('8 Nov')
    const day = document.querySelector('[data-day="2026-11-10"]')!
    expect(day.querySelectorAll('[data-kind]')).toHaveLength(2)
    expect(day.querySelector('[data-zero]')?.textContent).toBe('2 with no XP (quest), 10 min')
    expect(folds[0].getAttribute('data-open')).toBe('true')
    expect(folds[1].getAttribute('data-open')).toBe('false')
  })
})

describe('empty answers are said in words', () => {
  it('Wins, Recent, Building and GitHub each say what is missing, with no made-up zero', async () => {
    answers['/api/mission/status/v2'] = { ...V2, wins: [], recent: [], suggestions: [] }
    answers['/api/mission/engine/sessions'] = { ...SESSIONS, today_minutes: 0, week_minutes: 0, week_areas: {}, say: 'No commits found in the repos named in Settings, so no building hours to count yet.' }
    answers['/api/mission/engine/proof'] = { status: 'ok', configured: false, say: "I don't know your GitHub username yet." }
    await open()
    expect(document.querySelector('[data-card="P8"]')?.textContent).toContain('No wins on record yet')
    expect(document.querySelector('[data-card="P9"]')?.textContent).toContain('Nothing logged in the last 14 days')
    expect(document.querySelector('[data-card="P6"]')?.textContent).toContain('No building hours yet')
    expect(document.querySelector('[data-card="P6"]')?.textContent).toContain('no building hours to count yet')
    expect(document.querySelector('[data-card="P7"]')?.textContent).toContain('No GitHub name yet')
    expect(document.querySelector('[data-card="P7"]')?.textContent).not.toMatch(/streak/i)
  })
  it('the building hours say they are estimates', async () => {
    await open()
    const p6 = document.querySelector('[data-card="P6"]')!
    expect(p6.textContent).toContain('estimated from commit times')
    expect(p6.textContent).toContain('Most time: aankhen 1 h 30 min, well-wisher 1 h')
  })
})

describe('a failed route costs its card and nothing else', () => {
  it('shows the error and a Retry on P5 while the other nine cards still draw', async () => {
    answers['/api/mission/weekly'] = new Error('weekly is down')
    await open()
    const p5 = document.querySelector('[data-card="P5"]')!
    expect(p5.getAttribute('data-state')).toBe('error')
    expect(p5.textContent).toContain('Error: weekly is down')
    expect(p5.textContent).toContain('Retry')
    expect(document.querySelector('[data-card="P1"] [data-req]')).not.toBeNull()
    expect(document.querySelector('[data-card="P9"] .ww-fold')).not.toBeNull()
  })
  it('Retry asks the route again and recovers the card', async () => {
    answers['/api/mission/weekly'] = new Error('weekly is down')
    await open()
    answers['/api/mission/weekly'] = WEEKLY
    act(() => void ([...document.querySelectorAll('[data-card="P5"] button')].find((b) => b.textContent === 'Retry') as HTMLButtonElement).click())
    await settle()
    expect(document.querySelector('[data-card="P5"]')?.textContent).toContain('3/7 active days')
    expect(calls.filter((c) => c === '/api/mission/weekly').length).toBeGreaterThanOrEqual(2)
  })
  it('a refresh that fails keeps the last answer on screen and says it is old', async () => {
    useFrame.setState({ proofOpen: false })
    await open('rail')
    answers['/api/mission/status/v2'] = new Error('gone')
    act(() => useFrame.setState({ proofOpen: true }))
    await settle()
    expect(document.querySelector('[data-card="P9"] .ww-fold')).not.toBeNull()
    expect(document.querySelector('[data-card="P9"]')?.textContent).toContain('Could not refresh. Showing the last answer')
  })
})

describe('reading again', () => {
  it('reads the five routes once on mount and again when the panel is opened', async () => {
    await open('rail')
    const first = calls.filter((c) => c.startsWith('/api/mission/') && !c.includes('/kv')).length
    expect(first).toBe(5)
    act(() => useFrame.setState({ proofOpen: true }))
    await settle()
    expect(calls.filter((c) => c === '/api/mission/status/v2')).toHaveLength(2)
  })
})

describe('P10 What got in the way', () => {
  it('will not save an empty entry, saves a real one on this device and shows it', async () => {
    await open()
    const p10 = document.querySelector('[data-card="P10"]')!
    const save = [...p10.querySelectorAll('button')].find((b) => b.textContent === 'Save') as HTMLButtonElement
    expect(save.getAttribute('aria-disabled')).toBe('true')
    expect(p10.textContent).toContain('Nothing logged yet.')
    const area = p10.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      set.call(area, 'Started late after a long call')
      area.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => void (([...p10.querySelectorAll('button')].find((b) => b.textContent === 'Save')) as HTMLButtonElement).click())
    expect(useFailureStore.getState().entries).toHaveLength(1)
    expect(useFailureStore.getState().entries[0].whatHappened).toBe('Started late after a long call')
    expect(p10.textContent).toContain('Saved on this device.')
    expect(p10.textContent).toContain('1 logged · most common cause: planning')
  })
})

describe('wording', () => {
  it('no string in any state uses loss-framed or blaming wording', async () => {
    await open('rail')
    expect(text()).not.toMatch(SHAME_IN_UI)
    m?.unmount()
    answers['/api/mission/status/v2'] = { ...V2, wins: [], recent: [], series: [], suggestions: [] }
    await open('pinned')
    expect(text()).not.toMatch(SHAME_IN_UI)
  })
})

describe('formatting helpers', () => {
  it('formats days, minutes and source lines without going through UTC', () => {
    expect(dayLabel('2026-11-10')).toContain('10 Nov')
    expect(dayLabel('nonsense')).toBe('nonsense')
    expect(minutesLabel(45)).toBe('45 min')
    expect(minutesLabel(120)).toBe('2 h')
    expect(minutesLabel(65)).toBe('1 h 5 min')
    expect(sourceLine({ author: 'Seneca', work: 'On the Shortness of Life', year: 49, kind: 'primary text' })).toBe('Seneca, 49 CE. On the Shortness of Life (primary text)')
  })
})

describe('O4 Record', () => {
  it('registers itself under the record id', () => {
    expect(registeredOverlay('record')).toBe(RecordBody)
  })
  it('says "not measured yet" with an empty ledger and draws no attribute bar as zero', () => {
    useGame.setState({ g: E.defaultGame() })
    m = mount(<RecordBody />)
    const root = document.querySelector('[data-overlay="record"]')!
    expect(root.querySelector('[data-record="attributes"]')?.textContent).toContain('Not measured yet')
    expect(root.querySelector('[data-attr]')).toBeNull()
  })
  it('declares no primary and holds no button: close only', () => {
    m = mount(<RecordBody />)
    const root = document.querySelector('[data-overlay="record"]')!
    expect(root.hasAttribute('data-primary-none')).toBe(true)
    expect(root.querySelector('[data-primary]')).toBeNull()
    expect(root.querySelector('button.primary')).toBeNull()
  })
  it('lists every achievement once, earned or not yet, and the Season One record', async () => {
    const { ACHIEVEMENTS } = await import('../../germoney/game/achievements')
    useGame.setState({ g: { ...E.defaultGame(), achievements: { [ACHIEVEMENTS[0].id]: '2026-11-02' } } })
    m = mount(<RecordBody />)
    const rows = [...document.querySelectorAll('[data-ach]')]
    expect(rows).toHaveLength(ACHIEVEMENTS.length)
    expect(rows[0].getAttribute('data-got')).toBe('true')
    expect(rows[0].textContent).toContain('Earned')
    expect(rows[1].textContent).toContain('Not yet')
    expect(document.querySelector('[data-overlay="record"]')?.textContent).toContain('Season One record')
    expect(document.querySelector('[data-overlay="record"]')?.textContent).toContain(`Achievements · 1 of ${ACHIEVEMENTS.length}`)
  })
})
