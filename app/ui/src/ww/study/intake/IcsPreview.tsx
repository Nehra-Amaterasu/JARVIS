// IcsPreview (package C03, spec 21.4.2 S6, door 3): drop a calendar file; each event is listed with its title, its start in words
// and whether it repeats, with a kit Switch to keep it (on by default). An event that repeats is listed as "repeats, not
// expanded" here: one row, never a run of guessed dates. "Done" declines the ones he switched off; nothing is accepted.
import { useEffect, useRef, useState } from 'react'
import { Button, PrimaryButton, Switch } from '../../../shared/kit'
import { Lamp, readingOf, showsNumber, type LampState } from '../../../shared/lamp'
import { COPY } from './copy'
import { DropWell } from './ExportImportDrop'
import { dueWords } from './model'
import type { IntakeDeskPort } from './port'
import type { IcsResult, IntakeRow } from './types'

export interface IcsBodyProps {
  desk: IntakeDeskPort
  now: number
  onRows: (rows: IntakeRow[]) => void
  /** Rows he switched off are declined on Done. */
  onDecline: (ids: string[]) => void
  onClose: () => void
  /** The gallery hands the body a calendar text it reads on mount. */
  initialText?: string
}

export function IcsBody({ desk, now, onRows, onDecline, onClose, initialText }: IcsBodyProps) {
  const [res, setRes] = useState<{ state: LampState; reason: string; data: IcsResult | null } | null>(null)
  const [keep, setKeep] = useState<Record<string, boolean>>({})
  const ran = useRef(false)
  const read = async (text: string) => {
    const r = await desk.ics(text)
    setRes({ state: r.state, reason: r.reason, data: showsNumber(r.state) ? r.data : null })
    if (showsNumber(r.state) && r.data) { onRows(r.data.items); setKeep(Object.fromEntries(r.data.items.map((i) => [i.id, true]))) }
  }
  useEffect(() => {
    if (initialText && !ran.current) { ran.current = true; void read(initialText) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const items = res?.data?.items ?? []
  const off = items.filter((i) => keep[i.id] === false).map((i) => i.id)
  return (
    <div className="ik-sheet-body" data-component="ics-preview">
      <p className="ik-sheet-note">{COPY.icsNote}</p>
      <DropWell accept={['.ics']} title="Choose a calendar file" sub="an .ics file you exported yourself" onFile={(f) => void f.text().then(read)} />
      {res && (
        <div className="ik-result" role="status" data-component="ics-reading">
          <p className="ik-result-head">
            <Lamp reading={readingOf({ state: res.state, reason: res.reason })} />
            <span>{res.data ? `${items.length} event${items.length === 1 ? '' : 's'} read, ${res.data.skipped} skipped${res.data.past ? `, ${res.data.past} already over` : ''}` : `Not read: ${res.reason}`}</span>
          </p>
          {res.data && <p className="ik-sheet-note">{res.reason}</p>}
          {res.data && (
            <ul className="ik-entries" aria-label="Events in the file">
              {items.map((r) => (
                <li key={r.id}>
                  <span className="ik-entry-name">{r.title}</span>
                  <span className="ik-entry-meta">{r.repeats ? `${dueWords(r.date, r.time, now)}, repeats, ${r.repeatsWord ?? 'not expanded'}` : dueWords(r.date, r.time, now)}</span>
                  <Switch checked={keep[r.id] !== false} onChange={(v) => setKeep((k) => ({ ...k, [r.id]: v }))} label={`Keep ${r.title}`} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="ik-sheet-act">
        <Button onClick={onClose}>Close</Button>
        <PrimaryButton claimId="intake-ics-done" rank="overlay" disabled={!items.length} onClick={() => { onDecline(off); onClose() }}>
          {off.length ? `Done, decline ${off.length}` : 'Done'}
        </PrimaryButton>
      </div>
    </div>
  )
}
