// The day mode, Today's home specimen (spec 20.16.1): the Day Arc above the datum with the minutes Odometer at its centre,
// and under the datum the last seven days as a strip of bars against his own median (dashed). The full D02 Trace of those
// days (scope screen, pin and compare, table twin) opens from the Odometer: drawn under the datum it is a 330 px card, and
// the specimen has 178 px there (measured at 1366 x 768), so the strip is its summary and the Trace its level 2.
import { useState } from 'react'
import { Odometer } from '../../../../shared/data/numbers'
import { Trace } from '../../../../shared/data/series'
import { Drawer } from '../../../../shared/kit'
import { LampGlyph, type LampState } from '../../../../shared/lamp'
import { useSpecimenBox, useToday } from '../context'
import { DayArc, DaySpine } from '../DayArc'
import type { ModeRegistration } from '../registry'

/** Height of the arc drawing inside the specimen; the datum strip takes the rest below the datum. */
export const arcHeightFor = (h: number): number => Math.round(h * 0.64)

const WD = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

/** Seven bars on the datum, today last and darkest; the median as one dashed rule; a value under each bar. */
export function DatumStrip({ week, median, state, width }: { week: { date: string; minutes: number }[]; median: number | null; state: LampState; width: number }) {
  const drawn = state === 'live' || state === 'simulated'
  const h = 64
  const top = 6
  const max = Math.max(1, median ?? 0, ...week.map((d) => d.minutes))
  const col = width / Math.max(1, week.length)
  const bw = Math.min(26, Math.round(col * 0.42))
  const y = (m: number) => Math.round(top + h - (m / max) * h)
  return (
    <div className="td-strip" data-lamp={state}>
      <p className="td-strip-head">
        <LampGlyph state={state} size={10} />
        <span>Minutes, last 7 days</span>
        <span className="td-strip-why">{drawn ? (median === null ? 'median needs 3 logged days' : `your median, 30 d: ${median} min`) : 'block log not read yet'}</span>
      </p>
      <svg width={width} height={h + top + 34} viewBox={`0 0 ${width} ${h + top + 34}`} role="img" focusable="false"
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

function DaySpecimen() {
  const { model, raw } = useToday()
  const box = useSpecimenBox()
  const [trace, setTrace] = useState(false)
  const hero = (
    <Odometer value={model.minutes ?? 0} unit="min today" state={model.minutesState} size={box.phone ? 'compact' : 'hero'} reason={model.minutesReason}
      onOpen={model.weekState === 'waiting' ? undefined : () => setTrace(true)} />
  )
  const points = model.week.map((d) => ({ t: new Date(`${d.date}T12:00:00`).getTime(), v: d.minutes }))
  const strip = <DatumStrip week={model.week} median={model.median} state={model.weekState} width={Math.max(240, Math.min(box.w - 16, 520))} />
  const drawer = (
    <Drawer open={trace} onClose={() => setTrace(false)} title="Minutes, last 7 days" place="right">
      <Trace points={points} median={model.median ?? undefined} state={model.weekState} label="Minutes, last 7 days" unit="min" medianLabel="your median, 30 d" />
    </Drawer>
  )
  if (box.phone) {
    return (
      <div className="td-spec-phone">
        <div className="td-hero-phone">{hero}</div>
        <DaySpine blocks={model.classes} planned={model.planned} done={model.done} now={raw.now} state={model.state} dashed={model.noClasses} width={320} height={320} />
        {strip}
        {drawer}
      </div>
    )
  }
  return (
    <div className="td-spec-desk">
      <DayArc blocks={model.classes} planned={model.planned} done={model.done} now={raw.now} state={model.state} width={box.w} height={arcHeightFor(box.h)} dashed={model.noClasses}>
        {hero}
      </DayArc>
      {strip}
      {drawer}
    </div>
  )
}

export const mode: ModeRegistration = { id: 'day', label: 'Day', Specimen: DaySpecimen }
