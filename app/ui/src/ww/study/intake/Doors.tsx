// The four doors and the Classroom plate (package C03, spec 21.4.2 S6). Folder, Paste, Calendar file and Archive each take one
// tab stop; Enter opens the door's sheet. The fifth tile is not a door: Classroom is drawn PLANNED with its reason until he signs
// in, it is not focusable and says nothing about being linked. Each door carries its own lamp and the reason in words.
import { Lamp, readingOf, type LampReading } from '../../../shared/lamp'
import { COPY } from './copy'

export type DoorId = 'folder' | 'paste' | 'ics' | 'archive'

const DOORS: { id: DoorId; name: string; sub: string; key: string }[] = [
  { id: 'folder', name: 'Folder', sub: 'Files you saved into a watched folder', key: 'F' },
  { id: 'paste', name: 'Paste', sub: 'Lines such as “Maths Assignment 3 - due 18 Nov”', key: 'P' },
  { id: 'ics', name: 'Calendar file', sub: 'An .ics you exported yourself', key: 'C' },
  { id: 'archive', name: 'Archive', sub: 'A Classroom export .zip you made', key: 'Z' },
]

export interface DoorsProps {
  readings: Record<DoorId, LampReading>
  onOpen: (id: DoorId) => void
  classroom: LampReading
}

export function Doors({ readings, onOpen, classroom }: DoorsProps) {
  return (
    <ul className="ik-doors" aria-label="Ways to bring items in" data-component="doors">
      {DOORS.map((d) => (
        <li key={d.id}>
          <button type="button" className="ik-door" data-door={d.id} aria-keyshortcuts={d.key} onClick={() => onOpen(d.id)}>
            <span className="ik-door-top"><span className="ik-door-name">{d.name}</span><kbd className="ik-key" aria-hidden="true">{d.key}</kbd></span>
            <span className="ik-door-sub">{d.sub}</span>
            <span className="ik-door-lamp"><Lamp reading={readings[d.id]} /><span className="ik-door-why">{readings[d.id].reason}</span></span>
          </button>
        </li>
      ))}
      <li>
        <div className="ik-door ik-plate" data-door="classroom" role="group" aria-label={`${COPY.classroomPlate}: ${classroom.state}. ${COPY.classroomReason}`}>
          <span className="ik-door-top"><span className="ik-door-name">{COPY.classroomPlate}</span></span>
          <span className="ik-door-sub">{COPY.classroomReason}</span>
          <span className="ik-door-lamp"><Lamp reading={readingOf({ ...classroom, state: 'planned' })} /></span>
        </div>
      </li>
    </ul>
  )
}
