// PasteParser (package C03, spec 21.4.2 S6, door 2): a well that takes lines such as "Maths Assignment 3 - due 18 Nov 5pm".
// Ctrl+Enter reads, and the reading is a table: every line that was read, with its date in words, and every line that was
// not, with the reason. A line that cannot be read is listed, never guessed. The lines that were read are now NEW rows of the
// ledger; nothing is accepted, and no count changes, until he presses Accept there.
import { useEffect, useRef, useState } from 'react'
import { Button, PrimaryButton } from '../../../shared/kit'
import { Lamp, readingOf, showsNumber, type LampState } from '../../../shared/lamp'
import { COPY } from './copy'
import { dueWords } from './model'
import type { IntakeDeskPort } from './port'
import type { IntakeRow, PasteResult } from './types'

export interface PasteBodyProps {
  desk: IntakeDeskPort
  now: number
  onRows: (rows: IntakeRow[]) => void
  onClose: () => void
  /** The gallery fills the well and reads it on mount. */
  initialText?: string
  autoRead?: boolean
}

export function PasteBody({ desk, now, onRows, onClose, initialText = '', autoRead }: PasteBodyProps) {
  const [text, setText] = useState(initialText)
  const [res, setRes] = useState<{ state: LampState; reason: string; data: PasteResult | null } | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const ran = useRef(false)
  const read = async (t = text) => {
    if (!t.trim()) return
    const r = await desk.paste(t)
    setRes({ state: r.state, reason: r.reason, data: showsNumber(r.state) ? r.data : null })
    if (showsNumber(r.state) && r.data) onRows(r.data.items)
  }
  useEffect(() => {
    if (autoRead && !ran.current) { ran.current = true; void read(initialText) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const items = res?.data?.items ?? []
  const unread = res?.data?.unread ?? []
  return (
    <div className="ik-sheet-body" data-component="paste-parser">
      <p className="ik-sheet-note">{COPY.pasteNote}</p>
      <label className="ik-paste-label" htmlFor="ik-paste">Pasted lines</label>
      <textarea
        id="ik-paste"
        ref={ref}
        className="ik-paste"
        value={text}
        rows={6}
        placeholder={COPY.pasteHint}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void read() } }}
      />
      {res && (
        <div className="ik-result" role="status" data-component="paste-reading">
          <p className="ik-result-head">
            <Lamp reading={readingOf({ state: res.state, reason: res.reason })} />
            <span>{res.data ? `${items.length} line${items.length === 1 ? '' : 's'} read, ${unread.length} not read` : `Not read: ${res.reason}`}</span>
          </p>
          {res.data && <p className="ik-sheet-note">{res.reason}</p>}
          {res.data && (
            <ul className="ik-entries" aria-label="What was read">
              {items.map((r) => (
                <li key={r.id}>
                  <span className="ik-entry-name">{r.title}</span>
                  <span className="ik-entry-meta">{r.ambiguous ? 'date needs your choice' : dueWords(r.date, r.time, now)}</span>
                </li>
              ))}
              {unread.map((u) => (
                <li key={`u${u.line}`} data-refused="true">
                  <span className="ik-entry-name">{u.text}</span>
                  <span className="ik-entry-meta">{`line ${u.line}: ${u.reason}`}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="ik-sheet-act">
        <Button onClick={onClose}>Close</Button>
        <PrimaryButton claimId="intake-paste-read" rank="overlay" disabled={!text.trim()} onClick={() => void read()}>Read these lines</PrimaryButton>
      </div>
    </div>
  )
}
