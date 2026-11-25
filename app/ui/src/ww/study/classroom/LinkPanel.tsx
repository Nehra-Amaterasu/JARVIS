// The Classroom link as one panel: the state word and the engine's reason, then the keys that fit the state, the last sync, the
// counts and the faults of the last sync. The plate on the Intake desk and the first tray of the Classroom shelf both draw it, so
// the two cannot disagree about what the link is doing.
//
// Keys per state (the route contract): PLANNED and a window with no engine draw no key at all, WAITING and FAULT from the engine
// draw Connect, LIVE draws Sync now and Disconnect. Nothing here says "connected" before the engine says LIVE.
import { useState } from 'react'
import { Button, Field } from '../../../shared/kit'
import { Lamp, readingOf, showsNumber, type LampReading } from '../../../shared/lamp'
import type { GcrJob } from '../adapters/gcrTypes'
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

/** The short name of an account: lower-case letters, digits and `-`, at most 20 (the engine refuses anything else with a 400). */
export const ACCOUNT_NAME = /^[a-z0-9-]{1,20}$/
export const ACCOUNT_RULE = 'Use 1 to 20 lower-case letters, digits or - only.'
export function accountProblem(name: string): string | null {
  if (!name.trim()) return 'Type a short name first.'
  return ACCOUNT_NAME.test(name) ? null : ACCOUNT_RULE
}

/** The job's own sentence with a word for how it ended; "stopped" and "failed" are not lamp states, so they are plain words here. */
export function JobLine({ job }: { job: GcrJob }) {
  if (job.status === 'idle') return null
  const word = job.status === 'running' ? '' : `${job.status[0].toUpperCase()}${job.status.slice(1)}. `
  return <p className="cr-note" data-component="classroom-job" data-status={job.status}>{`${word}${job.text}`}</p>
}

function AddAccount({ onAdd, disabledReason }: { onAdd: (name: string) => void; disabledReason?: string }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [touched, setTouched] = useState(false)
  const problem = touched ? accountProblem(name) : null
  if (!open) return <Button size="sm" grouped onClick={() => setOpen(true)}>Add account</Button>
  const go = () => {
    setTouched(true)
    if (accountProblem(name)) return
    onAdd(name)
    setOpen(false); setName(''); setTouched(false)
  }
  return (
    <div className="cr-add" data-component="classroom-add-account">
      <Field label="Short name for the account" value={name} maxLength={40} error={problem ?? undefined} hint="For example: college" onChange={(e) => { setName(e.target.value); setTouched(true) }} onKeyDown={(e) => { if (e.key === 'Enter') go() }} />
      <div className="cr-keys">
        <Button size="sm" grouped onClick={go} disabledReason={disabledReason}>Connect this account</Button>
        <Button size="sm" grouped onClick={() => { setOpen(false); setName(''); setTouched(false) }}>Cancel</Button>
      </div>
    </div>
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
  const accounts = body?.accounts ?? []
  // with accounts listed each row has its own key; an engine that sends none keeps the single Connect and Disconnect
  const perAccount = accounts.length > 0
  return (
    <div className="cr-linkbox" data-component="classroom-link" data-state={reading.state}>
      <p className="cr-state"><Lamp reading={reading} />{!connecting && reading.reason && <span className="cr-why">{reading.reason}</span>}</p>
      {missing.length > 0 && <p className="cr-note">{`Not allowed yet: ${missing.map((s) => s.label).join(', ')}.`}</p>}
      {live && (
        <>
          <p className="cr-note" data-component="classroom-synced">{body?.synced_at ? `Last sync: ${body.synced_at}` : 'Not synced yet.'}</p>
          {counts && showsNumber(reading.state) && (
            <p className="cr-counts" data-component="classroom-counts">{`${counts.courses} courses, ${counts.files} files, ${counts.notes} notes, ${counts.papers} papers, ${counts.faults} faults`}</p>
          )}
          {job && <JobLine job={job} />}
          <FaultLines lines={job?.fault_lines ?? []} />
        </>
      )}
      {perAccount && (
        <ul className="cr-accounts" aria-label="Accounts" data-component="classroom-accounts">
          {accounts.map((a) => (
            <li key={a.name} className="cr-account" data-account={a.name} data-state={a.state}>
              <span className="cr-account-name">{a.name}</span>
              <Lamp reading={readingOf({ state: a.state, reason: a.reason })} />
              {a.reason && <span className="cr-why">{a.reason}</span>}
              {fromEngine && a.state === 'live' && <Button size="sm" grouped aria-label={`Disconnect ${a.name}`} onClick={() => void link.disconnect(a.name)}>Disconnect</Button>}
              {fromEngine && (a.state === 'waiting' || a.state === 'fault') && <Button size="sm" grouped aria-label={`Connect ${a.name}`} onClick={() => void link.connect(a.name)} disabledReason={connecting ? APPROVE_SENTENCE : undefined}>Connect</Button>}
            </li>
          ))}
        </ul>
      )}
      {say && <p className="cr-say" role="status" data-component="classroom-say"><Lamp reading={readingOf({ state: say.state, reason: say.text })} showLabel={false} /><span>{say.text}</span></p>}
      <div className="cr-keys">
        {canConnect && !perAccount && (
          <Button size="sm" grouped onClick={() => void link.connect()} disabledReason={connecting ? APPROVE_SENTENCE : undefined}>Connect</Button>
        )}
        {live && (
          <Button size="sm" grouped onClick={() => void link.syncNow()} disabledReason={running ? 'A sync is running.' : undefined}>Sync now</Button>
        )}
        {live && onShelf && <Button size="sm" grouped onClick={onShelf}>Open the shelf</Button>}
        {live && !perAccount && <Button size="sm" grouped onClick={() => void link.disconnect()}>Disconnect</Button>}
        {fromEngine && reading.state !== 'planned' && <AddAccount onAdd={(n) => void link.connect(n)} disabledReason={connecting ? APPROVE_SENTENCE : undefined} />}
      </div>
    </div>
  )
}
