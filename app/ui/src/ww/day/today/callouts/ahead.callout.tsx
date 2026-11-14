// Ahead (spec 20.16.1, A.L04 amendment): the nearest dated item and its days left as a plain number, until DB03 adds the
// countdown dots and the Next Three drawer to this file.
import { CalendarDays } from 'lucide-react'
import { IconButton } from '../../../../shared/kit'
import { openOverlay } from '../../../frame/overlayRegistry'
import { useToday } from '../context'
import { Num, TodayPlate } from '../Plate'
import type { CalloutRegistration } from '../registry'

function Ahead() {
  const { model } = useToday()
  const a = model.ahead
  return (
    <TodayPlate id="ahead" label="Ahead" state={a.state} reason={a.reason}
      corner={<IconButton label="Edit the date sheet" size="sm" onClick={() => openOverlay('date')}><CalendarDays size={16} aria-hidden="true" /></IconButton>}>
      <div className="td-ahead">
        <Num value={a.days} unit={a.days === 1 ? 'day' : 'days'} state={a.state} />
        <p className="td-ahead-what">
          {a.title ?? (a.reason === 'nothing dated' ? 'Nothing dated yet.' : 'Waiting for the date sheet.')}
          {a.more > 0 && <span className="td-ahead-more">{` then ${a.more} more dated`}</span>}
        </p>
      </div>
    </TodayPlate>
  )
}

export const callout: CalloutRegistration = { id: 'ahead', order: 20, Callout: Ahead }
