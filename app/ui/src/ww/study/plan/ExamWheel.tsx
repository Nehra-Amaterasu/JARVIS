// ExamWheel (package Y03, spec 20.7.3): the Date Wheel of the papers on file. One spoke per paper, laid on a 12 month ring by the
// paper's date; the spokes are one roving tab stop (arrows step, Enter chooses) and each names its paper. Past papers are filled,
// coming ones are rings, a tentative date is dashed. Today is a prop (the data layer owns the clock), so the drawing is a pure
// function of its inputs. The shared art DateWheel draws a list beside the ring and cannot choose a paper; this one chooses.
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'

export interface WheelPaper {
  id: string
  label: string
  /** 'YYYY-MM-DD' */
  date: string
  /** A tentative date is dashed. */
  approx?: boolean
}

export interface ExamWheelProps {
  papers: readonly WheelPaper[]
  /** 'YYYY-MM-DD' */
  today: string
  selectedId?: string | null
  onSelect?: (id: string) => void
}

const S = 280
const C = S / 2
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']
const MONTH_WORD = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const turnOf = (iso: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  const mo = Number(m[2]) - 1
  const days = new Date(Number(m[1]), mo + 1, 0).getDate()
  return (mo + (Number(m[3]) - 1) / days) / 12
}
const polar = (r: number, turn: number) => {
  const a = turn * Math.PI * 2 - Math.PI / 2
  return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) }
}
const sector = (r0: number, r1: number, t0: number, t1: number) => {
  const a = polar(r1, t0), b = polar(r1, t1), c = polar(r0, t1), d = polar(r0, t0)
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)}A${r1} ${r1} 0 0 1 ${b.x.toFixed(1)} ${b.y.toFixed(1)}L${c.x.toFixed(1)} ${c.y.toFixed(1)}A${r0} ${r0} 0 0 0 ${d.x.toFixed(1)} ${d.y.toFixed(1)}Z`
}

export function ExamWheel({ papers, today, selectedId, onSelect }: ExamWheelProps) {
  const placed = useMemo(() => papers.map((p) => ({ p, turn: turnOf(p.date) })).filter((x): x is { p: WheelPaper; turn: number } => x.turn !== null).sort((a, b) => (a.p.date < b.p.date ? -1 : 1)), [papers])
  const [focus, setFocus] = useState(0)
  const refs = useRef<(SVGGElement | null)[]>([])
  const now = turnOf(today)
  const a = now === null ? null : polar(84, now)
  const b = now === null ? null : polar(124, now)

  const step = (e: KeyboardEvent, i: number) => {
    const last = placed.length - 1
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i === last ? 0 : i + 1) : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i === 0 ? last : i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1
    if (to < 0) return
    e.preventDefault()
    setFocus(to)
    refs.current[to]?.focus()
  }
  return (
    <figure className="y3-wheel" data-component="exam-wheel" data-empty={placed.length ? undefined : 'true'}>
      <svg className="y3-wheel-svg" viewBox={`0 0 ${S} ${S}`} role="group" aria-label={`Exam wheel, ${placed.length} ${placed.length === 1 ? 'paper' : 'papers'} on file`}>
        <circle className="y3-wheel-well" cx={C} cy={C} r="132" />
        {MONTHS.map((m, i) => (
          <g key={i}>
            <path className="y3-wheel-seg" d={sector(80, 126, i / 12 + 0.004, (i + 1) / 12 - 0.004)} data-q={Math.floor(i / 3) % 2} />
            <text className="y3-wheel-m" {...polar(94, (i + 0.5) / 12)} textAnchor="middle" dominantBaseline="central">{m}</text>
            <title>{MONTH_WORD[i]}</title>
          </g>
        ))}
        {a && b && <line className="y3-wheel-now" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />}
        {placed.map(({ p, turn }, i) => {
          const pt = polar(115, turn)
          const past = p.date < today
          const sel = p.id === selectedId
          return (
            <g
              key={p.id}
              ref={(el) => { refs.current[i] = el }}
              className="y3-spoke"
              data-paper={p.id}
              data-selected={sel ? 'true' : undefined}
              role="button"
              tabIndex={i === focus ? 0 : -1}
              aria-pressed={sel}
              aria-label={`${p.label}, ${p.date}${p.approx ? ', date not final' : ''}, ${past ? 'past' : 'coming'}`}
              onFocus={() => setFocus(i)}
              onClick={() => onSelect?.(p.id)}
              onKeyDown={(e) => { step(e, i); if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(p.id) } }}
            >
              <circle className="y3-spoke-hit" cx={pt.x} cy={pt.y} r="22" />
              {sel && <circle className="y3-spoke-sel" cx={pt.x} cy={pt.y} r="12" />}
              <circle className="y3-spoke-dot" cx={pt.x} cy={pt.y} r="6" data-past={past ? 'true' : 'false'} data-approx={p.approx ? 'true' : undefined} />
            </g>
          )
        })}
        {!placed.length && <text className="y3-wheel-empty" x={C} y={C} textAnchor="middle" dominantBaseline="central">no papers</text>}
      </svg>
    </figure>
  )
}
