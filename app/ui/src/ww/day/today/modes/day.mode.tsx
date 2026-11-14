// The day mode, Today's home specimen (spec 20.16.1): the Day Arc above the datum with the minutes Odometer at its centre,
// and under the datum the last seven days as a strip of bars against his own median (dashed). The full D02 Trace of those
// days (scope screen, pin and compare, table twin) opens from the Odometer: drawn under the datum it is a 330 px card, and
// the specimen has 178 px there (measured at 1366 x 768), so the strip is its summary and the Trace its level 2.
import { useState } from 'react'
import { Odometer } from '../../../../shared/data/numbers'
import { Trace } from '../../../../shared/data/series'
import { Drawer } from '../../../../shared/kit'
import type { LampState } from '../../../../shared/lamp'
import { useSpecimenBox, useToday } from '../context'
import { DayArc } from '../DayArc'
import { LampWord } from '../Plate'
import { arcGeometry, minOfDate, toMin } from '../model'
import type { ModeRegistration } from '../registry'

/** Radius of the dial for a drawing w px wide (the same figure arcGeometry draws with). */
const dialR = (w: number): number => Math.max(80, Math.round(w / 2) - 46)

/** Height of the arc drawing inside the specimen; the datum strip takes the rest below the datum. Given the width it is only as
 *  tall as the dial needs (its radius, the hour labels, a 16 px lane for the notch's leader and the datum margin): at 486 px
 *  wide that is 285 px instead of 64 percent of the height (310), and the 25 px go to the strip. */
export const arcHeightFor = (h: number, w?: number): number => {
  const byHeight = Math.round(h * 0.64)
  return w === undefined ? byHeight : Math.min(byHeight, dialR(w) + 14 + 22 + 16 + 14 + 14)
}

/** The phone's half dial: as wide as the page lets it be, no taller than its labels need. */
export const phoneDial = (w: number): { w: number; h: number } => ({ w, h: dialR(w) + 14 + 22 + 14 + 14 })

const WD = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

/** Seven bars on the datum, today last and darkest; the median as one dashed rule; a value under each bar. */
export function DatumStrip({ week, median, state, width, barH = 64 }: { week: { date: string; minutes: number }[]; median: number | null; state: LampState; width: number; barH?: number }) {
  const drawn = state === 'live' || state === 'simulated'
  const h = barH
  const top = 6
  const max = Math.max(1, median ?? 0, ...week.map((d) => d.minutes))
  const col = width / Math.max(1, week.length)
  const bw = Math.min(26, Math.round(col * 0.42))
  const y = (m: number) => Math.round(top + h - (m / max) * h)
  return (
    <div className="td-strip" data-lamp={state}>
      <p className="td-strip-head">
        <span>Minutes, last 7 days</span>
        <LampWord state={state} />
        <span className="td-strip-why">{drawn ? (median === null ? 'median needs 3 logged days' : `your median, 30 d: ${median} min`) : 'block log not read yet'}</span>
      </p>
      <svg className="td-strip-svg" width={width} height={h + top + 34} viewBox={`0 0 ${width} ${h + top + 34}`} role="img" focusable="false"
        aria-label={drawn ? `Minutes on the last 7 days: ${week.map((d) => `${d.date} ${d.minutes}`).join(', ')}${median !== null ? `; your median ${median}` : ''}` : 'Minutes, last 7 days: not read yet'}>
        <path className="td-strip-base" d={`M0 ${top + h}H${width}`} />
        {week.map((d, i) => {
          const x = Math.round(i * col + col / 2)
          const today = i === week.length - 1
          const wd = WD[new Date(`${d.date}T12:00:00`).getDay()]
          return (
            <g key={d.date} className="td-strip-day" data-today={today ? 'true' : undefined}>
              <rect className="td-strip-slot" x={x - bw / 2} y={top} width={bw} height={h} rx={bw / 2} />
              {drawn && d.minutes > 0 && <rect className="td-strip-bar" x={x - bw / 2} y={y(d.minutes)} width={bw} height={top + h - y(d.minutes)} rx={bw / 2} />}
              <text className="td-strip-n" x={x} y={top + h + 14} textAnchor="middle">{drawn ? d.minutes : '–'}</text>
              <text className="td-strip-wd" x={x} y={top + h + 28} textAnchor="middle">{today ? 'today' : wd}</text>
            </g>
          )
        })}
        {drawn && median !== null && <path className="td-strip-median" d={`M0 ${y(median)}H${width}`} />}
      </svg>
    </div>
  )
}

const KIND_WORD = { class: 'class', planned: 'planned', done: 'done' } as const
/** Rows the phone's agenda shows before its one key: the block under way (or next) and the two after it. */
export const AGENDA_ROWS = 3

/** The agenda on the phone: the day's blocks in words, by start time, each name on its own line with its time above it (the
 *  dial's twin; nothing is cut, the rest of the day is behind one key that says how many). */
export function Agenda() {
  const { model, raw } = useToday()
  const [all, setAll] = useState(false)
  const rows = [...model.classes, ...model.planned, ...model.done].sort((a, b) => a.from.localeCompare(b.from))
  const drawn = model.state === 'live' || model.state === 'simulated'
  if (!drawn || !rows.length) return <p className="td-quiet td-spine-empty">{drawn ? 'No blocks yet today.' : 'Waiting for the timetable and the block log.'}</p>
  const nowMin = minOfDate(raw.now)
  const firstLive = rows.findIndex((b) => (toMin(b.to) ?? 0) >= nowMin)
  const start = firstLive < 0 ? Math.max(0, rows.length - AGENDA_ROWS) : Math.min(firstLive, Math.max(0, rows.length - AGENDA_ROWS))
  const shown = all ? rows : rows.slice(start, start + AGENDA_ROWS)
  const rest = rows.length - AGENDA_ROWS
  return (
    <div className="td-agenda">
      <ol className="td-spine-list" aria-label="Today's blocks">
        {shown.map((b) => (
          <li key={b.id} data-kind={b.kind}>
            <span className="td-mono">{b.from}<small>{KIND_WORD[b.kind]}</small></span>
            <span className="td-spine-what">{b.label}</span>
          </li>
        ))}
      </ol>
      {rest > 0 && (
        <button type="button" className="td-more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? 'Only what is next' : `All ${rows.length} blocks of the day`}
        </button>
      )}
    </div>
  )
}

function DaySpecimen() {
  const { model, raw } = useToday()
  const box = useSpecimenBox()
  const [trace, setTrace] = useState(false)
  // the hero is the Odometer WITHOUT its own lamp: the dial's caption carries the one lamp of both, so SIMULATED is printed once
  const hero = (
    <Odometer value={model.minutes ?? 0} unit="min today" state={model.minutesState} size="compact" reason={model.minutesReason} lamp={false}
      onOpen={model.weekState === 'waiting' ? undefined : () => setTrace(true)} />
  )
  const points = model.week.map((d) => ({ t: new Date(`${d.date}T12:00:00`).getTime(), v: d.minutes }))
  const drawer = (
    <Drawer open={trace} onClose={() => setTrace(false)} title="Minutes, last 7 days" place="right">
      <Trace points={points} median={model.median ?? undefined} state={model.weekState} label="Minutes, last 7 days" unit="min" medianLabel="your median, 30 d" />
    </Drawer>
  )
  if (box.phone) {
    const dial = phoneDial(Math.max(240, Math.min(box.w, 420)))
    return (
      <div className="td-spec-phone">
        <DayArc blocks={model.classes} planned={model.planned} done={model.done} now={raw.now} state={model.state} width={dial.w} height={dial.h} dashed={model.noClasses} compact />
        <div className="td-hero-phone">{hero}</div>
        <Agenda />
        <DatumStrip week={model.week} median={model.median} state={model.weekState} width={Math.min(box.w, 520)} barH={44} />
        {drawer}
      </div>
    )
  }
  const strip = <DatumStrip week={model.week} median={model.median} state={model.weekState} width={Math.max(240, Math.min(box.w - 16, 520))} />
  return (
    <div className="td-spec-desk">
      <DayArc blocks={model.classes} planned={model.planned} done={model.done} now={raw.now} state={model.state} width={box.w} height={arcHeightFor(box.h, box.w)} dashed={model.noClasses}>
        {hero}
      </DayArc>
      {strip}
      {drawer}
    </div>
  )
}

/** Where the minutes figure's right edge stands on the desk dial (the Counters leader starts there). */
export const heroRight = (w: number, h: number): { x: number; y: number } => {
  const g = arcGeometry(w, h)
  return { x: g.cx + HERO_HALF, y: g.cy - 24 }
}
/** Half the width of the minutes figure's wells on the desk dial, px (measured on the compact Odometer: see the geometry test). */
export const HERO_HALF = 84

export const mode: ModeRegistration = { id: 'day', label: 'Day', Specimen: DaySpecimen }
