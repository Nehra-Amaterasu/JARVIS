/**
 * The left rail under shell v2 (D-V3-31): the same four cards' data and actions (L1 to L5), drawn as ONE instrument of the
 * clay instead of a stack of bordered boxes. A recessed channel with corner ticks; inside it the data are forms:
 *
 *   Next sitting   the days to it as a numeral, every dated sitting as a dot on a notch scale (one notch a week)
 *   Now            the director's one step, Start, and the minute keys (left out on Today, whose Now callout owns it)
 *   Classes        each class a name, a time and three raised keys P A C (a pressed key sinks)
 *   Counters       raised keys, one press adds one, Undo (left out on Today, whose Counters callout owns it)
 *   Phone          one quiet line with a lamp
 *
 * Sans for labels, mono only for numbers. Nothing scrolls inside it: what does not fit is counted ("+2 later") and one key
 * opens it. Same store, same model (model.ts) and the same taps as the classic cards, so the two never disagree.
 */
import { createContext, memo, useContext, useLayoutEffect, useRef, useState } from 'react'
import { CalendarDays, ChevronRight, Undo2 } from 'lucide-react'
import { Button, IconButton, PrimaryButton } from '../kit'
import { LampGlyph, type LampState } from '../../shared/lamp'
import { openOverlay } from '../frame/overlayRegistry'
import { useDay, useHorizon, useSeason } from './hooks'
import { useLogMinutes } from './L2'
import { buildL1, buildL2, buildL3, buildL4, classLabel, upcoming, type ClassStatus, type RawPaper } from './model'
import { useLeft, type LeftData } from './store'
import './rail.css'

export type RailPart = 'now' | 'counters'

export interface LeftRailProps {
  /** Parts another surface already shows (Today draws Now and Counters as callouts). */
  omit?: RailPart[]
  /** Go to a place of the shell. */
  go: (section: string, view: string) => void
  /** The rows are fixtures (the gallery): every lamp that would say LIVE says SIMULATED. */
  simulated?: boolean
  /** Gallery rows (implies simulated); taps then change nothing. */
  fixture?: RailFixture
  /** The date the head shows (the gallery's fixed clock); default: now. */
  today?: Date
}

const WHERE: Record<string, [string, string]> = { study: ['study', 'plan'], recall: ['study', 'practice'], habit: ['day', 'week'], build: ['focus', 'start'] }
const TAPS: { s: ClassStatus; letter: string }[] = [
  { s: 'present', letter: 'P' },
  { s: 'absent', letter: 'A' },
  { s: 'cancelled', letter: 'C' },
]
/** The notch scale spans eight weeks; a sitting further out is counted at the right end, not drawn off the scale. */
export const SCALE_DAYS = 56

const lampOf = (phase: string, has: boolean): LampState => (has ? 'live' : phase === 'error' ? 'fault' : 'waiting')
/** Fixture rows (the gallery) draw every LIVE as SIMULATED: nothing invented is shown as measured. */
const SimCtx = createContext(false)
const useLamp = (s: LampState): LampState => (useContext(SimCtx) && s === 'live' ? 'simulated' : s)

/** Fixture rows for the gallery: the rail reads these instead of the store, so showing it never writes the real store. */
export type RailFixture = Pick<LeftData, 'papers' | 'now' | 'classes' | 'counters' | 'paired' | 'lastCount'> & { leftTop: 'countdown' | 'horizon' }
const FixCtx = createContext<RailFixture | null>(null)
const OK = { exams: 'ok', director: 'ok', attendance: 'ok', life: 'ok', remote: 'ok' } as const
function useRail<T>(sel: (s: Pick<LeftData, 'papers' | 'now' | 'classes' | 'counters' | 'paired' | 'lastCount' | 'phase'>) => T): T {
  const fx = useContext(FixCtx)
  const live = useLeft(sel)
  return fx ? sel({ ...fx, phase: OK }) : live
}
function useRailSeason() {
  const fx = useContext(FixCtx)
  const s = useSeason()
  return fx ? { ...s, left_top: fx.leftTop } : s
}

function Label({ text, state, why }: { text: string; state: LampState; why?: string }) {
  return (
    <h3 className="lr-label">
      <LampGlyph state={state} size={10} />
      <span>{text}</span>
      {why && <span className="lr-why">{why}</span>}
    </h3>
  )
}

/** Dots on a line: one per dated sitting within eight weeks, the nearest filled; a notch every seven days. */
export function NotchScale({ papers }: { papers: RawPaper[] }) {
  const w = 208
  const x = (d: number) => Math.round(6 + (Math.min(SCALE_DAYS, Math.max(0, d)) / SCALE_DAYS) * (w - 12))
  const near = papers.filter((p) => (p.days_left ?? -1) >= 0 && (p.days_left as number) <= SCALE_DAYS)
  const far = papers.filter((p) => (p.days_left ?? -1) > SCALE_DAYS).length
  return (
    <svg className="lr-scale" width="100%" height={30} viewBox={`0 0 ${w} 30`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path className="lr-scale-line" d={`M6 18H${w - 6}`} />
      {Array.from({ length: SCALE_DAYS / 7 + 1 }, (_, i) => <path key={i} className="lr-scale-notch" d={`M${x(i * 7)} ${i % 4 === 0 ? 11 : 14}V22`} />)}
      {near.map((p, i) => <circle key={p.id} className="lr-scale-dot" data-first={i === 0 ? 'true' : undefined} cx={x(p.days_left as number)} cy={18} r={i === 0 ? 5 : 3.5} />)}
      {far > 0 && <path className="lr-scale-far" d={`M${w - 10} 13l5 5-5 5`} />}
    </svg>
  )
}

const Sitting = memo(function Sitting() {
  const season = useRailSeason()
  const papers = useRail((s) => s.papers)
  const phase = useRail((s) => s.phase.exams)
  const horizon = useHorizon()
  const m = buildL1({ season: { left_top: season.left_top, now_card: 'now' }, papers, horizon })
  const list = upcoming(papers)
  const first = list[0]
  const state = m.variant === 'countdown' ? lampOf(phase, papers !== null) : horizon ? 'live' : 'waiting'
  const days = m.variant === 'countdown' ? first?.days_left ?? null : horizon?.deadline?.days_left ?? null
  const lamp = useLamp(state)
  const shown = (lamp === 'live' || lamp === 'simulated') && days !== null
  return (
    <section className="lr-sec" data-part="sitting" aria-label={m.title}>
      <Label text={m.variant === 'countdown' ? 'Next sitting' : 'Next application'} state={lamp} why={m.tentative ? 'dates tentative' : undefined} />
      <div className="lr-sitting">
        <p className="lr-big" data-hollow={shown ? undefined : 'true'}>
          <span className="lr-num">{shown ? days : '– –'}</span>
          <small>{shown && days === 1 ? 'day' : 'days'}</small>
        </p>
        {m.variant === 'countdown' && (
          <IconButton label="Edit the date sheet" size="sm" onClick={() => openOverlay('date')}><CalendarDays size={16} aria-hidden="true" /></IconButton>
        )}
      </div>
      <p className="lr-text">{m.variant === 'countdown' ? (first ? first.title : m.headline) : m.headline}</p>
      {m.variant === 'countdown' && list.length > 0 && (
        <>
          <NotchScale papers={list} />
          {m.counts && <p className="lr-meta"><span>CIE</span> {m.counts.cie}<span>End</span> {m.counts.end}<span>Other</span> {m.counts.other}</p>}
        </>
      )}
      {m.variant === 'horizon' && m.step && <p className="lr-meta-line">First step: {m.step}</p>}
    </section>
  )
})

const NowPart = memo(function NowPart({ go }: { go: LeftRailProps['go'] }) {
  const season = useSeason()
  const now = useRail((s) => s.now)
  const phase = useRail((s) => s.phase.director)
  const day = useDay()
  const m = buildL2({ season: { left_top: 'horizon', now_card: season.now_card }, now, day })
  const log = useLogMinutes(now)
  const close = m.variant === 'close'
  const state = useLamp(close ? 'live' : lampOf(phase, now !== null))
  return (
    <section className="lr-sec" data-part="now" aria-label={m.title}>
      <Label text={m.title} state={state} />
      <p className="lr-text lr-strong">{m.sentence}</p>
      {m.logged && <p className="lr-meta-line" aria-live="polite">{m.logged}</p>}
      <div className="lr-row">
        {close ? (
          <PrimaryButton claimId="now-start" rank="now" onClick={() => go('study', 'plan')}>See tomorrow</PrimaryButton>
        ) : m.kind ? (
          <PrimaryButton claimId="now-start" rank="now" onClick={() => { const [s, v] = WHERE[m.kind as string] ?? ['focus', 'start']; go(s, v) }}>Start</PrimaryButton>
        ) : null}
      </div>
      {!close && (
        <div className="lr-keys" role="group" aria-label="Log minutes">
          {m.presets.map((p) => (
            <button key={p} type="button" className="lr-key" aria-label={`Log ${p} minutes`} onClick={() => void log(p)}><span className="lr-num">+{p}</span></button>
          ))}
          <button type="button" className="lr-key" onClick={() => openOverlay('log')}>Other</button>
        </div>
      )}
    </section>
  )
})

const ClassesPart = memo(function ClassesPart({ rows: budget, go }: { rows: number; go: LeftRailProps['go'] }) {
  const classes = useRail((s) => s.classes)
  const phase = useRail((s) => s.phase.attendance)
  const m = buildL3({ classes })
  const shown = m.rows.slice(0, budget)
  const later = m.rows.length - shown.length
  const tapped = m.rows.filter((r) => r.status !== null).length
  const state = useLamp(lampOf(phase, classes !== null))
  return (
    <section className="lr-sec" data-part="classes" aria-label="Classes today">
      <Label text="Classes" state={state} why={m.rows.length ? `${tapped} of ${m.rows.length} marked` : undefined} />
      {m.empty ? (
        <p className="lr-text lr-quiet">{classes === null ? (phase === 'error' ? 'Could not read the classes.' : 'Reading the classes…') : m.empty}</p>
      ) : (
        <ul className="lr-classes" aria-label="Today's classes">
          {shown.map((r) => (
            <li key={r.id} className="lr-class" data-status={r.status ?? undefined}>
              <p className="lr-class-name"><span className="lr-num">{r.when}</span> {r.name}{r.lab && <em> lab</em>}</p>
              <span className="lr-trio" role="group" aria-label={`${r.name} at ${r.when}`}>
                {TAPS.map((t) => (
                  <button key={t.s} type="button" className="lr-key lr-tap" aria-pressed={r.status === t.s} aria-label={classLabel(r, t.s)}
                    onClick={() => void useLeft.getState().tapClass(r.id, r.status === t.s ? 'clear' : t.s)}>
                    {t.letter}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
      {later > 0 && (
        <button type="button" className="lr-more" onClick={() => go('day', 'week')}>+{later} later today<ChevronRight size={14} aria-hidden="true" /></button>
      )}
    </section>
  )
})

const CountersPart = memo(function CountersPart({ tiles, go }: { tiles: number; go: LeftRailProps['go'] }) {
  const counters = useRail((s) => s.counters)
  const phase = useRail((s) => s.phase.life)
  const last = useRail((s) => s.lastCount)
  const m = buildL4({ counters })
  // when not every counter fits, the last key of the grid is "+N" (it opens Day / Week), so the part never grows a row
  const fits = m.tiles.length <= tiles
  const shown = m.tiles.slice(0, fits ? tiles : tiles - 1)
  const more = m.tiles.length - shown.length
  const state = useLamp(lampOf(phase, counters !== null))
  const lastName = m.tiles.find((t) => t.id === last)?.name
  return (
    <section className="lr-sec" data-part="counters" aria-label="Counters">
      <div className="lr-label-row">
        <Label text="Counters" state={state} />
        {last && lastName && (
          <IconButton label={`Undo the last tap on ${lastName}`} size="sm" onClick={() => void useLeft.getState().tapCount(last, -1)}><Undo2 size={16} aria-hidden="true" /></IconButton>
        )}
      </div>
      {m.empty ? <p className="lr-text lr-quiet">{counters === null ? 'Reading the counters…' : m.empty}</p> : (
        <ul className="lr-ctrs" aria-label="Counters, press to add one">
          {shown.map((t) => (
            <li key={t.id}>
              <button type="button" className="lr-key lr-ctr" aria-label={`${t.name}: ${t.value === null ? 'not measured yet' : `${t.value} today`}. Add one.`}
                onClick={() => void useLeft.getState().tapCount(t.id, 1)}>
                <span className="lr-num" data-hollow={t.value === null ? 'true' : undefined}>{t.value === null ? '–' : t.value}</span>
                <span className="lr-ctr-name">{t.name}</span>
              </button>
            </li>
          ))}
          {more > 0 && (
            <li>
              <button type="button" className="lr-key lr-ctr" aria-label={`${more} more counters in Day, Week`} onClick={() => go('day', 'week')}>
                <span className="lr-num">+{more}</span>
                <span className="lr-ctr-name">more</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  )
})

const PhonePart = memo(function PhonePart() {
  const paired = useRail((s) => s.paired)
  const ok = paired !== null && paired > 0
  const pairedLamp = useLamp('live')
  return ok ? (
    <p className="lr-phone" data-paired="true"><LampGlyph state={pairedLamp} size={10} />Phone paired</p>
  ) : (
    <Button size="sm" tone="quiet" className="lr-phone-key" onClick={() => openOverlay('phone')} data-paired="false">
      <LampGlyph state="waiting" size={10} />{paired === null ? 'Phone not read. Set up' : 'Phone not paired. Set up'}
    </Button>
  )
})

/**
 * How many class rows and counter keys fit the rail's height (the no-scroll rule): a class row is 72 px, a key row 64 px.
 * Measured once per resize; before the first measurement it is the 664 px canvas's figure.
 */
export function railBudget(h: number, omit: RailPart[]): { classRows: number; tiles: number } {
  const fixed = 52 + 168 + 56 + (omit.includes('now') ? 0 : 178) + (omit.includes('counters') ? 0 : 98)
  const free = Math.max(0, h - fixed)
  const classRows = Math.max(1, Math.min(6, Math.floor(free / 72)))
  return { classRows, tiles: h >= 820 ? 6 : 3 }
}

export function LeftRail({ omit = [], go, simulated = false, fixture, today: day }: LeftRailProps) {
  const ref = useRef<HTMLElement>(null)
  const [h, setH] = useState(664)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => { const v = el.clientHeight; if (v > 0) setH(v) }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const b = railBudget(h, omit)
  const today = day ?? new Date()
  return (
    <FixCtx.Provider value={fixture ?? null}>
    <SimCtx.Provider value={simulated || !!fixture}>
    <nav ref={ref} className="lr" aria-label="Today rail" data-left="rail" data-simulated={simulated || fixture ? 'true' : undefined}>
      <span className="lr-corners" aria-hidden="true"><i /><i /><i /><i /></span>
      <p className="lr-head">
        <span>{today.toLocaleDateString('en-GB', { weekday: 'long' })}</span>
        <span className="lr-num">{today.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
      </p>
      <Sitting />
      {!omit.includes('now') && <NowPart go={go} />}
      <ClassesPart rows={b.classRows} go={go} />
      {!omit.includes('counters') && <CountersPart tiles={b.tiles} go={go} />}
      <div className="lr-foot"><PhonePart /></div>
    </nav>
    </SimCtx.Provider>
    </FixCtx.Provider>
  )
}
