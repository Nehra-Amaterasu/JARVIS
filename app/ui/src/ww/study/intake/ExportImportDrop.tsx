// ExportImportDrop (package C03, spec 21.4.2 S6, door 4): a well that takes one file he made himself (a Classroom export .zip, or a
// calendar file .ics through the same well) and, for an archive, lists what is inside BEFORE anything is queued. Each entry has
// a keep switch; an entry that cannot be read (a video, a path that leaves the archive) is listed with its reason and has no
// switch. Nothing is fetched and nothing is queued until the queue key is pressed.
import { useRef, useState, type DragEvent } from 'react'
import { Button, PrimaryButton, Switch } from '../../../shared/kit'
import { Lamp, readingOf, showsNumber, type LampState } from '../../../shared/lamp'
import { COPY } from './copy'
import { sizeWords } from './model'
import type { IntakeDeskPort } from './port'
import type { ArchiveListing } from './types'

export interface DropWellProps {
  /** Extensions that are taken, lower case with the dot (".zip"). */
  accept: readonly string[]
  title: string
  sub: string
  onFile: (file: File) => void
  inputRef?: React.RefObject<HTMLInputElement | null>
}

/** True when the file name ends with one of the accepted extensions. Pure, so a test can try every kind. */
export const takes = (name: string, accept: readonly string[]): boolean => accept.some((a) => name.toLowerCase().endsWith(a))

export function DropWell({ accept, title, sub, onFile, inputRef }: DropWellProps) {
  const own = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? own
  const [over, setOver] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const take = (f: File | undefined) => {
    if (!f) return
    if (!takes(f.name, accept)) { setRefused(`${f.name} is not a ${accept.join(' or ')} file`); return }
    setRefused(null)
    onFile(f)
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files[0]) }
  return (
    <div className="ik-well" data-component="drop-well" data-over={over ? 'true' : 'false'} onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      <button type="button" className="ik-well-btn" onClick={() => ref.current?.click()}>
        <span className="ik-well-title">{title}</span>
        <span className="ik-well-sub">{refused ?? sub}</span>
      </button>
      <input ref={ref} type="file" accept={accept.join(',')} hidden aria-label={title} onChange={(e) => { take(e.target.files?.[0]); e.target.value = '' }} />
    </div>
  )
}

export interface ArchiveBodyProps {
  desk: IntakeDeskPort
  /** Hand the body a listing already read (the gallery). */
  initial?: { listing: ArchiveListing; state: 'live' | 'simulated'; reason: string }
  onQueued?: (n: number) => void
  onClose: () => void
}

export function ArchiveBody({ desk, initial, onQueued, onClose }: ArchiveBodyProps) {
  const [res, setRes] = useState<{ state: LampState; reason: string; listing: ArchiveListing | null } | null>(initial ? { ...initial } : null)
  const [keep, setKeep] = useState<Record<string, boolean>>(() => Object.fromEntries((initial?.listing.entries ?? []).map((e) => [e.id, !e.refused])))
  const [done, setDone] = useState<string | null>(null)
  const read = async (f: File) => {
    const r = await desk.archive(f)
    setRes({ state: r.state, reason: r.reason, listing: r.data })
    setKeep(Object.fromEntries((r.data?.entries ?? []).map((e) => [e.id, !e.refused])))
    setDone(null)
  }
  const entries = res?.listing?.entries ?? []
  const chosen = entries.filter((e) => !e.refused && keep[e.id])
  const queue = async () => {
    if (!res?.listing) return
    const r = await desk.queueArchive(res.listing.id, chosen.map((e) => e.id))
    const n = r.data?.queued ?? 0
    setDone(showsNumber(r.state) ? `${n} file${n === 1 ? '' : 's'} queued as PENDING for review` : `Not queued: ${r.reason}`)
    if (showsNumber(r.state)) onQueued?.(n)
  }
  return (
    <div className="ik-sheet-body">
      <p className="ik-sheet-note">{COPY.archiveNote}</p>
      <DropWell accept={['.zip']} title="Choose a Classroom export" sub="a .zip you made yourself; nothing is read until you pick it" onFile={(f) => void read(f)} />
      {res && (
        <div className="ik-result" role="status" data-component="archive-listing">
          <p className="ik-result-head">
            <Lamp reading={readingOf({ state: res.state, reason: res.reason })} />
            <span>{res.listing ? `${entries.length} entries in ${res.listing.name}` : `Not listed: ${res.reason}`}</span>
          </p>
          {res.listing && (
            <ul className="ik-entries" aria-label="Files inside the export">
              {entries.map((e) => (
                <li key={e.id} data-refused={e.refused ? 'true' : undefined}>
                  <span className="ik-entry-name">{e.name}</span>
                  <span className="ik-entry-meta">{e.refused ? `refused: ${e.refused}` : sizeWords(e.size)}</span>
                  {!e.refused && <Switch checked={!!keep[e.id]} onChange={(v) => setKeep((k) => ({ ...k, [e.id]: v }))} label={`Keep ${e.name}`} />}
                </li>
              ))}
            </ul>
          )}
          {done && <p className="ik-sheet-note">{done}</p>}
        </div>
      )}
      <div className="ik-sheet-act">
        <Button onClick={onClose}>Close</Button>
        <PrimaryButton claimId="intake-archive-queue" rank="overlay" disabled={chosen.length === 0 || !!done} onClick={() => void queue()}>
          {`Queue ${chosen.length} file${chosen.length === 1 ? '' : 's'}`}
        </PrimaryButton>
      </div>
    </div>
  )
}
