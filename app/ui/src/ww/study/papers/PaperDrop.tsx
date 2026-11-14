// PaperDrop (package Y01, spec 20.7.1): the Drop Slot, a neumorphic well that takes a PDF or photos of a paper. Drag files onto
// it or press the key (`A` on the desk) to choose. The ASCII rule is static; it sweeps only while a file is being read (3 s cap,
// never at idle, and not at all under reduced motion). A file of another kind is refused in words, and nothing is read.
import { useRef, useState, type DragEvent, type RefObject } from 'react'
import { COPY } from './copy'

export interface PaperDropProps {
  onFiles: (files: File[]) => void
  /** Accepted kinds: a MIME type ("application/pdf"), a MIME family ("image/*") or an extension (".pdf"). */
  accept: readonly string[]
  /** A file is being read: the rule sweeps once (3 s at most). */
  reading?: boolean
  /** `well` is the 300 x 100 slot; `row` is the 44 px Drop row inside an open tray. */
  variant?: 'well' | 'row'
  /** The desk reaches the file chooser through this (the `A` key). */
  inputRef?: RefObject<HTMLInputElement | null>
  /** Told when a drop held a kind that is not accepted (the tray shows its refused-type state). */
  onRefused?: (names: string[]) => void
}

/** Does one file match the accept list? Pure, so a test can try every kind. */
export function acceptsFile(file: { name: string; type: string }, accept: readonly string[]): boolean {
  const name = file.name.toLowerCase()
  const type = file.type.toLowerCase()
  return accept.some((a) => {
    const k = a.toLowerCase().trim()
    if (k.startsWith('.')) return name.endsWith(k)
    if (k.endsWith('/*')) return type.startsWith(k.slice(0, -1))
    return type === k
  })
}

export const PAPER_ACCEPT: readonly string[] = ['application/pdf', 'image/*', '.pdf']

const RULE = '+-------------------------+'

export function PaperDrop({ onFiles, accept, reading, variant = 'well', inputRef, onRefused }: PaperDropProps) {
  const own = useRef<HTMLInputElement>(null)
  const input = inputRef ?? own
  const [over, setOver] = useState(false)
  const [refused, setRefused] = useState<string[]>([])

  const take = (list: FileList | File[] | null | undefined) => {
    const all = Array.from(list ?? [])
    const ok = all.filter((f) => acceptsFile(f, accept))
    const bad = all.filter((f) => !acceptsFile(f, accept)).map((f) => f.name)
    setRefused(bad)
    if (bad.length) onRefused?.(bad)
    if (ok.length) onFiles(ok)
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    take(e.dataTransfer?.files)
  }
  const state = refused.length ? 'refused-type' : reading ? 'reading' : over ? 'hover' : 'idle'

  return (
    <div
      className="pp-drop"
      data-component="paper-drop"
      data-state={state}
      data-variant={variant}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <button type="button" className="pp-drop-btn" onClick={() => input.current?.click()} aria-keyshortcuts="A">
        <span className="pp-drop-rule" aria-hidden="true" data-rule={RULE} data-sweep={reading ? 'true' : undefined}>{RULE}</span>
        <span className="pp-drop-title">{reading ? 'Reading the file' : variant === 'row' ? 'Drop PDF or photos' : 'Drop a paper here'}</span>
        <span className="pp-drop-sub">
          {refused.length ? `${COPY.refusedType}: ${refused.slice(0, 2).join(', ')}` : variant === 'row' ? 'or choose files' : 'PDF or photos, or choose files'}
        </span>
        <kbd className="pp-key" aria-hidden="true">A</kbd>
      </button>
      <input
        ref={input}
        hidden
        type="file"
        multiple
        accept={accept.join(',')}
        aria-label="Choose paper files"
        onChange={(e) => { take(e.target.files); e.target.value = '' }}
      />
      <span className="ww-sr-only" role="status">{state === 'refused-type' ? `${COPY.refusedType}: ${refused.join(', ')}` : ''}</span>
    </div>
  )
}
