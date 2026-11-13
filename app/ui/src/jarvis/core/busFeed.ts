// The Core view's own window on the event bus. lib/store drops the ephemeral voice frames (it keeps only the mic
// level as one number) and the `timing` events, and lib/store is read-only for this package, so the view opens its
// own /ws/events socket while it is mounted and closes it when the last listener leaves. Only four core kinds pass:
// the two voice frames (level, out_level), the stage timings and the state word. A refcount keeps it to one socket
// however many parts of the view listen; no timer lives here (the socket's own reconnect backoff is lib/api's).
import { openSocket } from '../../lib/api'

export type BusHandler = (ev: Record<string, unknown>) => void
export type SocketOpener = (onMessage: (data: unknown) => void) => { close: () => void }

/** The core kinds the view reads from the bus. Everything else (history replay included) is dropped here. */
export const CORE_KINDS: ReadonlySet<string> = new Set(['level', 'out_level', 'timing', 'state'])

/** True for a bus event the Core view listens to. A replayed history batch is not a live frame and never passes. */
export function wanted(ev: unknown): ev is Record<string, unknown> {
  if (!ev || typeof ev !== 'object') return false
  const e = ev as Record<string, unknown>
  return e.source === 'core' && typeof e.kind === 'string' && CORE_KINDS.has(e.kind)
}

/** A refcounted subscription to one socket. Exported as a factory so the test hands in a fake socket. */
export function createBusFeed(open: SocketOpener) {
  const handlers = new Set<BusHandler>()
  let sock: { close: () => void } | null = null
  return {
    subscribe(fn: BusHandler): () => void {
      handlers.add(fn)
      if (!sock) {
        sock = open((data) => {
          if (!wanted(data)) return
          for (const h of handlers) h(data)
        })
      }
      return () => {
        handlers.delete(fn)
        if (handlers.size === 0 && sock) {
          sock.close()
          sock = null
        }
      }
    },
    /** Listeners now (a test reads it; the view never needs it). */
    size: () => handlers.size,
    open: () => sock !== null,
  }
}

/** The app's feed: the real /ws/events socket, token-guarded by lib/api. */
export const coreBus = createBusFeed((onMessage) => openSocket('/ws/events', onMessage))
