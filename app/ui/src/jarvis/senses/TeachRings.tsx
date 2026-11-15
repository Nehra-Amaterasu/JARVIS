// The four Teach steps as sigil rings (spec 20.9.3, C03-04): a ring cut into as many segments as the step has real parts,
// one segment lit per part done. Room: one part. Quiet baselines: two (fan off, fan on). Drill days: one per day of the
// gate. Held-out check: one, and only the server's gate lights it. A step with no reading is a hollow dashed ring.
// Copy says "predicting" until every ring is lit; the rings never show a percentage the data does not have.
import { Sigil } from '../../shared/grammar'
import { Lamp, type LampReading } from '../../shared/lamp'
import type { TeachRing } from './model'

const C = 60
const R = 46

/** Segment i of n on a full circle from 12 o'clock, with a 5 degree gap (a single segment is a whole ring). */
function ringPath(i: number, n: number): string {
  if (n <= 1) return `M${C} ${C - R}A${R} ${R} 0 1 1 ${C - 0.01} ${C - R}`
  const gap = 5
  const span = 360 / n
  const pt = (deg: number): [number, number] => [C + R * Math.sin((deg * Math.PI) / 180), C - R * Math.cos((deg * Math.PI) / 180)]
  const [x0, y0] = pt(i * span + gap / 2)
  const [x1, y1] = pt((i + 1) * span - gap / 2)
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${R} ${R} 0 ${span - gap > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

export function TeachRingForm({ ring, known, simulated }: { ring: TeachRing; known: boolean; simulated: boolean }) {
  const reading: LampReading = !known
    ? { state: 'waiting', since: null, reason: 'readiness not read yet' }
    : { state: ring.done ? (simulated ? 'simulated' : 'live') : 'waiting', since: null, reason: ring.done ? ring.word : `not done: ${ring.word}` }
  return (
    <figure className="js-ring" data-ring={ring.id} data-done={ring.done ? 'true' : 'false'} data-known={known ? 'true' : 'false'}>
      <div className="js-ring-art">
        <svg viewBox="0 0 120 120" width="120" height="120" role="img" aria-label={`${ring.name}: ${known ? ring.word : 'not read'}`}>
          {Array.from({ length: ring.of }, (_, i) => (
            <path key={i} d={ringPath(i, ring.of)} className="js-ring-seg" data-on={known && i < ring.fill ? 'true' : 'false'} />
          ))}
        </svg>
        <span className="js-ring-sigil" aria-hidden="true"><Sigil seed={`senses.teach.${ring.id}`} size={24} fold={4} /></span>
      </div>
      <figcaption>
        <b className="js-ring-name">{ring.name}</b>
        <span className="js-ring-word">{known ? ring.word : 'not read yet'}</span>
        <Lamp reading={reading} subject={ring.name} />
      </figcaption>
    </figure>
  )
}
