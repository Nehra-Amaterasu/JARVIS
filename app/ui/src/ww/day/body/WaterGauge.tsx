// WaterGauge (spec 20.6.4, C02-20): a half-circle arc of the day's water against the goal the student set. Derived as a 120 px SVG arc. The
// static form is the same arc without the sweep (the sweep is one 160 ms length change, off under reduced motion). A number is drawn only for
// a LIVE or SIMULATED count; otherwise the track is dashed and the centre says "– –", so the gauge never stands for a value it does not have.
import { showsNumber, type LampState } from '../../../shared/lamp'
import { waterFrac } from './model'

export interface WaterGaugeProps {
  count: number | null
  goal: number
  state: LampState
}

const R = 50
const ARC = `M ${60 - R} 60 A ${R} ${R} 0 0 1 ${60 + R} 60`

export function WaterGauge({ count, goal, state }: WaterGaugeProps) {
  const ready = showsNumber(state) && count !== null
  const frac = ready ? waterFrac(count, goal) : 0
  return (
    <svg className="by-gauge" viewBox="0 0 120 72" width={120} height={72} role="img" aria-label={ready ? `Water today: ${count} of ${goal}` : `Water today: no count, ${state}`} focusable="false" data-hollow={ready ? undefined : 'true'}>
      <path className="by-gauge-track" d={ARC} pathLength={100} />
      {ready && frac > 0 && <path className="by-gauge-fill" d={ARC} pathLength={100} strokeDasharray={`${frac * 100} 100`} />}
      <text className="by-gauge-n" x={60} y={54} textAnchor="middle">{ready ? `${count}/${goal}` : '– –'}</text>
    </svg>
  )
}
