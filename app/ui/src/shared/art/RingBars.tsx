// Ring Bars (spec 7.4 #24): up to 24 radial bars in a recessed ring with a centre number. `state` is required
// (spec 7.7 rule 4): a bar chart is a set of numbers, and none is drawn without saying whether it is live. With
// no reading the bars are flat stubs and the centre says "--", they are not hidden. The table is a real <table>.
import { useMemo, useState } from 'react'
import { ArtTable, Figure } from './frame'
import { MAX_NODES, ringBars, type RingBarIn } from './geometry'
import { useRoving } from './hooks'
import type { ArtState } from './state'

export interface RingBarsProps {
  bars: readonly RingBarIn[]
  max: number
  state: ArtState
  unit?: string
  caption: string
  reason?: string
  showTable?: boolean
}

const S = 320
const C = S / 2

export function RingBars({ bars, max, state, unit = '', caption, reason, showTable }: RingBarsProps) {
  const reading = state === 'live' || state === 'simulated'
  const data = useMemo(() => bars.slice(0, MAX_NODES).map((b) => (reading ? b : { ...b, value: null })), [bars, reading])
  const geo = useMemo(() => ringBars(data, max, { cx: C, cy: C, rIn: 74, rOut: 138 }), [data, max])
  const rov = useRoving(geo.length)
  const [focus, setFocus] = useState<number | null>(null)
  const f = focus !== null ? geo[focus] : null
  return (
    <Figure component="ring-bars" state={state} caption={caption} reason={reason}>
      <svg className="art-svg" viewBox={`0 0 ${S} ${S}`} width={S} height={S} role="group" aria-label={`Ring bars, ${geo.length} bars, ${state}. ${caption}`}>
        <circle className="art-recess" cx={C} cy={C} r={146} />
        <circle className="art-hair" cx={C} cy={C} r={70} fill="none" />
        {geo.map((b, i) => {
          const rp = rov.props(i)
          return (
            <g
              key={b.id}
              className="art-node art-bar"
              data-bar={b.id}
              data-empty={b.empty || undefined}
              role="img"
              aria-label={b.value === null ? `${b.label}, no reading` : `${b.label}, ${b.value}${unit}`}
              {...rp}
              onFocus={() => {
                rp.onFocus()
                setFocus(i)
              }}
              onBlur={() => setFocus(null)}
            >
              <line className="art-hit-line" x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2} />
              <line className={b.empty || state !== 'live' ? 'art-bar-line art-bar-dim' : 'art-bar-line'} x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2} />
            </g>
          )
        })}
        <text className="art-num" x={C} y={C - 4} textAnchor="middle" dominantBaseline="middle">
          {reading ? (f ? (f.value === null ? '--' : `${f.value}${unit}`) : `${Math.round(geo.filter((b) => !b.empty).length)}/${geo.length}`) : '--'}
        </text>
        <text className="art-label" x={C} y={C + 22} textAnchor="middle">{f ? f.label : reading ? 'bars with a reading' : 'no reading'}</text>
      </svg>
      <ArtTable
        caption={`${caption} (values)`}
        head={['Bar', `Value${unit ? ` (${unit})` : ''}`]}
        rows={bars.slice(0, MAX_NODES).map((b) => [b.label, reading && b.value !== null ? b.value : 'no reading'])}
        visible={showTable}
      />
    </Figure>
  )
}
