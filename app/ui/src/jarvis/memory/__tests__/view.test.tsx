// The four Memory views on their ports (A.J04 accept list): the node count equals the store, no node carries stored text in the
// picture, embedding search is drawn PLANNED, a delete with no route is PLANNED and sends nothing, a delete with a route
// names the count and removes with no reward, a fix keeps a history row that Undo writes back, a capture is stored once and
// echoed, a Wrong belief is struck in place, People never rank, and Keep draws honest states. Fixtures stamp SIMULATED.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { mount } from '../../../__tests__/ww/_stubs'
import { BeliefsView } from '../Beliefs'
import { KeepView } from '../Keep'
import { PeopleView } from '../People'
import { RecallView } from '../Recall'
import { recallStore } from '../hooks'
import {
  NOW_MS, NOW_S, fixtureBeliefPort, fixturePeoplePort, fixtureRecallPort, fixtureRemindersPort, fixtureReviewPort, fixtureSourcesPort,
} from '../fixtures'
import type { RecallPort } from '../port'

let m: ReturnType<typeof mount> | null = null
beforeEach(() => {
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
  localStorage.clear()
  recallStore.set([])
})
afterEach(() => {
  m?.unmount()
  m = null
  document.body.innerHTML = ''
})

const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const q = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)
const click = (el: Element | null) => act(() => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
const key = (el: Element, k: string) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })) })
const typeInto = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => act(() => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})

function recall(port: RecallPort, extra: Record<string, unknown> = {}) {
  m = mount(<RecallView port={port} reminders={fixtureRemindersPort} now={NOW_S} {...extra} />)
}

describe('Recall, the constellation', () => {
  it('draws one node per stored item and the count on screen equals what the store reported', async () => {
    recall(fixtureRecallPort())
    await flush()
    expect(document.querySelectorAll('.jm-node')).toHaveLength(55)
    expect(q('[data-testid="count-line"]')!.textContent).toMatch(/55 drawn of 55 laid out/)
    // Holdings counts are the store's own, printed with the same numbers
    expect(q('[data-testid="idle"] [data-id="facts"] .jm-num')!.textContent).toBe('40')
    expect(q('[data-testid="idle"] [data-id="messages"] .jm-num')!.textContent).toBe('18,240')
  })

  it('every fixture state is stamped SIMULATED, never LIVE', async () => {
    recall(fixtureRecallPort())
    await flush()
    expect(q('.jm')!.getAttribute('data-simulated')).toBe('true')
    const lamps = [...document.querySelectorAll('.lamp')].map((l) => l.getAttribute('aria-label') ?? '')
    expect(lamps.length).toBeGreaterThan(2)
    expect(lamps.some((l) => /live/i.test(l))).toBe(false)
    expect(lamps.some((l) => /simulated/i.test(l))).toBe(true)
  })

  it('no node carries stored text: the picture holds letters and counts, and the text is in the list and the detail', async () => {
    const port = fixtureRecallPort()
    recall(port)
    await flush()
    const g = await port.galaxy()
    const svgText = q('[data-testid="constellation"]')!.textContent ?? ''
    for (const n of g.nodes.filter((x) => x.kind === 'memory').slice(0, 8)) expect(svgText).not.toContain(n.label.slice(0, 14))
    expect(svgText.replace(/[A-Z0-9\s]/g, '')).toBe('') // letters of source tags, ring numbers: nothing else
    // the text list is the keyboard equivalent and does carry the words
    await click(q('[data-testid="list-key"]'))
    await flush()
    expect(document.body.textContent).toContain(g.nodes[0].label)
  })

  it('above 120 items the stage shows clusters whose counts add up, and a click zooms into one', async () => {
    recall(fixtureRecallPort({ count: 340 }))
    await flush()
    expect(q('.jm-const')!.getAttribute('data-mode')).toBe('clusters')
    const counts = [...document.querySelectorAll('.jm-cluster .jm-cl-n')].map((e) => Number((e.textContent ?? '').replace(/\D/g, '')))
    expect(counts.reduce((a, b) => a + b, 0)).toBe(355)
    await click(q('.jm-cluster'))
    await flush()
    expect(q('.jm-const')!.getAttribute('data-mode')).toBe('group')
    expect(document.querySelectorAll('.jm-node:not(.jm-cluster)').length).toBeLessThanOrEqual(120)
    await click(q('[data-testid="zoom-out"]'))
    expect(q('.jm-const')!.getAttribute('data-mode')).toBe('clusters')
  })

  it('an empty store draws a hollow form with the reason, and the count it prints is the zero the store reported', async () => {
    recall(fixtureRecallPort({ empty: true }))
    await flush()
    expect(q('[data-testid="constellation-hollow"]')!.textContent).toContain('nothing is stored yet')
    expect(document.querySelectorAll('.jm-node')).toHaveLength(0)
    expect(q('[data-testid="count-line"]')!.textContent).toMatch(/^0 drawn of 0 laid out/)
  })

  it('a layout that did not load is a FAULT with the route\'s own words, not a blank and not a zero', async () => {
    const bad: RecallPort = { ...fixtureRecallPort(), galaxy: async () => { throw new Error('Could not lay out the memory galaxy: store locked') } }
    recall(bad)
    await flush()
    expect(q('[data-testid="constellation-hollow"]')!.textContent).toContain('store locked')
    expect(q('[data-testid="stage-foot"]')!.textContent).toContain('No count is drawn without a reading')
  })

  it('embedding search is drawn dashed and PLANNED beside the field', async () => {
    recall(fixtureRecallPort())
    await flush()
    const e = q('.jm-embed')!
    expect(e.textContent).toContain('PLANNED')
    expect(e.querySelector('.jm-embed-dash')).not.toBeNull()
  })

  it('a recall draws one path through the lit nodes, numbered in rank order, and the trail keeps it for the session only', async () => {
    recall(fixtureRecallPort(), { initialQuery: 'the spare key' })
    await flush()
    expect(q('[data-testid="recall-path"]')).not.toBeNull()
    const ranks = [...document.querySelectorAll('.jm-rank text')].map((t) => t.textContent)
    expect([...ranks].sort()).toEqual(['1', '2', '3'])
    expect(recallStore.get()).toHaveLength(1)
    expect(recallStore.get()[0].q).toBe('the spare key')
  })
})

describe('Recall, fix, delete and capture', () => {
  async function select(port: RecallPort) {
    recall(port)
    await flush()
    const svg = q('[data-testid="constellation"]')!
    await key(svg, 'ArrowRight')
    await key(svg, 'Enter')
    await flush()
    expect(q('[data-testid="detail"]')).not.toBeNull()
  }

  it('Delete with no route is PLANNED: it says why, sends nothing and removes nothing', async () => {
    const port = fixtureRecallPort()
    await select(port)
    const before = document.querySelectorAll('.jm-node').length
    expect(q('[data-testid="delete-key"]')).toBeNull()
    const planned = q('[data-planned="delete"]')!
    expect(planned.getAttribute('aria-disabled')).toBe('true')
    await click(planned)
    expect(q('[data-testid="note"]')!.textContent).toContain('not built')
    expect(document.querySelectorAll('.jm-node')).toHaveLength(before)
  })

  it('Delete with a route names the count, asks once, and the item is gone with no reward', async () => {
    const port = fixtureRecallPort({ deletable: true })
    const remove = vi.spyOn(port, 'remove' as never)
    await select(port)
    const before = document.querySelectorAll('.jm-node').length
    await click(q('[data-testid="delete-key"]'))
    await flush()
    expect(q('[data-testid="delete-line"]')!.textContent).toMatch(/This removes 1 item from what JARVIS holds\. \d+ stay\. There is no undo/)
    expect(remove).not.toHaveBeenCalled()
    const confirm = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Delete 1 item')!
    await click(confirm)
    await flush()
    expect(remove).toHaveBeenCalledTimes(1)
    expect(document.querySelectorAll('.jm-node')).toHaveLength(before - 1)
    expect(q('[data-flash="true"]')).toBeNull()
    expect(q('[data-testid="echo"]')!.textContent).toContain('removed 1 item')
  })

  it('Fix shows the two-line diff, stores a correction, keeps a history row, and Undo writes the old wording back', async () => {
    const port = fixtureRecallPort()
    const fix = vi.spyOn(port, 'fix')
    await select(port)
    await click(q('[data-testid="fix-key"]'))
    const field = q<HTMLTextAreaElement>('#jm-fix-field')!
    const first = field.value
    await typeInto(field, `${first} again`)
    expect(document.querySelectorAll('.jm-diff')).toHaveLength(2)
    expect(q('.jm-diff [data-k="add"]')!.textContent).toContain('again')
    await click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Save')!)
    await flush()
    expect(fix).toHaveBeenCalledWith(first, `${first} again`)
    expect(q('[data-testid="echo"]')!.textContent).toContain('stored as a correction')
    expect(JSON.parse(localStorage.getItem('jarvis.memory.fixes')!)).toHaveLength(1)
    await click(q('[data-testid="undo-fix"]'))
    await flush()
    expect(fix).toHaveBeenLastCalledWith(`${first} again`, first)
    expect(localStorage.getItem('jarvis.memory.fixes')).toBe('[]')
    expect(q('[data-testid="echo"]')!.textContent).toContain('undone')
  })

  it('a fix that the route refuses says so and keeps no history row', async () => {
    const port = fixtureRecallPort()
    port.fix = async () => { throw new Error('say what the right answer is') }
    await select(port)
    await click(q('[data-testid="fix-key"]'))
    await typeInto(q<HTMLTextAreaElement>('#jm-fix-field')!, 'something else entirely')
    await click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Save')!)
    await flush()
    expect(q('[data-testid="echo"]')!.textContent).toContain('not fixed: say what the right answer is')
    expect(localStorage.getItem('jarvis.memory.fixes')).toBeNull()
  })

  it('the capture line stores a fact once and echoes it with its source; an empty line stores nothing', async () => {
    const port = fixtureRecallPort()
    const cap = vi.spyOn(port, 'capture')
    recall(port)
    await flush()
    const input = q<HTMLInputElement>('.jm-dock input.cl-input')!
    await typeInto(input, 'remember the spare key is in the blue tin')
    await key(input, 'Enter')
    await flush()
    expect(cap).toHaveBeenCalledTimes(1)
    expect(cap).toHaveBeenCalledWith('the spare key is in the blue tin')
    expect(q('[data-testid="echo"]')!.textContent).toContain('stored, source: typed')
    await key(q<HTMLInputElement>('.jm-dock input.cl-input')!, 'Enter')
    expect(cap).toHaveBeenCalledTimes(1)
  })

  it('a capture the store refuses is echoed as a FAULT, not as stored', async () => {
    recall(fixtureRecallPort({ failCapture: true }))
    await flush()
    const input = q<HTMLInputElement>('.jm-dock input.cl-input')!
    await typeInto(input, 'remember the kettle needs descaling')
    await key(input, 'Enter')
    await flush()
    expect(q('[data-testid="echo"]')!.textContent).toContain('not stored: the store did not answer')
  })
})

describe('Beliefs', () => {
  it('three sockets, a chip of origin on every row, and a Wrong row is struck in place, never hidden', async () => {
    const port = fixtureBeliefPort()
    const answer = vi.spyOn(port, 'answer')
    m = mount(<BeliefsView port={port} now={NOW_S} />)
    await flush()
    expect(q('[data-testid="sockets"]')!.getAttribute('aria-label')).toBe('3 of 3 questions on the board')
    const rows = document.querySelectorAll('[data-testid="belief-row"]')
    expect(rows).toHaveLength(3)
    for (const r of rows) expect(r.querySelector('.jm-origin')).not.toBeNull()
    await click(q('[data-testid="belief-wrong"]'))
    await flush()
    expect(answer).toHaveBeenCalledWith('fb1', 'rejected', undefined)
    expect(document.querySelectorAll('[data-testid="belief-row"]')).toHaveLength(3)
    expect(q('[data-testid="belief-row"][data-state="rejected"] .jm-b-claim')!.getAttribute('data-struck')).toBe('true')
  })

  it('an unanswered belief is amber WAITING "unconfirmed": an inference is not a fact', async () => {
    m = mount(<BeliefsView port={fixtureBeliefPort()} now={NOW_S} />)
    await flush()
    const label = q('[data-testid="belief-row"] .lamp')!.getAttribute('aria-label') ?? ''
    expect(label.toLowerCase()).toContain('waiting')
    expect(label).toContain('unconfirmed')
  })

  it('Learned lately: Wrong takes effect through the route and the count of checks falls', async () => {
    const port = fixtureBeliefPort()
    const review = vi.spyOn(port, 'review')
    m = mount(<BeliefsView port={port} now={NOW_S} />)
    await flush()
    expect(q('[data-testid="learned-count"]')!.textContent).toContain('2 to check')
    await click(q('[data-testid="learned-wrong"]'))
    await flush()
    expect(review).toHaveBeenCalledWith('fl1', 'wrong')
    expect(q('[data-testid="learned-count"]')!.textContent).toContain('1 to check')
  })

  it('a board that did not load says so and confirms nothing', async () => {
    const port = fixtureBeliefPort()
    port.questions = async () => { throw new Error('store locked') }
    m = mount(<BeliefsView port={port} now={NOW_S} />)
    await flush()
    expect(q('.jm-note[role="alert"]')!.textContent).toContain('store locked')
    expect(document.querySelectorAll('[data-testid="belief-row"]')).toHaveLength(0)
  })
})

describe('People', () => {
  it('is alphabetical and shows no closeness, rank or score anywhere', async () => {
    m = mount(<PeopleView port={fixturePeoplePort} now={NOW_MS} />)
    await flush()
    const names = [...document.querySelectorAll('[data-testid="people-list"] .jm-list-t')].map((e) => e.textContent ?? '')
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })))
    expect(names).toHaveLength(10)
    expect(document.body.textContent).not.toMatch(/closeness|score|#\d/i)
    // the ring holds the first 24 only, beads in the same order as the list
    const beads = [...document.querySelectorAll('.jm-bead')].map((b) => b.getAttribute('aria-label'))
    expect(beads).toEqual(names)
  })

  it('a person with no last-mentioned date gets a dashed empty bar that says so, never a guess', async () => {
    m = mount(<PeopleView port={fixturePeoplePort} now={NOW_MS} />)
    await flush()
    const empty = document.querySelectorAll('.jm-last[data-empty="true"]')
    expect(empty).toHaveLength(1)
    expect(empty[0].textContent).toContain('no date in the store')
  })

  it('Fix and Delete for a person are PLANNED and send nothing', async () => {
    m = mount(<PeopleView port={fixturePeoplePort} now={NOW_MS} />)
    await flush()
    await click(q('.jm-bead'))
    const keys = [...document.querySelectorAll('.jm-ring-core .jm-key-planned')]
    expect(keys.map((k) => (k.textContent ?? '').trim())).toEqual(['FixPLANNED', 'DeletePLANNED'])
    expect(keys.every((k) => k.getAttribute('aria-disabled') === 'true')).toBe(true)
  })
})

describe('Keep', () => {
  const keep = (over: Partial<Parameters<typeof KeepView>[0]> = {}) => {
    m = mount(<KeepView recall={fixtureRecallPort()} sources={fixtureSourcesPort} review={fixtureReviewPort} simulated now={NOW_S} {...over} />)
  }

  it('Share a review has a home here: one press writes once and the line says a fixture wrote no file', async () => {
    const review = { ...fixtureReviewPort }
    const ex = vi.spyOn(review, 'exportReview')
    keep({ review })
    await flush()
    await click(q('[data-testid="share-review"]'))
    await flush()
    expect(ex).toHaveBeenCalledTimes(1)
    expect(q('[data-testid="review-line"]')!.textContent).toContain('fixture: no file was written')
  })

  it('with nothing recorded the review key says so instead of writing an empty file', async () => {
    const review = { ...fixtureReviewPort, summary: async () => ({ turns: 0, flags: {} }) }
    const ex = vi.spyOn(review, 'exportReview')
    keep({ review })
    await flush()
    await click(q('[data-testid="share-review"]'))
    await flush()
    expect(ex).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Nothing to share yet')
  })

  it('a review that failed is a FAULT with the route\'s words, never "written"', async () => {
    const review = { ...fixtureReviewPort, exportReview: async () => { throw new Error('disk full') } }
    keep({ review })
    await flush()
    await click(q('[data-testid="share-review"]'))
    await flush()
    expect(q('[data-testid="review-line"]')!.textContent).toContain('not written: disk full')
  })

  it('three plates are PLANNED with no enabled control, and Holdings equal the stored counts', async () => {
    keep()
    await flush()
    const planned = document.querySelectorAll('.jm-plate[data-planned="true"]')
    expect(planned).toHaveLength(3)
    for (const p of planned) expect(p.querySelectorAll('button:not([aria-disabled="true"])')).toHaveLength(0)
    expect(q('[data-testid="holdings"] [data-id="facts"] .jm-num')!.textContent).toBe('40')
    expect(q('[data-testid="holdings"] [data-id="people"] .jm-num')!.textContent).toBe('6')
  })

  it('the sources are the four exports of the classic page, each with its own state lamp', async () => {
    keep()
    await flush()
    const cards = document.querySelectorAll('[data-testid="source-card"]')
    expect(cards).toHaveLength(4)
    expect([...cards].map((c) => c.getAttribute('data-state'))).toEqual(['imported', 'arrived', 'not_requested', 'not_requested'])
    expect(cards[1].textContent).toContain('In Downloads')
  })

  it('holdings with no reading print "no reading", not zero', async () => {
    const recallPort = { ...fixtureRecallPort(), stats: async () => { throw new Error('store locked') } }
    keep({ recall: recallPort })
    await flush()
    expect(q('[data-testid="holdings"] [data-id="facts"] .jm-num')!.textContent).toBe('no reading')
  })
})
