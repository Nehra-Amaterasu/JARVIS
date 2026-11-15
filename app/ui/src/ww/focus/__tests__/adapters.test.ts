// Y02: the legacy-bank adapter keeps the game store's cards and schedule (moved behind the port, not rewritten), and the port registry
// answers with the null port until an adapter registers itself.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CARDS } from '../../../germoney/game/decks'
import { useGame } from '../../../germoney/game/store'
import { SET_MAX, cardToQuestion, legacyBankPort } from '../adapters'
import { activeFocusPort, clearFocusPorts, nullFocusPort, registerFocusPort } from '../ports'

afterEach(() => vi.restoreAllMocks())

describe('the legacy bank', () => {
  it('turns a card into a recall question with one rule-made hint that cannot be wrong', () => {
    const c = CARDS[0]
    const q = cardToQuestion(c)
    expect(q).toMatchObject({ id: c.id, stem: c.front, key: c.back, kind: 'recall' })
    expect(q.hints).toHaveLength(1)
    expect(q.hints[0]).toBe(`Starts with "${c.back.slice(0, 2)}", ${c.back.length} characters in all.`)
  })

  it('loads at most a sitting of cards from what the store says is due, LIVE, and records a result through reviewCard', async () => {
    const set = await legacyBankPort.loadSet()
    expect(set.questions.length).toBeGreaterThan(0)
    expect(set.questions.length).toBeLessThanOrEqual(SET_MAX)
    expect(set.state).toBe('live')
    const id = set.questions[0].id
    const spy = vi.spyOn(useGame.getState(), 'reviewCard')
    const before = useGame.getState().g.drill[id]?.seen ?? 0
    const r = await legacyBankPort.record({ questionId: id, result: 'matched', hintsUsed: 1, shown: false, markedBy: 'you', at: Date.now() })
    expect(useGame.getState().g.drill[id]?.seen).toBe(before + 1)
    expect(r && r.nextOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    void spy
    // a skipped card is not reviewed: the schedule is the student's, and a skip says nothing about memory
    const seen = useGame.getState().g.drill[id]?.seen
    await legacyBankPort.record({ questionId: id, result: 'skipped', hintsUsed: 0, shown: false, markedBy: 'you', at: Date.now() })
    expect(useGame.getState().g.drill[id]?.seen).toBe(seen)
  })

  it('offers the deck with the most cards due as the Pick for me item, with three printed terms', async () => {
    const p = await legacyBankPort.pick()
    expect(p?.terms.map((t) => t.name)).toEqual(['due', 'new', 'days late'])
    expect(p?.state).toBe('live')
  })
})

describe('the port registry', () => {
  it('answers with the null port until something registers, and the last one registered wins', () => {
    clearFocusPorts()
    expect(activeFocusPort()).toBe(nullFocusPort)
    registerFocusPort(legacyBankPort)
    expect(activeFocusPort()).toBe(legacyBankPort)
    clearFocusPorts()
    registerFocusPort(legacyBankPort)
  })
})
