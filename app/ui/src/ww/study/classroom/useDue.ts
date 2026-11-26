// What is due, as a hook: the answer of G-15 for the chosen course and the open/all switch, the announcements (G-18) and the calendar
// (G-19) that sit under the chosen assignment, and the three presses that change something (open the page, make one reminder, remove
// it). Every request carries the AbortSignal of this hook, so a closed view leaves nothing running; the lists are read again each
// time a sync finishes (`finished`), the way the files are.
//
// Nothing here makes a reminder by itself: `remind` runs only from a press, and the engine's own sentence for every press is kept
// as the notice. A reminder that was already gone when it was removed (a 404 from the list) leaves the sentence and reads the
// list again, so the screen never keeps a reminder the engine no longer has.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { GcrClient } from '../adapters/gcr'
import type { GcrAnnouncement, GcrAnswer, GcrAssignment, GcrAssignmentsBody, GcrEvent } from '../adapters/gcrTypes'
import type { Notice } from './ShelfPanes'

export type DueShow = 'open' | 'all'
/** How many announcements and calendar entries are listed: "short plain lists" under the assignment, the rest is named, not hidden. */
export const ANNOUNCEMENTS_SHOWN = 3
export const EVENTS_SHOWN = 5

export interface Due {
  show: DueShow
  setShow(s: DueShow): void
  course: string | null
  setCourse(c: string | null): void
  list: GcrAnswer<GcrAssignmentsBody> | null
  announcements: GcrAnswer<{ items: GcrAnnouncement[] }> | null
  calendar: GcrAnswer<{ items: GcrEvent[] }> | null
  chosenId: string | null
  choose(id: string | null): void
  chosen: GcrAssignment | null
  notice: Notice | null
  busy: boolean
  open(a: GcrAssignment): Promise<void>
  remind(a: GcrAssignment): Promise<void>
  removeReminder(a: GcrAssignment): Promise<void>
}

export function useDue(client: GcrClient, enabled: boolean, finished: number): Due {
  const [show, setShow] = useState<DueShow>('open')
  const [course, setCourse] = useState<string | null>(null)
  const [list, setList] = useState<GcrAnswer<GcrAssignmentsBody> | null>(null)
  const [announcements, setAnnouncements] = useState<GcrAnswer<{ items: GcrAnnouncement[] }> | null>(null)
  const [calendar, setCalendar] = useState<GcrAnswer<{ items: GcrEvent[] }> | null>(null)
  const [chosenId, setChosenId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  // a number that rises when the list must be read again outside a sync (a reminder the engine no longer has)
  const [again, setAgain] = useState(0)
  const ctl = useRef<AbortController | null>(null)
  const alive = useRef(true)
  const signal = () => ctl.current?.signal

  useEffect(() => {
    alive.current = true
    ctl.current = new AbortController()
    return () => { alive.current = false; ctl.current?.abort() }
  }, [])

  useEffect(() => {
    if (!enabled) { setList(null); return }
    const c = new AbortController()
    void client.assignments({ course: course ?? undefined, show }, c.signal).then((r) => { if (!c.signal.aborted) setList(r) })
    return () => c.abort()
  }, [client, enabled, course, show, finished, again])

  useEffect(() => {
    if (!enabled) { setAnnouncements(null); setCalendar(null); return }
    const c = new AbortController()
    void client.announcements(course ?? undefined, undefined, c.signal).then((r) => { if (!c.signal.aborted) setAnnouncements(r) })
    void client.calendar({}, c.signal).then((r) => { if (!c.signal.aborted) setCalendar(r) })
    return () => c.abort()
  }, [client, enabled, course, finished])

  const items = list?.data?.items ?? []
  const chosen = items.find((a) => a.id === chosenId) ?? null

  const choose = useCallback((id: string | null) => { setNotice(null); setChosenId(id) }, [])

  const replace = useCallback((a: GcrAssignment) =>
    setList((r) => (r && r.data ? { ...r, data: { ...r.data, items: r.data.items.map((x) => (x.id === a.id ? a : x)) } } : r)), [])

  const said = (r: GcrAnswer<unknown>, fallback: string) => setNotice({ state: r.state, text: r.reason || fallback })

  const open = useCallback(async (a: GcrAssignment) => {
    setNotice(null)
    const r = await client.openAssignment(a.id, signal())
    if (alive.current) said(r, 'Asked the PC to open the page in your browser.')
  }, [client])

  const remind = useCallback(async (a: GcrAssignment) => {
    setNotice(null); setBusy(true)
    const r = await client.remind(a.id, undefined, signal())
    if (!alive.current) return
    setBusy(false)
    if (r.data?.reminder) replace({ ...a, reminder: r.data.reminder })
    said(r, 'Reminder made.')
  }, [client, replace])

  const removeReminder = useCallback(async (a: GcrAssignment) => {
    if (!a.reminder) return
    setNotice(null); setBusy(true)
    const r = await client.removeReminder(a.reminder.id, signal())
    if (!alive.current) return
    setBusy(false)
    // removed, or already gone (the list answers 404 for a reminder that fired): either way the list is read again, not guessed
    if (r.state === 'live') replace({ ...a, reminder: null })
    else setAgain((n) => n + 1)
    said(r, 'Reminder removed.')
  }, [client, replace])

  return { show, setShow, course, setCourse, list, announcements, calendar, chosenId, choose, chosen, notice, busy, open, remind, removeReminder }
}
