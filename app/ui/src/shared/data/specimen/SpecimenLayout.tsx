// SpecimenLayout (spec 20.5.1): the composition that replaces the bento grid. One specimen (a drawing or a hero number)
// sits recessed at the left, up to five callouts stand in the margin on 1 px leaders that bend once at 45 degrees, a datum
// line with a tick every 40 px runs through the middle, and a footer strip carries the telemetry rail and the one primary
// key. Below 900 px it reflows: the specimen first, the callouts a swipe carousel with a dot index, the datum a sticky rule.
//
// The numbers are all in layout.ts (pure); this file places boxes at them and draws the leaders from the same numbers,
// so the lines and the boxes they join cannot disagree. No timer, no animation loop: the one observer reports a width
// when the container resizes, and every state change (a hot leader, the carousel index) is a user's action.
import { useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import { SigilFrame } from '../../grammar'
import { Lamp, showsNumber, type LampState } from '../../lamp'
import {
  DESIGN_W, TICK, defaultAnchors, leadersFor, specimenGeometry, calloutCount, type AnchorFrac, type Box,
} from './layout'
import './specimen.css'

export interface SpecimenLayoutProps {
  /** The one specimen: a drawing or a hero number. It fills a recessed box and is the only object wider than 40 percent. */
  specimen: ReactNode
  /** Up to five callout plates; more are dropped (the margin column holds five). */
  callouts?: ReactNode[]
  /** The footer strip: a telemetry rail of three readouts and the single primary key. */
  footer?: ReactNode
  /** Where each leader starts on the specimen, as fractions of its box (default: spread down the right side). */
  anchors?: AnchorFrac[]
  /** The accessible name of the whole composition. */
  label?: string
  /** A fixed container width in px, for tests and the gallery; by default the width is measured. */
  width?: number
}

const boxStyle = (b: Box): CSSProperties => ({ left: b.x, top: b.y, width: b.w, height: b.h })

function useWidth(fixed: number | undefined) {
  const ref = useRef<HTMLElement | null>(null)
  const [w, setW] = useState<number>(fixed ?? DESIGN_W)
  useEffect(() => {
    if (fixed !== undefined) { setW(fixed); return }
    const el = ref.current
    if (!el) return
    const read = () => { const r = el.getBoundingClientRect().width; if (r > 0) setW(Math.round(r)) }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fixed])
  return { ref, width: fixed ?? w }
}

function Datum({ g }: { g: ReturnType<typeof specimenGeometry> }) {
  const ticks = useMemo(() => {
    let d = ''
    for (let x = 0; x <= g.width; x += TICK) d += `M${x} ${g.datumY - 4}v8`
    return d
  }, [g.width, g.datumY])
  return (
    <>
      <path className="sp-datum-line" d={`M0 ${g.datumY}H${g.width}`} />
      <path className="sp-datum-ticks" d={ticks} />
    </>
  )
}

export function SpecimenLayout({ specimen, callouts = [], footer, anchors, label = 'Specimen', width }: SpecimenLayoutProps) {
  const { ref, width: w } = useWidth(width)
  const items = callouts.slice(0, calloutCount(callouts.length))
  const g = useMemo(() => specimenGeometry(w, items.length), [w, items.length])
  const fr = useMemo(() => anchors ?? defaultAnchors(items.length), [anchors, items.length])
  const leaders = useMemo(() => leadersFor(g, fr), [g, fr])
  const [hot, setHot] = useState<number | null>(null)
  const [at, setAt] = useState(0)
  const track = useRef<HTMLDivElement | null>(null)

  if (g.mode === 'reflow') {
    const goTo = (i: number) => {
      const el = track.current
      const card = el?.children[i] as HTMLElement | undefined
      if (!el || !card) return
      const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
      el.scrollTo({ left: card.offsetLeft - el.offsetLeft, behavior: calm ? 'auto' : 'smooth' })
      setAt(i)
    }
    return (
      <section ref={ref} className="sp" data-component="specimen-layout" data-state="reflow" aria-label={label}>
        <div className="sp-rule" aria-hidden="true" />
        <div className="sp-specimen" data-object="specimen" style={{ height: g.specimen.h }}>{specimen}</div>
        {items.length > 0 && (
          <div className="sp-carousel" role="group" aria-roledescription="carousel" aria-label={`${label} callouts`}>
            <div
              ref={track}
              className="sp-track"
              tabIndex={0}
              role="region"
              aria-label="Callouts, swipe or use the arrow keys"
              onScroll={(e) => {
                const el = e.currentTarget
                const first = el.children[0] as HTMLElement | undefined
                const pitch = first ? first.getBoundingClientRect().width + 12 : 1
                setAt(Math.max(0, Math.min(items.length - 1, Math.round(el.scrollLeft / pitch))))
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') { e.preventDefault(); goTo(Math.min(items.length - 1, at + 1)) }
                else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(Math.max(0, at - 1)) }
              }}
            >
              {items.map((c, i) => <div key={i} className="sp-card" data-at={i === at ? 'true' : undefined}>{c}</div>)}
            </div>
            <div className="sp-dots">
              {items.map((_, i) => (
                <button key={i} type="button" className="sp-dot" aria-label={`Callout ${i + 1} of ${items.length}`} aria-current={i === at ? 'true' : undefined} onClick={() => goTo(i)}>
                  <span aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        )}
        {footer && <footer className="sp-footer">{footer}</footer>}
      </section>
    )
  }

  return (
    <section ref={ref} className="sp" data-component="specimen-layout" data-state="desktop" aria-label={label} style={{ height: g.height, width: width ?? undefined, maxWidth: width === undefined ? undefined : 'none', flex: width === undefined ? undefined : '0 0 auto' }}>
      <svg className="sp-svg" width={g.width} height={g.height} viewBox={`0 0 ${g.width} ${g.height}`} aria-hidden="true" focusable="false">
        <Datum g={g} />
        {leaders.map((l, i) => (
          <g key={i} className="sp-leader" data-hot={hot === i ? 'true' : undefined}>
            <path d={l.d} />
            <circle cx={l.from.x} cy={l.from.y} r={hot === i ? 4 : 3} />
          </g>
        ))}
      </svg>
      <div className="sp-specimen" data-object="specimen" style={boxStyle(g.specimen)}>{specimen}</div>
      <ol className="sp-callouts">
        {items.map((c, i) => (
          <li
            key={i}
            className="sp-callout"
            style={boxStyle(g.callouts[i])}
            onMouseEnter={() => setHot(i)}
            onMouseLeave={() => setHot((h) => (h === i ? null : h))}
            onFocus={() => setHot(i)}
            onBlur={() => setHot((h) => (h === i ? null : h))}
          >
            {c}
          </li>
        ))}
      </ol>
      {footer && <footer className="sp-footer" style={boxStyle(g.footer)}>{footer}</footer>}
    </section>
  )
}

export interface CalloutPlateProps {
  label: string
  /** The number or phrase; a number is drawn only when `state` allows one, else the plate says why in `reason`. */
  value: string | number | null
  state: LampState
  reason?: string
  /** A mono line under the value (the unit, the window, the source). */
  note?: string
}

/** The flat plate that stands in the margin: mono caps label, one value, the lamp. 88 px high, bracketed corners. */
export function CalloutPlate({ label, value, state, reason, note }: CalloutPlateProps) {
  const shown = showsNumber(state) && value !== null && value !== ''
  return (
    <SigilFrame sides={[]} planned={state === 'planned'} className="sp-plate">
      <div className="sp-plate-in" data-state={state} tabIndex={0} role="group" aria-label={`${label}: ${shown ? value : (reason ?? 'no value')}, ${state}`}>
        <span className="sp-plate-label">{label}</span>
        <span className="sp-plate-value" data-hollow={shown ? undefined : 'true'}>{shown ? value : '– –'}</span>
        <span className="sp-plate-note">{shown ? note : reason ?? 'no report'}</span>
        <span className="sp-plate-lamp"><Lamp reading={{ state, since: null, reason: reason ?? '' }} showLabel={false} /></span>
      </div>
    </SigilFrame>
  )
}
