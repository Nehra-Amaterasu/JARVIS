// ImportTray (package Y01, spec 21.3.2 S1): the Drop Slot grown into a route list. Closed it is the 300 x 100 well; open (on
// hover, on focus inside it, on a drag, or by its key) it becomes a 300 x 260 tray of four 44 px route rows (Drop, Paste,
// Folder, Classroom), each with its lamp, and the file being read with a words-per-page trace. Keys on the desk: `A` files,
// `V` paste, `W` folder; Enter on a queued row opens its Extraction Trace. The Classroom row is PLANNED and opens the honest
// explanation, never a form. Esc closes the tray.
import { useState, type KeyboardEvent } from 'react'
import { Lamp, readingOf } from '../../../shared/lamp'
import type { IngestRoute, QueuedFile, RouteId } from '../ports'
import { PaperDrop, type PaperDropProps } from './PaperDrop'

export interface ImportTrayProps {
  routes: readonly IngestRoute[]
  queued: readonly QueuedFile[]
  onFiles: (files: File[]) => void
  accept: PaperDropProps['accept']
  /** A route row was pressed (paste, folder, classroom). The drop row opens the file chooser itself. */
  onRoute?: (id: RouteId) => void
  /** Enter on a queued row. */
  onOpenTrace?: (fileId: string) => void
  inputRef?: PaperDropProps['inputRef']
  /** Keep the tray open (the gallery shows the open state). */
  defaultOpen?: boolean
}

const KEY: Record<RouteId, string> = { drop: 'A', paste: 'V', folder: 'W', classroom: '' }
const METHOD: Record<QueuedFile['method'], string> = { 'text-layer': 'text layer', ocr: 'OCR', pasted: 'pasted', slides: 'slides' }

/** Words per page as one line of block glyphs; a page with no words is a gap, so a scan with no text layer shows at a glance. */
export function wordsTrace(words: readonly number[]): string {
  if (words.length === 0) return ''
  const hi = Math.max(1, ...words)
  const blocks = '▁▂▃▄▅▆▇█'
  return words.map((w) => (w === 0 ? '·' : blocks[Math.min(7, Math.floor((w / hi) * 7.999))])).join('')
}

export function ImportTray({ routes, queued, onFiles, accept, onRoute, onOpenTrace, inputRef, defaultOpen }: ImportTrayProps) {
  const [open, setOpen] = useState(!!defaultOpen)
  const [dragging, setDragging] = useState(false)
  const [refused, setRefused] = useState(false)
  const reading = queued.some((q) => q.reading)
  const expanded = open || dragging
  const state = refused ? 'refused-type' : reading ? 'reading' : expanded ? 'hover' : 'idle'
  const shown = queued.slice(0, 1)
  const more = queued.length - shown.length

  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) { setOpen(false); e.stopPropagation() } }
  const route = (id: RouteId) => routes.find((r) => r.id === id)

  return (
    <div
      className="pp-tray"
      data-component="import-tray"
      data-state={state}
      data-open={expanded ? 'true' : 'false'}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={(e) => { if (!e.currentTarget.contains(document.activeElement)) setOpen(false) }}
      onFocus={() => setOpen(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false) }}
      onDragEnter={() => setDragging(true)}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false) }}
      onDrop={() => setDragging(false)}
      onKeyDown={onKey}
    >
      <div className="pp-tray-body">
        <PaperDrop
          onFiles={(f) => { setRefused(false); onFiles(f) }}
          accept={accept}
          reading={reading}
          inputRef={inputRef}
          variant={expanded ? 'row' : 'well'}
          onRefused={() => setRefused(true)}
        />
        {expanded && (
          <ul className="pp-routes" aria-label="Ways to bring a paper in">
            {(['paste', 'folder', 'classroom'] as RouteId[]).map((id) => {
              const r = route(id)
              if (!r) return null
              return (
                <li key={id}>
                  <button type="button" className="pp-route" data-route={id} aria-keyshortcuts={KEY[id] || undefined} onClick={() => onRoute?.(id)}>
                    <span className="pp-route-label">{r.label}</span>
                    <Lamp reading={readingOf({ state: r.state, reason: r.reason })} />
                    {KEY[id] && <kbd className="pp-key" aria-hidden="true">{KEY[id]}</kbd>}
                  </button>
                </li>
              )
            })}
            <li className="pp-queue" aria-label="Queued files">
              {queued.length === 0 && <span className="pp-queue-none">Nothing queued</span>}
              {shown.map((q) => (
                <button key={q.id} type="button" className="pp-qrow" onClick={() => onOpenTrace?.(q.id)} aria-label={`${q.name}, ${METHOD[q.method]}, open its trace`}>
                  <span className="pp-qname">{q.name}</span>
                  <span className="pp-qmeth">{METHOD[q.method]}</span>
                  <span className="pp-qtrace" aria-hidden="true">{wordsTrace(q.wordsPerPage) || (q.reading ? 'reading' : '')}</span>
                  <span className="ww-sr-only">{q.wordsPerPage.length ? `words per page ${q.wordsPerPage.join(', ')}` : 'not read yet'}</span>
                </button>
              ))}
              {more > 0 && <span className="pp-queue-more">+{more} queued</span>}
            </li>
          </ul>
        )}
      </div>
    </div>
  )
}
