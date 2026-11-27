// IntakeDesk (package C03, spec 21.4.2 S4 and S6): the Manual Intake desk. Four doors (Folder, Paste, Calendar file, Archive) and the
// Classroom plate (PLANNED or WAITING with its reason until the link answers, then its keys) on top; under them the ledger of what was brought in, each item with where it came from, and on the
// right the chosen item with Accept and Decline. Nothing is accepted without his press and no accepted deadline changes a count
// by itself. It reads through `StudyPort.intake()`, the Classroom client for the plate, and the wider
// `IntakeDeskPort` of this folder. With the null adapters every answer is WAITING with a reason, so a fresh install draws an
// honest hollow desk; the gallery and the tests hand it the fixture desk (invented rows, SIMULATED).
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Button, Drawer, Segmented, ToastStack } from '../../../shared/kit'
import type { ToastItem } from '../../../shared/kit/Toast'
import { Lamp, readingOf, showsNumber, type LampReading, type LampState } from '../../../shared/lamp'
import { lookV3Enabled, useViewChrome, Zones, type ViewChromeSpec } from '../../../shell/v3'
import { STUDY_PORT, type StudyPort } from '../ports'
import type { GcrClient } from '../adapters/gcr'
import { gcrClient } from '../adapters/gcr.register'
import { ClassroomPlate } from '../classroom/ClassroomPlate'
import './adapters/store.register'
import { COPY } from './copy'
import { Doors, type DoorId } from './Doors'
import { ArchiveBody } from './ExportImportDrop'
import { ARCHIVE, ICS_SAMPLE, PASTE_SAMPLE } from './fixtures'
import { IcsBody } from './IcsPreview'
import { IntakeDetail } from './IntakeDetail'
import { IntakeLedger } from './IntakeLedger'
import { CourseMapper } from './CourseMapper'
import { PER_PAGE, batchEligible, isOlder, walkOrder, type Draft } from './model'
import { PasteBody } from './PasteParser'
import { intakeDesk, type IntakeDeskPort } from './port'
import type { DeskHead, IntakeRow, SubjectOption } from './types'
import './intake.css'
import './intake-v3.css'

type Filter = 'new' | 'accepted' | 'declined'
type Sheet = DoorId | 'courses'

export interface IntakeDeskProps {
  desk?: IntakeDeskPort
  study?: StudyPort
  /** The Classroom client the plate reads (the tests hand a fake). */
  gcr?: GcrClient
  /** Opens the Classroom shelf; the plate offers it once the link is live. */
  onShelf?: () => void
  /** Fixed clock (gallery and tests). */
  now?: number
  /** A sheet that starts open. */
  open?: Sheet
  /** With `open`: fill that sheet with the fixture reading (the gallery). */
  demo?: boolean
  initialFilter?: Filter
  initialSel?: string
  /** Placed at the end of the head (the shell view puts its Intake / Library face switch here). */
  extra?: ReactNode
}

const WAITING: DeskHead = { state: 'waiting', reason: 'reading your list' }
const reading = (state: LampState, reason: string): LampReading => readingOf({ state, reason })

export function IntakeDesk({ desk = intakeDesk(), study = STUDY_PORT, gcr = gcrClient, onShelf, now: nowProp, open, demo, initialFilter = 'new', initialSel, extra }: IntakeDeskProps) {
  const now = useMemo(() => nowProp ?? Date.now(), [nowProp])
  const [head, setHead] = useState<DeskHead>(WAITING)
  const [rows, setRows] = useState<IntakeRow[]>([])
  /** What the store set aside on its last list (a rows file it could not read); printed under a fault, never swallowed. */
  const [problems, setProblems] = useState<string[]>([])
  const [subjects, setSubjects] = useState<SubjectOption[]>([])
  const [folder, setFolder] = useState<LampReading>(reading('waiting', 'choose a folder to watch'))
  const [filter, setFilter] = useState<Filter>(initialFilter)
  const [page, setPage] = useState(0)
  const [sel, setSel] = useState<string | null>(initialSel ?? null)
  const [showOlder, setShowOlder] = useState(false)
  const [sheet, setSheet] = useState<Sheet | null>(open ?? null)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const seq = useRef(0)
  const jumped = useRef(false)

  const load = useCallback(async () => {
    const [l, s] = await Promise.all([desk.list(), desk.subjects()])
    setHead({ state: l.state, reason: l.reason })
    setProblems(desk.problems?.() ?? [])
    setRows(showsNumber(l.state) && l.data ? l.data : [])
    setSubjects(showsNumber(s.state) && s.data ? s.data : [])
  }, [desk])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    let live = true
    void study.intake().then((f) => {
      if (!live) return
      setFolder(reading(f.state, f.state === 'live' || f.state === 'simulated' ? `${f.data?.files ?? 0} files seen` : f.reason))
    })
    return () => { live = false }
  }, [study])

  // v3: Courses is used rarely (rule 4.7), so it rides in More; the M key still opens it
  const chrome = useMemo<ViewChromeSpec>(() => ({ more: [{ id: 'courses', label: 'Courses and subjects', onSelect: () => setSheet('courses') }] }), [])
  useViewChrome(lookV3Enabled() ? chrome : null)

  const live = showsNumber(head.state)
  const byFilter = useMemo(() => rows.filter((r) => (filter === 'new' ? r.state === 'new' : filter === 'accepted' ? r.state === 'accepted' || r.state === 'taken' : r.state === 'declined')), [rows, filter])
  const olderRows = useMemo(() => (filter === 'new' ? byFilter.filter((r) => isOlder(r, now)) : []), [byFilter, filter, now])
  const visible = useMemo(() => (showOlder ? byFilter : byFilter.filter((r) => !olderRows.includes(r))), [byFilter, olderRows, showOlder])
  const order = useMemo(() => walkOrder(visible), [visible])
  const selRow = order.find((r) => r.id === sel) ?? order[page * PER_PAGE] ?? order[0] ?? null
  /** A desk opened on a chosen item shows the page that holds it, once. */
  useEffect(() => {
    if (jumped.current || !initialSel || order.length === 0) return
    jumped.current = true
    const i = order.findIndex((r) => r.id === initialSel)
    if (i >= 0) setPage(Math.floor(i / PER_PAGE))
  }, [order, initialSel])
  const newCount = rows.filter((r) => r.state === 'new').length
  const batch = useMemo(() => (filter === 'new' ? visible.filter(batchEligible) : []), [filter, visible])

  const say = useCallback((message: string, undo?: () => void) => {
    const id = `t${++seq.current}`
    setToasts((t) => [...t.slice(-2), { id, message, action: undo ? { label: 'Undo', onAction: undo } : undefined }])
  }, [])
  const replace = (r: IntakeRow) => setRows((rs) => rs.map((x) => (x.id === r.id ? r : x)))
  // the rows are drawn at once; the list is then read again, because a desk that opened EMPTY holds the store's WAITING head until it is (found 27 Nov
  // against the real routes: rows on screen and the count still "--" with a WAITING lamp)
  const merge = (items: IntakeRow[]) => { setRows((rs) => [...rs, ...items.filter((i) => !rs.some((x) => x.id === i.id))]); setFilter('new'); setPage(0); void load() }
  /** After a row leaves the filter, the next one in the walking order is chosen, so Accept can be pressed down the list. */
  const advance = (id: string) => {
    const i = order.findIndex((r) => r.id === id)
    const rest = order.filter((r) => r.id !== id)
    const next = rest[Math.min(i, rest.length - 1)]
    setSel(next?.id ?? null)
    setPage(next ? Math.floor(rest.indexOf(next) / PER_PAGE) : 0)
  }

  /** A store that keeps a decision (R-39) has no way back to new: no Undo toast, no U key, no Back key. */
  const canUndo = !desk.noUndo
  const back = async (ids: string[]) => {
    const rs = await Promise.all(ids.map((id) => desk.decide(id, { state: 'new' })))
    rs.forEach((r) => { if (showsNumber(r.state) && r.data) replace(r.data) })
    say(rs.every((r) => showsNumber(r.state)) ? COPY.undone : `Not undone: ${rs.find((r) => !showsNumber(r.state))?.reason ?? ''}`)
  }
  const decide = async (row: IntakeRow, state: 'accepted' | 'declined', extra: Draft = {}) => {
    const r = await desk.decide(row.id, { state, ...extra })
    if (showsNumber(r.state) && r.data) {
      advance(row.id)
      replace(r.data)
      say(`${state === 'accepted' ? 'Accepted' : 'Declined'} “${row.title}”`, canUndo ? () => void back([row.id]) : undefined)
    } else say(`Not saved: ${r.reason}`)
  }
  const take = async (row: IntakeRow, to: 'papers' | 'notes') => {
    const r = await desk.take(row.id, to)
    if (showsNumber(r.state) && r.data) { advance(row.id); replace(r.data); say(`${COPY.taken}`) } else say(`Not sent: ${r.reason}`)
  }
  const remove = async (row: IntakeRow) => {
    const r = await desk.remove(row.id)
    if (showsNumber(r.state) && r.data) {
      advance(row.id)
      setRows((rs) => rs.filter((x) => x.id !== row.id))
      say(r.data.file ? 'Removed the row and the copy the app held.' : 'Removed the row. Your own files were not touched.')
    } else say(`Not removed: ${r.reason}`)
  }
  const acceptBatch = async () => {
    const ids = batch.map((r) => r.id)
    const rs = await Promise.all(batch.map((r) => desk.decide(r.id, { state: 'accepted' })))
    rs.forEach((r) => { if (showsNumber(r.state) && r.data) replace(r.data) })
    const done = rs.filter((r) => showsNumber(r.state)).length
    setSel(null)
    setPage(0)
    say(done ? `Accepted ${done} that have a subject and a clear date` : `Not saved: ${rs.find((r) => !showsNumber(r.state))?.reason ?? ''}`, done && canUndo ? () => void back(ids) : undefined)
  }

  const readings: Record<DoorId, LampReading> = {
    folder,
    paste: reading(head.state, live ? '' : head.reason),
    ics: reading(head.state, live ? '' : head.reason),
    archive: reading(head.state, live ? '' : head.reason),
  }

  const onKey = (e: KeyboardEvent) => {
    if (sheet || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return
    const t = e.target as HTMLElement
    if (!e.currentTarget.contains(t) || t.closest('input, textarea, select, [role="dialog"]')) return
    const k = e.key.toLowerCase()
    const door: Partial<Record<string, Sheet>> = { f: 'folder', p: 'paste', c: 'ics', z: 'archive', m: 'courses' }
    if (door[k]) { e.preventDefault(); setSheet(door[k]!); return }
    if (!selRow || selRow.state !== 'new') { if (k === 'u' && selRow && canUndo) { e.preventDefault(); void back([selRow.id]) } return }
    if (k === 'a' && e.shiftKey) { if (batch.length > 1) { e.preventDefault(); void acceptBatch() } return }
    if (k === 'a' && selRow.kind !== 'file' && (!selRow.ambiguous || selRow.date)) { e.preventDefault(); void decide(selRow, 'accepted', { subject: selRow.subject }) }
    else if (k === 'd') { e.preventDefault(); void decide(selRow, 'declined') }
  }

  const close = () => setSheet(null)
  const plate = <ClassroomPlate client={gcr} onShelf={onShelf} />
  const emptyTitle = !live ? `${head.state === 'fault' ? 'Fault' : 'Waiting'}: ${head.reason}` : rows.length === 0 ? COPY.emptyTitle : COPY.noMatch
  const emptyNote = head.state === 'fault' ? COPY.faultNote : rows.length === 0 ? COPY.emptyNote : filter === 'new' ? 'Nothing is waiting for you.' : 'Nothing here yet.'

  const sheets = (
    <>
      <Drawer open={sheet === 'folder'} onClose={close} title="Folder" className="ik-sheet">
        <div className="ik-sheet-body" data-component="folder-door">
          <p className="ik-result-head"><Lamp reading={folder} /><span>{folder.reason}</span></p>
          <p className="ik-sheet-note">Save the files you download from Classroom into the folder the app watches. Each new file appears here as a Folder item; Take sends it to Papers or Notes on your press.</p>
          <p className="ik-sheet-note">{COPY.noFetch}</p>
          <div className="ik-sheet-act"><Button onClick={close}>Close</Button></div>
        </div>
      </Drawer>
      <Drawer open={sheet === 'paste'} onClose={close} title="Paste a list" className="ik-sheet">
        <PasteBody desk={desk} now={now} onRows={merge} onClose={close} initialText={open === 'paste' && demo ? PASTE_SAMPLE : ''} autoRead={open === 'paste' && demo} />
      </Drawer>
      <Drawer open={sheet === 'ics'} onClose={close} title="Import a calendar file" className="ik-sheet">
        <IcsBody desk={desk} now={now} onRows={merge} onDecline={(ids) => { ids.forEach((id) => void desk.decide(id, { state: 'declined' }).then((r) => { if (r.data) replace(r.data) })) }} onClose={close} initialText={open === 'ics' && demo ? ICS_SAMPLE : undefined} />
      </Drawer>
      <Drawer open={sheet === 'archive'} onClose={close} title="Archive" className="ik-sheet">
        <ArchiveBody
          desk={desk}
          onClose={close}
          onSent={(name) => say(`Sent ${name} to the paper desk. It arrives as pending; nothing is accepted until you review it.`)}
          initial={open === 'archive' && demo ? { listing: ARCHIVE, state: 'simulated', reason: 'a fixture listing, not a real export' } : undefined}
        />
      </Drawer>
      <Drawer open={sheet === 'courses'} onClose={close} title="Courses and subjects" className="ik-sheet">
        <CourseMapper desk={desk} onMapped={() => void load()} onClose={close} />
      </Drawer>
      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </>
  )

  if (lookV3Enabled()) {
    return (
      <div className="ik-desk ik-v3" data-component="intake-desk" data-state={head.state} onKeyDown={onKey}>
        <Zones
          ratio="default"
          first={{
            job: 'LEDGER',
            flare: newCount > 0 ? 1 : 0,
            chip: <span className="ik-count" data-component="intake-count"><span className="ik-count-n">{live ? `${newCount} new` : '--'}</span><Lamp reading={reading(head.state, head.reason)} /></span>,
            children: (
              <div className="ik3-col">
                <div className="ik3-bar">
                  <Segmented<Filter>
                    variant="choice"
                    label="Show"
                    value={filter}
                    onChange={(f) => { setFilter(f); setPage(0); setSel(null) }}
                    options={[{ id: 'new', label: 'New' }, { id: 'accepted', label: 'Accepted' }, { id: 'declined', label: 'Declined' }]}
                  />
                  {extra}
                </div>
                {batch.length > 1 && (
                  <Button onClick={() => void acceptBatch()} aria-keyshortcuts="Shift+A">{`Accept ${batch.length} with a subject`}<kbd className="ik-key" aria-hidden="true">{'⇧'}A</kbd></Button>
                )}
                <div className="ik3-ledger">
                  <IntakeLedger
                    rows={visible}
                    subjects={subjects}
                    now={now}
                    page={page}
                    onPage={(pg) => { setPage(pg); setSel(null) }}
                    selId={selRow?.id ?? null}
                    onSelect={setSel}
                    emptyTitle={emptyTitle}
                    emptyNote={emptyNote}
                    older={olderRows.length}
                    showOlder={showOlder}
                    onToggleOlder={() => setShowOlder((v) => !v)}
                    live={live && rows.length === 0}
                    problems={problems}
                  />
                </div>
                <p className="ik-foot-line ik3-foot"><span>{head.state === 'simulated' ? `${COPY.footer} ${COPY.fixture}` : COPY.footer}</span></p>
              </div>
            ),
          }}
          second={{
            job: 'DETAIL',
            peek: { name: 'Detail', lamp: head.state, note: selRow ? selRow.title : 'no item chosen' },
            children: (
              <div className="ik3-col">
                <IntakeDetail
                  key={selRow?.id ?? 'none'}
                  row={selRow}
                  subjects={subjects}
                  now={now}
                  head={reading(head.state, head.reason)}
                  onAccept={(r, dr) => void decide(r, 'accepted', dr)}
                  onDecline={(r) => void decide(r, 'declined')}
                  onTake={(r, to) => void take(r, to)}
                  onBack={canUndo ? (r) => void back([r.id]) : undefined}
                  onRemove={(r) => void remove(r)}
                />
              </div>
            ),
          }}
          third={{
            job: 'DOORS',
            peek: { name: 'Doors', lamp: head.state, note: 'ways to bring items in' },
            children: (
              <div className="ik3-col ik3-doors">
                <Doors readings={readings} plate={plate} onOpen={(id) => setSheet(id)} />
              </div>
            ),
          }}
        />
        {sheets}
      </div>
    )
  }

  return (
    <div className="ik-desk" data-component="intake-desk" data-state={head.state} onKeyDown={onKey}>
      <div className="ik-desk-in">
        <header className="ik-head">
          <h2 className="ik-title">{COPY.title}</h2>
          <span className="ik-count" data-component="intake-count"><span className="ik-count-n">{live ? `${newCount} new` : '--'}</span><Lamp reading={reading(head.state, head.reason)} /></span>
          <Segmented<Filter>
            variant="choice"
            label="Show"
            value={filter}
            onChange={(f) => { setFilter(f); setPage(0); setSel(null) }}
            options={[{ id: 'new', label: 'New' }, { id: 'accepted', label: 'Accepted' }, { id: 'declined', label: 'Declined' }]}
          />
          <span className="ik-grow" />
          {batch.length > 1 && (
            <Button onClick={() => void acceptBatch()} aria-keyshortcuts="Shift+A">{`Accept ${batch.length} with a subject`}<kbd className="ik-key" aria-hidden="true">{'⇧'}A</kbd></Button>
          )}
          <Button onClick={() => setSheet('courses')} aria-keyshortcuts="M">Courses<kbd className="ik-key" aria-hidden="true">M</kbd></Button>
          {extra}
        </header>

        <Doors readings={readings} plate={plate} onOpen={(id) => setSheet(id)} />

        <div className="ik-main">
          <IntakeLedger
            rows={visible}
            subjects={subjects}
            now={now}
            page={page}
            onPage={(p) => { setPage(p); setSel(null) }}
            selId={selRow?.id ?? null}
            onSelect={setSel}
            emptyTitle={emptyTitle}
            emptyNote={emptyNote}
            older={olderRows.length}
            showOlder={showOlder}
            onToggleOlder={() => setShowOlder((v) => !v)}
            live={live && rows.length === 0}
            problems={problems}
          />
          <IntakeDetail
            key={selRow?.id ?? 'none'}
            row={selRow}
            subjects={subjects}
            now={now}
            head={reading(head.state, head.reason)}
            onAccept={(r, d) => void decide(r, 'accepted', d)}
            onDecline={(r) => void decide(r, 'declined')}
            onTake={(r, to) => void take(r, to)}
            onBack={canUndo ? (r) => void back([r.id]) : undefined}
            onRemove={(r) => void remove(r)}
          />
        </div>

        <footer className="ik-foot-line"><span>{head.state === 'simulated' ? `${COPY.footer} ${COPY.fixture}` : COPY.footer}</span></footer>
      </div>

      {sheets}
    </div>
  )
}
