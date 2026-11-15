// CourseMapper and CourseMapRow (package C03, spec 21.4.2 S3): one row per class name read from his lists, each mapped to one
// subject by him. A suggestion (name overlap at 0.6 or more) is a chip he presses; it is never applied by itself. His choice is
// kept and never overwritten by a later reading. The per-class "pull announcements" switch is drawn PLANNED (it needs the
// Classroom link); there is no auto-accept switch, because nothing here is accepted without his press.
import { useEffect, useState } from 'react'
import { Button, Chip, Switch } from '../../../shared/kit'
import { Lamp, readingOf, showsNumber, type LampState } from '../../../shared/lamp'
import { COPY } from './copy'
import type { IntakeDeskPort } from './port'
import type { CourseRow, SubjectOption } from './types'

const SHORT = 36

export interface CourseMapRowProps {
  course: CourseRow
  subjects: readonly SubjectOption[]
  onMap: (subject: string) => void
}

export function CourseMapRow({ course, subjects, onMap }: CourseMapRowProps) {
  const sug = course.suggestion ? subjects.find((s) => s.id === course.suggestion!.subject) : undefined
  const long = course.name.length > SHORT
  return (
    <li className="ik-course" data-component="course-map-row" data-mapped={course.subject ? 'true' : 'false'}>
      <span className="ik-course-name" title={course.name} tabIndex={long ? 0 : undefined} aria-label={long ? course.name : undefined}>
        {long ? `${course.name.slice(0, SHORT - 1)}…` : course.name}
      </span>
      <span className="ik-course-from">{course.from === 'classroom' ? 'from Classroom' : `from your lists, ${course.items} item${course.items === 1 ? '' : 's'}`}</span>
      <label className="ik-course-pick">
        <span className="ww-sr-only">{`Subject for ${course.name}`}</span>
        <select className="ik-select" value={course.subject} onChange={(e) => onMap(e.target.value)}>
          <option value="">Not mapped</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      {!course.subject && sug && (
        <Chip tone="neutral" onClick={() => onMap(sug.id)}>{`Suggested: ${sug.label}`}</Chip>
      )}
      <Switch className="ik-course-sw" checked={false} onChange={() => undefined} label="Pull announcements" planned onPlanned={() => undefined} />
    </li>
  )
}

export interface CourseMapperProps {
  desk: IntakeDeskPort
  /** Told after a mapping saved, so the ledger can show the subject. */
  onMapped?: (course: CourseRow) => void
  onClose: () => void
}

export function CourseMapper({ desk, onMapped, onClose }: CourseMapperProps) {
  const [courses, setCourses] = useState<CourseRow[] | null>(null)
  const [subjects, setSubjects] = useState<SubjectOption[]>([])
  const [head, setHead] = useState<{ state: LampState; reason: string }>({ state: 'waiting', reason: 'reading your class names' })
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void Promise.all([desk.courses(), desk.subjects()]).then(([c, s]) => {
      if (!live) return
      setHead({ state: c.state, reason: c.reason })
      setCourses(showsNumber(c.state) && c.data ? c.data : [])
      setSubjects(showsNumber(s.state) && s.data ? s.data : [])
    })
    return () => { live = false }
  }, [desk])
  const map = async (c: CourseRow, subject: string) => {
    const r = await desk.mapCourse(c.id, subject)
    if (showsNumber(r.state) && r.data) { setCourses((cs) => (cs ?? []).map((x) => (x.id === c.id ? r.data! : x))); onMapped?.(r.data); setNote(null) }
    else setNote(`Not saved: ${r.reason}`)
  }
  return (
    <div className="ik-sheet-body" data-component="course-mapper">
      <p className="ik-sheet-note">{COPY.coursesNote}</p>
      <p className="ik-result-head"><Lamp reading={readingOf(head)} /><span>{courses && courses.length ? `${courses.length} class names` : head.reason}</span></p>
      {courses && courses.length === 0 && <p className="ik-empty-line">{COPY.coursesEmpty}</p>}
      {courses && courses.length > 0 && (
        <ul className="ik-courses" aria-label="Classes and their subjects">
          {courses.map((c) => <CourseMapRow key={c.id} course={c} subjects={subjects} onMap={(s) => void map(c, s)} />)}
        </ul>
      )}
      {note && <p className="ik-sheet-note" role="status">{note}</p>}
      <div className="ik-sheet-act"><Button onClick={onClose}>Close</Button></div>
    </div>
  )
}
