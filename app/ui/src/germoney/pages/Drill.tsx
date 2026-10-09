/**
 * Mission → Drill: spaced repetition (Leitner boxes 1, 3, 7, 16, 35 days).
 * Answer in your head, reveal, grade yourself honestly. 20 German cards tick the
 * Deutsch rep; 20 VLSI cards tick the Silicon rep.
 */
import { RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { DECKS, CARDS, type DeckId } from '../game/decks'
import { dueCards, useGame } from '../game/store'
import { MissionHeader, NeonBar } from '../ui'

export function DrillPage() {
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
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.code === 'Space') { e.preventDefault(); setRevealed(true) }
      if (revealed && e.key === '1') grade(false)
      if (revealed && e.key === '2') grade(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const boxes = [0, 1, 2, 3, 4, 5].map((b) => CARDS.filter((c) => c.deck === deck && (g.drill[c.id]?.box ?? -1) === b).length)
  const unseen = CARDS.filter((c) => c.deck === deck && !g.drill[c.id]).length
  return (
    <div className="mission-page drill">
      <MissionHeader n="M5" title="Drill" sub="Answer in your head. Reveal. Grade yourself honestly — the schedule only works if you do."
        right={<span className="pill"><i className="led" />{session.right + session.wrong} this session</span>} />
      <div className="deck-tabs">
        {(Object.keys(DECKS) as DeckId[]).map((d) => (
          <button key={d} className={`deck-tab ${d === deck ? 'on' : ''}`} onClick={() => { setDeck(d); setRevealed(false) }}>
            <b>{DECKS[d].name}</b><span className="mono muted">{dueCards(g, d, today).length} due · {g.drillDay[today]?.[d] ?? 0} today</span>
          </button>
        ))}
      </div>

      <section className="card drill-card">
        <div className="dc-meta mono muted">
          <span>{DECKS[deck].blurb}</span>
          <span>{doneToday} / 20 today{deck !== 'ops' ? ` → ${deck === 'deutsch' ? 'Deutsch' : 'Silicon'} rep` : ''}</span>
        </div>
        <NeonBar progress={Math.min(1, doneToday / 20)} tone={doneToday >= 20 ? 'live' : 'chrome'} />
        {card ? (
          <div className={`flash ${revealed ? 'revealed' : ''}`}>
            <div className="flash-front">{card.front}</div>
            {revealed ? (
              <>
                <div className="flash-back fade-in">{card.back}</div>
                <div className="flash-actions">
                  <button className="btn danger" onClick={() => grade(false)}><RotateCcw size={14} />Missed it <kbd>1</kbd></button>
                  <button className="btn primary" onClick={() => grade(true)}>Got it <kbd>2</kbd></button>
                </div>
              </>
            ) : <button className="btn" onClick={() => setRevealed(true)}>Reveal <kbd>Space</kbd></button>}
            <span className="mono muted small">{g.drill[card.id] ? `box ${g.drill[card.id].box} · seen ${g.drill[card.id].seen}×` : 'new card'}</span>
          </div>
        ) : (
          <div className="flash empty-deck"><b>Deck clear for today.</b><p className="muted">Come back tomorrow — the schedule brings each card back just before you would forget it.</p></div>
        )}
      </section>

      <section className="card box-strip">
        <span className="eyebrow">Where the deck stands</span>
        <div className="boxes">
          <div><span className="dot">{unseen}</span><span className="eyebrow">unseen</span></div>
          {boxes.slice(1).map((n, i) => <div key={i}><span className="dot">{n}</span><span className="eyebrow">box {i + 1} · {[1, 3, 7, 16, 35][i]}d</span></div>)}
        </div>
      </section>
    </div>
  )
}
