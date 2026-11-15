/**
 * The honest wait of a Study card (principle 17): the lamp and its word appear at once, the line says what is
 * awaited, and the kit Skeleton follows after its own delay. Replaces the bare "Reading..." lines, which named no
 * state. The text stays in a role=status line, so it is announced once.
 */
import { Lamp } from '../../../shared/kit/Lamp'
import { Skeleton } from '../../../shared/kit/Skeleton'

export function Waiting({ what }: { what: string }) {
  return (
    <div className="ww-waiting" role="status">
      <span className="ww-waiting-line">
        <Lamp state="waiting" />
        <span className="ww-papers-line">{what}</span>
      </span>
      <Skeleton lines={2} />
    </div>
  )
}
