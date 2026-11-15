// MotionTape (spec 20.9.3, extends WeekStrip): seven days as seven 24-hour strips, one 2 px column per five minutes. A column is
// filled only for "motion seen", hatched for "sensing paused by you", blank for "nothing seen". Blank is not a finding:
// the caption says so, and this window records only the minutes it is open (there is no route for earlier days yet).
// SVG only, runs of equal cells are merged into one rect each, and the strips are one tab stop with the arrow keys.
import { useId, useMemo, useState, type KeyboardEvent } from 'react'
import { TAPE_CAPTION, TAPE_COLS, TAPE_STEP_MIN, tapeCounts, tapeHover, type TapeCell } from './model'

export interface MotionTapeProps {
  week: { start: number; cells: TapeCell[] }[]
  /** How the tape was made: the lamp words in the caption row. */
  source: 'live' | 'simulated' | 'none'
}

const LABEL_W = 36
const W = 510 - 24
const STRIP_H = 17
const GAP = 7
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function runs(cells: TapeCell[], kind: TapeCell): [number, number][] {
  const out: [number, number][] = []
  let from = -1
  cells.forEach((c, i) => {
    if (c === kind && from < 0) from = i
    if ((c !== kind || i === cells.length - 1) && from >= 0) { out.push([from, (c === kind ? i + 1 : i) - from]); from = -1 }
  })
  return out
}

export function MotionTape({ week, source }: MotionTapeProps) {
  const hatch = useId().replace(/:/g, '')
  const [at, setAt] = useState<{ day: number; col: number } | null>(null)
  const px = (W - LABEL_W) / TAPE_COLS
  const counts = useMemo(() => tapeCounts(week), [week])
  const height = week.length * (STRIP_H + GAP)
  const says = at ? tapeHover(week[at.day].start, at.col, week[at.day].cells[at.col]) : null
  const move = (e: KeyboardEvent) => {
    const cur = at ?? { day: week.length - 1, col: Math.floor(TAPE_COLS / 2) }
    const d = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0], PageUp: [0, -12], PageDown: [0, 12] }[e.key] as [number, number] | undefined
    if (!d) return
    e.preventDefault()
    setAt({ day: Math.max(0, Math.min(week.length - 1, cur.day + d[0])), col: Math.max(0, Math.min(TAPE_COLS - 1, cur.col + d[1])) })
  }
  const pointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * W - LABEL_W
    const y = ((e.clientY - r.top) / r.height) * height
    const day = Math.floor(y / (STRIP_H + GAP))
    if (x < 0 || day < 0 || day >= week.length) return setAt(null)
    setAt({ day, col: Math.max(0, Math.min(TAPE_COLS - 1, Math.floor(x / px))) })
  }
  return (
    <div className="js-tape" data-source={source}>
      <svg
        viewBox={`0 0 ${W} ${height}`} width="100%" tabIndex={0} role="group" data-testid="motion-tape"
        aria-label={`Motion tape, seven days of ${TAPE_STEP_MIN}-minute columns. ${counts.seen} columns with motion seen, ${counts.paused} paused by you. Arrow keys move.`}
        onKeyDown={move} onPointerMove={pointer} onPointerLeave={() => setAt(null)} onBlur={() => setAt(null)}
      >
        <defs>
          <pattern id={hatch} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" className="js-tape-hatch" /></pattern>
        </defs>
        {week.map((d, i) => {
          const y = i * (STRIP_H + GAP)
          return (
            <g key={d.start} transform={`translate(0 ${y})`} data-day={i}>
              <text x="0" y={STRIP_H - 3} className="js-tape-day">{DAY[new Date(d.start).getDay()]}</text>
              <rect x={LABEL_W} y="0" width={W - LABEL_W} height={STRIP_H} rx="3" className="js-tape-track" />
              {runs(d.cells, 'paused').map(([c, n]) => <rect key={`p${c}`} x={LABEL_W + c * px} y="0" width={n * px} height={STRIP_H} fill={`url(#${hatch})`} className="js-tape-paused" />)}
              {runs(d.cells, 'seen').map(([c, n]) => <rect key={`s${c}`} x={LABEL_W + c * px} y="1" width={Math.max(2, n * px)} height={STRIP_H - 2} className="js-tape-seen" />)}
              {at?.day === i && <rect x={LABEL_W + at.col * px - 1} y="-2" width={Math.max(3, px + 2)} height={STRIP_H + 4} rx="2" className="js-tape-cursor" />}
            </g>
          )
        })}
      </svg>
      <p className="js-tape-says" aria-live="polite">{says ?? 'Hover or use the arrow keys to read a column.'}</p>
      <p className="js-tape-caption">{TAPE_CAPTION}</p>
    </div>
  )
}
