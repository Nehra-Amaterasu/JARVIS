// The tonight sheet and the ledger clients (package N2) against a fake engine: R-55 to R-59 and R-60 to R-62 in each state and each class
// of failure, the two ways the client stays silent (gate off, no token), and what the mappers keep and drop. Every record is invented.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attemptRow, createTonightClient, ledgerOf, NOT_CONNECTED, paceOf, settingsOf, sheetOf, tonightView, whyOf } from '../pyqTonight'
import { env, fakeEngine, refuse } from './fakeEngine'

const B = '/api/mission/pyq'
const make = (over: { gate?: () => boolean; token?: () => string } = {}) => createTonightClient({ gate: () => true, token: () => 'tok', now: () => 5000, ...over })
afterEach(() => { vi.unstubAllGlobals() })

const WHY = { days_left: 4, marks_weight: 8.5, share: 0.6, proficiency: 0.5, syllabus_weight: 3 }
const ITEM = (n: number, q: string, marks: number, over: Record<string, unknown> = {}) => ({ n, question_id: q, marks, unit: 2, topic: 'Sampling', topic_key: '2|Sampling', text: `Invented question ${n}.`, crop: null, why: WHY, mark: null, ...over })
const SHEET = { id: '2026-11-27-fixture-signals', date: '2026-11-27', subject: 'fixture-signals', built_at: '2026-11-27T19:00:00', items: [ITEM(1, 'q1', 5), ITEM(2, 'q2', 10)], marks: [], unmarked: 2 }
const SETTINGS = { on: true, hour: '19:00', count: 6, horizon_days: 21 }

describe('mappers', () => {
  it('a sheet keeps every number the engine sent, the terms that chose each question, and his marks as marks', () => {
    const s = sheetOf({ ...SHEET, items: [ITEM(1, 'q1', 5, { mark: { question_id: 'q1', got: 3, max: 5, minutes: 12, at: '2026-11-27T21:00:00' } }), ITEM(2, 'q2', 10)] })
    expect(s).toMatchObject({ id: SHEET.id, date: '2026-11-27', subject: 'fixture-signals', unmarked: 2 })
    expect(s!.items[0]).toMatchObject({ n: 1, questionId: 'q1', marks: 5, topicKey: '2|Sampling', mark: { got: 3, max: 5, minutes: 12 } })
    expect(s!.items[0].why).toEqual({ daysLeft: 4, marksWeight: 8.5, share: 0.6, proficiency: 0.5, syllabusWeight: 3 })
    expect(s!.items[1].mark).toBeNull()
  })
  it('a sheet with no id is nothing; an item with no question or no marks is dropped, not padded', () => {
    expect(sheetOf(null)).toBeNull()
    expect(sheetOf({ date: 'x' })).toBeNull()
    expect(sheetOf({ ...SHEET, items: [{ n: 1 }, ITEM(2, 'q2', 10)] })!.items.map((i) => i.questionId)).toEqual(['q2'])
  })
  it('when an older answer carries no unmarked count it is the items with no mark of his', () => {
    expect(sheetOf({ ...SHEET, unmarked: undefined, items: [ITEM(1, 'q1', 5, { mark: { got: 1, max: 5 } }), ITEM(2, 'q2', 10)] })!.unmarked).toBe(1)
  })
  it('settings are read only when whole; a missing field is not guessed', () => {
    expect(settingsOf(SETTINGS)).toEqual({ on: true, hour: '19:00', count: 6, horizonDays: 21 })
    expect(settingsOf({ on: true, hour: '19:00' })).toBeNull()
    expect(settingsOf({ ...SETTINGS, on: 'yes' })).toBeNull()
  })
  it('a missing term stays null', () => { expect(whyOf({ days_left: null, proficiency: 0.2 })).toMatchObject({ daysLeft: null, proficiency: 0.2, marksWeight: null }) })
  it('the tonight view keeps the waiting sheets and the papers ahead', () => {
    const v = tonightView({ sheet: null, awaiting_marks: [{ id: 'a', date: '2026-11-26', subject: 's', unmarked: 3 }, { date: 'no id' }], settings: SETTINGS, next_papers: [{ subject: 's', title: 'Mid', date: '2026-12-01', days_left: 4 }] })
    expect(v).toEqual({ sheet: null, awaiting: [{ id: 'a', date: '2026-11-26', subject: 's', unmarked: 3 }], settings: { on: true, hour: '19:00', count: 6, horizonDays: 21 }, nextPapers: [{ subject: 's', title: 'Mid', date: '2026-12-01', daysLeft: 4 }] })
  })
  it('a ledger keeps the engine order, its counts, its holes in its own words and the rows behind the counts', () => {
    const l = ledgerOf({
      items: [{ key: '2|Sampling', unit: 2, topic: 'Sampling', syllabus_weight: 3, notes: 1, past_questions: 2, past_marks: 15, papers_seen: 2, families: 2, attempts: 0, got: 0, max: 0, minutes: null, last_practised: null, question_ids: ['q1', 'q2'], note_files: ['f1'] }, { nokey: true }],
      holes: [{ key: '2|Sampling', kind: 'never_practised', sentence: 'No mark on file for Sampling.' }],
      totals: { topics: 1, with_notes: 1, with_past_question: 1, practised: 0, attempts: 0, got: 0, max: 0 },
      skipped: [{ file: 'x.json', reason: 'This sheet file does not read as JSON; it was left out.' }],
    })
    expect(l.items).toHaveLength(1)
    expect(l.items[0]).toMatchObject({ key: '2|Sampling', syllabusWeight: 3, pastMarks: 15, minutes: null, lastPractised: null, questionIds: ['q1', 'q2'], noteFiles: ['f1'] })
    expect(l.holes).toEqual([{ key: '2|Sampling', kind: 'never_practised', sentence: 'No mark on file for Sampling.' }])
    expect(l.totals).toMatchObject({ topics: 1, withNotes: 1 })
    expect(l.skipped).toHaveLength(1)
  })
  it('an attempt row needs a time and both numbers', () => {
    expect(attemptRow({ at: '2026-11-27T20:00:00', source: 'sheet', source_id: 's', question_id: 'q', topic_key: 'k', got: 3, max: 5, minutes: null })).toMatchObject({ got: 3, max: 5, minutes: null, source: 'sheet' })
    expect(attemptRow({ at: '', got: 1, max: 2 })).toBeNull()
    expect(attemptRow({ at: 'x', got: 1 })).toBeNull()
  })
  it('a pace keeps null where the engine sent none: never a zero', () => {
    expect(paceOf({ paper_date: null, days_left: null, topics: 12, practised: 0, left: 12, days_counted: 0, per_day: null, days_needed: null, sentence: 'No mark on file for this subject yet.' }))
      .toMatchObject({ paperDate: null, daysLeft: null, perDay: null, daysNeeded: null, practisedInDays: null, daysCounted: 0, sentence: 'No mark on file for this subject yet.' })
  })
})

describe('R-55 tonight', () => {
  it('PLANNED (off) still carries the settings and the papers ahead', async () => {
    fakeEngine({ [`GET ${B}/tonight`]: { json: env('planned', 'The evening sheet is off.', { sheet: null, awaiting_marks: [], settings: { ...SETTINGS, on: false }, next_papers: [] }) } })
    const r = await make().tonight()
    expect(r.state).toBe('planned')
    expect(r.reason).toBe('The evening sheet is off.')
    expect(r.data?.settings).toMatchObject({ on: false, count: 6 })
  })
  it('WAITING passes the reason as sent', async () => {
    fakeEngine({ [`GET ${B}/tonight`]: { json: env('waiting', 'No paper on the date sheet in the next 21 days.', { sheet: null, awaiting_marks: [], settings: SETTINGS, next_papers: [] }) } })
    expect((await make().tonight()).reason).toBe('No paper on the date sheet in the next 21 days.')
  })
  it('LIVE carries the sheet', async () => {
    fakeEngine({ [`GET ${B}/tonight`]: { json: env('live', "Tonight's sheet: 2 questions", { sheet: SHEET, awaiting_marks: [], settings: SETTINGS, next_papers: [] }) } })
    const r = await make().tonight()
    expect(r.data?.sheet?.items).toHaveLength(2)
  })
  it('an answer with no valid state is a FAULT and shows nothing', async () => {
    fakeEngine({ [`GET ${B}/tonight`]: { json: { reason: 'x' } } })
    const r = await make().tonight()
    expect(r).toMatchObject({ state: 'fault', data: null })
  })
  it('gate off or no token: nothing is called', async () => {
    const e = fakeEngine({})
    expect((await make({ gate: () => false }).tonight()).reason).toBe(NOT_CONNECTED)
    expect((await make({ token: () => '' }).tonight()).state).toBe('waiting')
    expect(e.calls).toHaveLength(0)
  })
  it('the engine not being there is WAITING, and the next call within 15 s makes no request', async () => {
    const e = fakeEngine({})
    const c = make()
    expect((await c.tonight()).reason).toBe('engine routes not found')
    await c.tonight()
    expect(e.calls).toHaveLength(1)
  })
})

describe('R-56 settings', () => {
  it('sends only the fields in the patch, with the engine own names', async () => {
    const e = fakeEngine({ [`PUT ${B}/tonight/settings`]: { json: env('live', 'Each day at 18:30.', { settings: { ...SETTINGS, hour: '18:30' } }) } })
    const r = await make().saveSettings({ hour: '18:30', horizonDays: 14 })
    expect(e.calls[0].body).toEqual({ hour: '18:30', horizon_days: 14 })
    expect(r.data).toMatchObject({ hour: '18:30' })
  })
  it('a refusal is the engine sentence as a FAULT', async () => {
    fakeEngine({ [`PUT ${B}/tonight/settings`]: refuse(400, 'Questions are from 3 to 12.') })
    expect(await make().saveSettings({ count: 40 })).toMatchObject({ state: 'fault', reason: 'Questions are from 3 to 12.', data: null })
  })
  it('switched off answers PLANNED and still hands back the settings now on file', async () => {
    fakeEngine({ [`PUT ${B}/tonight/settings`]: { json: env('planned', 'The evening sheet is off: nothing is built and nothing reminds you.', { settings: { ...SETTINGS, on: false } }) } })
    const r = await make().saveSettings({ on: false })
    expect(r.state).toBe('planned')
    expect(r.data?.on).toBe(false)
  })
})

describe('R-57 build', () => {
  it('sends nothing but what he chose, and returns the sheet', async () => {
    const e = fakeEngine({ [`POST ${B}/tonight/build`]: { json: env('live', "Tonight's sheet: 2 questions, Signals, paper in 4 days.", { sheet: SHEET }) } })
    const r = await make().build({})
    expect(e.calls[0].body).toEqual({})
    expect(r.data?.id).toBe(SHEET.id)
    await make().build({ date: '2026-11-26', subject: 'fixture-signals' })
    expect(e.calls[1].body).toEqual({ date: '2026-11-26', subject: 'fixture-signals' })
  })
  it('WAITING keeps the engine reason and no sheet', async () => {
    fakeEngine({ [`POST ${B}/tonight/build`]: { json: env('waiting', 'No accepted question for Signals yet.', { sheet: null }) } })
    expect(await make().build()).toMatchObject({ state: 'waiting', reason: 'No accepted question for Signals yet.', data: null })
  })
  it('a 409 is WAITING with the engine sentence; a LIVE answer with no sheet is not shown as built', async () => {
    fakeEngine({ [`POST ${B}/tonight/build`]: refuse(409, 'The paper desk is reading files; try again when it has finished.') })
    expect(await make().build()).toMatchObject({ state: 'waiting', reason: 'The paper desk is reading files; try again when it has finished.' })
    fakeEngine({ [`POST ${B}/tonight/build`]: { json: env('live', 'ok', {}) } })
    expect((await make().build()).state).toBe('fault')
  })
})

describe('R-58 marks', () => {
  it('posts question_id and got (minutes only when given) and keeps the engine totals and marked_by', async () => {
    const saved = { ...SHEET, items: [ITEM(1, 'q1', 5, { mark: { got: 3, max: 5, minutes: null, at: 'x' } }), ITEM(2, 'q2', 10)], unmarked: 1 }
    const e = fakeEngine({ [`POST ${B}/tonight/${SHEET.id}/marks`]: { json: env('live', 'Saved marks for 1 question: 3 of 5. 1 question is still unmarked.', { sheet: saved, saved: 1, total: { got: 3, max: 5 }, marked_by: 'you' }) } })
    const r = await make().saveMarks(SHEET.id, [{ questionId: 'q1', got: 3 }, { questionId: 'q2', got: 7, minutes: 12 }])
    expect(e.calls[0].body).toEqual({ items: [{ question_id: 'q1', got: 3 }, { question_id: 'q2', got: 7, minutes: 12 }] })
    expect(r.data).toMatchObject({ saved: 1, total: { got: 3, max: 5 }, markedBy: 'you' })
    expect(r.data?.sheet?.unmarked).toBe(1)
  })
  it('a mark over the maximum is the engine sentence as a FAULT', async () => {
    fakeEngine({ [`POST ${B}/tonight/${SHEET.id}/marks`]: refuse(400, 'Marks for a 5-mark question are from 0 to 5.') })
    expect(await make().saveMarks(SHEET.id, [{ questionId: 'q1', got: 9 }])).toMatchObject({ state: 'fault', reason: 'Marks for a 5-mark question are from 0 to 5.', data: null })
  })
})

describe('R-59 print', () => {
  it('returns the engine HTML as text; a refusal is the sentence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html><title>Tonight</title>', { status: 200, headers: { 'content-type': 'text/html' } })))
    expect((await make().printHtml(SHEET.id)).data).toContain('<title>Tonight</title>')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'No such sheet.' }), { status: 404, headers: { 'content-type': 'application/json' } })))
    expect(await make().printHtml('nope')).toMatchObject({ state: 'fault', reason: 'No such sheet.', data: null })
  })
})

describe('R-60 to R-62 ledger', () => {
  it('asks for the subject and the topic key, encoded', async () => {
    const e = fakeEngine({
      [`GET ${B}/ledger`]: { json: env('live', '1 topic: 0 in your notes.', { items: [], count: 0, holes: [], totals: { topics: 0 }, skipped: [] }) },
      [`GET ${B}/ledger/attempts`]: { json: env('live', '1 mark on file: 3 of 5.', { items: [{ at: '2026-11-27T20:00:00', source: 'sheet', source_id: 's', question_id: 'q', topic_key: '2|Sampling', got: 3, max: 5, minutes: null }], count: 1 }) },
      [`GET ${B}/ledger/pace`]: { json: env('waiting', 'No mark on file for this subject yet.', { topics: 4, practised: 0, left: 4, days_counted: 0, per_day: null, sentence: 'No mark on file for this subject yet.' }) },
    })
    const c = make()
    await c.ledger('fixture-signals')
    expect(e.calls[0].query.get('subject')).toBe('fixture-signals')
    const a = await c.attempts('fixture-signals', '2|Sampling')
    expect(e.calls[1].query.get('topic')).toBe('2|Sampling')
    expect(a.data).toHaveLength(1)
    const p = await c.pace('fixture-signals')
    expect(p.state).toBe('waiting')
    expect(p.data?.perDay).toBeNull()
    expect(p.data?.sentence).toBe('No mark on file for this subject yet.')
  })
  it('a topic named in two units is the engine sentence listing the keys', async () => {
    fakeEngine({ [`GET ${B}/ledger/attempts`]: refuse(400, 'That topic is in more than one unit; send its key: 1|Intro, 3|Intro.') })
    expect(await make().attempts('s', 'Intro')).toMatchObject({ state: 'fault', reason: 'That topic is in more than one unit; send its key: 1|Intro, 3|Intro.' })
  })
  it('an unknown subject is the engine 404 sentence', async () => {
    fakeEngine({ [`GET ${B}/ledger`]: refuse(404, 'No such subject.') })
    expect((await make().ledger('zzz')).reason).toBe('No such subject.')
  })
})
