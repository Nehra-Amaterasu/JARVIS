// The reader of the Classroom shelf: the chosen file's card with its keys (Read note, Open original, Open in its own program, Mark
// as paper or notes, Send to paper desk), the sentence the engine gave for the last press, and what was opened. A note is Markdown
// shown by NoteView. A PDF original goes in an <iframe> and an image in an <img>, both from a blob URL the shelf made from the bytes
// of G-11 (an <iframe src> cannot send the token header); the shelf revokes the URL when the reader closes.
import { useEffect, useRef, type RefObject } from 'react'
import { Button } from '../../../shared/kit'
import { Lamp, readingOf } from '../../../shared/lamp'
import type { GcrAnswer, GcrFile, GcrNoteBody, GcrOriginal } from '../adapters/gcrTypes'
import { NoteView } from './markdown'
import { FileNotes, Pose } from './ShelfPanes'

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']
export const isPdf = (f: GcrFile): boolean => f.ext.toLowerCase().replace(/^\./, '') === 'pdf'
export const isImage = (f: GcrFile): boolean => IMAGE_EXT.includes(f.ext.toLowerCase().replace(/^\./, ''))
/** What the app can show itself; every other type opens in the PC's own program. */
export const showsInApp = (f: GcrFile): boolean => isPdf(f) || isImage(f)

export interface OpenedView {
  fileId: string
  mode: 'note' | 'original'
  loading: boolean
  note?: GcrAnswer<GcrNoteBody>
  original?: GcrAnswer<GcrOriginal>
}

export interface ReaderProps {
  file: GcrFile | null
  opened: OpenedView | null
  busy: boolean
  onNote: (f: GcrFile) => void
  onOriginal: (f: GcrFile) => void
  onProgram: (f: GcrFile) => void
  onKind: (f: GcrFile, kind: 'notes' | 'paper') => void
  onToPapers: (f: GcrFile) => void
  onClose: () => void
}

function Facts({ f }: { f: GcrFile }) {
  const parts = [
    f.pages ? `${f.pages} pages` : '',
    f.words ? `${f.words} words` : '',
    f.scanned_pages ? `${f.scanned_pages} scanned pages` : '',
    f.course_name,
  ].filter(Boolean)
  return parts.length ? <p className="cr-note">{parts.join(', ')}</p> : null
}

/** In one column (a phone) the reader sits below the lists, out of sight; this brings it up when the owner chooses a file or opens
 *  something. With three columns it is already in view, so nothing moves. jsdom has no scrollIntoView, so it is called only where it exists. */
function useBringIntoView(ref: RefObject<HTMLElement | null>, key: string) {
  useEffect(() => {
    const el = ref.current
    const grid = el?.closest('.cr-grid')
    if (!el || !grid || typeof el.scrollIntoView !== 'function') return
    if (getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length > 1) return
    el.scrollIntoView({ block: 'start' })
  }, [ref, key])
}

export function Reader({ file, opened, busy, onNote, onOriginal, onProgram, onKind, onToPapers, onClose }: ReaderProps) {
  const card = useRef<HTMLDivElement>(null)
  const open = useRef<HTMLElement>(null)
  useBringIntoView(card, file?.id ?? '')
  useBringIntoView(open, opened && opened.fileId === file?.id ? `${opened.mode}-${opened.loading}` : '')
  if (!file) return <Pose title="Choose a file to read it here." reading={readingOf({ state: 'waiting', reason: 'no file chosen' })} />
  const inApp = showsInApp(file)
  return (
    <div className="cr-reader" ref={card} data-component="classroom-reader" data-file={file.id}>
      <header className="cr-card">
        <h3 className="cr-card-title">{file.title}</h3>
        <p className="cr-state"><span className="cr-tag">File</span><Lamp reading={readingOf({ state: file.state, reason: file.reason })} />{file.reason && <span className="cr-why">{file.reason}</span>}</p>
        {file.note_reason && <p className="cr-state"><span className="cr-tag">Note</span><Lamp reading={readingOf({ state: file.note_state, reason: file.note_reason })} /><span className="cr-why">{file.note_reason}</span></p>}
        <Facts f={file} />
        <FileNotes f={file} />
        <div className="cr-keys">
          <Button size="sm" grouped onClick={() => onNote(file)} disabledReason={file.has_note ? undefined : 'There is no note for this file yet.'}>Read note</Button>
          {inApp
            ? <Button size="sm" grouped onClick={() => onOriginal(file)} disabledReason={file.has_original ? undefined : 'The original is not on this PC.'}>Open original</Button>
            : null}
          <Button size="sm" grouped onClick={() => onProgram(file)} disabledReason={file.has_original ? undefined : 'The original is not on this PC.'}>Open in its own program</Button>
          {file.kind !== 'paper' && <Button size="sm" grouped onClick={() => onKind(file, 'paper')} disabledReason={busy ? 'Working.' : undefined}>Mark as paper</Button>}
          {file.kind !== 'notes' && <Button size="sm" grouped onClick={() => onKind(file, 'notes')} disabledReason={busy ? 'Working.' : undefined}>Mark as notes</Button>}
          {isPdf(file) && (
            <Button size="sm" grouped onClick={() => onToPapers(file)} disabledReason={file.kind !== 'paper' ? 'Mark it as a paper first.' : busy ? 'Working.' : undefined}>Send to paper desk</Button>
          )}
        </div>
      </header>
      {opened && opened.fileId === file.id && (
        <section className="cr-open" ref={open} aria-label={opened.mode === 'note' ? 'The note' : 'The original'} data-component="classroom-open" data-mode={opened.mode}>
          <div className="cr-open-bar">
            <span className="cr-open-name">{opened.mode === 'note' ? 'Note' : 'Original'}</span>
            <Button size="sm" grouped onClick={onClose}>Close</Button>
          </div>
          {opened.loading && <p className="cr-note">Reading…</p>}
          {opened.mode === 'note' && opened.note && (
            opened.note.data && opened.note.data.markdown
              ? <NoteView markdown={opened.note.data.markdown} />
              : <Pose title="No note to show." reading={readingOf({ state: opened.note.state, reason: opened.note.reason })} />
          )}
          {opened.mode === 'original' && opened.original && (
            opened.original.data
              ? (isPdf(file)
                ? <iframe className="cr-frame" title={`Original of ${file.title}`} src={opened.original.data.url} />
                : <img className="cr-img" alt={`Original: ${file.title}`} src={opened.original.data.url} />)
              : <Pose title="The original could not be shown." reading={readingOf({ state: opened.original.state, reason: opened.original.reason })} />
          )}
        </section>
      )}
    </div>
  )
}
