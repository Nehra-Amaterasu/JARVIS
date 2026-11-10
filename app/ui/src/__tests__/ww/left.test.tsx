// Chunk 6: the left column (plan 8.1 "Left column"), its view-model, and the phone's copy of that view-model.
// Fictional data only. The routes are faked at lib/api, so nothing here touches a server or a data dir.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { mount, resetHtml } from './_stubs'

const hoisted = vi.hoisted(() => ({ api: vi.fn(), post: vi.fn() }))
vi.mock('../../lib/api', async (orig) => ({ ...(await orig<typeof import('../../lib/api')>()), api: hoisted.api, post: hoisted.post }))

import { usePlan } from '../../germoney/game/plan'
import { useStore } from '../../lib/store'
import { PrimaryOwner } from '../../ww/kit'
import { useFrame, resetFrameStore } from '../../ww/frame/frameStore'
import { useOverlay, closeOverlay } from '../../ww/frame/overlayRegistry'
import { LeftColumn } from '../../ww/left'
import { buildLeft, LEFT_SECTION_IDS, type RawLeft } from '../../ww/left/model'
import { renders, resetRenders } from '../../ww/left/renders'
import { resetLeftForTests } from '../../ww/left/store'

// ---------------------------------------------------------------- fixtures (invented names and dates)
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const TOMORROW = ymd(new Date(Date.now() + 864e5))

const paper = (id: string, title: string, date: string, days_left: number, kind: string, extra: object = {}) => ({ id, title, date, days_left, kind, approx: false, start: null, ...extra })
const EXAMS = {
  status: 'ok',
  papers: [
    paper('p1', 'Control', '2026-11-20', 8, 'end_sem', { approx: true }),
    paper('p2', 'Maths 3', '2026-11-18', 6, 'cie', { start: '10:00' }),
    paper('p3', 'Circuits', '2026-11-18', 6, 'cie', { start: '14:00' }),
    paper('p4', 'Signals', '2026-11-25', 13, 'cie'),
    paper('p5', 'Machines', '2026-11-27', 15, 'other'),
    paper('p6', 'Power', '2026-12-01', 19, 'end_sem'),
    paper('p7', 'Drives', '2026-12-04', 22, 'other'),
    paper('p0', 'Old paper', '2026-11-04', -3, 'cie'),
  ],
  days: [{ date: TOMORROW, slots: [{ label: 'Library', minutes: 90, blocks: [{ title: 'Signals', minutes: 90, focus: [{ title: 'Fourier series' }] }] }] }],
}
const DIRECTOR = {
  status: 'ok',
  steps: [
    { kind: 'study', title: 'Control: Root locus', minutes: 45, why: 'Control in 8 days', paper: 'p1' },
    { kind: 'recall', title: 'Recall: Bode plots', minutes: 5, why: 'due today' },
  ],
}
const cls = (id: string, start: string, name: string, status: string | null = null, kind = 'theory') => ({ id, start, end: null, subject: id, name, kind, room: '', status })
const mkAttendance = () => ({
  status: 'ok',
  today: [cls('c1', '08:45', 'Control systems'), cls('c2', '10:45', 'Maths 3'), cls('c3', '12:00', 'Circuits'), cls('c4', '14:00', 'Machines lab', null, 'lab'), cls('c5', '16:00', 'Signals')],
  subjects: [],
})
const mkLife = () => ({
  status: 'ok',
  counters: [
    { id: 'water', name: 'Glasses of water', today: 3 }, { id: 'gym', name: 'Gym', today: 0 }, { id: 'walk', name: 'Walk', today: 1 },
    { id: 'read', name: 'Reading', today: 2 }, { id: 'meal', name: 'Meals', today: 2 }, { id: 'sleep', name: 'Sleep', today: 1 }, { id: 'note', name: 'Notes', today: null },
  ],
})
const SEASON = { season: 'exams', mode: 'auto', window_days: 45, nearest_days: 6, evening: false, evening_why: null, left_top: 'countdown', opens: 'study', due_soon_days: 3, findings_hidden: true, now_card: 'now' }
const TODAY = (over: object = {}) => ({
  date: ymd(new Date()), track: 'silicon', season: SEASON, contracts: [{ done: true }, { done: false }, { done: false }],
  welcome_back: { idle_days: 3, since: '2026-11-07', slipped: ['one'], next_deadline: null, refreshers: [], say: 'Welcome back.' },
  deadlines: [], three: null, ...over,
})

let attendance = mkAttendance()
let life = mkLife()
let payloads: Record<string, unknown>
let failing: Set<string>
let deferred: { resolve: (v: unknown) => void; reject: (e: Error) => void } | null = null
const calls: { method: string; path: string; body: unknown }[] = []

function serve(path: string, method: string, body?: unknown): Promise<unknown> {
  calls.push({ method, path, body })
  const key = Object.keys(payloads).find((k) => path === k)
  if (method === 'POST' && path.startsWith('/api/mission/attendance/')) {
    if (failing.has('class')) return Promise.reject(new Error('refused'))
    const [slot, status] = path.replace('/api/mission/attendance/', '').split('/')
    attendance = { ...attendance, today: attendance.today.map((c) => (c.id === slot ? { ...c, status: status === 'clear' ? null : status } : c)) }
    if (deferred === null && failing.has('slow')) return new Promise((res, rej) => (deferred = { resolve: () => res(attendance), reject: rej }))
    return Promise.resolve(attendance)
  }
  if (method === 'POST' && path === '/api/mission/life/count') {
    if (failing.has('count')) return Promise.reject(new Error('refused'))
    const b = body as { id: string; delta: number }
    life = { ...life, counters: life.counters.map((c) => (c.id === b.id ? { ...c, today: Math.max(0, (c.today ?? 0) + b.delta) } : c)) }
    return Promise.resolve(life)
  }
  if (failing.has('all')) return Promise.reject(new Error('offline'))
  if (path === '/api/mission/attendance') return Promise.resolve(attendance)
  if (path === '/api/mission/life') return Promise.resolve(life)
  if (key) return Promise.resolve(payloads[key])
  return Promise.reject(new Error(`unmocked ${method} ${path}`))
}

// ---------------------------------------------------------------- harness
const flush = async () => {
  for (let i = 0; i < 4; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}
let m: ReturnType<typeof mount> | null = null
let heightOfLeft = 0
const show = async () => {
  m = mount(
    <PrimaryOwner>
      <div className="ww" data-density="compact">
        <aside className="ww-left">
          <LeftColumn />
        </aside>
      </div>
    </PrimaryOwner>,
  )
  await flush()
  return m
}
const col = () => document.querySelector('[data-left="column"]') as HTMLElement
const text = () => col().textContent ?? ''
const card = (id: string) => document.querySelector(`[data-card="${id}"]`) as HTMLElement
const btn = (re: RegExp, within: ParentNode = document) => [...within.querySelectorAll<HTMLButtonElement>('button')].find((b) => re.test(b.getAttribute('aria-label') ?? b.textContent ?? ''))!
const click = async (el: Element) => {
  await act(async () => void (el as HTMLElement).click())
  await flush()
}

beforeEach(() => {
  resetHtml()
  resetFrameStore()
  resetLeftForTests()
  resetRenders()
  closeOverlay()
  attendance = mkAttendance()
  life = mkLife()
  failing = new Set()
  deferred = null
  calls.length = 0
  payloads = { '/api/mission/exams': EXAMS, '/api/mission/director': DIRECTOR, '/api/remote': { devices: [] } }
  hoisted.api.mockImplementation((path: string, init?: { method?: string; body?: unknown }) => serve(path, init?.method ?? 'GET', init?.body))
  hoisted.post.mockImplementation((path: string, body?: unknown) => serve(path, 'POST', body))
  usePlan.setState({
    today: TODAY() as never,
    state: { events: [] } as never,
    ladder: null,
    loadLadder: vi.fn(async () => {}),
    log: vi.fn(async () => ({ ok: true, say: 'Logged 25 minutes of silicon. Plus 5 XP.' })),
  })
  useStore.setState({ toast: vi.fn() })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return (this as HTMLElement).classList?.contains('ww-left') ? heightOfLeft : 0 } })
  heightOfLeft = 0
})
afterEach(() => {
  m?.unmount()
  m = null
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------- the column
describe('left column: structure', () => {
  it('renders Countdown, Now, Classes, Counters, Phone chip in that order', async () => {
    await show()
    expect([...col().querySelectorAll('[data-section]')].map((e) => (e as HTMLElement).dataset.section)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5'])
    expect([...col().querySelectorAll('[data-card]')].map((e) => (e as HTMLElement).dataset.card)).toEqual(['L1', 'L2', 'L3', 'L4'])
    expect(card('L1').querySelector('h2')!.textContent).toBe('Countdown')
    expect(card('L2').querySelector('h2')!.textContent).toBe('Now')
  })

  it('Countdown lists earlier-sitting papers first and shows "+N more" rather than cutting them', async () => {
    await show()
    const l1 = card('L1')
    expect(l1.textContent).toContain('Next: Maths 3 in 6 d')                    // 11-18 10:00 sits before 11-18 14:00
    expect([...l1.querySelectorAll('.ww-l1-rows li')].map((li) => li.querySelector('.ww-l1-name')!.textContent)).toEqual(['Circuits', 'Control', 'Signals'])
    expect(l1.textContent).toContain('+3 more')                                  // Machines, Power, Drives: counted, not dropped
    expect(l1.textContent).toContain('CIE 3 · End 2 · Other 2')
    expect(l1.textContent).not.toContain('Old paper')                            // a paper in the past is not ahead
  })

  it('shows one "dates tentative" line, not a tilde per row', async () => {
    await show()
    expect(text().match(/Dates tentative/g)).toHaveLength(1)
    expect(text()).not.toContain('~')
  })

  it('Edit opens the date sheet', async () => {
    await show()
    await click(btn(/Edit the date sheet/))
    expect(useOverlay.getState().open).toBe('date')
  })

  it('Now shows the director\'s step 1 only; no second "first pick" exists anywhere in the tree', async () => {
    await show()
    expect(card('L2').textContent).toContain('Control: Root locus, 45 min.')
    expect(text()).not.toContain('Recall: Bode plots')                           // step 2 is not offered as "next"
    expect(text()).not.toMatch(/first pick|today'?s (3|three)/i)
  })

  it('Now shows one welcome-back line and its day count equals the idle-days field', async () => {
    await show()
    const lines = document.querySelectorAll('[data-welcome]')
    expect(lines).toHaveLength(1)
    expect(lines[0].textContent).toContain('Back after 3 days.')
    expect(usePlan.getState().today!.welcome_back!.idle_days).toBe(3)
  })

  it('the Why-this fold holds the server\'s reason, closed until opened, and the reason appears once', async () => {
    await show()
    const fold = card('L2').querySelector('.ww-fold-btn') as HTMLButtonElement
    expect(fold.getAttribute('aria-expanded')).toBe('false')
    await click(fold)
    expect(fold.getAttribute('aria-expanded')).toBe('true')
    expect(text().match(/Control in 8 days/g)).toHaveLength(1)
  })

  it('with the plan not loaded and every list empty the column renders words, never "undefined", "NaN", "null" or "[object"', async () => {
    usePlan.setState({ today: null, state: null })
    payloads = { '/api/mission/exams': { status: 'ok', papers: [], days: [] }, '/api/mission/director': { status: 'ok', steps: [] }, '/api/remote': { devices: [] } }
    attendance = { status: 'ok', today: [], subjects: [] }
    life = { status: 'ok', counters: [] }
    await show()
    expect(text()).not.toMatch(/undefined|NaN|\bnull\b|\[object/)
    expect(text()).toContain('Nothing read yet for the horizon.')              // no plan, so the quiet default season: Horizon
    expect(text()).toContain('Nothing planned yet')
    expect(text()).toContain('No classes today, or no timetable yet.')
    expect(text()).toContain('No counters set up.')
  })

  it('in exam season with an empty date sheet Countdown says there is no dated paper, not a number', async () => {
    payloads['/api/mission/exams'] = { status: 'ok', papers: [], days: [] }
    await show()
    expect(card('L1').textContent).toContain('No dated paper ahead.')
    expect(card('L1').textContent).not.toMatch(/CIE|NaN|undefined/)
  })

  it('when every read fails the cards say so with a Retry and still show no undefined or NaN', async () => {
    failing = new Set(['all'])
    await show()
    expect(text()).not.toMatch(/undefined|NaN|\bnull\b|\[object/)
    expect(text()).toContain('Could not read the date sheet.')
    expect(text()).toContain('Could not read the classes.')
    expect(btn(/Retry/, card('L3'))).toBeTruthy()
  })
})

describe('left column: taps', () => {
  it('+25 posts minutes through usePlan.log, shows a toast, and the line moves before the server answers', async () => {
    let done: (v: { ok: boolean; say: string }) => void = () => {}
    const log = vi.fn(() => new Promise<{ ok: boolean; say: string }>((r) => (done = r)))
    usePlan.setState({ log: log as never })
    await show()
    await click(btn(/Log 25 minutes/))
    expect(log).toHaveBeenCalledWith({ minutes: 25, track: 'silicon', note: 'Control: Root locus' })
    expect(card('L2').textContent).toContain('Logged today: 25 min')           // optimistic, before the reply
    await act(async () => done({ ok: true, say: 'Logged 25 minutes of silicon. Plus 5 XP.' }))
    await flush()
    expect(useStore.getState().toast).toHaveBeenCalledWith('Logged 25 minutes of silicon. Plus 5 XP.', 'live')
  })

  it('a refused +50 takes its minutes back and says so', async () => {
    usePlan.setState({ log: vi.fn(async () => { throw new Error('down') }) as never })
    await show()
    await click(btn(/Log 50 minutes/))
    expect(card('L2').textContent).not.toContain('Logged today')
    expect(useStore.getState().toast).toHaveBeenCalledWith('Could not log that. Nothing changed.', 'fault')
  })

  it('Other opens the Log-minutes sheet and Start goes to the workspace of the step', async () => {
    await show()
    await click(btn(/^Other$/))
    expect(useOverlay.getState().open).toBe('log')
    await click(btn(/^Start$/))
    expect(useFrame.getState().ws).toBe('study')
  })

  it('class taps carry aria-labels with subject, time and status, are 44 px by class, and a second tap on the same status clears it', async () => {
    await show()
    const first = card('L3').querySelector('.ww-cls') as HTMLElement
    const taps = [...first.querySelectorAll<HTMLButtonElement>('button')]
    expect(taps.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Control systems at 08:45: mark present', 'Control systems at 08:45: mark absent', 'Control systems at 08:45: mark cancelled',
    ])
    expect(taps.every((b) => b.getAttribute('data-grouped') === 'true')).toBe(true)   // grouped = 44 px high and wide for real
    expect([...card('L2').querySelectorAll('.ww-left-presets button')].every((b) => b.getAttribute('data-grouped') === 'true')).toBe(true)
    await click(taps[0])
    let now = [...card('L3').querySelectorAll<HTMLButtonElement>('.ww-cls')[0].querySelectorAll('button')]
    expect(now[0].getAttribute('aria-pressed')).toBe('true')
    expect(now[0].getAttribute('aria-label')).toBe('Control systems at 08:45: clear present')
    await click(now[0])
    now = [...card('L3').querySelectorAll<HTMLButtonElement>('.ww-cls')[0].querySelectorAll('button')]
    expect(now[0].getAttribute('aria-pressed')).toBe('false')
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/api/mission/attendance/c1/present', '/api/mission/attendance/c1/clear'])
  })

  it('a class tap lights before the reply and goes back, with a toast, when the server refuses', async () => {
    await show()
    failing = new Set(['slow'])
    const present = () => card('L3').querySelector<HTMLButtonElement>('.ww-cls button')!
    await act(async () => void present().click())
    expect(present().getAttribute('aria-pressed')).toBe('true')                  // the reply has not come
    await act(async () => deferred!.reject(new Error('refused')))
    await flush()
    expect(present().getAttribute('aria-pressed')).toBe('false')
    expect(useStore.getState().toast).toHaveBeenCalledWith('Could not save that class. Nothing changed.', 'fault')
  })

  it('shows 3 class rows at compact density and counts the rest instead of hiding them; a tall column shows 5', async () => {
    await show()
    expect(card('L3').querySelectorAll('.ww-cls')).toHaveLength(3)
    expect(card('L3').textContent).toContain('+2 later today')
    m!.unmount()
    heightOfLeft = 800
    await show()
    expect(card('L3').querySelectorAll('.ww-cls')).toHaveLength(5)
    expect(card('L3').textContent).not.toContain('later today')
  })

  it('counters: 6 tiles, the 7th is counted and linked to Life; a tap adds one at once and Undo takes it back; a refusal restores', async () => {
    await show()
    expect(card('L4').querySelectorAll('.ww-ctr')).toHaveLength(6)
    expect(card('L4').textContent).toContain('+1 more in')
    await click(card('L4').querySelector('.ww-ctr')!)
    expect(card('L4').querySelector('.ww-ctr')!.getAttribute('aria-label')).toBe('Glasses of water: 4 today. Add one.')
    await click(btn(/Undo last tap/))
    expect(card('L4').querySelector('.ww-ctr')!.getAttribute('aria-label')).toBe('Glasses of water: 3 today. Add one.')
    failing = new Set(['count'])
    await click(card('L4').querySelector('.ww-ctr')!)
    expect(card('L4').querySelector('.ww-ctr')!.getAttribute('aria-label')).toBe('Glasses of water: 3 today. Add one.')
    expect(useStore.getState().toast).toHaveBeenCalledWith('Could not save that count. Nothing changed.', 'fault')
  })

  it('a counter with no number from the server says "not measured yet", not 0', async () => {
    heightOfLeft = 1000
    await show()
    const note = [...card('L4').querySelectorAll('.ww-ctr')].find((e) => e.textContent!.includes('Notes'))!
    expect(note.textContent).toContain('not measured yet')
    expect(note.getAttribute('aria-label')).toContain('not measured yet')
  })
})

describe('left column: render counts', () => {
  it('tapping a class re-renders only the Classes card (render-count test)', async () => {
    await show()
    const before = { ...renders }
    expect(before.L3).toBeGreaterThan(0)
    await click(card('L3').querySelector('.ww-cls button')!)
    const delta = (id: string) => (renders[id] ?? 0) - (before[id] ?? 0)
    expect(delta('L3')).toBeGreaterThan(0)
    for (const other of ['L1', 'L2', 'L4', 'L5']) expect(delta(other), other).toBe(0)
  })

  it('tapping a counter re-renders only the Counters card', async () => {
    await show()
    const before = { ...renders }
    await click(card('L4').querySelector('.ww-ctr')!)
    const delta = (id: string) => (renders[id] ?? 0) - (before[id] ?? 0)
    expect(delta('L4')).toBeGreaterThan(0)
    for (const other of ['L1', 'L2', 'L3', 'L5']) expect(delta(other), other).toBe(0)
  })

  it('a Ticker roll re-renders only its own Stat: a second tap on one tile leaves the other tiles\' text alone', async () => {
    await show()
    const tiles = () => [...card('L4').querySelectorAll('.ww-ctr')].map((e) => e.getAttribute('aria-label'))
    const before = tiles()
    await click(card('L4').querySelector('.ww-ctr')!)
    const after = tiles()
    expect(after.slice(1)).toEqual(before.slice(1))
    expect(after[0]).not.toBe(before[0])
  })
})

describe('left column: season, evening, phone', () => {
  it('the season pill swaps Countdown for Horizon in the SAME card element, with the room it had', async () => {
    await show()
    const node = card('L1')
    expect(node.querySelector('h2')!.textContent).toBe('Countdown')
    await act(async () => useFrame.getState().setSeasonMode('normal'))
    await flush()
    expect(card('L1')).toBe(node)                                                  // not remounted
    expect(node.querySelector('h2')!.textContent).toBe('Horizon')
    expect(node.classList.contains('ww-l1')).toBe(true)                             // the class that reserves its height
    expect(node.textContent).not.toContain('CIE')
  })

  it('Horizon reads the deadline, the first step and the week\'s goal from the plan', async () => {
    usePlan.setState({
      today: TODAY({ season: { ...SEASON, season: 'normal', left_top: 'horizon' }, deadlines: [{ org: 'Acme Labs', programme: 'summer intern', days_left: 12 }], three: { career_next: { title: 'Acme Labs', action: 'update the CV', days_left: 12 } } }) as never,
      ladder: { week: { ends: '', goals: [{ serves: null, title: 'Ship the demo' }] } } as never,
    })
    await show()
    expect(card('L1').textContent).toContain('Acme Labs summer intern in 12 d')
    expect(card('L1').textContent).toContain('First step: update the CV')
    expect(card('L1').textContent).toContain('Goal this week: Ship the demo')
  })

  it('in the evening Now becomes Close the day: what moved, "not done: kept", tomorrow\'s first block, and the fill moves to See tomorrow', async () => {
    usePlan.setState({
      today: TODAY({ season: { ...SEASON, evening: true, evening_why: 'clock', now_card: 'close_the_day' } }) as never,
      state: { events: [{ id: 'e1', t: 0, date: ymd(new Date()), kind: 'log', minutes: 70, track: 'silicon' }] } as never,
    })
    await show()
    const l2 = card('L2')
    expect(l2.querySelector('h2')!.textContent).toBe('Close the day')
    expect(l2.textContent).toContain('Moved today: 1 h 10 logged.')
    expect(l2.textContent).toContain('Not done: kept, not lost.')
    expect(l2.textContent).toContain('Tomorrow first: Signals: Fourier series')
    expect(l2.textContent).toContain('1 of 3 done')
    expect(btn(/^Start$/, l2)).toBeUndefined()
    expect(btn(/See tomorrow/, l2).getAttribute('data-primary')).toBe('true')
    await click(btn(/See tomorrow/, l2))
    expect(useFrame.getState().ws).toBe('study')
  })

  it('exactly one saffron fill in the column', async () => {
    await show()
    expect(col().querySelectorAll('[data-primary]')).toHaveLength(1)
  })

  it('the phone chip says Not paired and opens the Phone overlay; once a phone is paired it is a quiet line with no arrow', async () => {
    await show()
    const row = document.querySelector('[data-section="L5"]')!
    expect(row.textContent).toContain('Not paired. Set up')
    await click(row.querySelector('button')!)
    expect(useOverlay.getState().open).toBe('phone')
    m!.unmount()
    payloads['/api/remote'] = { devices: [{ id: 'd1', name: 'A phone' }] }
    await show()
    const paired = document.querySelector('[data-section="L5"]')!
    expect(paired.textContent).toBe('Phone: paired')
    expect(paired.querySelector('button')).toBeNull()
  })
})

// ---------------------------------------------------------------- the phone's copy of the view-model
describe('phone parity: ww.js carries the same view-model as model.ts', () => {
  const PAGE = join(process.cwd(), '..', 'jarvis_app', 'phone_page') // vitest runs in app/ui
  const src = readFileSync(join(PAGE, 'ww.js'), 'utf8')
  const html = readFileSync(join(PAGE, 'ww.html'), 'utf8')
  // The source is this repository's own file, read from disk (not input): it is evaluated with no DOM so that
  // only its pure functions run, exactly as the phone's browser would define them.
  const js = new Function('window', 'document', `${src}\nreturn window.WWLeft`)({}, undefined) as {
    buildLeft: (r: RawLeft) => unknown
    rawOf: (d: object) => RawLeft
    LEFT_SECTION_IDS: string[]
  }
  const same = (r: RawLeft) => expect(JSON.parse(JSON.stringify(js.buildLeft(r)))).toEqual(JSON.parse(JSON.stringify(buildLeft(r))))
  const pp = (id: string, title: string, date: string, d: number, kind: string, approx = false, start: string | null = null) => ({ id, title, date, start, days_left: d, kind, approx })
  const FULL: RawLeft = {
    season: { left_top: 'countdown', now_card: 'now' },
    papers: [pp('a', 'Control', '2026-11-20', 8, 'end_sem', true), pp('b', 'Maths', '2026-11-18', 6, 'cie', false, '10:00'), pp('c', 'Circuits', '2026-11-18', 6, 'cie', false, '14:00'), pp('d', 'Signals', '2026-11-25', 13, 'cie'), pp('e', 'Machines', '2026-11-27', 15, 'other'), pp('f', 'Power', '2026-12-01', 19, 'backlog'), pp('g', 'Past', '2026-11-01', -2, 'cie'), pp('h', 'Undated', '', null as never, 'cie')],
    now: { kind: 'study', title: 'Control: Root locus', minutes: 95, why: 'Control in 8 days', paper: 'a' },
    horizon: null,
    day: { done: 1, total: 3, logged_minutes: 25, tomorrow: 'Signals: Fourier series', idle_days: 1, slipped: 2 },
    classes: [{ id: 'c1', start: '08:45', name: 'Control systems', kind: 'theory', status: 'present' }, { id: 'c2', start: '14:00', name: 'Machines', kind: 'lab', status: null }],
    counters: [{ id: 'w', name: 'Water', today: 3 }, { id: 'n', name: 'Notes', today: null }, { id: 'z', name: 'Gym', today: 0 }],
  }
  const nothing: RawLeft = { season: { left_top: 'countdown', now_card: 'now' }, papers: null, now: null, horizon: null, day: null, classes: null, counters: null }

  it('builds the same sections from the same raw data: full, empty, unread, horizon and evening', () => {
    same(FULL)
    same({ ...FULL, papers: [], now: null, classes: [], counters: [], day: { done: null, total: null, logged_minutes: null, tomorrow: null, idle_days: null, slipped: 0 } })
    same(nothing)
    same({ ...FULL, season: { left_top: 'horizon', now_card: 'now' }, horizon: { deadline: { org: 'Acme Labs', programme: 'intern', days_left: 12 }, first_step: 'update the CV', rung: 'Ship the demo' } })
    same({ ...FULL, season: { left_top: 'horizon', now_card: 'now' }, horizon: { deadline: null, first_step: null, rung: null } })
    same({ ...FULL, season: { left_top: 'countdown', now_card: 'close_the_day' } })
    same({ ...nothing, season: { left_top: 'horizon', now_card: 'close_the_day' } })
  })

  it('lists the same section ids, in the same order, in the page as in the window\'s view-model', () => {
    expect(js.LEFT_SECTION_IDS).toEqual([...LEFT_SECTION_IDS])
    expect([...html.matchAll(/<section id="(L\d)" class="card" data-section="(L\d)"/g)].map((x) => x[1])).toEqual([...LEFT_SECTION_IDS])
    expect(buildLeft(FULL).ids).toEqual([...LEFT_SECTION_IDS])
  })

  it('turns the phone route\'s payload into the same raw data, falling back to today\'s first study block for Now and to null elsewhere', () => {
    const payload = {
      season: SEASON, papers: [pp('a', 'Control', '2026-11-20', 8, 'end_sem')],
      blocks: [{ label: 'Library', minutes: 90, blocks: [{ paper: 'a', title: 'Control systems', minutes: 90, focus: [{ title: 'Root locus' }] }] }],
      classes: [{ id: 'c1', start: '08:45', name: 'Control systems', kind: 'theory', status: null }], counters: [{ id: 'w', name: 'Water', today: 3 }],
    }
    const raw = js.rawOf(payload)
    expect(raw.now).toEqual({ kind: 'study', title: 'Control systems: Root locus', minutes: 90, why: null, paper: 'a' })
    expect(raw.horizon).toBeNull()
    expect(raw.day).toEqual({ done: null, total: null, logged_minutes: null, tomorrow: null, idle_days: null, slipped: 0 })
    // a route that sends `now` (the director's step 1) wins over the fallback
    expect(js.rawOf({ ...payload, now: { kind: 'habit', title: 'Walk', minutes: 20, why: null, paper: null } }).now!.kind).toBe('habit')
    // no payload fields: nothing is invented
    expect(js.rawOf({}).papers).toBeNull()
    expect(js.rawOf({}).classes).toBeNull()
  })
})
