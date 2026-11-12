// Calendar Wheel (spec 7.4 #29): a 12-segment wheel (one per month) with dated items as ticks on the ring and a
// "today" notch. Past items are filled, upcoming are rings, planned dated items are dashed. Today is a prop (the
// data layer owns the clock, so the drawing is a pure function of its inputs and resets neutrally when the date
// changes). Ticks are one roving group (Left/Right, Enter opens the item); the list beside it is the alternative.
import { useMemo } from 'react'
import { ArtTable, Figure } from './frame'
import { polar, sectorPath, wheelTurn } from './geometry'
import { useRoving } from './hooks'

export interface WheelItem {
  id: string
  label: string
  /** 'YYYY-MM-DD' */
  date: string
  planned?: boolean
}

export interface DateWheelProps {
  items: readonly WheelItem[]
  /** 'YYYY-MM-DD' from the data layer; without it there is no notch and nothing counts as past. */
  today?: string
  caption: string
  /** Opens the existing `date` overlay for the item. */
  onOpen?: (id: string) => void
}

const S = 320
const C = S / 2
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function DateWheel({ items, today, caption, onOpen }: DateWheelProps) {
  const placed = useMemo(
    () =>
      items
        .map((it) => ({ it, turn: wheelTurn(it.date) }))
        .filter((x): x is { it: WheelItem; turn: number } => x.turn !== null)
        .sort((a, b) => (a.it.date < b.it.date ? -1 : a.it.date > b.it.date ? 1 : 0)),
    [items],
  )
  const rov = useRoving(placed.length)
  const todayTurn = today ? wheelTurn(today) : null
  const a = todayTurn === null ? null : polar(C, C, 96, todayTurn)
  const b = todayTurn === null ? null : polar(C, C, 136, todayTurn)
  return (
    <Figure component="date-wheel" caption={caption}>
      <div className="art-split">
        <svg className="art-svg" viewBox={`0 0 ${S} ${S}`} width={S} height={S} role="group" aria-label={`Calendar wheel, ${placed.length} dated items. ${caption}`}>
          {MONTHS.map((m, i) => (
            <g key={m}>
              <path className="art-cell-seg" d={sectorPath(C, C, 100, 132, i / 12, (i + 1) / 12)} />
              <text className="art-label" {...polar(C, C, 150, (i + 0.5) / 12)} textAnchor="middle" dominantBaseline="middle">{m}</text>
            </g>
          ))}
          {a && b ? <line className="art-now" x1={a.x} y1={a.y} x2={b.x} y2={b.y} /> : null}
          {placed.map(({ it, turn }, i) => {
            const p = polar(C, C, 116, turn)
            const past = today ? it.date < today : false
            const rp = rov.props(i)
            return (
              <g
                key={it.id}
                className="art-node"
                data-node={it.id}
                data-status={it.planned ? 'planned' : past ? 'past' : 'upcoming'}
                role="button"
                aria-label={`${it.label}, ${it.date}${it.planned ? ', planned' : past ? ', past' : ', upcoming'}`}
                {...rp}
                onClick={() => onOpen?.(it.id)}
                onKeyDown={(e) => {
                  rp.onKeyDown(e)
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onOpen?.(it.id)
                  }
                }}
              >
                <circle className="art-hit" cx={p.x} cy={p.y} r={22} />
                <circle className="art-focusring" cx={p.x} cy={p.y} r={10} fill="none" />
                {past && !it.planned ? (
                  <circle className="art-solid" cx={p.x} cy={p.y} r={5.5} />
                ) : (
                  <circle className="art-stroke" cx={p.x} cy={p.y} r={5} strokeDasharray={it.planned ? '2.2 2' : undefined} />
                )}
              </g>
            )
          })}
        </svg>
        <ol className="art-list">
          {placed.map(({ it }) => (
            <li key={it.id} data-planned={it.planned || undefined}>
              <span className="art-mono">{it.date}</span> {it.label}
              {it.planned ? <span className="art-list-meta"> planned</span> : null}
            </li>
          ))}
        </ol>
      </div>
      <ArtTable caption={`${caption} (dates)`} head={['Item', 'Date', 'Status']} rows={placed.map(({ it }) => [it.label, it.date, it.planned ? 'planned' : today && it.date < today ? 'past' : 'upcoming'])} />
    </Figure>
  )
}
