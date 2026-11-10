// Chunk 8: the Life workspace (plan 8.1 "Life"). Fictional rows only; the server is a small in-memory fake behind
// lib/api, so a delete really removes the row and a failure really throws.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { join } from 'node:path'
import { mount, resetHtml } from './_stubs'
import { parseCss, read, WW_DIR } from './_css'

const srv = vi.hoisted(() => ({
  handler: (async () => ({})) as (method: string, path: string, body: any) => Promise<unknown>,
  calls: [] as { method: string; path: string; body: any }[],
}))
vi.mock('../../lib/api', () => ({
  api: (path: string, init: { method?: string; body?: unknown } = {}) => {
    const method = init.method ?? (init.body === undefined ? 'GET' : 'POST')
    srv.calls.push({ method, path, body: init.body })
    return srv.handler(method, path, init.body)
  },
  post: (path: string, body: unknown = {}) => {
    srv.calls.push({ method: 'POST', path, body })
    return srv.handler('POST', path, body)
  },
}))

import { LifeWorkspace } from '../../ww/life'
import { CounterTiles } from '../../ww/life/CounterTiles'
import { MIN_SAMPLE, classProgress, counterTiles, itemCue, marginView, pendingWord, questSets, questTyped, wentToCollege } from '../../ww/life/derive'
import type { AttendanceAnswer, Counter, ItemRow, SubjectRow, TodayClass } from '../../ww/life/derive'
import { recentSessions } from '../../ww/life/GymCard'
import { PrimaryButton, PrimaryOwner, TapGroup } from '../../ww/kit'
import { usePlan } from '../../germoney/game/plan'
import { useWorkoutStore } from '../../germoney/stores/workout-store'
import { workspaceMemory } from '../../ww/frame/workspaceMemory'

// ---------------------------------------------------------------------------------------------- fixtures
const cls = (id: string, status: TodayClass['status']): TodayClass => ({ id, start: '10:00', end: '11:00', subject: id, name: `Subject ${id}`, kind: 'lecture', room: '', status })
const subj = (id: string, held: number, attended: number, over: Partial<SubjectRow> = {}): SubjectRow => ({
  subject: id, name: `Subject ${id}`, held, attended, weekly: 3, pct: held ? attended / held : null, can_miss: 0, need: 0, last: null, ...over,
})
const attendance = (today: TodayClass[], subjects: SubjectRow[], confirmed = true): AttendanceAnswer => ({
  status: 'ok', date: '2026-11-10', say: '', risks: [], rule: { threshold: 0.75, scope: 'per_subject', confirmed }, today, subjects, overall: null,
})
const counters: Counter[] = [
  { id: 'college', name: 'Went to class', want: 'yes', today: 0, line: null, on_line: null, last7: [] },
  { id: 'water', name: 'Glasses of water', want: 'more', today: 3, line: 4, on_line: false, last7: [3, 4] },
]

interface Server {
  items: Omit<ItemRow, 'index'>[]
  reelsDue: { date: string; index: number; text: string; kind: string }[]
  att: AttendanceAnswer
  failDelete: boolean
  failAdd: boolean
}
const server: Server = { items: [], reelsDue: [], att: attendance([], []), failDelete: false, failAdd: false }

function dayView() {
  const queued = server.items.filter((i) => i.kind === 'reel' && !i.explained).length
  return {
    status: 'ok', say: '', rule: 'A counter you want less of gets a line.', date: '2026-11-10', counters, items: server.items, points_today: 1,
    weeks: [{ ends: '2026-11-10', points: 4, logged: 3 }], reels_to_explain: server.reelsDue, last_grade: null,
    item_rows: server.items.map((it, index) => ({ index, ...it })),
    reels_pending: { queued_today: queued, due: server.reelsDue.length, total: queued + server.reelsDue.length },
  }
}
const body = { status: 'ok', say: '', habits: [
  { id: 'walk', target: 'Walk', per_week: 4, done_this_week: 1, today_done: false, on_track: false, met: false },
  { id: 'read', target: 'Read', per_week: 3, done_this_week: 3, today_done: true, on_track: true, met: true },
], focus: { id: 'posture', name: 'Posture', text: 'Stand tall for the first hour.' } }

const quest = (key: string, over: object = {}) => ({
  key, source: 'quest', slot: 'quest', title: `Quest ${key}`, minutes: 20, xp: 10, done: false, steps: [], hint: '', why: '',
  quest: { line: 'push', track: 'body', track_name: 'Push', level: 2, max_level: 5, sets: 3, target: 10, unit: 'reps', hits: ['a'], need: 2, top: false, ...over },
})

beforeEach(() => {
  workspaceMemory.set('life', 'view', 'today', 'today')
  server.items = []
  server.reelsDue = []
  server.att = attendance([], [])
  server.failDelete = false
  server.failAdd = false
  srv.calls.length = 0
  srv.handler = async (method, path, b) => {
    if (path === '/api/mission/life/day') return dayView()
    if (path === '/api/mission/attendance') return server.att
    if (path === '/api/mission/body') return body
    if (path === '/api/mission/life/item' && method === 'POST') {
      if (server.failAdd) throw new Error('disk full')
      server.items.push({ kind: b.kind, text: b.text, ...(b.minutes ? { minutes: b.minutes } : {}), ...(b.url ? { url: b.url } : {}) })
      return dayView()
    }
    if (path === '/api/mission/life/item/delete') {
      if (server.failDelete) throw new Error('the server refused')
      const i = b.index as number
      if (server.items[i]?.kind !== b.kind || server.items[i]?.text !== b.text) throw new Error('that row has changed; reload the list')
      const [removed] = server.items.splice(i, 1)
      return { removed, index: i, ...dayView() }
    }
    if (path === '/api/mission/life/item/restore') {
      server.items.splice(b.index, 0, b.item)
      return dayView()
    }
    if (path.startsWith('/api/mission/quest/')) return { ok: true, say: 'Session logged.' }
    if (path.startsWith('/api/mission/habit/')) return body
    return {}
  }
  usePlan.setState({ today: { contracts: [quest('q1')] } as never, refresh: vi.fn(async () => {}) as never })
  useWorkoutStore.setState({ sessions: [], isLoaded: true })
})

let m: ReturnType<typeof mount> | null = null
afterEach(() => {
  m?.unmount()
  m = null
  document.body.replaceChildren()
  resetHtml()
})

/** Let every pending fake-server promise and the state updates they cause run. */
const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}
const show = async (el = <LifeWorkspace />) => {
  m = mount(<PrimaryOwner>{el}</PrimaryOwner>)
  await settle()
  return m
}
const q = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T
const qa = (sel: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>(sel)]
const byText = (sel: string, text: string | RegExp, root: ParentNode = document) =>
  qa(sel, root).find((e) => (typeof text === 'string' ? (e.textContent ?? '').trim() === text : text.test(e.textContent ?? ''))) as HTMLElement
const click = async (el: Element | undefined) => {
  expect(el, 'the element to click').toBeTruthy()
  await act(async () => (el as HTMLElement).click())
  await settle()
}
const type = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const field = (label: string | RegExp) => {
  const l = qa('label.ww-field-label').find((x) => (typeof label === 'string' ? x.textContent === label : label.test(x.textContent ?? '')))
  return q<HTMLInputElement>(`#${CSS.escape((l as HTMLLabelElement).htmlFor)}`)
}
const logAdd = async (kind: string, text: string, extra?: string) => {
  await click(byText('[role="radio"]', kind))
  await type(q<HTMLInputElement>('.ww-life-what input'), text)
  if (extra) await type(q<HTMLInputElement>('.ww-life-extra input'), extra)
  await click(byText('.ww-life-add button', 'Add'))
}

// ---------------------------------------------------------------------------------------------- tests
describe('Life workspace', () => {
  it('Add to day, Quest, Attendance, This week render in that order; class taps are not duplicated here', async () => {
    server.att = attendance([cls('A', null), cls('B', 'present')], [subj('A', 10, 9, { can_miss: 1 })])
    await show()
    expect(qa('[data-card]').map((c) => c.dataset.card)).toEqual(['LF1', 'LF4', 'LF2', 'LF3', 'LF5'])
    expect(qa('[data-card]').map((c) => q('h2', c)?.textContent)).toEqual(['Add to day', 'Quest', 'Attendance', 'This week', 'Gym'])
    // the idle view is hidden, not unmounted
    expect(q('[data-pane="week"]').hidden).toBe(true)
    expect(q('[data-pane="today"]').hidden).toBe(false)
    const attCard = q('[data-card="LF2"]')
    expect(qa('button', attCard).map((b) => b.textContent)).not.toContain('Present')
    expect(attCard.textContent).not.toMatch(/All present|Absent|Cancelled/)
    expect(qa('[aria-label="Present"], [aria-label="Absent"], [aria-label="Cancelled"]')).toHaveLength(0)
  })

  it('the Week view switch reveals This week and Gym and hides the Today cards', async () => {
    await show()
    await click(byText('[role="radio"]', 'Week and gym'))
    expect(q('[data-pane="week"]').hidden).toBe(false)
    expect(q('[data-pane="today"]').hidden).toBe(true)
    expect(byText('[data-card="LF3"] .ww-row-title', 'Walk')).toBeTruthy()
    expect(q('[data-card="LF3"]').textContent).toContain('Behind') // the walk habit is under its pace: a word, not a colour
    expect(q('[data-card="LF3"]').textContent).toContain('Upgrade · Posture')
  })

  it('Attendance shows behind as text plus an icon and never red below a minimum sample', async () => {
    server.att = attendance(
      [],
      [subj('A', 10, 6, { need: 4, pct: 0.6 }), subj('B', MIN_SAMPLE - 1, 1, { need: 2, pct: 0.25 }), subj('C', 12, 11, { can_miss: 2, pct: 0.92 }), subj('D', 8, 6, { can_miss: 0, pct: 0.75 })],
    )
    await show()
    const row = (n: string) => byText('.ww-life-attrow', new RegExp(`Subject ${n}`))
    const a = row('A')
    expect(a.dataset.tone).toBe('behind')
    expect(a.textContent).toContain('behind by 4 classes')
    expect(q('svg', a)).toBeTruthy() // a hollow icon beside the words
    // under the minimum sample: said as a count, never as behind
    const b = row('B')
    expect(b.dataset.tone).toBe('few')
    expect(b.textContent).toContain(`${MIN_SAMPLE - 1} tapped so far`)
    expect(b.textContent).not.toMatch(/behind/i)
    expect(row('C').textContent).toContain('margin 2 classes')
    expect(row('D').textContent).toContain('at the line')
    // red is a state of its own in the kit (fault chip / overdue row): none is anywhere in the card
    const card = q('[data-card="LF2"]')
    expect(qa('[data-tone="fault"], [data-state="overdue"], .ww-chip', card)).toHaveLength(0)
    // and the stylesheet never colours these rows with the fault token
    const rules = parseCss(read(join(WW_DIR, 'life/life.css'))).rules.filter((r) => r.selectors.some((s) => /ww-life-att/.test(s)))
    expect(rules.length).toBeGreaterThan(3)
    for (const r of rules) for (const v of Object.values(r.decls)) expect(v).not.toMatch(/--fault/)
  })

  it('marginView says behind only from the minimum sample on, and never uses a verdict word', () => {
    const words = /fail|bad|danger|skip|safe|warning|risk|shame|low\b/i
    for (const held of [0, 1, MIN_SAMPLE - 1, MIN_SAMPLE, 30]) {
      for (const need of [0, 1, 7]) {
        const v = marginView(subj('A', held, 0, { need, can_miss: need ? 0 : 3 }), 0.75)
        expect(`${v.text} ${v.detail}`).not.toMatch(words)
        if (held < MIN_SAMPLE) expect(v.tone).not.toBe('behind')
        else if (need) expect(v.tone).toBe('behind')
      }
    }
  })

  it('the counter tile and the class list agree: no "went to college" zero beside logged classes', async () => {
    // the raw counter says 0 (the old hand-tapped tile), the class list says two classes were attended
    const att = attendance([cls('A', 'present'), cls('B', 'present'), cls('C', 'absent')], [])
    expect(counters[0].today).toBe(0)
    m = mount(<CounterTiles counters={counters} attendance={att} />)
    const tile = q('[data-tile="college"]')
    expect(tile.textContent).toContain('Yes')
    expect(tile.textContent).not.toMatch(/\b0\b|Not yet|Not today/)
    expect(q('button', tile)).toBeNull() // derived: nothing to tap, so it cannot drift from the list
    expect(q('[data-tile="water"]').textContent).toContain('3') // other counters are the server's

    const word = (today: TodayClass[]) => counterTiles(counters, attendance(today, []))[0].word
    expect(word([])).toBe('No class today')
    expect(word([cls('A', null), cls('B', 'absent')])).toBe('Not yet')
    expect(word([cls('A', 'absent'), cls('B', 'cancelled')])).toBe('Not today')
    expect(word([cls('A', null), cls('B', 'present')])).toBe('Yes') // one present is a yes while others are unmarked
    // with no attendance answer at all the tile falls back to the counter, it does not invent a zero from nothing
    expect(counterTiles(counters, null)[0].kind).toBe('yes')
  })

  it('wentToCollege and classProgress read only the class list', () => {
    expect(wentToCollege(undefined)).toBe('no-class')
    expect(classProgress([cls('A', 'present'), cls('B', null), cls('C', 'cancelled')])).toEqual({ total: 3, present: 1, absent: 0, cancelled: 1, pending: 1 })
  })

  it('a logged item offers undo, delete and show all; delete calls the new route and rolls back on failure', async () => {
    server.items = [{ kind: 'meal', text: 'dal' }, { kind: 'anime', text: 'episode 3', minutes: 24 }, { kind: 'movie', text: 'a film' }, { kind: 'meal', text: 'rice' }, { kind: 'note', text: 'a note' }]
    await show()
    const logged = q('[aria-label="Logged today"]')
    // newest first, three rows, then Show all
    expect(qa('.ww-life-item', logged)).toHaveLength(3)
    expect(qa('.ww-life-item', logged)[0].textContent).toContain('a note')
    expect(byText('button', 'Show all 5', logged)).toBeTruthy()

    // delete: the row goes at once and the route is called with the row's index, kind and text
    await click(q('[aria-label="Delete note: a note"]'))
    expect(qa('.ww-life-item', logged)[0].textContent).toContain('rice')
    const del = srv.calls.find((c) => c.path === '/api/mission/life/item/delete')!
    expect(del.body).toEqual({ index: 4, kind: 'note', text: 'a note' })
    expect(server.items.map((i) => i.text)).toEqual(['dal', 'episode 3', 'a film', 'rice'])

    // undo puts it back where it was, through the restore route
    const undo = byText('.ww-life-notice button', 'Undo')
    expect(undo).toBeTruthy()
    await click(undo)
    expect(srv.calls.some((c) => c.path === '/api/mission/life/item/restore' && c.body.index === 4)).toBe(true)
    expect(server.items.map((i) => i.text)).toEqual(['dal', 'episode 3', 'a film', 'rice', 'a note'])
    expect(qa('.ww-life-item', logged)[0].textContent).toContain('a note')

    // a failing delete leaves the row where it was and says so in words
    server.failDelete = true
    await click(q('[aria-label="Delete note: a note"]'))
    expect(qa('.ww-life-item', logged)[0].textContent).toContain('a note')
    expect(server.items).toHaveLength(5)
    expect(q('.ww-life-notice[role="alert"]').textContent).toMatch(/Could not remove that, it is still in the list/)

    // show all opens the whole list in a drawer
    await click(byText('button', 'Show all 5', logged))
    const drawer = q('[role="dialog"]')
    expect(drawer).toBeTruthy()
    expect(qa('.ww-life-item', drawer)).toHaveLength(5)
  })

  it('a stale delete (the list moved under the page) is refused by the server and the row is restored on screen', async () => {
    server.items = [{ kind: 'meal', text: 'dal' }, { kind: 'meal', text: 'rice' }]
    await show()
    server.items.shift() // a second window removed "dal": the page still believes rice is index 1
    await click(q('[aria-label="Delete meal: rice"]'))
    expect(q('.ww-life-notice[role="alert"]').textContent).toMatch(/Could not remove that/)
    expect(server.items.map((i) => i.text)).toEqual(['rice']) // nothing else was touched
  })

  it('adding something shows it, and Undo on the add removes it again', async () => {
    await show()
    await logAdd('Meal', 'khichdi', '20')
    expect(server.items).toEqual([{ kind: 'meal', text: 'khichdi', minutes: 20 }])
    expect(q('.ww-life-item').textContent).toContain('khichdi')
    expect(q('.ww-life-item').textContent).toContain('20 min')
    await click(byText('.ww-life-notice button', 'Undo'))
    expect(server.items).toEqual([])
    expect(q('[aria-label="Logged today"]').textContent).toContain('Nothing logged yet today.')
  })

  it('an empty add says what is missing and sends nothing; a failed add keeps what was typed', async () => {
    await show()
    await click(byText('.ww-life-add button', 'Add'))
    expect(q('.ww-life-what').textContent).toContain('Error: Say what it was.')
    expect(srv.calls.filter((c) => c.path === '/api/mission/life/item')).toHaveLength(0)
    server.failAdd = true
    await logAdd('Meal', 'khichdi')
    expect(q<HTMLInputElement>('.ww-life-what input').value).toBe('khichdi')
    expect(q('.ww-life-notice[role="alert"]').textContent).toMatch(/Could not save that/)
    expect(server.items).toEqual([])
    expect(qa('.ww-life-item')).toHaveLength(0) // the optimistic row rolled back
  })

  it('a reel added today says "will ask tomorrow" and raises a pending count', async () => {
    await show()
    expect(q('[data-pending]')).toBeNull()
    await logAdd('Reel', 'a trick about stacks', 'https://example.com/reel')
    const row = q('.ww-life-item')
    expect(row.textContent).toContain('will ask tomorrow')
    expect(q('[data-pending]').textContent).toBe('1 reel pending')
    expect(srv.calls.find((c) => c.path === '/api/mission/life/item')!.body).toEqual({ kind: 'reel', text: 'a trick about stacks', url: 'https://example.com/reel' })
    // a meal raises nothing
    await logAdd('Meal', 'dal')
    expect(q('[data-pending]').textContent).toBe('1 reel pending')
    // deleting the reel lowers it
    await click(q('[aria-label="Delete reel: a trick about stacks"]'))
    expect(q('[data-pending]')).toBeNull()
  })

  it('reels from earlier days make the pending count a button that opens the explain-back', async () => {
    server.reelsDue = [{ date: '2026-11-08', index: 0, text: 'old idea', kind: 'reel' }]
    await show()
    const btn = q('button[data-pending]')
    expect(btn.textContent).toBe('1 reel pending')
    await click(btn)
    const drawer = q('[role="dialog"]')
    expect(drawer.textContent).toContain('old idea')
    const save = byText('button', 'Save to my knowledge', drawer)
    expect(save.getAttribute('aria-disabled')).toBe('true') // under 20 characters: disabled with its reason
    await type(q<HTMLTextAreaElement>('textarea', drawer), 'It is the idea that a stack is last in, first out.')
    expect(byText('button', 'Save to my knowledge', drawer).getAttribute('aria-disabled')).toBeNull()
  })

  it('itemCue and pendingWord', () => {
    expect(itemCue({ kind: 'reel' })).toBe('will ask tomorrow')
    expect(itemCue({ kind: 'reel', explained: '2026-11-10' })).toBeNull()
    expect(itemCue({ kind: 'meal' })).toBeNull()
    expect(pendingWord({ queued_today: 0, due: 0, total: 0 })).toBe('')
    expect(pendingWord({ queued_today: 2, due: 0, total: 2 })).toBe('2 reels pending, asked tomorrow')
    expect(pendingWord({ queued_today: 1, due: 2, total: 3 })).toBe('3 reels pending, 2 ready to explain')
  })
})

describe('the one primary', () => {
  /** Life inside the stand-ins for the left column's two claimants. */
  const withLeft = (pendingClass: boolean) => (
    <>
      <PrimaryButton claimId="all-present" rank="workspace" when={pendingClass}>All present</PrimaryButton>
      <PrimaryButton claimId="now-start" rank="now">Start</PrimaryButton>
      <LifeWorkspace />
    </>
  )
  const primaries = () => qa('[data-primary]').map((e) => e.textContent)

  it('Log session is the primary once a set value or proof is typed; All present takes it while a class is pending; otherwise Now\'s Start', async () => {
    server.att = attendance([cls('A', 'present')], [])
    await show(withLeft(false))
    expect(primaries()).toEqual(['Start']) // nothing typed: Now's Start
    await type(field('Set 1'), '8')
    expect(primaries()).toEqual(['Log session'])
    await type(field('Set 1'), '')
    expect(primaries()).toEqual(['Start'])
    await type(field(/Proof link/), 'https://example.com/clip') // a proof alone also takes it
    expect(primaries()).toEqual(['Log session'])
    m?.unmount()

    // a class is unmarked: Life declares no primary, All present holds the fill even with a value typed
    server.att = attendance([cls('A', null)], [])
    await show(withLeft(true))
    await type(field('Set 1'), '8')
    expect(primaries()).toEqual(['All present'])
    expect(qa('[data-primary]')).toHaveLength(1)
  })

  it('submitting sends the typed sets and the proof, then clears the form and refreshes the plan', async () => {
    await show()
    await click(byText('button', 'Log session')) // nothing typed
    expect(q('[data-card="LF4"]').textContent).toContain('Enter what you did in at least one set.')
    expect(srv.calls.some((c) => c.path.startsWith('/api/mission/quest/'))).toBe(false)
    await type(field('Set 1'), '8')
    await type(field('Set 3'), '6')
    await type(field(/Proof link/), ' https://example.com/clip ')
    await click(byText('button', 'Log session'))
    const call = srv.calls.find((c) => c.path === '/api/mission/quest/push/log')!
    expect(call.body).toEqual({ track: 'body', sets: [8, 6], proof: 'https://example.com/clip' })
    expect(q('[data-card="LF4"]').textContent).toContain('Session logged.')
    expect(field('Set 1').value).toBe('')
    expect(usePlan.getState().refresh).toHaveBeenCalled()
  })

  it('Quest renders once in the whole tree', async () => {
    usePlan.setState({ today: { contracts: [quest('q1')] } as never })
    await show()
    expect(qa('[data-card="LF4"]')).toHaveLength(1)
    expect(qa('[data-quest]')).toHaveLength(1)
    expect(qa('.ww-life-sets')).toHaveLength(1)
    m?.unmount()
    // two quest lines still show one form at a time, chosen by a segmented control
    usePlan.setState({ today: { contracts: [quest('q1'), quest('q2', { track_name: 'Pull' })] } as never })
    await show()
    expect(qa('[data-card="LF4"]')).toHaveLength(1)
    expect(qa('[data-quest]')).toHaveLength(1)
    expect(qa('[role="radio"]').map((r) => r.textContent)).toEqual(expect.arrayContaining(['Push', 'Pull']))
  })

  it('no quest today is said in words, with no form', async () => {
    usePlan.setState({ today: { contracts: [] } as never })
    await show()
    expect(q('[data-card="LF4"]').textContent).toContain('No quest is on today.')
    expect(qa('[data-quest]')).toHaveLength(0)
  })

  it('questTyped and questSets', () => {
    expect(questTyped({ sets: ['', ' '], proof: '' })).toBe(false)
    expect(questTyped({ sets: ['', '5'], proof: '' })).toBe(true)
    expect(questTyped({ sets: ['', ''], proof: 'x' })).toBe(true)
    expect(questSets({ sets: ['8', '', '6'], proof: '' })).toEqual([8, 6]) // a blank is skipped, never a 0
  })
})

describe('data and honesty', () => {
  it('every number on screen comes from a route: with empty answers the cards say so in words', async () => {
    server.att = attendance([], [])
    await show()
    expect(q('[data-card="LF1"]').textContent).toContain('Nothing logged yet today.')
    expect(q('[data-card="LF2"]').textContent).toContain('No timetable yet.')
    expect(q('[data-card="LF5"]').textContent).toContain('No session logged yet.')
  })

  it('Gym counts only real sessions from the last 7 days', () => {
    const now = Date.parse('2026-11-10T12:00:00Z')
    const s = [{ date: '2026-11-09T08:00:00Z', muscles: ['back'] }, { date: '2026-10-20T08:00:00Z', muscles: ['legs'] }, { date: 'not a date', muscles: [] }]
    const r = recentSessions(s, now)
    expect(r.week).toBe(1)
    expect(r.last?.muscles).toEqual(['back'])
    expect(recentSessions([], now)).toEqual({ week: 0, last: null })
  })

  it('placeholders come from the registry, one line each and no enabled button', async () => {
    await show()
    const hint = q('[data-planned="life-v2"]')
    expect(hint.textContent).toContain('Holiday switch is not built')
    expect(q('button', hint).getAttribute('aria-disabled')).toBe('true')
    await click(byText('[role="radio"]', 'Reel'))
    expect(q('[data-planned="reels-v2"]').textContent).toContain('Transcription and summary are not built')
  })
})

describe('a pressed TapGroup button (LIFE-02)', () => {
  it('is filled, not an inset-shadow stripe', () => {
    m = mount(<TapGroup label="Class" value="p" options={[{ id: 'p', label: 'P' }, { id: 'a', label: 'A' }]} onTap={() => {}} />)
    const on = q('.ww-tapopt[data-active="true"]')
    expect(on.getAttribute('aria-pressed')).toBe('true')
    const rules = parseCss(read(join(WW_DIR, 'kit/data.css'))).rules.filter((r) => r.selectors.some((s) => /ww-tapopt\[data-active/.test(s)))
    expect(rules.length).toBeGreaterThan(0)
    for (const r of rules) {
      expect(Object.keys(r.decls).some((k) => /^background/.test(k))).toBe(true)
      expect(r.decls['box-shadow'] ?? '').not.toMatch(/inset/)
    }
  })
})
