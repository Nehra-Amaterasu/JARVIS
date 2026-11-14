// Now (spec 20.16.1): the current block or the gap to the next class, and the screen's one accent key.
import { Button } from '../../../../shared/kit'
import { useToday } from '../context'
import { TodayPlate } from '../Plate'
import type { CalloutRegistration } from '../registry'

function Now() {
  const { model, actions } = useToday()
  const n = model.now
  return (
    <TodayPlate id="now" label="Now" state={n.state} reason={n.reason}>
      <p className="td-now-line"><span className="td-sr">{n.head}: </span>{n.line}</p>
      <Button tone="primary" size="lg" className="td-start" data-primary="" aria-keyshortcuts="n" onClick={actions.startBlock}>
        {n.action}
      </Button>
    </TodayPlate>
  )
}

export const callout: CalloutRegistration = { id: 'now', order: 10, Callout: Now }
