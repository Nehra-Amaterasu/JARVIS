// The Review Desk rules: nothing is accepted by itself, "certain" is narrow, a reject can be taken back for 10 s, and the
// handles never leave the page.
import { describe, expect, it } from 'vitest'
import { QUESTIONS } from '../../papers/fixtures'
import { UNDO_MS, certain, initialReview, isCertain, nextUncertain, pending, reduceReview, rubricSum } from '../reviewModel'
import { dragCorner, moveEdge } from '../cropModel'

const start = () => initialReview(QUESTIONS.filter((q) => q.year === 2024))

describe('review model', () => {
  it('nothing enters the bank on its own: every question of a new paper starts pending', () => {
    const s = start()
    expect(s.items.every((i) => i.status === 'pending')).toBe(true)
    expect(pending(s)).toHaveLength(7)
  })
  it('"certain" is a RULE tag at margin 0.5 or more with its marks found, and only that', () => {
    const s = start()
    expect(certain(s).map((i) => i.id)).toEqual(['q2024-1', 'q2024-2', 'q2024-4'])
    // Q6 has margin 0.55 and RULE but no marks; Q5 is MODEL at 0.09
    expect(isCertain(s.items.find((i) => i.id === 'q2024-6')!)).toBe(false)
    expect(isCertain(s.items.find((i) => i.id === 'q2024-5')!)).toBe(false)
  })
  it('accept all certain accepts those three and lands the cursor on the least certain one left', () => {
    const s = reduceReview(start(), { type: 'acceptCertain' })
    expect(s.items.filter((i) => i.status === 'accepted').map((i) => i.id)).toEqual(['q2024-1', 'q2024-2', 'q2024-4'])
    expect(pending(s)).toHaveLength(4)
    expect(s.cursorId).toBe('q2024-5')
  })
  it('next uncertain jumps to the lowest margin that is not the current one', () => {
    const s = start()
    expect(nextUncertain(s)).toBe('q2024-5')
    expect(nextUncertain(reduceReview(s, { type: 'go', id: 'q2024-5' }))).toBe('q2024-3')
  })
  it('accept moves on to the next waiting question', () => {
    const s = reduceReview(start(), { type: 'accept' })
    expect(s.items[0].status).toBe('accepted')
    expect(s.cursorId).toBe('q2024-2')
  })
  it('a reject can be undone for 10 s and not after', () => {
    const r = reduceReview(start(), { type: 'reject', now: 1000 })
    expect(r.items[0].status).toBe('rejected')
    expect(r.undo).toEqual({ id: 'q2024-1', until: 1000 + UNDO_MS })
    const back = reduceReview(r, { type: 'undo', now: 1000 + UNDO_MS })
    expect(back.items[0].status).toBe('pending')
    expect(back.cursorId).toBe('q2024-1')
    const late = reduceReview(r, { type: 'undo', now: 1000 + UNDO_MS + 1 })
    expect(late.items[0].status).toBe('rejected')
    expect(late.undo).toBeNull()
    expect(reduceReview(r, { type: 'expire', now: 1000 + UNDO_MS + 1 }).undo).toBeNull()
    expect(reduceReview(r, { type: 'expire', now: 5000 }).undo).not.toBeNull()
  })
  it('a topic the student chooses is a HAND tag at full margin; the text stays unverified until checked', () => {
    const s = reduceReview(start(), { type: 'edit', patch: { topicId: 't1', stem: 'Reworded stem.' } })
    const i = s.items[0]
    expect(i.tag).toBe('HAND')
    expect(i.margin).toBe(1)
    expect(i.hand).toEqual(expect.arrayContaining(['topic', 'stem']))
    expect(i.crop.textStatus).toBe('unverified')
    expect(reduceReview(s, { type: 'verify', verified: true }).items[0].crop.textStatus).toBe('verified')
  })
  it('merge joins a question to the one before it; the marks are summed only when both are known', () => {
    const s = reduceReview(reduceReview(start(), { type: 'go', id: 'q2024-2' }), { type: 'merge' })
    expect(s.items).toHaveLength(6)
    expect(s.items[0].marks).toBe(30)
    expect(s.items[0].mergedFrom).toEqual(['q2024-1', 'q2024-2'])
    expect(s.items[0].stem).toContain('Starting from the definitions')
    const m = reduceReview(reduceReview(start(), { type: 'go', id: 'q2024-6' }), { type: 'merge' })
    expect(m.items.find((i) => i.id === 'q2024-5')!.marks).toBeNull()
    expect(reduceReview(start(), { type: 'merge' }).items).toHaveLength(7)
  })
  it('split makes two questions whose marks are unknown, so neither is certain', () => {
    const s = reduceReview(start(), { type: 'split' })
    expect(s.items).toHaveLength(8)
    expect(s.items[0].marks).toBeNull()
    expect(s.items[1].id).toBe('q2024-1b')
    expect(certain(s).map((i) => i.id)).not.toContain('q2024-1')
    expect(certain(s).map((i) => i.id)).not.toContain('q2024-1b')
  })
  it('rubric points must sum to the marks', () => {
    let s = reduceReview(start(), { type: 'addPoint', text: 'States the relation', marks: 5 })
    expect(rubricSum(s.items[0])).toEqual({ sum: 5, total: 15, ok: false })
    s = reduceReview(s, { type: 'addPoint', text: 'Works it out', marks: 10 })
    expect(rubricSum(s.items[0]).ok).toBe(true)
    expect(reduceReview(s, { type: 'addPoint', text: '', marks: 3 }).items[0].rubric).toHaveLength(2)
  })
})

describe('crop handles', () => {
  const page = { w: 500, h: 552 }
  it('Shift+arrow moves one edge of the corner it is on', () => {
    expect(moveEdge([20, 30, 460, 60], 'tl', 'ArrowLeft', 4, page)).toEqual([16, 30, 464, 60])
    expect(moveEdge([20, 30, 460, 60], 'br', 'ArrowDown', 4, page)).toEqual([20, 30, 460, 64])
    expect(moveEdge([20, 30, 460, 60], 'tr', 'ArrowUp', 4, page)).toEqual([20, 26, 460, 64])
  })
  it('never leaves the page and never gets under 24 units', () => {
    expect(moveEdge([2, 30, 460, 60], 'tl', 'ArrowLeft', 4, page)[0]).toBe(0)
    expect(moveEdge([20, 30, 470, 60], 'br', 'ArrowRight', 40, page)[2]).toBe(480)
    expect(moveEdge([20, 30, 30, 60], 'br', 'ArrowLeft', 40, page)[2]).toBe(24)
  })
  it('a drag moves both edges of the corner', () => {
    expect(dragCorner([20, 30, 100, 60], 'br', 10, 6, page)).toEqual([20, 30, 110, 66])
  })
})
