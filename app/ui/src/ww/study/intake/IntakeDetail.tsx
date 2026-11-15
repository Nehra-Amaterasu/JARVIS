// IntakeDetail (package C03, spec 21.4.2 S4): the chosen item. Where it came from (provenance, in a sentence), when it is due, its
// subject, and the keys. Accept and Decline are his; an ambiguous date must be chosen before Accept can be pressed (and the key
// says why while it cannot); a file row is taken to Papers or Notes instead of accepted. Nothing here changes a count: an
// accepted deadline is listed. Remove deletes the row, and only a file the app owns (the engine decides and says which).
import { useState } from 'react'
import { Button, PrimaryButton, Segmented } from '../../../shared/kit'
import { Lamp, readingOf, type LampReading } from '../../../shared/lamp'
import { AttachmentLadder } from './AttachmentLadder'
import { COPY } from './copy'
import { canAccept, dueWords, provenanceLine, readingWords, sizeWords, type Draft } from './model'
import { ProvenanceChip } from './ProvenanceChip'
import type { IntakeRow, SubjectOption } from './types'

const STATE_WORD = { new: 'New, waiting for you', accepted: 'Accepted', declined: 'Declined', taken: 'Sent for reading' } as const

export interface IntakeDetailProps {
  row: IntakeRow | null
  subjects: readonly SubjectOption[]
  now: number
  /** The lamp of the data the row came from (SIMULATED for the gallery's invented rows). */
  head: LampReading
  onAccept: (row: IntakeRow, draft: Draft) => void
  onDecline: (row: IntakeRow) => void
  onTake: (row: IntakeRow, to: 'papers' | 'notes') => void
  onBack: (row: IntakeRow) => void
  onRemove: (row: IntakeRow) => void
}

export function IntakeDetail({ row, subjects, now, head, onAccept, onDecline, onTake, onBack, onRemove }: IntakeDetailProps) {
  const [draft, setDraft] = useState<Draft>({})
  const [sure, setSure] = useState(false)
  if (!row) {
    return (
      <aside className="ik-detail ik-detail-none" aria-label="The chosen item" data-component="intake-detail">
        <p>Choose an item in the list.</p>
      </aside>
    )
  }
  const isNew = row.state === 'new'
  const isFile = row.kind === 'file'
  const subject = draft.subject ?? row.subject
  const sug = row.suggestion ? subjects.find((s) => s.id === row.suggestion!.subject) : undefined
  const ok = canAccept(row, draft)
  const dateChoice = draft.date ?? row.date ?? ''
  return (
    <aside className="ik-detail" aria-label="The chosen item" data-component="intake-detail" data-row={row.id}>
      <header className="ik-detail-head">
        <h2>{row.title}</h2>
        <Button
          size="sm"
          onClick={() => { if (sure || !row.file?.owned) { onRemove(row); setSure(false) } else setSure(true) }}
          title={COPY.removeNote}
        >
          {sure ? 'Press again to remove' : 'Remove'}
        </Button>
      </header>
      <p className="ik-prov-line"><ProvenanceChip source={row.source} /><span>{provenanceLine(row, now)}</span></p>
      <dl className="ik-facts">
        {!isFile && (
          <div>
            <dt>{row.kind === 'event' ? 'Starts' : 'Due'}</dt>
            <dd>{row.ambiguous && !row.date ? (draft.date ? readingWords(draft.date, now) : 'not chosen') : dueWords(row.date, row.time, now)}{row.repeats ? ', repeats, not expanded' : ''}</dd>
          </div>
        )}
        {isFile && row.file && <div><dt>File</dt><dd>{sizeWords(row.file.size)}{row.file.owned ? ', a copy the app holds' : ', in your folder'}</dd></div>}
        {!isNew && <div><dt>State</dt><dd>{STATE_WORD[row.state]}</dd></div>}
      </dl>
      {isNew && row.ambiguous && !row.date && (
        <Segmented
          variant="choice"
          label={COPY.chooseDate}
          value={dateChoice}
          onChange={(v) => setDraft((d) => ({ ...d, date: v }))}
          options={row.readings.map((r) => ({ id: r, label: readingWords(r, now) }))}
        />
      )}
      <div className="ik-subject">
        <label className="ik-subject-label" htmlFor="ik-subject">Subject</label>
        <select id="ik-subject" className="ik-select" value={subject} disabled={!isNew} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}>
          <option value="">No subject</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        {isNew && !subject && sug && (
          <Button size="sm" onClick={() => setDraft((d) => ({ ...d, subject: sug.id }))}>{`Use ${sug.label}`}</Button>
        )}
      </div>
      {isFile && <AttachmentLadder row={row} />}
      <div className="ik-keys">
        {isNew && !isFile && (
          <>
            <PrimaryButton claimId="intake-accept" rank="workspace" size="lg" disabledReason={ok ? undefined : COPY.ambiguousNeeds} onClick={() => onAccept(row, { ...draft, subject })}>
              Accept<kbd className="ik-key" aria-hidden="true">A</kbd>
            </PrimaryButton>
            <Button size="lg" onClick={() => onDecline(row)}>Decline<kbd className="ik-key" aria-hidden="true">D</kbd></Button>
          </>
        )}
        {isNew && isFile && (
          <>
            <PrimaryButton claimId="intake-accept" rank="workspace" size="lg" onClick={() => onTake(row, 'papers')}>Take to Papers</PrimaryButton>
            <Button size="lg" onClick={() => onTake(row, 'notes')}>Take to Notes</Button>
            <Button size="lg" onClick={() => onDecline(row)}>Decline<kbd className="ik-key" aria-hidden="true">D</kbd></Button>
          </>
        )}
        {!isNew && <Button size="lg" onClick={() => onBack(row)}>Back to new<kbd className="ik-key" aria-hidden="true">U</kbd></Button>}
      </div>
      {sure && <p id="ik-remove-note" className="ik-detail-note" role="status">{COPY.removeNote}</p>}
      <p className="ik-detail-lamp"><Lamp reading={readingOf(head)} /></p>
    </aside>
  )
}
