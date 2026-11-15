// C03 on the gallery (gallery/entries/C03.tsx loads this file lazily behind the product gate, so a JARVIS only build carries none
// of it): the Manual Intake desk and its parts, every state on INVENTED items. The fixture desk is an in-memory port with a tiny
// fixture reader; every answer is SIMULATED and says so, and the null adapters' own empty desk (WAITING) is shown beside them.
// Nothing here reads a route.
import { useState, type ReactNode } from 'react'
import { nullStudyPort } from '../adapters/null.register'
import type { StudyPort } from '../ports'
import { AttachmentLadder } from './AttachmentLadder'
import { IntakeDesk } from './IntakeDesk'
import { NOW, ROWS, makeFixtureDesk, manyRows } from './fixtures'
import { nullIntakeDesk } from './port'
import { ProvenanceChip } from './ProvenanceChip'
import { LADDER, type IntakeRow, type IntakeSource } from './types'
import './intake.css'

export const C03_LABELS = [
  'Intake desk, twelve items (SIMULATED)',
  'Intake desk, nothing brought in (null adapters: WAITING)',
  'An item with an ambiguous date: Accept waits for the choice',
  'A folder file and its attachment ladder',
  'Accepted items (the Accepted filter)',
  'Forty new items: the first screen, grouped and paged',
  'Paste door: lines read, one not read',
  'Calendar-file door: events with their keep switches',
  'Archive door: listed before anything is queued',
  'Course Mapper: mapped, suggested, unmapped',
  'Folder door',
  'Parts: ProvenanceChip and AttachmentLadder',
] as const

const study: StudyPort = { ...nullStudyPort, intake: async () => ({ state: 'simulated', reason: 'invented folder', since: NOW, data: { files: 2, folderChosen: true } }) }
const Box = ({ children }: { children: ReactNode }) => <div className="c03-box">{children}</div>

function Desk(props: Omit<Parameters<typeof IntakeDesk>[0], 'desk' | 'study' | 'now'> & { rows?: IntakeRow[]; empty?: boolean }) {
  const { rows, empty, ...rest } = props
  const [desk] = useState(() => (empty ? nullIntakeDesk : makeFixtureDesk({ rows })))
  return <Box><IntakeDesk {...rest} desk={desk} study={empty ? nullStudyPort : study} now={NOW} /></Box>
}

const SOURCES: IntakeSource[] = ['paste', 'ics', 'folder', 'archive', 'classroom']
const fileRow = (i: number): IntakeRow => ({ ...ROWS[5], state: 'new', ladder: LADDER[i] })

export function C03State({ index }: { index: number }) {
  switch (index) {
    case 0: return <Desk />
    case 1: return <Desk empty />
    case 2: return <Desk initialSel="r4" />
    case 3: return <Desk initialSel="r6" />
    case 4: return <Desk initialFilter="accepted" />
    case 5: return <Desk rows={manyRows(40)} />
    case 6: return <Desk open="paste" demo />
    case 7: return <Desk open="ics" demo />
    case 8: return <Desk open="archive" demo />
    case 9: return <Desk open="courses" />
    case 10: return <Desk open="folder" />
    default:
      return (
        <div className="c03-parts">
          <p>{SOURCES.map((s) => <ProvenanceChip key={s} source={s} />)}</p>
          <AttachmentLadder row={ROWS[5]} />
          <AttachmentLadder row={fileRow(0)} />
          <AttachmentLadder row={{ ...ROWS[5], state: 'taken' }} />
        </div>
      )
  }
}
