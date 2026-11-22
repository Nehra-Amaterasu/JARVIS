// The Classroom shelf (a face of Study > Library, beside Intake and Library): the courses the link read, the files of the chosen
// course, and a reader for a note or the original. Three trays under the v3 look, named COURSES (the link, its sync key and the
// courses), FILES (search, kind filter and the files of the chosen course) and READER (the chosen file's card and what was opened);
// under the current look the same three parts sit in a row that folds to one column when the desk is narrow.
//
// It reads only through the typed client (adapters/gcr.ts), and every request carries one AbortSignal that the unmount fires.
// Nothing here is invented: with no link, or no engine, the lists are a pose with the engine's reason; every state word is the
// engine's own; the original is a blob URL that is revoked when the reader closes or the shelf goes away.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button } from '../../../shared/kit'
import { Lamp, readingOf, showsNumber } from '../../../shared/lamp'
import { lookV3Enabled, Zones } from '../../../shell/v3'
import type { GcrClient } from '../adapters/gcr'
import { gcrClient } from '../adapters/gcr.register'
import type { GcrAnswer, GcrCourse, GcrFile } from '../adapters/gcrTypes'
import { intakeDesk, type IntakeDeskPort } from '../intake/port'
import type { SubjectOption } from '../intake/types'
import { LinkPanel, linkReading } from './LinkPanel'
import { Reader, type OpenedView } from './Reader'
import { CoursesPane, FilesFilter, FilesPane, NoticeLine, Pose, type KindFilter, type Notice } from './ShelfPanes'
import { useClassroomLink } from './useClassroomLink'
import './classroom.css'
import './classroom-v3.css'

/** The search waits this long after the last key before it asks the engine (G-08 takes the text as `q`). */
export const SEARCH_MS = 300

export interface ClassroomShelfProps {
  client?: GcrClient
  desk?: IntakeDeskPort
  /** Placed at the head (the shell view puts its face switch here). */
  extra?: ReactNode
}

export function ClassroomShelf({ client = gcrClient, desk = intakeDesk(), extra }: ClassroomShelfProps) {
  const link = useClassroomLink(client)
  const linkLamp = linkReading(link)
  const live = linkLamp.state === 'live'
  const [subjects, setSubjects] = useState<SubjectOption[]>([])
  const [courses, setCourses] = useState<GcrAnswer<{ items: GcrCourse[] }> | null>(null)
  const [course, setCourse] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [dq, setDq] = useState('')
  const [kind, setKind] = useState<KindFilter>('all')
  const [files, setFiles] = useState<GcrAnswer<{ items: GcrFile[] }> | null>(null)
  const [fileId, setFileId] = useState<string | null>(null)
  const [opened, setOpened] = useState<OpenedView | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)

  const ctl = useRef<AbortController | null>(null)
  const alive = useRef(true)
  const url = useRef<string | null>(null)
  const seq = useRef(0)
  const signal = () => ctl.current?.signal

  /** The blob URL is revoked the moment nothing shows it: on close, on another file, on unmount. */
  const dropUrl = useCallback(() => {
    if (url.current) { client.revokeOriginal(url.current); url.current = null }
  }, [client])

  useEffect(() => {
    alive.current = true
    ctl.current = new AbortController()
    return () => { alive.current = false; ctl.current?.abort(); dropUrl() }
  }, [dropUrl])

  useEffect(() => {
    let on = true
    void desk.subjects().then((r) => { if (on && showsNumber(r.state) && r.data) setSubjects(r.data) })
    return () => { on = false }
  }, [desk])

  // the courses are read when the link is live and again each time a sync finishes
  useEffect(() => {
    if (!live) { setCourses(null); return }
    const c = new AbortController()
    void client.courses(c.signal).then((r) => { if (!c.signal.aborted) setCourses(r) })
    return () => c.abort()
  }, [client, live, link.finished])

  useEffect(() => {
    const t = setTimeout(() => setDq(query), SEARCH_MS)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    if (!live) { setFiles(null); return }
    const c = new AbortController()
    void client.files({ course: course ?? undefined, kind: kind === 'all' ? '' : kind, q: dq }, c.signal).then((r) => { if (!c.signal.aborted) setFiles(r) })
    return () => c.abort()
  }, [client, live, course, kind, dq, link.finished])

  const closeReader = useCallback(() => { seq.current++; dropUrl(); setOpened(null) }, [dropUrl])
  const chooseFile = (id: string) => { closeReader(); setNotice(null); setFileId(id) }
  const chooseCourse = (id: string | null) => { closeReader(); setFileId(null); setCourse(id) }

  const fileList = useMemo(() => files?.data?.items ?? [], [files])
  const file = fileList.find((f) => f.id === fileId) ?? null
  const replaceFile = (f: GcrFile) => setFiles((r) => (r && r.data ? { ...r, data: { ...r.data, items: r.data.items.map((x) => (x.id === f.id ? f : x)) } } : r))
  const replaceCourse = (c: GcrCourse) => setCourses((r) => (r && r.data ? { ...r, data: { ...r.data, items: r.data.items.map((x) => (x.id === c.id ? c : x)) } } : r))
  const said = (r: GcrAnswer<unknown>, fallback: string) => setNotice({ state: r.state, text: r.reason || fallback })

  const readNote = async (f: GcrFile) => {
    dropUrl()
    const mine = ++seq.current
    setOpened({ fileId: f.id, mode: 'note', loading: true })
    const note = await client.note(f.id, signal())
    if (alive.current && mine === seq.current) setOpened({ fileId: f.id, mode: 'note', loading: false, note })
  }
  const readOriginal = async (f: GcrFile) => {
    dropUrl()
    const mine = ++seq.current
    setOpened({ fileId: f.id, mode: 'original', loading: true })
    const original = await client.original(f.id, signal())
    if (!alive.current || mine !== seq.current) {
      // the reader moved on while the bytes came: the URL that was just made is not shown, so it is revoked at once
      if (original.data) client.revokeOriginal(original.data.url)
      return
    }
    if (original.data) url.current = original.data.url
    setOpened({ fileId: f.id, mode: 'original', loading: false, original })
  }
  const inProgram = async (f: GcrFile) => {
    const r = await client.openInProgram(f.id, signal())
    if (alive.current) said(r, 'Asked the PC to open it.')
  }
  const markKind = async (f: GcrFile, to: 'notes' | 'paper') => {
    setBusy(true)
    const r = await client.setKind(f.id, to, signal())
    if (!alive.current) return
    setBusy(false)
    if (r.data?.file) replaceFile(r.data.file)
    said(r, `Marked as ${to === 'paper' ? 'a paper' : 'notes'}.`)
  }
  const toPapers = async (f: GcrFile) => {
    setBusy(true)
    const r = await client.toPapers(f.id, signal())
    if (!alive.current) return
    setBusy(false)
    if (r.data?.paper_id) replaceFile({ ...f, paper_id: r.data.paper_id })
    said(r, 'Sent to the paper desk.')
  }
  const patchCourse = async (c: GcrCourse, patch: { subject?: string; include?: boolean }, fail: string) => {
    const r = await client.patchCourse(c.id, patch, signal())
    if (!alive.current) return
    if (r.data?.course) replaceCourse(r.data.course)
    else said(r, fail)
  }

  const courseItems = courses?.data?.items ?? []
  const chosenCourse = courseItems.find((c) => c.id === course) ?? null
  const asking = readingOf({ state: 'waiting', reason: 'asking the engine' })

  const coursesBody = !live
    ? <Pose title="Courses appear once the link answers." reading={linkLamp} />
    : !courses
      ? <Pose title="Reading the courses." reading={asking} />
      : courses.state !== 'live' || courseItems.length === 0
        ? <Pose title="No courses to show." reading={readingOf({ state: courses.state, reason: courses.reason || 'the link read no courses yet' })} />
        : (
          <CoursesPane
            items={courseItems}
            subjects={subjects}
            chosen={course}
            onChoose={chooseCourse}
            onSubject={(c, s) => void patchCourse(c, { subject: s }, 'The subject was not saved.')}
            onInclude={(c, v) => void patchCourse(c, { include: v }, 'The switch was not saved.')}
          />
        )

  const filesBody = !live
    ? <Pose title="Files appear once the link answers." reading={linkLamp} />
    : !files
      ? <Pose title="Reading the files." reading={asking} />
      : files.state !== 'live' || fileList.length === 0
        ? <Pose title="No files to show." reading={readingOf({ state: files.state, reason: files.reason || 'nothing matches this search' })} />
        : <FilesPane items={fileList} chosen={fileId} onChoose={chooseFile} />

  const first = (
    <div className="cr-col">
      <LinkPanel link={link} />
      {live && chosenCourse && (
        <Button size="sm" grouped onClick={() => void link.syncNow([chosenCourse.id])} disabledReason={link.running ? 'A sync is running.' : undefined}>Sync this course</Button>
      )}
      {coursesBody}
    </div>
  )
  const second = (
    <div className="cr-col">
      {live && <FilesFilter query={query} onQuery={setQuery} kind={kind} onKind={setKind} />}
      {live && <p className="cr-note">{chosenCourse ? `Files of ${chosenCourse.name}` : 'Files of every course'}</p>}
      {filesBody}
    </div>
  )
  const third = (
    <div className="cr-col">
      <NoticeLine notice={notice} />
      <Reader
        file={file}
        opened={opened}
        busy={busy}
        onNote={(f) => void readNote(f)}
        onOriginal={(f) => void readOriginal(f)}
        onProgram={(f) => void inProgram(f)}
        onKind={(f, k) => void markKind(f, k)}
        onToPapers={(f) => void toPapers(f)}
        onClose={closeReader}
      />
    </div>
  )

  if (lookV3Enabled()) {
    return (
      <div className="cr-shelf cr-v3" data-component="classroom-shelf" data-state={linkLamp.state}>
        <Zones
          ratio="default"
          first={{
            job: 'COURSES',
            chip: <span className="cr-chip"><Lamp reading={linkLamp} /></span>,
            children: <div className="cr-col">{extra && <div className="cr-bar">{extra}</div>}{first}</div>,
          }}
          second={{ job: 'FILES', peek: { name: 'Files', lamp: files?.state ?? linkLamp.state, note: chosenCourse ? chosenCourse.name : 'every course' }, children: second }}
          third={{ job: 'READER', peek: { name: 'Reader', lamp: opened ? 'live' : 'waiting', note: file ? file.title : 'no file chosen' }, children: third }}
        />
      </div>
    )
  }
  return (
    <div className="cr-shelf" data-component="classroom-shelf" data-state={linkLamp.state}>
      <header className="cr-head">
        <h2 className="cr-title">Classroom</h2>
        <Lamp reading={linkLamp} />
        <span className="cr-grow" />
        {extra}
      </header>
      <div className="cr-grid">
        <section className="cr-tray" aria-label="Courses">{first}</section>
        <section className="cr-tray" aria-label="Files">{second}</section>
        <section className="cr-tray" aria-label="Reader">{third}</section>
      </div>
    </div>
  )
}
