// Reminders (spec 20.16.1): the next two reminders once the reminder engine (E03) answers. Until then the null adapter
// below answers PLANNED, and the plate draws two hollow rows and says so: nothing is invented to fill it.
import type { LampState } from '../../../../shared/lamp'
import { TodayPlate } from '../Plate'
import type { CalloutRegistration } from '../registry'

export interface ReminderRow { id: string; at: string; text: string }
export interface ReminderPort { next(n: number): { state: LampState; reason: string; rows: ReminderRow[] } }

/** The null adapter: no reminder store exists in this build. */
export const nullReminders: ReminderPort = { next: () => ({ state: 'planned', reason: 'arrives with the reminder engine', rows: [] }) }

function Reminders() {
  const r = nullReminders.next(2)
  return (
    <TodayPlate id="reminders" label="Reminders" state={r.state} reason={r.reason}>
      {r.rows.length ? (
        <ul className="td-rems">
          {r.rows.map((x) => <li key={x.id}><span className="td-mono">{x.at}</span>{x.text}</li>)}
        </ul>
      ) : (
        <ul className="td-rems" data-hollow="true" aria-label="No reminders: not built yet">
          <li><span className="td-mono">– –:– –</span><span className="td-dash" /></li>
          <li><span className="td-mono">– –:– –</span><span className="td-dash" /></li>
        </ul>
      )}
    </TodayPlate>
  )
}

export const callout: CalloutRegistration = { id: 'reminders', order: 40, Callout: Reminders }
