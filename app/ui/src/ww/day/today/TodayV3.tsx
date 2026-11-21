// Today under the v3 look (design-language-v3.md 4.1, 7): three trays in the order the owner acts.
//   1 START       the day's headline, the ONE accent key that starts a block, and the day arc with the minutes figure
//   2 FOLLOW-UPS  what is ahead (the next dated item, today's classes) and the counters
//   3 EVIDENCE    proof, the reminders and the minutes of the last seven days
// The capture line is the dock's Capture mode; Season and Roadmap, which lost their home with the old frame, are rows of More.
// Every piece is the existing one (callouts, DayArc, Odometer, DatumStrip, ProofStrip): this file only regroups them.
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Odometer } from '../../../shared/data/numbers'
import { Trace } from '../../../shared/data/series'
import { Button, Drawer } from '../../../shared/kit'
import type { Parsed } from '../../../shared/capture'
import { useStore } from '../../../lib/store'
import { PhonePeeks, useViewChrome, Zones, type ViewChromeSpec } from '../../../shell/v3'
import { openOverlay } from '../../frame/overlayRegistry'
import { useFrame } from '../../frame/frameStore'
import { SEASON_MODES, type SeasonMode } from '../../frame/season'
import { ProofStrip } from '../../proof/ProofStrip'
import { CAPTURE_MODE, takeLine } from '../v3/capture'
import '../v3/day-v3.css'
import { DayArc } from './DayArc'
import { TodayProvider, useToday, type TodayCtx } from './context'
import { arcHeightFor, DatumStrip, phoneDial } from './modes/day.mode'
import { CALLOUTS } from './registry'
import { LampWord } from './Plate'

const SEASON_LABEL: Record<SeasonMode, string> = { auto: 'Auto', exams: 'Exams', normal: 'Normal' }
/** Under this width the arc takes the phone's half-dial form (it is the tray's width, not the window's: tray 1 is about 430 px at 1120). */
const COMPACT_BELOW = 340

/** Width and height of a box, read from its own offset size (CSS px, so a zoomed ancestor does not change the answer). */
function useSize(): { ref: RefObject<HTMLDivElement | null>; w: number; h: number } {
  const ref = useRef<HTMLDivElement>(null)
  const [s, setS] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => setS((b) => (b.w === el.offsetWidth && b.h === el.offsetHeight ? b : { w: el.offsetWidth, h: el.offsetHeight }))
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, w: s.w, h: s.h }
}

function Callout({ id }: { id: string }) {
  const c = CALLOUTS.list.find((x) => x.id === id)
  return c ? <c.Callout /> : null
}

function Dial() {
  const { model, raw } = useToday()
  const { ref, w, h } = useSize()
  const [trace, setTrace] = useState(false)
  const hero = (
    <Odometer value={model.minutes ?? 0} unit="min today" state={model.minutesState} size="compact" reason={model.minutesReason} lamp={false}
      onOpen={model.weekState === 'waiting' ? undefined : () => setTrace(true)} />
  )
  const points = model.week.map((d) => ({ t: new Date(`${d.date}T12:00:00`).getTime(), v: d.minutes }))
  let arc: ReactNode = null
  if (w > 0) {
    if (w < COMPACT_BELOW) {
      const dial = phoneDial(Math.max(240, Math.min(w, 420)))
      arc = (
        <>
          <DayArc blocks={model.classes} planned={model.planned} done={model.done} now={raw.now} state={model.state} width={dial.w} height={dial.h} dashed={model.noClasses} compact />
          <div className="td-hero-phone">{hero}</div>
        </>
      )
    } else {
      // never taller than the box the tray leaves it: the dial's own height for this width, cut to the room
      const ah = Math.max(150, Math.min(h || 9999, arcHeightFor(Math.round((h || 400) / 0.64), w)))
      arc = (
        <DayArc blocks={model.classes} planned={model.planned} done={model.done} now={raw.now} state={model.state} width={w - 8} height={ah} dashed={model.noClasses}>
          {hero}
        </DayArc>
      )
    }
  }
  return (
    <div className="tv3-dial" ref={ref} aria-label="Today, the day arc">
      {arc}
      <Drawer open={trace} onClose={() => setTrace(false)} title="Minutes, last 7 days" place="right">
        <Trace points={points} median={model.median ?? undefined} state={model.weekState} label="Minutes, last 7 days" unit="min" medianLabel="your median, 30 d" />
      </Drawer>
    </div>
  )
}

function Classes() {
  const { model, raw } = useToday()
  const read = raw.classes !== null
  const rows = [...model.classes].sort((a, b) => a.from.localeCompare(b.from))
  return (
    <section className="tv3-block" data-block="classes" aria-label="Classes today">
      <header className="tv3-bhead">
        <h3>Classes</h3>
        <LampWord state={read ? model.state : 'waiting'} />
      </header>
      {rows.length > 0 ? (
        <ol className="tv3-classes">
          {rows.map((b) => <li key={b.id}><span className="td-mono">{b.from}</span><span className="tv3-cname">{b.label}</span></li>)}
        </ol>
      ) : (
        <p className="td-quiet">{read ? 'No classes today, or no timetable yet.' : 'The timetable has not been read yet.'}</p>
      )}
    </section>
  )
}

function WeekStrip() {
  const { model } = useToday()
  const { ref, w } = useSize()
  return (
    <div className="tv3-week" ref={ref}>
      {w > 0 && <DatumStrip week={model.week} median={model.median} state={model.weekState} width={Math.max(180, Math.min(w, 520))} barH={typeof window !== 'undefined' && window.innerHeight < 760 ? 24 : 40} />}
    </div>
  )
}

export function TodayV3({ ctx, onCapture, children }: { ctx: TodayCtx; onCapture: (p: Parsed) => void; children?: ReactNode }) {
  const { model, actions } = ctx
  const seasonMode = useFrame((s) => s.seasonMode)
  const chrome = useMemo<ViewChromeSpec>(() => ({
    dock: {
      modes: [CAPTURE_MODE],
      onSubmit: (_mode, text) => takeLine(text, onCapture, (m) => useStore.getState().toast(m, 'info')),
    },
    more: [
      {
        id: 'season',
        label: `Season: ${SEASON_LABEL[seasonMode]}, change`,
        onSelect: () => useFrame.getState().setSeasonMode(SEASON_MODES[(SEASON_MODES.indexOf(seasonMode) + 1) % SEASON_MODES.length]),
      },
      { id: 'roadmap', label: 'Roadmap', onSelect: () => openOverlay('roadmap') },
    ],
  }), [onCapture, seasonMode])
  useViewChrome(chrome)

  const n = model.now
  const ahead = model.ahead
  const weekDrawn = model.weekState === 'live' || model.weekState === 'simulated'
  return (
    <TodayProvider value={ctx}>
      <Zones
        ratio={[1.85, 1.05, 0.95]}
        first={{
          job: 'START',
          chip: <LampWord state={n.state} />,
          children: (
            <div className="tv3 tv3-first">
              <div className="tv3-hero">
                <h3 className="tv3-line">{n.line}</h3>
                <p className="tv3-why">{n.reason}</p>
                <Button tone="primary" size="lg" className="tv3-start" data-primary="" aria-keyshortcuts="n" onClick={actions.startBlock}>{n.action}</Button>
              </div>
              <PhonePeeks />
              <Dial />
            </div>
          ),
        }}
        second={{
          job: 'FOLLOW-UPS',
          peek: { name: 'Follow-ups', lamp: ahead.state, note: ahead.days === null ? ahead.reason : `${ahead.days} ${ahead.days === 1 ? 'day' : 'days'} ahead` },
          children: (
            <div className="tv3 tv3-second">
              <Callout id="ahead" />
              <Classes />
              <Callout id="counters" />
              <Button grouped onClick={actions.openPlan} data-open="plan">Plan the day</Button>
            </div>
          ),
        }}
        third={{
          job: 'EVIDENCE',
          peek: { name: 'Evidence', lamp: model.weekState, note: weekDrawn ? undefined : 'block log not read yet' },
          children: (
            <div className="tv3 tv3-third">
              <div className="td-phone-rail"><ProofStrip /></div>
              <Callout id="reminders" />
              <WeekStrip />
            </div>
          ),
        }}
      />
      {children}
    </TodayProvider>
  )
}

export default TodayV3
