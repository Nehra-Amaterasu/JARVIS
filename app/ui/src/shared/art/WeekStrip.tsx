// Week Strip (spec 7.4 #31): seven day pills, today with a notch, each showing real logged minutes as a small dot
// count (a pure function of the day's minutes: one dot per started 30 minutes, at most 5; no minutes is no dots).
// A rest day is a first-class glyph (a half moon and the word "rest") with no penalty tone. Roving tabindex:
// Left/Right move, Enter or click opens that day. Today is a prop, so the strip resets neutrally on a new date.
import { useMemo } from 'react'
import { Figure } from './frame'
import { weekDots } from './geometry'
import { useRoving } from './hooks'

export interface WeekDay {
  iso: string
  /** Short weekday, already localised by the caller. */
  label: string
  minutes: number
  rest?: boolean
}

export interface WeekStripProps {
  days: readonly WeekDay[]
  today?: string
  selected?: string
  caption?: string
  onOpen?: (iso: string) => void
}

export function WeekStrip({ days, today, selected, caption = 'Logged study minutes this week', onOpen }: WeekStripProps) {
  const list = useMemo(() => days.slice(0, 7), [days])
  const rov = useRoving(list.length, { wrap: false })
  return (
    <Figure component="week-strip" caption={caption}>
      <div className="art-week" role="group" aria-label={caption}>
        {list.map((d, i) => {
          const dots = weekDots(d.rest ? 0 : d.minutes)
          const isToday = d.iso === today
          const dayNum = d.iso.slice(8, 10).replace(/^0/, '')
          return (
            <button
              key={d.iso}
              type="button"
              className="art-day"
              data-day={d.iso}
              data-today={isToday || undefined}
              data-rest={d.rest || undefined}
              aria-current={isToday ? 'date' : undefined}
              aria-pressed={selected ? d.iso === selected : undefined}
              aria-label={`${d.label} ${dayNum}, ${d.rest ? 'rest day' : `${d.minutes} minutes logged`}${isToday ? ', today' : ''}`}
              {...rov.props(i)}
              onClick={() => onOpen?.(d.iso)}
            >
              {isToday ? <span className="art-notch" aria-hidden="true" /> : null}
              <span className="art-day-name">{d.label}</span>
              <span className="art-day-num art-mono">{dayNum}</span>
              {d.rest ? (
                <span className="art-rest">
                  <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true" focusable="false">
                    <path className="art-stroke" d="M8 2a6 6 0 1 0 0 12 4.6 4.6 0 0 1 0-12z" />
                  </svg>
                  <span>rest</span>
                </span>
              ) : (
                <svg className="art-day-dots" viewBox="0 0 50 8" width={50} height={8} aria-hidden="true" focusable="false">
                  {Array.from({ length: 5 }, (_, k) => (
                    <circle key={k} className={k < dots ? 'art-solid' : 'art-stroke art-dim-ring'} cx={5 + k * 10} cy={4} r={3} data-on={k < dots || undefined} />
                  ))}
                </svg>
              )}
            </button>
          )
        })}
      </div>
    </Figure>
  )
}
