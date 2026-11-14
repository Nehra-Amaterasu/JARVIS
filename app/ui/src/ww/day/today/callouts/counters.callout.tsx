// Counters (spec 20.16.1): the day's counters as raised keys (one press adds one), classes tapped as a readout, and Undo.
// At most four keys stand on the plate; the rest are counted and one key opens them in Day / Week (never a cut list).
import { Undo2 } from 'lucide-react'
import { IconButton } from '../../../../shared/kit'
import { useToday } from '../context'
import { TodayPlate } from '../Plate'
import type { CalloutRegistration } from '../registry'

const MAX_KEYS = 4

function Counters() {
  const { model, actions } = useToday()
  const shown = model.counters.slice(0, MAX_KEYS)
  const more = model.counters.length - shown.length
  const st = model.countersState
  const drawn = st === 'live' || st === 'simulated'
  const undoName = model.counters.find((c) => c.id === actions.lastCount)?.name
  return (
    <TodayPlate id="counters" label="Counters" state={st} reason={drawn ? `classes tapped ${model.classesTapped.done} of ${model.classesTapped.of}` : 'counters not read yet'}
      corner={actions.lastCount && undoName ? (
        <IconButton label={`Undo the last tap on ${undoName}`} size="sm" onClick={() => actions.tapCount(actions.lastCount as string, -1)}>
          <Undo2 size={16} aria-hidden="true" />
        </IconButton>
      ) : undefined}>
      {shown.length === 0 ? (
        <p className="td-quiet">{drawn ? 'No counters set up.' : 'Waiting for the counters.'}</p>
      ) : (
        <ul className="td-keys" aria-label="Counters, press to add one">
          {shown.map((c) => (
            <li key={c.id}>
              <button type="button" className="td-key" disabled={!drawn}
                aria-label={`${c.name}: ${c.value === null || !drawn ? 'not measured yet' : `${c.value} today`}. Add one.`}
                onClick={() => actions.tapCount(c.id, 1)}>
                <span className="td-key-n" data-hollow={c.value === null || !drawn ? 'true' : undefined}>{c.value === null || !drawn ? '–' : c.value}</span>
                <span className="td-key-name">{c.name}</span>
              </button>
            </li>
          ))}
          {more > 0 && (
            <li>
              <button type="button" className="td-key" data-more="" onClick={() => actions.go('day', 'week')} aria-label={`${more} more counters in Day, Week`}>
                <span className="td-key-n">+{more}</span>
                <span className="td-key-name">more</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </TodayPlate>
  )
}

export const callout: CalloutRegistration = { id: 'counters', order: 30, Callout: Counters }
