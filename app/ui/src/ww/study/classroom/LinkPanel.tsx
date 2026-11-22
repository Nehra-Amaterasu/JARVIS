// The Classroom link as one panel: the state word and the engine's reason, then the keys that fit the state, the last sync, the
// counts and the faults of the last sync. The plate on the Intake desk and the first tray of the Classroom shelf both draw it, so
// the two cannot disagree about what the link is doing.
//
// Keys per state (the route contract): PLANNED and a window with no engine draw no key at all, WAITING and FAULT from the engine
// draw Connect, LIVE draws Sync now and Disconnect. Nothing here says "connected" before the engine says LIVE.
import { Button } from '../../../shared/kit'
import { Lamp, readingOf, showsNumber, type LampReading } from '../../../shared/lamp'
import { APPROVE_SENTENCE, type ClassroomLink } from './useClassroomLink'

/** How many fault lines are listed before "and N more". */
export const FAULTS_SHOWN = 5

export function FaultLines({ lines }: { lines: readonly string[] }) {
  if (lines.length === 0) return null
  const rest = lines.length - FAULTS_SHOWN
  return (
    <ul className="cr-faults" aria-label="Faults of the last sync" data-component="classroom-faults">
      {lines.slice(0, FAULTS_SHOWN).map((l, i) => <li key={`${i}-${l}`}>{l}</li>)}
      {rest > 0 && <li className="cr-faults-more">{`and ${rest} more`}</li>}
    </ul>
  )
}

export interface LinkPanelProps {
  link: ClassroomLink
  /** Present when a shelf exists to open (the plate on the desk); the shelf itself passes nothing. */
  onShelf?: () => void
}

export function linkReading(link: ClassroomLink): LampReading {
  const s = link.status
  return s ? readingOf({ state: s.state, since: s.since, reason: s.reason }) : readingOf({ state: 'waiting', reason: 'asking the engine' })
}

export function LinkPanel({ link, onShelf }: LinkPanelProps) {
  const { status, job, connecting, running, say } = link
  const reading = linkReading(link)
  const body = status?.data ?? null
  const fromEngine = status?.from === 'engine'
  const live = reading.state === 'live'
  const canConnect = fromEngine && (reading.state === 'waiting' || reading.state === 'fault')
  const counts = body?.counts ?? job?.counts ?? null
  const missing = (body?.scopes ?? []).filter((s) => !s.granted)
  return (
    <div className="cr-link" data-component="classroom-link" data-state={reading.state}>
      <p className="cr-state"><Lamp reading={reading} />{!connecting && reading.reason && <span className="cr-why">{reading.reason}</span>}</p>
      {missing.length > 0 && <p className="cr-note">{`Not allowed yet: ${missing.map((s) => s.label).join(', ')}.`}</p>}
      {live && (
        <>
          <p className="cr-note" data-component="classroom-synced">{body?.synced_at ? `Last sync: ${body.synced_at}` : 'Not synced yet.'}</p>
          {counts && showsNumber(reading.state) && (
            <p className="cr-counts" data-component="classroom-counts">{`${counts.courses} courses, ${counts.files} files, ${counts.notes} notes, ${counts.papers} papers, ${counts.faults} faults`}</p>
          )}
          {job && job.status !== 'idle' && <p className="cr-note" data-component="classroom-job">{job.text}</p>}
          <FaultLines lines={job?.fault_lines ?? []} />
        </>
      )}
      {say && <p className="cr-say" role="status" data-component="classroom-say"><Lamp reading={readingOf({ state: say.state, reason: say.text })} showLabel={false} /><span>{say.text}</span></p>}
      <div className="cr-keys">
        {canConnect && (
          <Button size="sm" grouped onClick={() => void link.connect()} disabledReason={connecting ? APPROVE_SENTENCE : undefined}>Connect</Button>
        )}
        {live && (
          <Button size="sm" grouped onClick={() => void link.syncNow()} disabledReason={running ? 'A sync is running.' : undefined}>Sync now</Button>
        )}
        {live && onShelf && <Button size="sm" grouped onClick={onShelf}>Open the shelf</Button>}
        {live && <Button size="sm" grouped onClick={() => void link.disconnect()}>Disconnect</Button>}
      </div>
    </div>
  )
}
