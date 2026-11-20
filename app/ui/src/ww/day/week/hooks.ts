// Hooks the three L03 views share (Week, Body, Close): a read through a port tagged with its key, the local date that steps once at
// midnight, and the phone form read from the page's own width. They are the same three small hooks Month keeps private; L01 owns
// that file, so the Day views of L03 keep one copy here instead of three.
import { useEffect, useRef, useState, type RefObject } from 'react'
import { ymd } from '../../../shared/almanac'
import type { PortReply } from '../ports'

/**
 * A read through the port, tagged with the key it was made for, so a slow answer for another week is never drawn. When a re-read of the
 * SAME scope is under way (a placed move, a refresh) the previous reply stays on screen until the new one lands, so the page does not
 * flash to "– –" and WAITING after every save; a different scope (another week) never shows the old answer.
 */
export function useRead<T>(key: string, read: () => Promise<PortReply<T>>, scope: string = key): PortReply<T> | null {
  const [got, setGot] = useState<{ key: string; scope: string; reply: PortReply<T> } | null>(null)
  const ref = useRef(read)
  useEffect(() => { ref.current = read })
  useEffect(() => {
    let live = true
    ref.current().then(
      (reply) => { if (live) setGot({ key, scope, reply }) },
      () => { if (live) setGot({ key, scope, reply: { state: 'fault', reason: 'the read did not finish', since: null, data: null } }) },
    )
    return () => { live = false }
  }, [key, scope])
  return got && (got.key === key || got.scope === scope) ? got.reply : null
}

/** What every write says when it threw instead of answering: the student is told, in the status line, that nothing was saved. */
export const SAVE_FAILED = 'The save did not finish. Nothing was saved.'

/** Runs one write; a rejection becomes the status line instead of an unhandled rejection. Returns undefined when it threw. */
export async function attempt<T>(run: () => Promise<T>, say: (message: string) => void): Promise<T | undefined> {
  try { return await run() } catch { say(SAVE_FAILED); return undefined }
}

/** The local date, stepping once at midnight (one timeout re-armed after each step; never an interval). */
export function useToday(fixed?: string): string {
  const [t, setT] = useState(() => fixed ?? ymd(new Date()))
  useEffect(() => {
    if (fixed) {
      setT(fixed)
      return
    }
    const next = new Date()
    next.setHours(24, 0, 5, 0)
    const id = setTimeout(() => setT(ymd(new Date())), Math.max(1000, next.getTime() - Date.now()))
    return () => clearTimeout(id)
  }, [fixed, t])
  return t
}

export const PHONE_MAX = 700

/** The phone form below 700 px of the page's own width, read once from the window and then from the page. */
export function useForm(ref: RefObject<HTMLElement | null>, forced?: 'desk' | 'phone'): 'desk' | 'phone' {
  const [form, setForm] = useState<'desk' | 'phone'>(forced ?? (typeof window !== 'undefined' && window.innerWidth < PHONE_MAX ? 'phone' : 'desk'))
  useEffect(() => {
    if (forced) {
      setForm(forced)
      return
    }
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setForm(el.clientWidth > 0 && el.clientWidth < PHONE_MAX ? 'phone' : 'desk'))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, forced])
  return form
}

/** True under the calm setting or the OS reduced-motion flag: the static form of every motion on these views. */
export const calm = (): boolean =>
  typeof window === 'undefined' || document.documentElement.dataset.motion === 'calm' || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** One per-device convenience (a remembered goal, a list the student edits). Never state that must persist: it can come back empty. */
export function localGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
export function localSet(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* blocked storage: the page works without it */ }
}
