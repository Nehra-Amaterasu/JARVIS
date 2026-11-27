// ExportImportDrop (package C03 and row R25, spec 21.4.2 S6, door 4): the door takes a Classroom export .zip he made himself, by a path
// on this PC or by picking the file (R-46), and lists what is inside BEFORE anything is taken. Each entry carries the engine's verdict
// (a kind it reads, or its own refusal sentence), and a Send to paper desk key of its own (R-47, one name per press, the engine's
// answer printed under that entry). Nothing is extracted and nothing is sent until that key is pressed. The same well also takes a
// calendar file .ics (IcsPreview).
import { useRef, useState, type DragEvent } from 'react'
import { Button, PrimaryButton } from '../../../shared/kit'
import { Lamp, readingOf, showsNumber, type LampState } from '../../../shared/lamp'
import { COPY } from './copy'
import { sizeWords } from './model'
import type { IntakeDeskPort } from './port'
import type { ArchiveEntry, ArchiveListing } from './types'

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
  /** Told after the engine accepted one entry, with its name. */
  onSent?: (name: string) => void
  onClose: () => void
}

type Say = { state: LampState; reason: string }
/** What an entry can be: a kind the paper desk reads and no refusal; anything else says why not, in the engine's words when it has some. */
export const entryVerdict = (e: ArchiveEntry): { sendable: boolean; word: string } => {
  if (e.refused) return { sendable: false, word: `refused: ${e.refused}` }
  if (e.kind === 'other') return { sendable: false, word: 'not a .pdf or .pptx; only those are read' }
  return { sendable: true, word: `${e.kind ? e.kind.toUpperCase() : 'file'}, ${sizeWords(e.size)}` }
}

export function ArchiveBody({ desk, initial, onSent, onClose }: ArchiveBodyProps) {
  const [res, setRes] = useState<{ state: LampState; reason: string; listing: ArchiveListing | null } | null>(initial ? { ...initial } : null)
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<Record<string, Say>>({})
  const [sending, setSending] = useState<Record<string, boolean>>({})
  const show = (r: { state: LampState; reason: string; data: ArchiveListing | null }) => {
    setRes({ state: r.state, reason: r.reason, listing: showsNumber(r.state) ? r.data : null })
    setSaid({})
    setSending({})
  }
  const readFile = async (f: File) => { setBusy(true); show(await desk.archive(f)); setBusy(false) }
  const readPath = async () => {
    if (!desk.archivePath || !path.trim()) return
    setBusy(true)
    show(await desk.archivePath(path.trim()))
    setBusy(false)
  }
  const send = async (e: ArchiveEntry) => {
    if (!res?.listing) return
    setSending((s) => ({ ...s, [e.id]: true }))
    const r = await desk.queueArchive(res.listing.id, [e.id])
    setSending((s) => ({ ...s, [e.id]: false }))
    setSaid((s) => ({ ...s, [e.id]: { state: r.state, reason: r.reason } }))
    if (showsNumber(r.state)) onSent?.(e.name)
  }
  const entries = res?.listing?.entries ?? []
  return (
    <div className="ik-sheet-body" data-component="archive-door">
      <p className="ik-sheet-note">{COPY.archiveNote}</p>
      {desk.archivePath && (
        <div className="ik-path">
          <label className="ww-sr-only" htmlFor="ik-zip-path">Full path of the export .zip on this PC</label>
          <input
            id="ik-zip-path"
            className="ik-input"
            value={path}
            placeholder="Full path of the .zip on this PC, like D:\Exports\classroom.zip"
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void readPath() } }}
          />
          <PrimaryButton claimId="intake-archive-list" rank="overlay" disabled={!path.trim() || busy} onClick={() => void readPath()}>List it</PrimaryButton>
        </div>
      )}
      <DropWell accept={['.zip']} title="Or choose a Classroom export" sub="a .zip you made yourself; it is only listed until you send an entry" onFile={(f) => void readFile(f)} />
      {res && (
        <div className="ik-result" role="status" data-component="archive-listing">
          <p className="ik-result-head">
            <Lamp reading={readingOf({ state: res.state, reason: res.reason })} />
            <span>{res.listing ? `${entries.length} file${entries.length === 1 ? '' : 's'} in ${res.listing.name}` : `Not listed: ${res.reason}`}</span>
          </p>
          {res.listing && <p className="ik-sheet-note">{res.reason}{res.listing.note ? ` ${res.listing.note}` : ''}</p>}
          {res.listing && (
            <ul className="ik-entries" aria-label="Files inside the export">
              {entries.map((e) => {
                const v = entryVerdict(e)
                const a = said[e.id]
                const sent = !!a && showsNumber(a.state)
                return (
                  <li key={e.id} className="ik-entry" data-entry={e.id} data-refused={v.sendable ? undefined : 'true'}>
                    <span className="ik-entry-name">{e.name}</span>
                    <span className="ik-entry-meta">{v.word}</span>
                    {v.sendable && (
                      <span className="ik-entry-act">
                        <Button disabled={sent || !!sending[e.id]} onClick={() => void send(e)}>{sent ? 'Sent' : 'Send to paper desk'}</Button>
                      </span>
                    )}
                    {a && <p className="ik-entry-say" role="status"><Lamp reading={readingOf(a)} /><span>{a.reason}</span></p>}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
      <div className="ik-sheet-act"><Button onClick={onClose}>Close</Button></div>
    </div>
  )
}
