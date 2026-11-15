/**
 * The legacy-bank adapter (A.Y02): the game store's Leitner cards (germoney/game/decks.ts, store.reviewCard) behind the FocusPort, so
 * the new Drill reads and writes exactly what the classic Drill did. The cards, the schedule (1, 3, 7, 16, 35 days) and the
 * grading are the store's, unchanged; only the screen is new. A card is a recall question: the student says the answer, the key
 * is shown, and the student says whether they had it (marked by you). The one derived hint is a rule, not a guess: the first
 * letters and the length of the key, so it can never be wrong.
 */
import { usePlan } from '../../../germoney/game/plan'
import { DECKS, type Card, type DeckId } from '../../../germoney/game/decks'
import { dueCards, useGame } from '../../../germoney/game/store'
import type { Attempt, DrillQuestion, DrillSet, FocusPort, PickItem } from '../ports'

/** At most this many questions in a set: the classic page capped a day at 20 cards; a set is a sitting, not a day. */
export const SET_MAX = 10
const DECK_ORDER: DeckId[] = ['deutsch', 'vlsi', 'ops']

export function cardToQuestion(c: Card): DrillQuestion {
  const key = c.back
  const head = key.replace(/\s+/g, ' ').slice(0, 2)
  return {
    id: c.id,
    stem: c.front,
    topic: DECKS[c.deck].name,
    kind: 'recall',
    key,
    hints: [`Starts with "${head}", ${key.length} characters in all.`],
  }
}

function due(): { deck: DeckId; cards: Card[] }[] {
  const { g, today } = useGame.getState()
  return DECK_ORDER.map((deck) => ({ deck, cards: dueCards(g, deck, today) }))
}

export const legacyBankPort: FocusPort = {
  id: 'legacy-bank',
  async loadSet(): Promise<DrillSet> {
    const cards = due().flatMap((d) => d.cards).slice(0, SET_MAX)
    if (!cards.length) return { title: 'Nothing queued', state: 'live', reason: 'every card is scheduled for a later day', questions: [] }
    return { title: 'Cards due today', state: 'live', questions: cards.map(cardToQuestion) }
  },
  async record(a: Attempt) {
    if (a.result === 'skipped') return
    useGame.getState().reviewCard(a.questionId, a.result === 'matched')
    return { nextOn: useGame.getState().g.drill[a.questionId]?.due }
  },
  async park(text: string) {
    await usePlan.getState().park(text)
    return { stored: true }
  },
  async pick(): Promise<PickItem | null> {
    const rows = due().filter((d) => d.cards.length)
    if (!rows.length) return null
    const { g, today } = useGame.getState()
    const top = rows.reduce((a, b) => (b.cards.length > a.cards.length ? b : a))
    const seen = top.cards.filter((c) => g.drill[c.id])
    const oldest = seen.length ? Math.max(0, ...seen.map((c) => Math.round((Date.parse(today) - Date.parse(g.drill[c.id].due)) / 86_400_000))) : 0
    return {
      id: top.deck,
      title: `Drill the ${DECKS[top.deck].name} cards`,
      reason: 'the deck with the most cards due today',
      terms: [{ name: 'due', value: top.cards.length }, { name: 'new', value: top.cards.length - seen.length }, { name: 'days late', value: oldest }],
      state: 'live',
    }
  },
}
