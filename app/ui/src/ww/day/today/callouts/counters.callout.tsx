// Counters (spec 20.16.1), rebuilt 25 Nov after the owner's words: "+2 more takes me to Week", "no counters changing option", "undo only
// reverts the latest one", "went to college is tick or not". So:
//   - each count tile has a minus and a plus, 44 px each, and the value between them;
//   - a counter that is a yes or no (want "yes", and the college counter) is ONE tick tile: pressed = yes, pressed again = no, never a 2;
//   - "+N more" opens the rest in this plate, it does not leave Today;
//   - Undo walks back through every tap of this visit, newest first;
//   - "Choose counters" picks which show and their order, kept on this device (the engine has no route for that list).
// How a count is stored and what the engine answers: ww/life/counterDeck.ts.
import { useState } from 'react'
import { ArrowDown, ArrowUp, Check, ListChecks, Minus, Plus, Undo2 } from 'lucide-react'
import { Chip, Drawer, IconButton } from '../../../../shared/kit'
import { arrange, freshUndo, isTick, useCounterDeck, useDeck, type DeckCounter } from '../../../life/counterDeck'
import { useToday } from '../context'
import { TodayPlate } from '../Plate'
import type { CalloutRegistration } from '../registry'

/** Tiles standing before "+N more": two rows of two in the narrow tray. */
export const MAX_TILES = 4

function Tile({ c, ready, onStep, onTick }: { c: DeckCounter; ready: boolean; onStep: (id: string, d: 1 | -1) => void; onTick: (id: string) => void }) {
  const known = c.today !== null
  if (isTick(c)) {
    const yes = (c.today ?? 0) >= 1
    return (
      <li className="td-ctile" data-kind="tick" data-counter={c.id}>
        <span className="td-ctile-name">{c.name}</span>
        <button type="button" className="td-tick" aria-pressed={yes} disabled={!ready} onClick={() => onTick(c.id)} aria-label={`${c.name}: ${yes ? 'yes' : 'not yet'}. ${yes ? 'Press to take it back.' : 'Press to tick it.'}`}>
          <span className="td-tick-box" aria-hidden="true">{yes && <Check size={18} />}</span>
          <span className="td-tick-word">{yes ? 'Yes' : 'Not yet'}</span>
        </button>
      </li>
    )
  }
  return (
    <li className="td-ctile" data-kind="count" data-counter={c.id}>
      <span className="td-ctile-name">{c.name}</span>
      <span className="td-ctile-row">
        <button type="button" className="td-step" disabled={!ready || !c.today} aria-label={`${c.name}: one less`} onClick={() => onStep(c.id, -1)}><Minus size={18} aria-hidden="true" /></button>
        <b className="td-ctile-n" data-hollow={known ? undefined : 'true'} aria-label={known ? `${c.today} today` : 'not measured yet'}>{known ? c.today : '–'}</b>
        <button type="button" className="td-step" disabled={!ready} aria-label={`${c.name}: one more`} onClick={() => onStep(c.id, 1)}><Plus size={18} aria-hidden="true" /></button>
      </span>
    </li>
  )
}

/** The manage sheet: which counters stand on the card and in what order. */
function Choose({ open, onClose, all }: { open: boolean; onClose: () => void; all: DeckCounter[] }) {
  const prefs = useDeck((s) => s.prefs)
  const setPrefs = useDeck((s) => s.setPrefs)
  const { shown, hidden } = arrange(all, prefs)
  const order = [...shown, ...hidden].map((c) => c.id)
  const save = (o: string[], h: string[]) => setPrefs({ order: o, hidden: h })
  const move = (id: string, d: -1 | 1) => {
    const i = order.indexOf(id), j = i + d
    if (i < 0 || j < 0 || j >= order.length) return
    const o = [...order]; [o[i], o[j]] = [o[j], o[i]]
    save(o, prefs.hidden)
  }
  const toggle = (id: string) => save(order, prefs.hidden.includes(id) ? prefs.hidden.filter((x) => x !== id) : [...prefs.hidden, id])
  return (
    <Drawer open={open} onClose={onClose} title="Choose counters" place="right" className="td-choose">
      <div className="td-choose-body">
        <p className="td-choose-line">Pick the counters that stand on the Today card and put them in the order you use them. Only the first four show at once; the rest wait behind &ldquo;more&rdquo;.</p>
        <ol className="td-choose-list" aria-label="Counters">
          {order.map((id, i) => {
            const c = all.find((x) => x.id === id)
            if (!c) return null
            const on = !prefs.hidden.includes(id)
            return (
              <li key={id} className="td-choose-row" data-counter={id} data-on={on ? 'true' : 'false'}>
                <Chip selected={on} onClick={() => toggle(id)}>{on ? 'Shown' : 'Hidden'}</Chip>
                <span className="td-choose-name">{c.name}</span>
                <IconButton label={`Move ${c.name} up`} size="sm" disabled={i === 0} onClick={() => move(id, -1)}><ArrowUp size={16} aria-hidden="true" /></IconButton>
                <IconButton label={`Move ${c.name} down`} size="sm" disabled={i === order.length - 1} onClick={() => move(id, 1)}><ArrowDown size={16} aria-hidden="true" /></IconButton>
              </li>
            )
          })}
        </ol>
        <p className="td-choose-line" data-kept="">Kept on this device. The engine has no list of its own for this yet, so another phone or window has its own choice.</p>
      </div>
    </Drawer>
  )
}

function Counters() {
  const { model } = useToday()
  const deck = useCounterDeck()
  const [open, setOpen] = useState(false)
  const [choose, setChoose] = useState(false)
  // until the engine's own read answers, the tiles show the numbers Today already holds (read only: nothing can be pressed on a guess)
  const ready = deck.counters !== null
  const all: DeckCounter[] = deck.counters ?? model.counters.map((c) => ({ id: c.id, name: c.name, want: 'less' as const, today: c.value }))
  const { shown } = arrange(all, deck.prefs)
  const stood = open ? shown : shown.slice(0, MAX_TILES)
  const more = shown.length - Math.min(shown.length, MAX_TILES)
  const st = model.countersState
  const drawn = st === 'live' || st === 'simulated'
  const stack = freshUndo(deck.undo)
  const last = stack[stack.length - 1]
  const delta = last ? last.after - last.before : 0
  const tiles = drawn || ready
  return (
    <TodayPlate id="counters" label="Counters" state={st} reason={drawn ? `classes tapped ${model.classesTapped.done} of ${model.classesTapped.of}` : 'counters not read yet'}
      corner={(
        <span className="td-corner-keys">
          <IconButton label={last ? `Undo: ${last.name} ${delta > 0 ? 'plus' : 'minus'} ${Math.abs(delta) || 'change'}${stack.length > 1 ? `, ${stack.length} to undo` : ''}` : 'Nothing to undo yet'} size="sm" disabled={!last} onClick={() => void deck.undoLast()} data-act="undo-count">
            <Undo2 size={16} aria-hidden="true" />{stack.length > 1 && <span className="td-undo-n">{stack.length}</span>}
          </IconButton>
          <IconButton label="Choose counters" size="sm" disabled={!ready} onClick={() => setChoose(true)} data-act="choose-counters"><ListChecks size={16} aria-hidden="true" /></IconButton>
        </span>
      )}>
      {shown.length === 0 || !tiles ? (
        <p className="td-quiet">{drawn ? (all.length ? 'Every counter is hidden. Choose counters brings them back.' : 'No counters set up.') : 'Waiting for the counters.'}</p>
      ) : (
        <>
          <ul className="td-ctiles" aria-label="Counters" data-open={open ? 'true' : undefined}>
            {stood.map((c) => <Tile key={c.id} c={c} ready={ready} onStep={(id, d) => void deck.step(id, d)} onTick={(id) => void deck.tick(id)} />)}
          </ul>
          {more > 0 && (
            <button type="button" className="td-more td-more-counters" aria-expanded={open} data-more="" onClick={() => setOpen(!open)}>
              {open ? 'Show fewer' : `+${more} more`}
            </button>
          )}
        </>
      )}
      {deck.said && <p className="td-ctiles-said" role="status" data-said="">{deck.said}</p>}
      <Choose open={choose} onClose={() => setChoose(false)} all={all} />
    </TodayPlate>
  )
}

export const callout: CalloutRegistration = { id: 'counters', order: 30, Callout: Counters }
