// Chunk 7: the Study workspace (plan 8.1 "Study"). Fictional subjects; fetch is a router (_study.tsx).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mount, resetHtml } from './_stubs'
import { $, $$, byText, bankListing, click, examsAnswer, harvestQueue, paperResponse, paperRow, settle, slot, stubApi, topic, type } from './_study'
import { PrimaryOwner } from '../../ww/kit'
import { OverlayHost } from '../../ww/frame/OverlayHost'
import { closeOverlay, openOverlay, useOverlay } from '../../ww/frame/overlayRegistry'
import { resetFrameStore, useFrame } from '../../ww/frame/frameStore'
import { StudyPage, STUDY_VIEWS } from '../../ww/study/StudyPage'
import { resetStudyStore, selectPaper, useStudy } from '../../ww/study/studyStore'
import { changes, savedLine } from '../../ww/study/marksLoop'
import { queueLine } from '../../ww/study/api'
import { usePlan } from '../../germoney/game/plan'

let m: ReturnType<typeof mount> | null = null
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => {
  closeOverlay()
  useOverlay.setState({ open: null, props: {} })
  m?.unmount()
  m = null
  resetStudyStore()
  resetFrameStore()
  usePlan.setState({ today: null, findings: null })
  vi.unstubAllGlobals()
  vi.useRealTimers()
  resetHtml()
  document.body.innerHTML = ''
})

const cie = () => paperRow()
const endSem = () => paperRow({ id: 'end-d', subject: 'subj-d', title: 'Subject D End', kind: 'end_sem', approx: false, max: 60, days_left: 30, date: '2026-12-10' })

function routes(over: { exams?: unknown; bank?: unknown; harvest?: unknown; paper?: unknown } = {}) {
  return stubApi([
    ['GET', /\/api\/mission\/exams$/, () => over.exams ?? examsAnswer([cie(), endSem()])],
    ['GET', /\/api\/mission\/bank\/[\w-]+$/, () => over.bank ?? bankListing(5)],
    ['GET', /\/api\/mission\/harvest\/queue$/, () => over.harvest ?? harvestQueue()],
    ['GET', /\/api\/phone\/ww\/harvest/, () => ({ on_disk: 0, queued: 0 })],
    ['GET', /\/api\/mission\/paper\//, () => over.paper ?? paperResponse()],
  ])
}

async function open(el = <StudyPage />) {
  m = mount(<PrimaryOwner>{el}<OverlayHost /></PrimaryOwner>)
  await settle()
}

describe('views', () => {
  it('views are Papers, Plan, Library, dMAT and Papers is the default', async () => {
    routes()
    await open()
    const radios = $$('[role=radiogroup][aria-label="Study views"] [role=radio]')
    expect(radios.map((r) => r.textContent)).toEqual(['Papers', 'Plan', 'Library', 'dMAT'])
    expect(STUDY_VIEWS).toEqual(['papers', 'plan', 'library', 'dmat'])
    expect(radios.find((r) => r.getAttribute('aria-checked') === 'true')!.textContent).toBe('Papers')
    expect($('[data-view=papers]')).not.toBeNull()
  })
  it('switching the view goes through the frame store', async () => {
    routes()
    await open()
    await click(byText('Plan', '[role=radio]'))
    await settle()
    expect(useFrame.getState().view).toBe('plan')
    expect($('[data-study-view=plan]')).not.toBeNull()
  })
})

describe('Papers', () => {
  it('preselects the next paper and shows list, topics, the stage strip and the Practice cell', async () => {
    routes()
    await open()
    expect(useStudy.getState().selected).toBe('cie-c')
    expect($('[data-paper="cie-c"]')!.getAttribute('aria-pressed')).toBe('true')
    expect($$('.ww-paperrow')).toHaveLength(2)
    expect($('[data-paper-detail="cie-c"]')).not.toBeNull()
    expect($$('.ww-topic')).toHaveLength(3)
    expect($('[data-card=study-practice]')).not.toBeNull()
    // one Practice block
    expect($$('[data-card=study-practice]')).toHaveLength(1)
  })
  it('the stage strip prints "not measured" for any stage with no data', async () => {
    routes()
    await open()
    const strip = $('[aria-label="Paper stages"]')!
    const states = $$('.ww-stage', strip).map((s) => [s.querySelector('.ww-stage-label')!.textContent, s.getAttribute('data-state'), s.querySelector('.ww-stage-count')!.textContent])
    expect(states.find((s) => s[0] === 'Proficiency')).toEqual(['Proficiency', 'unknown', 'not measured'])
    expect(states.find((s) => s[0] === 'Tomorrow')).toEqual(['Tomorrow', 'unknown', 'not measured'])
    expect(states.find((s) => s[0] === 'Bank')![1]).toBe('done')
    expect(states.find((s) => s[0] === 'Bank')![2]).toBe('5')
  })
  it('one "dates tentative" line replaces a tilde on each row', async () => {
    routes()
    await open()
    expect(document.body.textContent).toContain('Dates are tentative until the final sheet.')
    expect(document.body.textContent).not.toContain('~')
  })
  it('selecting a paper in the list or from outside (the Countdown) selects it in both and survives a tab round trip', async () => {
    routes()
    await open()
    await click($('[data-paper="end-d"]'))
    expect($('[data-paper-detail="end-d"]')).not.toBeNull()
    m!.unmount()
    m = null
    await open()
    expect(useStudy.getState().selected).toBe('end-d')
    act(() => selectPaper('cie-c'))
    await settle()
    expect($('[data-paper="cie-c"]')!.getAttribute('aria-pressed')).toBe('true')
    expect($('[data-paper-detail="cie-c"]')).not.toBeNull()
  })
  it('the filter shows CIE, End or Other papers only', async () => {
    routes()
    await open()
    await click(byText('End', '[role=radio]'))
    expect($$('.ww-paperrow').map((r) => r.getAttribute('data-paper'))).toEqual(['end-d'])
    await click(byText('Other', '[role=radio]'))
    expect($$('.ww-paperrow')).toHaveLength(0)
    expect(document.body.textContent).toContain('No paper of that kind is ahead.')
  })
  it('a topic chip cycles to do, learned, solid and its aria-label says what the next tap does', async () => {
    const r = routes()
    r.on('POST', /\/exams\/subj-c\/topic$/, (_u, body) => {
      const b = body as { key: string; state: 'none' | 'learned' | 'solid' }
      return examsAnswer([paperRow({ topics: [topic(1, 'Alpha', b.state), topic(1, 'Beta', 'learned'), topic(2, 'Gamma', 'none', 'low')] }), endSem()])
    })
    await open()
    const alpha = () => $$('.ww-topic').find((c) => c.textContent === '○Alpha')!
    expect(alpha().getAttribute('aria-label')).toBe('Alpha: to do. Tap for learned.')
    await click(alpha())
    await settle()
    expect(r.calls.find((c) => c.method === 'POST')!.body).toEqual({ key: '1|Alpha', state: 'learned' })
    expect($$('.ww-topic').find((c) => c.textContent?.includes('Alpha'))!.getAttribute('aria-label')).toBe('Alpha: learned. Tap for solid.')
    expect($$('.ww-topic').find((c) => c.textContent?.includes('Beta'))!.getAttribute('aria-label')).toBe('Beta: learned. Tap for solid.')
  })
  it('a topic tap that the server refuses puts the chip back', async () => {
    const r = routes()
    r.on('POST', /\/topic$/, () => ({ __status: 500 }))
    await open()
    await click($$('.ww-topic')[0])
    await settle()
    expect($$('.ww-topic')[0].getAttribute('aria-label')).toBe('Alpha: to do. Tap for learned.')
  })
  it('a sheet shows a Read button that opens the Reader on that file; no sheet shows the registry line', async () => {
    routes({ exams: examsAnswer([paperRow({ files: [{ name: 'Unit-2-notes.md', path: 'c/unit2.md', folder: 'c' }] }), endSem()]) })
    await open()
    expect(byText(/Read Unit 2 notes/)).not.toBeNull()
    selectPaper('end-d')
    await settle()
    expect($('[data-planned="sheets-rewritten"]')!.textContent).toContain('No sheet is linked to this paper yet (0 of 2 units).')
  })
})

describe('the Practice cell', () => {
  it('a paper with an empty bank shows the CIE empty state with Add questions and no Practice paper button', async () => {
    routes({ bank: bankListing(0) })
    await open()
    expect($('[data-planned="cie-practice"]')!.textContent).toContain('No CIE questions yet. A CIE paper is 20 marks; its shape is not set.')
    expect(byText('Practice paper')).toBeNull()
    expect(byText('Add questions')!.getAttribute('data-primary')).toBe('true')
    expect($$('[data-primary]')).toHaveLength(1)
  })
  it('Add questions opens O8 and an added question posts to the add-question route and raises the bank count', async () => {
    const r = routes({ bank: bankListing(0) })
    r.on('POST', /\/api\/mission\/bank\/subj-c$/, () => ({ added: { id: 'subj-c:typed:0' }, sizes: bankListing(1).sizes, dropped: [] }))
    await open()
    await click(byText('Add questions'))
    await settle()
    expect(useOverlay.getState().open).toBe('add')
    const dlg = $('[role=dialog]')!
    expect(dlg.textContent).toContain('bank: 0 questions')
    type($('textarea', dlg) as HTMLTextAreaElement, 'State $a^2+b^2=c^2$ and name it.')
    type($('input[type=number]', dlg) as HTMLInputElement, '2')
    type($('input[list]', dlg) as HTMLInputElement, 'Alpha')
    await settle(1)
    expect($('[aria-label=Preview]', dlg)).not.toBeNull()
    await click(byText('Add question', 'button', dlg))
    await settle()
    const post = r.calls.find((c) => c.method === 'POST')!
    expect(post.url).toMatch(/\/api\/mission\/bank\/subj-c$/)
    expect(post.body).toMatchObject({ unit: 1, topic: 'Alpha', question: 'State $a^2+b^2=c^2$ and name it.', marks: 2, tier: 'exam' })
    expect($('[data-added]', dlg)!.textContent).toBe('Added. Bank: 1 question.')
    expect(useStudy.getState().bank!.sizes.total).toBe(1)
  })
  it('the server refusal is shown in words', async () => {
    const r = routes({ bank: bankListing(0) })
    r.on('POST', /\/api\/mission\/bank\/subj-c$/, () => ({ __status: 400, body: { detail: 'this question is already in the bank' } }))
    await open()
    await click(byText('Add questions'))
    await settle()
    const dlg = $('[role=dialog]')!
    type($('textarea', dlg) as HTMLTextAreaElement, 'Same again')
    type($('input[type=number]', dlg) as HTMLInputElement, '2')
    type($('input[list]', dlg) as HTMLInputElement, 'Alpha')
    await click(byText('Add question', 'button', dlg))
    await settle()
    expect(dlg.textContent).toContain('this question is already in the bank')
  })
  it('a CIE paper offers a practice paper at its own scaled pattern, in the Reader', async () => {
    const r = routes()
    await open()
    expect(byText('Practice paper')!.getAttribute('data-primary')).toBe('true')
    expect($('[data-practice]')!.textContent).toContain('A CIE paper is 20 marks.')
    await click(byText('Practice paper'))
    await settle()
    expect(r.calls.some((c) => /\/paper\/cie-c\?seed=\d+&tier=exam$/.test(c.url))).toBe(true)
    expect($('[data-paper-out]')!.textContent).toContain('20 marks, scaled pattern')
    expect(useOverlay.getState().open).toBe('reader')
    expect($('[data-overlay=reader]')).not.toBeNull()
  })
  it('the Exam / GATE control disables GATE with its reason while no GATE question exists', async () => {
    routes({ harvest: harvestQueue({ items: [{ subject: 'subj-c', topic: 'Alpha', status: 'waiting', tier: 'gate' }] }) })
    await open()
    const gate = byText('GATE', '[role=radio]')!
    expect(gate.getAttribute('aria-disabled')).toBe('true')
    await click(gate)
    expect(document.body.textContent).toContain('GATE: No GATE questions yet (1 queued).')
    expect(byText('Exam', '[role=radio]')!.getAttribute('aria-checked')).toBe('true')
  })
  it('GATE is selectable once the bank has a GATE question, and a gate request that comes back as an exam paper prints the tier note, not the GATE label', async () => {
    const note = 'No GATE-tier questions in this bank yet: this is an exam-tier paper.'
    const r = routes({ bank: bankListing(5, 1), paper: paperResponse({ tier: 'exam', tier_requested: 'gate', tier_note: note }) })
    await open()
    const gate = byText('GATE', '[role=radio]')!
    expect(gate.getAttribute('aria-disabled')).toBeNull()
    await click(gate)
    await click(byText('Practice paper'))
    await settle()
    expect(r.calls.some((c) => /tier=gate$/.test(c.url))).toBe(true)
    const out = $('[data-paper-out]')!
    expect(out.textContent).toContain('Exam paper')
    expect(out.textContent).not.toContain('GATE paper')
    expect(out.textContent).toContain(note)
  })
  it('the practice cell is keyed by paper id and clears when another paper is chosen', async () => {
    routes()
    await open()
    await click(byText('Practice paper'))
    await settle()
    closeOverlay()
    await settle()
    expect($('[data-paper-out]')).not.toBeNull()
    await click($('[data-paper="end-d"]'))
    await settle()
    expect($('[data-paper-out]')).toBeNull()
    expect(useStudy.getState().practice).toBeNull()
  })
  it('a reply for a paper that is no longer chosen is dropped', async () => {
    let release: (v: unknown) => void = () => {}
    const slow = new Promise((res) => { release = res })
    const r = routes()
    r.on('GET', /\/paper\//, () => slow as never)
    // fetch resolves the handler's value; a promise value is awaited by the async mock
    await open()
    const p = useStudy.getState().makePaper('cie-c', 'exam', 3)
    useStudy.getState().select('end-d')
    release(paperResponse())
    await act(async () => { await p })
    expect(useStudy.getState().practice).toBeNull()
  })
  it('the paper that came back empty says so and offers Add questions (never an empty paper)', async () => {
    routes({ paper: paperResponse({ empty: true, sections: [] }) })
    await open()
    await click(byText('Practice paper'))
    await settle()
    expect(useOverlay.getState().open).toBeNull()
    expect($('[data-paper-out]')).toBeNull()
    expect(document.body.textContent).toContain('No questions for Subject C CIE yet.')
  })
})

describe('the harvester lines', () => {
  it('with work queued and the harvester off the cell says "Queued: n topics (off)" and never "Fetching"', async () => {
    routes({ harvest: harvestQueue({ items: [{ subject: 'subj-c', topic: 'A', status: 'waiting' }, { subject: 'subj-c', topic: 'B', status: 'waiting' }] }) })
    await open()
    expect($('[data-queue]')!.textContent).toBe('Queued: 2 topics (off)')
    expect(document.body.textContent).not.toContain('Fetching')
  })
  it('queueLine words each real state, and Fetching only for a request in flight or finished in the last five minutes', () => {
    const item = (status: string) => ({ subject: 'subj-c', topic: 'A', status })
    const now = Date.parse('2026-11-10T10:00:00Z')
    const q = (o: object) => harvestQueue({ enabled: true, items: [item('waiting')], ...o }) as never
    expect(queueLine(q({ paused: true }), 'subj-c', now)).toBe('Queued: 1 topic (paused)')
    expect(queueLine(q({ enabled: false }), 'subj-c', now)).toBe('Queued: 1 topic (off)')
    expect(queueLine(q({}), 'subj-c', now)).toBe('Queued: 1 topic')
    expect(queueLine(q({ last_request_at: '2026-11-10T09:57:00Z' }), 'subj-c', now)).toBe('Fetching: 1 topic')
    expect(queueLine(q({ last_request_at: '2026-11-10T09:50:00Z' }), 'subj-c', now)).toBe('Queued: 1 topic')
    expect(queueLine(q({ items: [item('fetching')] }), 'subj-c', now)).toBe('Fetching: 1 topic')
    expect(queueLine(q({ items: [] }), 'subj-c', now)).toBeNull()
    expect(queueLine(null, 'subj-c', now)).toBeNull()
    expect(queueLine(q({}), 'subj-other', now)).toBeNull()
  })
  it('with the route absent the queue line does not render', async () => {
    const r = routes()
    r.on('GET', /harvest\/queue$/, () => ({ __status: 404 }))
    await open()
    expect($('[data-queue]')).toBeNull()
  })
})

describe('the Reader', () => {
  async function openPaper(over: Parameters<typeof routes>[0] = {}) {
    const r = routes(over)
    await open()
    await click(byText('Practice paper'))
    await settle()
    return r
  }
  it('a generated paper is one ordered list with continuous numbers and "answer any n of m" per section', async () => {
    await openPaper()
    const lists = $$('ol.ww-paper')
    expect(lists).toHaveLength(1)
    expect($$('li.ww-q', lists[0]).map((li) => li.querySelector('.ww-q-n')!.textContent)).toEqual(['1.', '2.', '3.', '4.', '5.'])
    expect($$('.ww-paper-head').map((h) => h.textContent)).toEqual([
      'Section A. Answer any 2 of 3. 2 marks each.', 'Section B. Answer any 1 of 2. 8 marks each.',
    ])
  })
  it('every stem goes through MathText; Raw shows the source untouched', async () => {
    await openPaper()
    const stem = () => $$('.ww-q-stem')[1]
    expect(stem().querySelector('.rd-math, .ww-math')).not.toBeNull()
    expect(stem().textContent).not.toContain('\\int')
    await click(byText('Raw'))
    expect(stem().textContent).toContain('$\\int_0^1 x\\,dx$')
    expect(byText('Raw')!.getAttribute('aria-pressed')).toBe('true')
  })
  it('each question ends with a quiet source line, a harvested pointer reads "Solve: <reference>", and "p" is hidden at the untapped default', async () => {
    await openPaper()
    const srcs = $$('[data-source]').map((e) => e.textContent)
    expect(srcs).toHaveLength(5)
    expect(srcs[0]).toBe('source: SEE Jun 2026')
    expect(srcs[3]).toBe('source: Open course notes, CC BY-SA')
    expect($('[data-harvested=true] .ww-q-stem')!.textContent).toBe('Solve: reference book ch 3, problem 4')
    const metas = $$('.ww-q-meta').map((e) => e.textContent)
    expect(metas[0]).not.toContain('p ')
    expect(metas[1]).toContain('p 50 %')
  })
  it('Open in Reader works with scrollTop > 0 because the Reader is portalled to the body', async () => {
    routes()
    const scroller = document.createElement('div')
    scroller.style.overflow = 'auto'
    document.body.appendChild(scroller)
    m = mount(<PrimaryOwner><StudyPage /><OverlayHost /></PrimaryOwner>)
    scroller.appendChild(m.container)
    await settle()
    scroller.scrollTop = 400
    await click(byText('Practice paper'))
    await settle()
    const dlg = $('[role=dialog]')!
    expect(dlg.closest('.ww-portal')!.parentElement).toBe(document.body)
    expect(scroller.contains(dlg)).toBe(false)
    expect(dlg.textContent).toContain('Section A')
    scroller.remove()
  })
  it('J and K move between sections; typing in a field is not hijacked', async () => {
    await openPaper()
    const heads = $$('.ww-paper-head')
    heads.forEach((h) => (h.scrollIntoView = vi.fn()))
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true })))
    expect(document.activeElement).toBe(heads[0])
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true })))
    expect(document.activeElement).toBe(heads[1])
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true })))
    expect(document.activeElement).toBe(heads[0])
  })
  it('Save marks is the overlay primary once something is marked, and posts the marks as shown', async () => {
    const r = await openPaper()
    r.on('POST', /\/marks$/, () => ({ saved: 2, score: 3, max: 4, say: 'Marked 2 answers', proficiency: {} }))
    const save = () => byText('Save marks')!
    expect(save().getAttribute('aria-disabled')).toBe('true')
    expect(save().getAttribute('data-primary')).toBeNull()
    await click($('[aria-label="One step more for question 1"]'))
    await click($('[aria-label="One step more for question 1"]'))
    await click($('[aria-label="One step more for question 2"]'))
    expect($$('.ww-q-got').map((o) => o.textContent).slice(0, 2)).toEqual(['1 / 2', '0.5 / 2'])
    expect(save().getAttribute('data-primary')).toBe('true')
    await click(save())
    await settle()
    const post = r.calls.find((c) => c.method === 'POST')!
    expect(post.body).toEqual({ items: [{ id: 'subj-c:typed:0', got: 1, max: 2 }, { id: 'subj-c:typed:1', got: 0.5, max: 2 }], seed: 7 })
  })
  it('after Save marks the line "Saved. Tomorrow\'s blocks changed" lists only the computed changes', async () => {
    const before = examsAnswer([cie(), endSem()], [slot([{ paper: 'cie-c', title: 'Subject C CIE', minutes: 60, focus: [{ kind: 'learn', title: 'Alpha', unit: 1, minutes: 30 }, { kind: 'learn', title: 'Beta', unit: 1, minutes: 30 }] }])])
    const after = examsAnswer([cie(), endSem()], [slot([{ paper: 'cie-c', title: 'Subject C CIE', minutes: 80, focus: [{ kind: 'learn', title: 'Alpha', unit: 1, minutes: 50 }, { kind: 'learn', title: 'Beta', unit: 1, minutes: 30 }] }])])
    let saved = false
    const r = routes()
    r.on('GET', /\/exams$/, () => (saved ? after : before))
    r.on('POST', /\/marks$/, () => { saved = true; return { saved: 1, score: 1, max: 2, say: 'Marked', proficiency: {} } })
    await open()
    await click(byText('Practice paper'))
    await settle()
    await click($('[aria-label="One step more for question 1"]'))
    await click(byText('Save marks'))
    await settle()
    const line = "Saved. Tomorrow's blocks changed: Alpha +20 min"
    expect($('[role=dialog] [data-saved]')!.textContent).toBe(`${line} (1 of 2)`)
    expect($('[data-card=study-practice] [data-saved]')!.textContent).toBe(line)
  })
  it('with no difference in tomorrow the line reads "No change to tomorrow\'s plan"', async () => {
    const same = examsAnswer([cie(), endSem()], [slot([{ paper: 'cie-c', title: 'Subject C CIE', minutes: 60, focus: [{ kind: 'learn', title: 'Alpha', unit: 1, minutes: 60 }] }])])
    const r = routes({ exams: same })
    r.on('POST', /\/marks$/, () => ({ saved: 1, score: 2, max: 2, say: 'Marked', proficiency: {} }))
    await open()
    await click(byText('Practice paper'))
    await settle()
    await click($('[aria-label="One step more for question 1"]'))
    await click(byText('Save marks'))
    await settle()
    expect($('[data-card=study-practice] [data-saved]')!.textContent).toBe("Saved. No change to tomorrow's plan.")
  })
  it('marksLoop names at most four changes and counts the rest', () => {
    const list = ['a', 'b', 'c', 'd', 'e', 'f'].map((label, i) => ({ label, delta: 10 + i }))
    expect(savedLine(list)).toBe("Saved. Tomorrow's blocks changed: a +10 min, b +11 min, c +12 min, d +13 min, and 2 more")
    expect(savedLine([])).toBe("Saved. No change to tomorrow's plan.")
    expect(changes(null, null)).toEqual([])
  })
  it('a file opens in the Reader through the same renderer, and an unreadable file says so', async () => {
    const r = routes()
    r.on('GET', /academics\/file/, () => ({ __status: 404 }))
    await open()
    act(() => void openOverlay('reader', { kind: 'file', path: 'x/notes.md', title: 'Notes' }))
    await settle()
    expect($('[data-overlay=reader][data-kind=file]')!.textContent).toContain('This file could not be opened.')
  })
  it('with no paper made the Reader says so and has no primary', async () => {
    routes()
    await open()
    act(() => void openOverlay('reader', {}))
    await settle()
    expect($('[data-overlay=reader]')!.textContent).toContain('No paper is open.')
    expect($('[role=dialog] [data-primary]')).toBeNull()
  })
})

describe('Plan', () => {
  const contracts = [
    { key: 'c1', source: 'tree', slot: 'library', title: 'Solve ten questions', minutes: 45, done: false, node_name: 'Node A', hint: '' },
    { key: 'c2', source: 'tree', slot: 'library', title: 'Second block', minutes: 30, done: false, node_name: 'Node B', hint: '' },
    { key: 'c3', source: 'tree', slot: 'evening', title: 'Review and log', minutes: 30, done: true, node_name: '', hint: '' },
  ]
  const today = {
    blocks: [{ id: 'b1', kind: 'library', label: 'Library', start: '10:00', minutes: 75 }, { id: 'b2', kind: 'protected', label: 'Social', start: '17:00', minutes: 60 }, { id: 'b3', kind: 'evening', label: 'Evening', start: '19:00', minutes: 30 }],
    contracts, alternatives: [{ key: 'alt1', title: 'Another way', minutes: 25, node_name: 'Node C' }], exam: { advice: 'Exam week: library blocks first.', phase: null, subject: null, milestone: null },
  }
  it('shows ONE next action, Swap inside the first block row, and Rebuild asks first', async () => {
    const reroll = vi.fn(async () => {})
    const choose = vi.fn(async () => ({ ok: true, say: 'Swapped.' }))
    usePlan.setState({ today: today as never, reroll, choose })
    useFrame.setState({ view: 'plan' })
    routes()
    await open()
    expect($$('[data-next=true]')).toHaveLength(1)
    expect($('[data-next=true]')!.getAttribute('data-contract')).toBe('c1')
    expect(byText('Start in Focus')).not.toBeNull()
    expect($$('button').filter((b) => b.textContent === 'Start in Focus')).toHaveLength(1)
    // Swap is inside the row of the first open library contract
    expect($('[data-contract=c1]')!.textContent).toContain('Swap (1 other option)')
    expect($('[data-contract=c2]')!.textContent).not.toContain('Swap')
    expect($('[data-block=protected]')!.textContent).toContain('Protected rest')
    // rebuild asks first
    await click(byText("Rebuild today's plan"))
    expect(reroll).not.toHaveBeenCalled()
    expect($('[aria-label="Confirm rebuild"]')).not.toBeNull()
    await click(byText('Keep the plan'))
    expect(reroll).not.toHaveBeenCalled()
    await click(byText("Rebuild today's plan"))
    await click(byText('Rebuild'))
    await settle()
    expect(reroll).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain('Exam week: library blocks first.')
  })
  it('the swap button calls the plan engine with the open contract and the alternative', async () => {
    const choose = vi.fn(async () => ({ ok: true, say: 'Swapped.' }))
    usePlan.setState({ today: today as never, choose })
    useFrame.setState({ view: 'plan' })
    routes()
    await open()
    await click(byText(/Swap \(1/, 'button'))
    await click(byText('Swap in'))
    await settle()
    expect(choose).toHaveBeenCalledWith('c1', 'alt1')
    expect(document.body.textContent).toContain('Swapped.')
  })
  it("logs 30 or 60 minutes on today's exam block through the exams route", async () => {
    usePlan.setState({ today: today as never })
    useFrame.setState({ view: 'plan' })
    const ex = examsAnswer([cie(), endSem()])
    ex.days[0].slots = [slot([{ paper: 'cie-c', title: 'Subject C CIE', minutes: 60, focus: [] }])]
    const r = routes({ exams: ex })
    r.on('POST', /\/subj-c\/minutes$/, () => ex)
    await open()
    await click($('[aria-label="Log 30 minutes on Subject C CIE"]'))
    await settle()
    expect(r.calls.find((c) => c.method === 'POST')!.body).toEqual({ minutes: 30 })
  })
})

describe('Library', () => {
  const resource = { id: 'r1', title: 'A good book', kind: 'book', url: 'https://example.org/book', free: true, hours: 10 }
  const node = { status: 'ok', stage: 'study', say: '', node: { id: 'n', name: 'Node', branch: 'b', outcomes: [], hours_est: 10 }, next: { kind: 'study', title: 'Read chapter 3', why: '', minutes: 45 },
    primary: resource, backups: [{ ...resource, id: 'r2', title: 'Notes', url: '' }], contracts: [], entries: [], follow_ups: [], progress: { minutes: 0, hours_est: 10, share: 0, notes: 0, contracts_done: 0, contracts: 0 } }
  const learn = { status: 'ok', say: '', new: { id: 'k1', title: 'Compound growth', body: 'Growth is $e^{rt}$.', quiz: [] }, due: [], progress: { seen: 2, total: 9 }, source: 'private' }
  function libRoutes() {
    const r = routes()
    r.on('GET', /\/api\/mission\/learn$/, () => learn)
    r.on('GET', /\/api\/mission\/study\//, () => node)
    r.on('GET', /\/api\/mission\/findings/, () => ({ nodes: [{ node_id: 'zz', name: 'Some node', cats: [], papers: [{ id: 'f1', title: 'A finding on $x^2$', summary: '', published: '', url: 'https://example.org/f1' }], fetched: null, stale: false, error: null }] }))
    useFrame.setState({ view: 'library' })
    return r
  }
  it("a resource's Open link opens its url, and a resource with no link says so", async () => {
    libRoutes()
    await open()
    const link = $<HTMLAnchorElement>('a[aria-label="Open A good book"]')!
    expect(link.getAttribute('href')).toBe('https://example.org/book')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect($('[data-resource=r2]')!.textContent).toContain('no link')
    expect($('[data-resource=r2] a')).toBeNull()
  })
  it('the concept of the day is typeset, and what is not built is a muted line from the registry', async () => {
    libRoutes()
    await open()
    expect($('[data-concept=k1]')!.querySelector('.rd-math, .ww-math')).not.toBeNull()
    expect(document.body.textContent).toContain('Today shows one track.')
    expect(document.body.textContent).toContain('Chapter checklists per resource: not built.')
  })
  it('Findings are hidden in exam season', async () => {
    libRoutes()
    usePlan.setState({ today: { season: { season: 'exams', mode: 'auto', window_days: 45, nearest_days: 5, evening: false, evening_why: null, left_top: 'countdown', opens: 'study', due_soon_days: 3, findings_hidden: true, now_card: 'now' } } as never })
    await open()
    expect($('[data-findings-hidden]')).not.toBeNull()
    expect($('[data-card=study-findings]')).toBeNull()
  })
  it('in the normal season Findings show, filtered to the active node', async () => {
    libRoutes()
    usePlan.setState({ today: { season: { season: 'normal', mode: 'auto', window_days: 45, nearest_days: null, evening: false, evening_why: null, left_top: 'horizon', opens: 'life', due_soon_days: 7, findings_hidden: false, now_card: 'now' } } as never })
    await open()
    const card = $('[data-card=study-findings]')!
    expect(card).not.toBeNull()
    expect(card.querySelector('a')!.getAttribute('href')).toBe('https://example.org/f1')
  })
})

describe('layout', () => {
  const css = (f: string) => readFileSync(join(__dirname, '../../ww/kit', f), 'utf8')
  it('list over detail under 720 px: the pair is the kit MasterDetail, which stacks below 720 px of its own width', async () => {
    routes()
    await open()
    expect($('.ww-md .ww-md-list [data-card=study-papers]')).not.toBeNull()
    expect($('.ww-md .ww-md-detail [data-card=study-practice]')).not.toBeNull()
    expect(css('data.css') + css('extras.css') + css('card.css') + css('controls.css') + css('kit.css')).toMatch(/720px/)
  })
  it('the paper list wraps: no horizontal scroll rule on it', () => {
    const study = readFileSync(join(__dirname, '../../ww/study/study.css'), 'utf8')
    expect(study).not.toMatch(/overflow-x:\s*(auto|scroll)/)
    expect(study).toMatch(/overflow-wrap:\s*anywhere/)
  })
})
