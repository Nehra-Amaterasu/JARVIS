// The two lists of the Classroom shelf: the courses (name, section, state, the subject he maps it to, the include switch, the counts)
// and the files of the chosen course (title, type, the post's topic, state, why the note is what it is). Both are presentational:
// the shelf owns the data and the presses, so a list never calls the engine itself.
import { createContext, useContext } from 'react'
import { Field, Segmented, Switch } from '../../../shared/kit'
import { Lamp, readingOf, type LampReading, type LampState } from '../../../shared/lamp'
import type { GcrCourse, GcrFile, GcrKind } from '../adapters/gcrTypes'
import type { SubjectOption } from '../intake/types'

/** Course id -> name, from the courses the shelf read. "Also in" is an id on the wire (a Google course id, 10 digits in real life), and
 *  an id is not a thing to read: the shelf provides the names, and a course not in the list falls back to the post's title. */
export const CourseNames = createContext<Readonly<Record<string, string>>>({})

export const STALE_SENTENCE = 'An older copy: the newer version could not be fetched'
/** The two honest notes of a file: an older copy, and the other courses it was posted in. */
export function FileNotes({ f }: { f: GcrFile }) {
  const names = useContext(CourseNames)
  const also = (f.also_in ?? []).map((a) => names[a.course] || a.course).filter(Boolean)
  return (
    <>
      {f.stale && <span className="cr-fine" data-component="classroom-stale">{STALE_SENTENCE}</span>}
      {also.length > 0 && <span className="cr-fine" data-component="classroom-also">{`Also in: ${also.join(', ')}`}</span>}
    </>
  )
}

/** A pose for an empty or unanswered list: the state word and the engine's reason, never a skeleton. */
export function Pose({ reading, title }: { reading: LampReading; title: string }) {
  return (
    <div className="cr-pose" data-component="classroom-pose" data-state={reading.state}>
      <p className="cr-pose-title">{title}</p>
      <p className="cr-state"><Lamp reading={reading} />{reading.reason && <span className="cr-why">{reading.reason}</span>}</p>
    </div>
  )
}

export interface Notice { state: LampState; text: string }

/** The engine's sentence for the last press on the shelf (a kind change, a send to the paper desk, a refusal), with its state. */
export function NoticeLine({ notice }: { notice: Notice | null }) {
  if (!notice) return null
  return (
    <p className="cr-say" role="status" data-component="classroom-notice">
      <Lamp reading={readingOf({ state: notice.state, reason: notice.text })} />
      <span>{notice.text}</span>
    </p>
  )
}

export interface CoursesPaneProps {
  items: readonly GcrCourse[]
  subjects: readonly SubjectOption[]
  chosen: string | null
  onChoose: (id: string | null) => void
  onSubject: (course: GcrCourse, subject: string) => void
  onInclude: (course: GcrCourse, include: boolean) => void
}

export function CoursesPane({ items, subjects, chosen, onChoose, onSubject, onInclude }: CoursesPaneProps) {
  return (
    <ul className="cr-rows" aria-label="Courses" data-component="classroom-courses">
      {items.map((c) => {
        const known = subjects.some((s) => s.id === c.subject)
        return (
          <li key={c.id} className="cr-course" data-course={c.id} data-chosen={chosen === c.id ? 'true' : undefined}>
            <button type="button" className="cr-pick" aria-pressed={chosen === c.id} onClick={() => onChoose(chosen === c.id ? null : c.id)}>
              <span className="cr-name">{c.name}</span>
              {c.section && <span className="cr-fine">{c.section}</span>}
              <span className="cr-fine"><Lamp reading={readingOf({ state: c.state, reason: c.state === 'live' || !c.google_state ? '' : `Google says: ${c.google_state}` })} /></span>
              <span className="cr-fine">{`${c.files} files, ${c.notes} notes, ${c.papers} papers`}</span>
            </button>
            <div className="cr-ctl">
              <Field kind="select" label={`Subject for ${c.name}`} value={c.subject} onChange={(e) => onSubject(c, e.target.value)} hint={c.subject && c.subject_source ? `from ${c.subject_source}` : undefined}>
                <option value="">Not mapped</option>
                {!known && c.subject && <option value={c.subject}>{c.subject}</option>}
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </Field>
              <Switch checked={c.include} onChange={(v) => onInclude(c, v)} label={`Include ${c.name}`} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export type KindFilter = 'all' | GcrKind
const KINDS: { id: KindFilter; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'notes', label: 'Notes' }, { id: 'paper', label: 'Papers' }, { id: 'other', label: 'Other' }]

export interface FilesPaneProps {
  items: readonly GcrFile[]
  chosen: string | null
  onChoose: (id: string) => void
  query: string
  onQuery: (q: string) => void
  kind: KindFilter
  onKind: (k: KindFilter) => void
}

export function FilesFilter({ query, onQuery, kind, onKind }: Pick<FilesPaneProps, 'query' | 'onQuery' | 'kind' | 'onKind'>) {
  return (
    <div className="cr-filter" data-component="classroom-filter">
      <Field label="Search files" value={query} onChange={(e) => onQuery(e.target.value)} />
      <Segmented<KindFilter> variant="choice" label="Kind of file" value={kind} onChange={onKind} options={KINDS} />
    </div>
  )
}

export function FilesPane({ items, chosen, onChoose }: Pick<FilesPaneProps, 'items' | 'chosen' | 'onChoose'>) {
  return (
    <ul className="cr-rows" aria-label="Files" data-component="classroom-files">
      {items.map((f) => (
        <li key={f.id} className="cr-file" data-file={f.id}>
          <button type="button" className="cr-pick" aria-pressed={chosen === f.id} onClick={() => onChoose(f.id)}>
            <span className="cr-name">{f.title}</span>
            <span className="cr-fine">{[f.ext.toUpperCase(), f.post?.topic].filter(Boolean).join(', ')}</span>
            <span className="cr-fine"><Lamp reading={readingOf({ state: f.state, reason: '' })} /></span>
            {f.note_reason && <span className="cr-fine" data-component="classroom-note-state"><span className="cr-tag">Note</span> <Lamp reading={readingOf({ state: f.note_state, reason: '' })} /> {f.note_reason}</span>}
            <FileNotes f={f} />
          </button>
        </li>
      ))}
    </ul>
  )
}
