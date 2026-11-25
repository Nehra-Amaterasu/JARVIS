// The state of the Classroom link as a hook, so the plate on the Intake desk and the Classroom shelf read it one way: the answer of
// G-01, the job of G-05, the sentence of the last press, and the two polls the route contract asks for (2 s while a sign-in is open
// in the browser, 2 s while a sync runs). Every request carries one AbortSignal that the unmount fires, and a poll that is waiting
// is cleared with it, so a closed view leaves nothing running.
import { useCallback, useEffect, useRef, useState } from 'react'
import { POLL_MS, type GcrClient } from '../adapters/gcr'
import type { GcrAnswer, GcrJob, GcrStatusBody } from '../adapters/gcrTypes'
import type { LampState } from '../../../shared/lamp'

export const APPROVE_SENTENCE = 'Approve in the browser window that opened.'

export interface LinkSay { state: LampState; text: string }

export interface ClassroomLink {
  /** Null until the first answer arrives. */
  status: GcrAnswer<GcrStatusBody> | null
  job: GcrJob | null
  connecting: boolean
  running: boolean
  /** The engine's sentence for the last press (a refusal, a busy job), or null. */
  say: LinkSay | null
  /** Counts up each time a sync finishes, so a screen that lists courses and files knows to read them again. */
  finished: number
  /** `account` is a short lower-case name; absent means the main account. */
  connect(account?: string): Promise<void>
  disconnect(account?: string): Promise<void>
  syncNow(courses?: string[]): Promise<void>
  refresh(): Promise<void>
}

export function useClassroomLink(client: GcrClient): ClassroomLink {
  const [status, setStatus] = useState<GcrAnswer<GcrStatusBody> | null>(null)
  const [jobNow, setJobNow] = useState<GcrJob | null>(null)
  const [say, setSay] = useState<LinkSay | null>(null)
  const [finished, setFinished] = useState(0)
  const ctl = useRef<AbortController | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    ctl.current = new AbortController()
    return () => { alive.current = false; ctl.current?.abort() }
  }, [])

  const signal = () => ctl.current?.signal

  const refresh = useCallback(async () => {
    const r = await client.status(signal())
    if (!alive.current) return
    setStatus(r)
    if (r.data) setJobNow(r.data.job)
  }, [client])
  useEffect(() => { void refresh() }, [refresh])

  const job = jobNow ?? status?.data?.job ?? null
  const connecting = status?.data?.connecting === true
  const running = job?.status === 'running'
  const polling = connecting || running

  // one timeout per state change: the answer of a poll is a new state, which arms the next one
  useEffect(() => {
    if (!polling) return
    const t = setTimeout(() => {
      if (running) {
        void client.job(signal()).then((r) => {
          if (!alive.current) return
          const next = r.data?.job ?? null
          setJobNow(next ?? jobNow)
          // the sync ended: the status carries the new counts and time, and the lists are read again
          if (next && next.status !== 'running') { setFinished((n) => n + 1); void refresh() }
          else if (!next) setJobNow(null)
        })
      } else void refresh()
    }, POLL_MS)
    return () => clearTimeout(t)
  }, [polling, running, status, jobNow, client, refresh])

  const connect = useCallback(async (account?: string) => {
    setSay(null)
    const r = await client.connect(account, signal())
    if (!alive.current) return
    // a refusal (409 already connecting, for one) has no data: the engine's sentence is shown and the status stays as it was
    if (r.data) setStatus(r)
    else setSay({ state: r.state, text: r.reason })
  }, [client])

  const disconnect = useCallback(async (account?: string) => {
    setSay(null)
    const r = await client.disconnect(account, signal())
    if (!alive.current) return
    if (r.data) { setStatus(r); setJobNow(r.data.job) } else setSay({ state: r.state, text: r.reason })
  }, [client])

  const syncNow = useCallback(async (courses?: string[]) => {
    setSay(null)
    const r = await client.sync(courses, signal())
    if (!alive.current) return
    if (r.data?.job) setJobNow(r.data.job)
    else setSay({ state: r.state, text: r.reason })
  }, [client])

  return { status, job, connecting, running, say, finished, connect, disconnect, syncNow, refresh }
}
