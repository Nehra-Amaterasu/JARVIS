// The Classroom plate on the Intake desk (it was a PLANNED tile that said nothing could be pressed). It now reads the link through
// the typed client: the state word and the engine's reason, and the keys that fit the state (LinkPanel). With no engine, or no token
// in the window, the plate stays PLANNED or WAITING with its reason and has no key, the way it was.
import type { GcrClient } from '../adapters/gcr'
import { LinkPanel, linkReading } from './LinkPanel'
import { useClassroomLink } from './useClassroomLink'

export interface ClassroomPlateProps {
  client: GcrClient
  /** Opens the Classroom shelf (the face beside Intake and Library); absent where there is none. */
  onShelf?: () => void
}

export function ClassroomPlate({ client, onShelf }: ClassroomPlateProps) {
  const link = useClassroomLink(client)
  const reading = linkReading(link)
  return (
    <div className="ik-door ik-plate cr-plate" data-door="classroom" role="group" aria-label={`Classroom: ${reading.state}. ${reading.reason}`}>
      <span className="ik-door-top"><span className="ik-door-name">Classroom</span></span>
      <LinkPanel link={link} onShelf={onShelf} />
    </div>
  )
}
