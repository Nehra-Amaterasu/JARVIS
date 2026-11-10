/**
 * Focus > Drill (plan 4.8, F2): spaced repetition on the Leitner boxes (1, 3, 7, 16, 35 days). The cards,
 * the schedule and the grading are the game store's, unchanged (game/decks.ts, game/store.ts reviewCard);
 * only the page is new. Answer in your head, reveal, grade yourself honestly. Space reveals, 1 is missed, 2 is got it.
 */
import { useEffect, useMemo, useState } from 'react'
import { CARDS, DECKS, type DeckId } from '../../germoney/game/decks'
import { dueCards, useGame } from '../../germoney/game/store'
import { Button, Card, Chip, EmptyState, Meter, PrimaryButton, Segmented } from '../kit'

const INTERVAL_DAYS = [1, 3, 7, 16, 35]

export function WwDrill() {
  const g = useGame((s) => s.g)
  const today = useGame((s) => s.today)
  const review = useGame((s) => s.reviewCard)
  const [deck, setDeck] = useState<DeckId>('deutsch')
  const [revealed, setRevealed] = useState(false)
  const [session, setSession] = useState({ right: 0, wrong: 0 })
  const queue = useMemo(() => dueCards(g, deck, today), [g, deck, today])
  const card = queue[0]
  const doneToday = g.drillDay[today]?.[deck] ?? 0

  const grade = (right: boolean) => {
    if (!card) return
    review(card.id, right)
    setRevealed(false)
    setSession((s) => ({ right: s.right + (right ? 1 : 0), wrong: s.wrong + (right ? 0 : 1) }))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      if (e.code === 'Space' && card && !revealed) { e.preventDefault(); setRevealed(true) }
      else if (revealed && e.key === '1') grade(false)
      else if (revealed && e.key === '2') grade(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const boxes = [1, 2, 3, 4, 5].map((b) => CARDS.filter((c) => c.deck === deck && (g.drill[c.id]?.box ?? -1) === b).length)
  const unseen = CARDS.filter((c) => c.deck === deck && !g.drill[c.id]).length
  const rec = card ? g.drill[card.id] : undefined
  return (
    <div className="ww-drill">
      <Card data-card="focus-drill" title="Drill" kicker="Focus" tone="quiet"
        action={<Chip>{`${session.right + session.wrong} this session`}</Chip>}>
        <div className="ww-drill-decks">
          <Segmented<DeckId> label="Deck" variant="choice" value={deck} onChange={(d) => { setDeck(d); setRevealed(false) }}
            options={(Object.keys(DECKS) as DeckId[]).map((d) => ({ id: d, label: `${DECKS[d].name} · ${dueCards(g, d, today).length} due` }))} />
          <span className="ww-drill-note">{DECKS[deck].blurb}</span>
        </div>
        <div className="ww-drill-count">
          <Meter value={Math.min(1, doneToday / 20)} label={`${doneToday} of 20 cards today`} />
          <span className="ww-drill-note">{doneToday} / 20 today{deck !== 'ops' ? ` → ${deck === 'deutsch' ? 'Deutsch' : 'Silicon'} rep` : ''}</span>
        </div>
        {card ? (
          <div className="ww-flash" data-revealed={revealed ? 'true' : 'false'}>
            <p className="ww-flash-front">{card.front}</p>
            {revealed ? (
              <>
                <p className="ww-flash-back">{card.back}</p>
                <div className="ww-flash-actions">
                  <Button size="lg" grouped onClick={() => grade(false)}>Missed it (1)</Button>
                  <PrimaryButton claimId="focus-drill-gotit" rank="workspace" size="lg" onClick={() => grade(true)}>Got it (2)</PrimaryButton>
                </div>
              </>
            ) : (
              <PrimaryButton claimId="focus-drill-reveal" rank="workspace" size="lg" onClick={() => setRevealed(true)}>Reveal (Space)</PrimaryButton>
            )}
            <span className="ww-drill-note">{rec ? `box ${rec.box} · seen ${rec.seen} times` : 'new card'}</span>
          </div>
        ) : (
          <EmptyState title="Deck clear for today." body="Come back tomorrow: the schedule brings each card back just before you would forget it." />
        )}
        <div className="ww-drill-boxes" role="group" aria-label="Where the deck stands">
          <span className="ww-kicker">Where the deck stands</span>
          <Chip>{`unseen ${unseen}`}</Chip>
          {boxes.map((n, i) => <Chip key={i}>{`box ${i + 1} · ${INTERVAL_DAYS[i]}d · ${n}`}</Chip>)}
        </div>
      </Card>
    </div>
  )
}
