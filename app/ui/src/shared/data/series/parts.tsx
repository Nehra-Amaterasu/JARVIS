// The instrument housing the three series forms share: a raised clay plate with a lit ridge, a mono label and the
// lamp (glyph plus word, never colour alone), a charcoal screen well with HUD brackets, and a table fold so every
// drawing has a text twin. Nothing here runs at idle: the width comes from a ResizeObserver (only on a resize), and
// the one-shot draw comes from an IntersectionObserver that disconnects after the first sighting.
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react'
import { LAMP_SPECS, LampGlyph, showsNumber, type LampState } from '../../lamp'
import { isReducedMotion } from '../../motion/useReducedMotion'
import './series.css'

/** The words a hollow form says when the caller gave no reason (spec: WAITING, PLANNED and FAULT say why). */
export const HOLLOW_REASON: Record<LampState, string> = {
  live: '',
  simulated: '',
  waiting: 'no report yet: the series starts with the first value',
  planned: 'not built: no code path produces this series',
  fault: 'the source reported an error',
}

/** True when this state must not draw a number. */
export const isHollow = (s: LampState) => !showsNumber(s)

export function StateLamp({ state, reason }: { state: LampState; reason?: string }) {
  const spec = LAMP_SPECS[state]
  const why = reason || (isHollow(state) ? HOLLOW_REASON[state] : state === 'simulated' ? 'generated, not measured' : '')
  return (
    <span className="sr-lamp" data-lamp={state} style={{ ['--sr-lamp' as string]: `var(${spec.token})` } as CSSProperties}>
      <LampGlyph state={state} size={12} />
      <span className="sr-lamp-word">{spec.label}</span>
      {why && <span className="sr-lamp-why">{why}</span>}
    </span>
  )
}

export interface HousingProps {
  component: 'Trace' | 'DotHistogram' | 'SkyLedger'
  state: LampState
  label: string
  reason?: string
  /** The readout row under the label (big numerals, the median line, the sparkline twin). */
  readout?: ReactNode
  children: ReactNode
  /** Under the screen: the legend or the ruler words. */
  foot?: ReactNode
  table?: ReactNode
}

export function Housing({ component, state, label, reason, readout, children, foot, table }: HousingProps) {
  const id = useId()
  return (
    <figure className="sr-inst" aria-labelledby={id} data-component={component} data-state={state} data-hollow={isHollow(state) ? 'true' : 'false'}>
      <div className="sr-head">
        <span className="sr-title">
          <span className="sr-serial" aria-hidden="true">{SERIAL[component]}</span>
          <span className="sr-label" id={id}>{label}</span>
        </span>
        <StateLamp state={state} reason={reason} />
      </div>
      {readout && <div className="sr-readout">{readout}</div>}
      {children}
      {foot && <div className="sr-foot">{foot}</div>}
      {table}
    </figure>
  )
}

/**
 * The charcoal screen in either theme (the immersive scene remaps the roles), seated in a recessed clay bezel and
 * framed by four HUD brackets. `tag` is the mono plate in the top left corner (what the screen shows and over how
 * long, C04-18), `status` the plate in the top right (the lamp word); both are text, never a number without a lamp.
 */
export function Screen({ children, planned, height, draw, boxRef, tag, status }: {
  children: ReactNode; planned?: boolean; height: number; draw?: string; boxRef?: Ref<HTMLDivElement>; tag?: string; status?: ReactNode
}) {
  return (
    <div className="sr-bezel" data-planned={planned ? 'true' : 'false'}>
      <div ref={boxRef} className="sr-screen" data-scene="immersive" data-planned={planned ? 'true' : 'false'} data-draw={draw} style={{ blockSize: `${height}px` }}>
        <span className="sr-scan" aria-hidden="true" />
        {(['tl', 'tr', 'bl', 'br'] as const).map((c) => <span key={c} className="sr-corner" data-c={c} aria-hidden="true" />)}
        {tag && <span className="sr-tag" data-at="tl" aria-hidden="true">{tag}</span>}
        {status && <span className="sr-tag" data-at="tr" aria-hidden="true">{status}</span>}
        {children}
      </div>
    </div>
  )
}

/** The module plate before a label: a short serial in a recessed pill ("TRC", "HST", "SKY"), the C02-33 index. */
export const SERIAL: Record<HousingProps['component'], string> = { Trace: 'TRC', DotHistogram: 'HST', SkyLedger: 'SKY' }

/** The measured content width of an element; `fallback` until it is measured (and in a test DOM without layout). */
export function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => {
      const cw = Math.round(el.clientWidth)
      if (cw > 0) setW((old) => (Math.abs(old - cw) >= 1 ? cw : old))
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/**
 * The one-shot draw: 'pending' (line hidden) from mount until the element is first a quarter in view, then 'in' (the
 * CSS plays the 320 ms draw once), then 'done' on animationend. Calm, the OS reduce flag, a hidden page or a browser
 * without IntersectionObserver go straight to 'done', so the static form is the drawn line.
 */
export function useDrawOnce(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<'pending' | 'in' | 'done'>(() =>
    enabled && typeof IntersectionObserver !== 'undefined' && !isReducedMotion() && !(typeof document !== 'undefined' && document.hidden) ? 'pending' : 'done',
  )
  useEffect(() => {
    if (phase !== 'pending') return
    const el = ref.current
    if (!el) { setPhase('done'); return }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect()
        setPhase(document.hidden || isReducedMotion() ? 'done' : 'in')
      }
    }, { threshold: 0.25 })
    io.observe(el)
    return () => io.disconnect()
  }, [phase])
  return { ref, phase, done: () => setPhase('done') }
}

/**
 * The text twin: a native disclosure (keyboard and screen reader for free) whose table body is rendered only while it
 * is open, so a two-year series costs no DOM until someone asks for it.
 */
export function TableFold({ caption, head, rows, summary = 'Table' }: { caption: string; head: string[]; rows: () => (string | number)[][]; summary?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <details className="sr-fold" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="sr-fold-key">{summary}</summary>
      {open && (
        <div className="sr-fold-body">
          <table className="sr-table">
            <caption>{caption}</caption>
            <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
            <tbody>
              {rows().map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}</tr>)}
            </tbody>
          </table>
        </div>
      )}
    </details>
  )
}
