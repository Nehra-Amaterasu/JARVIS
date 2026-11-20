// GroveRing (T01, spec 20.8.1, scale 1): the ten trees as a ring of seeds round one readout. Choose which tree to grow next without a
// dashboard of numbers: a seed is a 96 px clay disc with an ASCII mark (Well Wisher speaks ASCII) and a 3 px progress arc. A tree with
// no counted evidence is a dashed seed, and the centre says WAITING with the reason; the numbers appear only when the ledger's state
// may show one (LIVE or SIMULATED). The ring is one composite: arrows move round it, Home and End jump, a letter jumps to a name.
import { useRef, useState, type KeyboardEvent } from 'react'
import { showsNumber, type LampState } from '../../shared/lamp'
import { LampWord } from '../left/LampWord'
import type { TreeSummary } from './model'

export interface GroveRingProps {
  trees: TreeSummary[]
  onOpen: (id: string) => void
  /** The ledger's state and reason: they decide whether any number is drawn. Default WAITING. */
  state?: LampState
  reason?: string
  /** Draw the arcs in once (the first entry of the session). The reduced-motion form is the finished ring. */
  draw?: boolean
}

const RX = 270
const RY = 190
const ARC_R = 52
const ARC_LEN = 2 * Math.PI * ARC_R

/** Two letters for the seed's ASCII mark: the initials of the first two words that carry meaning. */
export function monogram(name: string): string {
  const w = name.split(/\s+/).filter((x) => !/^(and|of|the)$/i.test(x))
  return ((w[0]?.[0] ?? '') + (w[1]?.[0] ?? w[0]?.[1] ?? '')).toUpperCase()
}

export function GroveRing({ trees, onOpen, state = 'waiting', reason = 'No evidence store is connected yet, so nothing is counted.', draw = false }: GroveRingProps) {
  const counted = showsNumber(state) && trees.every((t) => t.evidenced !== null)
  const total = counted ? trees.reduce((s, t) => s + (t.evidenced ?? 0), 0) : null
  const [pointed, setPointed] = useState<string | null>(null)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const [rove, setRove] = useState(0)
  const focusAt = (i: number) => {
    const n = ((i % trees.length) + trees.length) % trees.length
    setRove(n)
    refs.current[n]?.focus({ preventScroll: true })
  }
  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') focusAt(i + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') focusAt(i - 1)
    else if (e.key === 'Home') focusAt(0)
    else if (e.key === 'End') focusAt(trees.length - 1)
    else if (e.key.length === 1 && /[a-z]/i.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const k = e.key.toLowerCase()
      const n = trees.length
      for (let s = 1; s <= n; s++) if (trees[(i + s) % n].name.toLowerCase().startsWith(k)) { focusAt(i + s); break }
    } else return
    e.preventDefault()
  }
  const focused = trees.find((t) => t.id === pointed) ?? null
  const callout = focused
    ? `${focused.name}: ${focused.branches} branches, ${focused.nodes} nodes written. ${counted && focused.evidenced !== null ? `${focused.evidenced} evidenced${focused.last ? `, last record ${focused.last}` : ', no record yet'}.` : 'Evidence not counted yet.'}`
    : counted ? 'Point at a seed to read its tree.' : 'Seeds are dashed until evidence is counted.'
  return (
    <div className="gr" data-lamp={state} data-draw={draw ? 'true' : undefined}>
      <div className="gr-centre" aria-live="off">
        <LampWord state={state} />
        <span className="gr-total" data-hollow={total === null ? 'true' : undefined} aria-label={total === null ? 'not counted' : `${total} nodes evidenced`}>{total === null ? '– –' : total}</span>
        <span className="gr-total-cap">nodes evidenced</span>
        <span className="gr-why">{total === null ? reason : 'Counted from the evidence ledger.'}</span>
        <span className="gr-callout">{callout}</span>
      </div>
      <div role="group" aria-label="The ten trees. Arrow keys move round the ring, Enter opens a tree, a letter jumps to a name." className="gr-seeds">
        {trees.map((t, i) => {
          const a = ((-90 + (360 / trees.length) * i) * Math.PI) / 180
          const x = Math.round(RX * Math.cos(a))
          const y = Math.round(RY * Math.sin(a))
          const frac = counted && t.evidenced !== null && t.nodes > 0 ? t.evidenced / t.nodes : 0
          return (
            <button
              key={t.id} type="button" ref={(el) => { refs.current[i] = el }}
              className="gr-seed tree-node" data-tree={t.id} data-side={x === 0 ? (y < 0 ? 'top' : 'bottom') : x < 0 ? 'left' : 'right'} data-dashed={counted ? undefined : 'true'}
              style={{ '--x': `${x}px`, '--y': `${y}px`, '--i': i, animationDelay: draw ? `${i * 40}ms` : undefined } as React.CSSProperties}
              tabIndex={i === rove ? 0 : -1}
              aria-label={`${t.name}, ${t.branches} branches, ${counted && t.evidenced !== null ? `${t.evidenced} of ${t.nodes} nodes evidenced` : 'evidence not counted'}`}
              onClick={() => onOpen(t.id)} onKeyDown={(e) => onKey(e, i)}
              onPointerEnter={() => setPointed(t.id)} onPointerLeave={() => setPointed((p) => (p === t.id ? null : p))}
              onFocus={() => { setRove(i); setPointed(t.id) }} onBlur={() => setPointed((p) => (p === t.id ? null : p))}
            >
              <svg className="gr-arc" viewBox="-56 -56 112 112" width="112" height="112" aria-hidden="true">
                <circle className="gr-track" r={ARC_R} />
                <circle className="gr-fill" r={ARC_R} transform="rotate(-90)" strokeDasharray={counted ? `${ARC_LEN * frac} ${ARC_LEN}` : undefined} data-draw-in={draw ? 'true' : undefined} />
              </svg>
              <span className="gr-mark" aria-hidden="true">[{monogram(t.name)}]</span>
              <span className="gr-name">{t.name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
