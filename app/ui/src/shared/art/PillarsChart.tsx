// Pillars Polygon Chart (spec 7.4 #30): a 5 to 8 axis spider chart with a polygon outline and a state tag at all
// times. Sample or simulated data is stamped and is never shown as the student's own until it is (`state` is
// required, `sample` adds the words "SAMPLE DATA"). Arrows move between axes; values change only in edit mode, by
// the sliders beneath (native range inputs, so keyboard and touch come free). The table is the fallback.
import { useMemo } from 'react'
import { ArtTable, Figure, clip } from './frame'
import { spider, type Axis } from './geometry'
import { useRoving } from './hooks'
import type { ArtState } from './state'

export interface PillarsChartProps {
  axes: readonly Axis[]
  state: ArtState
  sample?: boolean
  editable?: boolean
  onChange?: (id: string, value: number) => void
  caption: string
}

const S = 360
const C = S / 2
const R = 112

export function PillarsChart({ axes, state, sample = false, editable = false, onChange, caption }: PillarsChartProps) {
  const ok = axes.length >= 5 && axes.length <= 8
  const list = useMemo(() => (ok ? axes : []), [axes, ok])
  const sp = useMemo(() => spider(list, C, C, R), [list])
  const rov = useRoving(sp.spokes.length)
  const rings = [0.25, 0.5, 0.75, 1]
  return (
    <Figure component="pillars-chart" state={state} caption={sample ? `${caption} (SAMPLE DATA)` : caption}>
      {!ok ? (
        <p className="art-readout">A pillars chart needs 5 to 8 axes; {axes.length} given.</p>
      ) : (
        <svg className="art-svg" viewBox={`0 0 ${S} ${S}`} width={S} height={S} role="group" aria-label={`Pillars chart, ${list.length} axes, ${sample ? 'sample data, ' : ''}${state}. ${caption}`}>
          {rings.map((k) => (
            <polygon key={k} className="art-hair" fill="none" points={spider(list.map((a) => ({ ...a, value: k })), C, C, R).points} />
          ))}
          {sp.spokes.map((s) => (
            <line key={s.id} className="art-hair" x1={C} y1={C} x2={s.x} y2={s.y} />
          ))}
          <polygon className="art-poly" points={sp.points} data-sample={sample || undefined} strokeDasharray={sample || state === 'simulated' ? '5 3' : undefined} />
          {sp.spokes.map((s, i) => {
            const rp = rov.props(i)
            const turn = i / sp.spokes.length
            const side = Math.sin(turn * Math.PI * 2)
            const lx = C + (R + 16) * side
            const ly = C - (R + 16) * Math.cos(turn * Math.PI * 2)
            return (
              <g key={s.id} className="art-node" role="img" aria-label={`${s.label}, ${Math.round((list[i].value ?? 0) * 100)} percent`} {...rp}>
                <circle className="art-hit" cx={s.vx} cy={s.vy} r={22} />
                <circle className="art-focusring" cx={s.vx} cy={s.vy} r={10} fill="none" />
                <circle className="art-solid" cx={s.vx} cy={s.vy} r={3.5} />
                <text className="art-label" x={lx} y={ly} textAnchor={side > 0.25 ? 'start' : side < -0.25 ? 'end' : 'middle'} dominantBaseline="middle">{clip(s.label, 14)}</text>
              </g>
            )
          })}
        </svg>
      )}
      {ok && editable ? (
        <div className="art-sliders">
          {list.map((a) => (
            <label key={a.id} className="art-slider">
              <span>{a.label}</span>
              <input type="range" min={0} max={1} step={0.05} value={a.value} onChange={(e) => onChange?.(a.id, Number(e.currentTarget.value))} />
            </label>
          ))}
        </div>
      ) : null}
      <ArtTable caption={`${caption} (axes)`} head={['Axis', 'Value']} rows={list.map((a) => [a.label, `${Math.round(a.value * 100)}%`])} />
    </Figure>
  )
}
