// Today's composition (spec 20.16.1, 21.5.1; D-V3-31): one canvas, no document scroll, no inner scrollbar.
//
//   desk (container >= 900 px)   left rail | specimen (the mode's drawing) + margin of callouts on leaders | Proof rail
//                                footer: the Capture Line and the Plan key
//   phone (< 900 px)             Now first, the spine, the other callouts, the footer, then both rails folded beneath;
//                                the page box scrolls (the document never does)
//
// The composition follows SpecimenLayout's grammar (datum, leaders that bend once at 45 degrees, plates on the margin) and
// uses its leader geometry, but places the boxes itself: SpecimenLayout is a fixed 1302 x 720 stage, and Today has two
// rails and a 664 px canvas under the shell's view row, so the stage would be cut (measured: 56 px too tall).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { leaderPath } from '../../../shared/data/specimen'
import { CaptureLine, type Parsed } from '../../../shared/capture'
import { Button, Fold, Segmented } from '../../../shared/kit'
import { RailFormProvider } from '../../left/railForm'
import { SpecimenBoxProvider, TodayProvider, type TodayCtx } from './context'
import { arcFrac, arcGeometry, arcPoint, minOfDate, type Pt } from './model'
import { arcHeightFor, heroRight } from './modes/day.mode'
import { CALLOUTS, MAX_CALLOUTS, MODES } from './registry'
// the space roles (--space-1 to 7) live in the shared primitive sheet; the frame loads it through ww/design/base.css, and
// Today, which replaces the frame on its view, loads it itself
import '../../../styles/design/primitive.css'
import './today.css'

export const PHONE_BELOW = 900
export const RAIL_L = 248
/** The Proof rail is an instrument of the left rail's weight (a ring, three figures with their lamp words): 96 px, not the 64 px
 *  of five bare pins. */
export const RAIL_R = 96
const PAD = 16
const GAP = 16
/** The Capture Line (D04) is a 104 px terminal well with its hint row; the footer holds it whole. */
const FOOT = 108
const PLATE_GAP = 14
const SPEC_INSET = 12
/** The phone form is tighter: 12 px of page padding and 8 px inside the well (the 16 and 12 of the desk cost a 284 px page 16 px of width
 *  and made the dial's caption wrap). */
const PHONE_PAD = 12
const PHONE_INSET = 8
/** How tall each plate is, as a share of the margin, each weight its content's need at 1366 x 768 (Now: sentence and the 48 px accent
 *  key; Ahead: one numeral; Counters: one row of keys; Reminders: two hollow rows). Equal 116 px plates left Now's text touching its
 *  header and Reminders' rows overflowing (jury, 14 Nov). Unknown ids weigh 1. */
const WEIGHT: Record<string, number> = { now: 1.5, ahead: 1, counters: 1.06, reminders: 1.08 }

export interface TodayGeom {
  phone: boolean
  main: { w: number; h: number }
  spec: { x: number; y: number; w: number; h: number }
  margin: { x: number; w: number }
  plates: { y: number; h: number }[]
}

/** The boxes of the desk form for a container w x h with n callouts (pure, so the test checks 1366 x 768 without a DOM). */
export function todayGeometry(w: number, h: number, n: number, rails: { left: boolean; right: boolean }, ids: readonly string[] = []): TodayGeom {
  const phone = w < PHONE_BELOW
  // the phone form has no rails beside it and no clamp: the box is exactly what is left of the width after the page's padding
  // (the 320 px floor of the desk made a 286 px phone well draw 320 px of dial and strip, cut at both edges)
  const mw = phone ? Math.max(0, w - 2 * PHONE_PAD) : Math.max(320, w - 2 * PAD - (rails.left ? RAIL_L + GAP : 0) - (rails.right ? RAIL_R + GAP : 0))
  const mh = Math.max(420, h - 2 * PAD)
  const body = mh - FOOT - GAP
  const sw = Math.max(380, Math.min(640, Math.round(mw * 0.57)))
  const mx = sw + 44
  const k = Math.max(1, n)
  const wt = Array.from({ length: n }, (_, i) => WEIGHT[ids[i] ?? ''] ?? 1)
  const unit = (body - (k - 1) * PLATE_GAP) / Math.max(1, wt.reduce((a, b) => a + b, 0))
  const hs = wt.map((x) => Math.min(168, Math.floor(unit * x)))
  const used = hs.reduce((a, b) => a + b, 0) + (k - 1) * PLATE_GAP
  const top = Math.max(0, Math.round((body - used) / 2))
  let y = top
  const plates = hs.map((ph) => { const p = { y, h: ph }; y += ph + PLATE_GAP; return p })
  return { phone, main: { w: mw, h: mh }, spec: { x: 0, y: 0, w: sw, h: body }, margin: { x: mx, w: mw - mx }, plates }
}

/** Where each callout's leader starts on the specimen. Every leader leaves from the open side of its figure and runs where there is
 *  no text (the geometry test measures it against every text box of the specimen): the Now leader starts OUTSIDE the hour labels
 *  on the notch's own ray, Ahead on the class track's evening part between two hour labels, Counters on the right edge of the
 *  minutes figure at 24 px above the datum (between the 23:00 dot and the 24 label), Reminders at the strip's right margin;
 *  any later callout on the specimen's right edge at its own height. */
export function anchorsFor(ids: string[], g: TodayGeom, now: Date): Pt[] {
  const iw = g.spec.w - 2 * SPEC_INSET
  const ah = arcHeightFor(g.spec.h - 2 * SPEC_INSET, iw)
  const a = arcGeometry(iw, ah)
  const at = (p: Pt) => ({ x: Math.round(p.x + SPEC_INSET), y: Math.round(p.y + SPEC_INSET) })
  return ids.map((id, i) => {
    if (id === 'now') return at(arcPoint(a.cx, a.cy, a.labelR + 16, arcFrac(minOfDate(now))))
    if (id === 'ahead') return at(arcPoint(a.cx, a.cy, a.r.class, 0.85))
    if (id === 'counters') return at(heroRight(iw, ah))
    if (id === 'reminders') return at({ x: iw - 4, y: ah + Math.round((g.spec.h - 2 * SPEC_INSET - ah) * 0.62) })
    const p = g.plates[i]
    return { x: g.spec.w - 6, y: p ? p.y + Math.round(p.h / 2) : g.spec.h / 2 }
  })
}

function useBox(fixed?: { w: number; h: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState(fixed ?? { w: 1302, h: 664 })
  useEffect(() => {
    if (fixed) { setBox(fixed); return }
    const el = ref.current
    if (!el) return
    // offset sizes, not the bounding box: they are CSS px of the box itself, so a zoomed ancestor (the gallery draws the
    // 1302 px canvas at 0.74) does not change the layout the page picks
    const read = () => {
      const w = el.offsetWidth
      const h = el.offsetHeight
      if (w > 0) setBox((b) => (b.w === w && b.h === (h || b.h) ? b : { w, h: h || b.h }))
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fixed])
  return { ref, box }
}

export interface TodayViewProps {
  ctx: TodayCtx
  left?: ReactNode
  right?: ReactNode
  /** Fixed container size (gallery and tests); measured by default. */
  size?: { w: number; h: number }
  /** What the Capture Line's Enter does. */
  onCapture?: (p: Parsed) => void
  /** Drawn after everything (the plan drawer, the overlay host). */
  children?: ReactNode
}

export function TodayView({ ctx, left, right, size, onCapture, children }: TodayViewProps) {
  const { ref, box } = useBox(size)
  const modes = MODES.list
  const [modeId, setModeId] = useState(modes[0]?.id ?? 'day')
  const mode = modes.find((m) => m.id === modeId) ?? modes[0]
  const callouts = CALLOUTS.list.slice(0, MAX_CALLOUTS)
  const g = useMemo(() => todayGeometry(box.w, box.h, callouts.length, { left: !!left, right: !!right }, callouts.map((c) => c.id)), [box.w, box.h, callouts, left, right])
  const anchors = useMemo(() => anchorsFor(callouts.map((c) => c.id), g, ctx.raw.now), [callouts, g, ctx.raw.now])
  const [hot, setHot] = useState<number | null>(null)
  const startBlock = ctx.actions.startBlock

  // `n` starts a block (spec keys); never while typing, never with a modifier
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'n' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      e.preventDefault()
      startBlock()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [startBlock])

  const Specimen = mode?.Specimen
  const footer = (
    <footer className="td-foot">
      <div className="td-capture"><CaptureLine grammar="ww" label="Capture, for example: water 500 ml" onCommit={(p) => onCapture?.(p)} /></div>
      {modes.length > 1 && (
        <Segmented<string> label="Today modes" variant="compact" value={mode.id} onChange={setModeId} options={modes.map((m) => ({ id: m.id, label: m.label }))} />
      )}
      <Button size={g.phone ? 'sm' : 'md'} onClick={ctx.actions.openPlan} data-open="plan">Plan the day</Button>
    </footer>
  )

  if (g.phone) {
    const now = callouts.find((c) => c.id === 'now')
    const reminders = callouts.find((c) => c.id === 'reminders')
    const rest = callouts.filter((c) => c.id !== 'now' && c.id !== 'reminders')
    // one column, about 1,400 px: Now first, the dial with its figures, Ahead and Counters, then the Capture Line; what is not
    // needed at once (Reminders, the whole left rail) is behind one key each, and the Proof rail is one short instrument
    return (
      <TodayProvider value={ctx}>
        <div ref={ref} className="td" data-form="phone" data-simulated={ctx.raw.simulated ? 'true' : undefined} data-first-run={ctx.model.firstRun ? 'true' : undefined}>
          {now && <div className="td-phone-now"><now.Callout /></div>}
          <section className="td-spec" aria-label="Today, the day arc">
            <SpecimenBoxProvider value={{ w: g.main.w - 2 * PHONE_INSET, h: 0, phone: true }}>{Specimen && <Specimen />}</SpecimenBoxProvider>
          </section>
          <div className="td-phone-cards">{rest.map((c) => <c.Callout key={c.id} />)}</div>
          {reminders && <Fold title="Reminders"><div className="td-phone-cards"><reminders.Callout /></div></Fold>}
          {footer}
          {left && <div className="td-phone-rail" data-rail="left"><RailFormProvider value="row">{left}</RailFormProvider></div>}
          {right && <div className="td-phone-rail" data-rail="right">{right}</div>}
          {children}
        </div>
      </TodayProvider>
    )
  }

  const bodyH = g.spec.h
  return (
    <TodayProvider value={ctx}>
      <div ref={ref} className="td" data-form="desk" data-simulated={ctx.raw.simulated ? 'true' : undefined} data-first-run={ctx.model.firstRun ? 'true' : undefined}
        style={{ gridTemplateColumns: [left && `${RAIL_L}px`, 'minmax(0, 1fr)', right && `${RAIL_R}px`].filter(Boolean).join(' ') }}>
        {left && <div className="td-rail" data-rail="left">{left}</div>}
        <div className="td-main">
          <div className="td-body" style={{ height: bodyH }}>
            <svg className="td-leaders" width={g.main.w} height={bodyH} aria-hidden="true" focusable="false">
              {callouts.map((c, i) => {
                const p = g.plates[i]
                const from = anchors[i]
                // the leader ends on the plate's edge at the height nearest its start (clear of the corner radius), so it runs level
                // for most of its length and its one 45 degree bend is short: a long diagonal cut across the dial's labels
                const to = { x: g.margin.x, y: Math.max(p.y + 18, Math.min(p.y + p.h - 18, from.y)) }
                return (
                  <g key={c.id} className="td-leader" data-hot={hot === i ? 'true' : undefined}>
                    <path d={leaderPath(from, to)} />
                    <circle cx={from.x} cy={from.y} r={hot === i ? 4 : 3} />
                  </g>
                )
              })}
            </svg>
            <section className="td-spec" aria-label="Today, the day arc" style={{ width: g.spec.w, height: bodyH }}>
              <SpecimenBoxProvider value={{ w: g.spec.w - 2 * SPEC_INSET, h: bodyH - 2 * SPEC_INSET, phone: false }}>{Specimen && <Specimen />}</SpecimenBoxProvider>
            </section>
            <ol className="td-margin" style={{ left: g.margin.x, width: g.margin.w }}>
              {callouts.map((c, i) => (
                <li key={c.id} style={{ top: g.plates[i].y, height: g.plates[i].h }}
                  onMouseEnter={() => setHot(i)} onMouseLeave={() => setHot((x) => (x === i ? null : x))}
                  onFocus={() => setHot(i)} onBlur={() => setHot((x) => (x === i ? null : x))}>
                  <c.Callout />
                </li>
              ))}
            </ol>
          </div>
          {footer}
        </div>
        {right && <div className="td-rail" data-rail="right">{right}</div>}
        {children}
      </div>
    </TodayProvider>
  )
}
