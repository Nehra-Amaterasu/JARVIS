// DayCell (package L01): one day as a small raised clay tile, or a pressed one outside the month. It shows the date, up to four
// kind marks along the base and the stipple strip of minutes. It is a button with ONE name (the date and what the day holds,
// said in words), so the marks inside it are decorative. A cell renders the same at month and year zoom except for its size
// (the year form draws its own bare cells from the same CellView). On the phone only the strongest mark shows, with a dot when
// there is more than one, and the tap opens the sheet that says the rest.
import { memo, type Ref } from 'react'
import { DayMark } from './DayMark'
import { StippleStrip } from './StippleStrip'
import { longDate } from './model'
import type { CellView } from './types'

export interface DayCellProps {
  date: string
  view: CellView
  inMonth?: boolean
  today?: boolean
  selected?: boolean
  /** The one tab stop of the grid (roving tabindex). */
  stop?: boolean
  form?: 'desk' | 'phone'
  /** The page has read nothing yet: the base shows three still dots (the skeleton), never a mark. */
  waiting?: boolean
  onPick: (date: string) => void
  buttonRef?: Ref<HTMLButtonElement>
}

/** A ring of 12 dots round today's numeral: the stipple ring of 20.6.1, still. */
function TodayRing() {
  return (
    <svg className="alm-ring" viewBox="-13 -13 26 26" width="26" height="26" aria-hidden="true" focusable="false">
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2
        return <circle key={i} cx={(Math.cos(a) * 11.2).toFixed(2)} cy={(Math.sin(a) * 11.2).toFixed(2)} r="1" />
      })}
    </svg>
  )
}

function DayCellBase({ date, view, inMonth = true, today, selected, stop, form = 'desk', waiting, onPick, buttonRef }: DayCellProps) {
  const phone = form === 'phone'
  const shown = phone ? view.marks.slice(0, 1) : view.marks.slice(0, 4)
  const plannedOnly = view.marks.length > 0 && view.marks.every((m) => !m.done)
  const empty = view.marks.length === 0 && !view.rest
  const label = `${longDate(date)}${today ? ', today' : ''}: ${view.text}`
  return (
    <button
      ref={buttonRef}
      type="button"
      className="alm-cell"
      data-date={date}
      data-tip={label}
      data-form={form}
      data-inmonth={inMonth ? 'true' : 'false'}
      data-today={today ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      data-rest={view.rest ? 'true' : undefined}
      data-planned-only={plannedOnly ? 'true' : undefined}
      data-empty={empty ? 'true' : undefined}
      data-waiting={waiting ? 'true' : undefined}
      tabIndex={stop ? 0 : -1}
      aria-label={label}
      aria-current={today ? 'date' : undefined}
      onClick={() => onPick(date)}
    >
      <span className="alm-num" aria-hidden="true">
        {today && <TodayRing />}
        <span className="alm-d">{Number(date.slice(8, 10))}</span>
      </span>
      {view.rest && !phone && <span className="alm-rest" aria-hidden="true">Rest</span>}
      <span className="alm-base" aria-hidden="true">
        {waiting && empty ? <span className="alm-skel"><i /><i /><i /></span> : (
          <>
            <span className="alm-marks">
              {shown.map((m) => <DayMark key={`${m.kind}${m.done}${m.state}`} kind={m.kind} done={m.done} decorative />)}
              {phone && view.marks.length > 1 && <i className="alm-more" />}
            </span>
            {!phone && view.dots != null && view.dots > 0 && <StippleStrip dots={view.dots} more={view.more} decorative />}
          </>
        )}
      </span>
    </button>
  )
}

export const DayCell = memo(DayCellBase)
