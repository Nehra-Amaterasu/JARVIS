/**
 * The two-way bridge between the shell's place and the Well Wisher frame, without the feedback loop (A.N02 c).
 *
 * The loop it removes, measured in frameBridge.test.tsx and in the keyboard-reach spec: the frame runs a
 * cross-workspace switch inside a view transition, and a second switch within 600 ms skips the first
 * (shared/motion/transition.ts) while the skipped transition's change still commits afterwards. Under rapid
 * keys the frame therefore reported an OLDER place last; the frame -> shell subscription followed it and
 * moved the rail with no key pressed (study.plan fell back to study.papers).
 *
 * The rule now: the shell is the source of truth for every place it asked for. While any shell request is in
 * flight (`pending` > 0, the bridge.pending token of the spec) a frame report is a place the shell did not ask
 * for and is ignored; when the last request settles, the frame is put back on the shell's place if it is
 * elsewhere (one retry, so a frame that cannot reach a place never ping-pongs). A frame change with nothing in
 * flight (Tree's "Study this node") still moves the rail, as before.
 */
import type { Host } from './hosts'

export interface FramePort {
  switchTo: (ws: 'study' | 'tree' | 'life' | 'career' | 'focus', view: string | null) => Promise<void>
  current: () => { ws: string; view: string | null }
  subscribe: (fn: (ws: string, view: string | null) => void) => () => void
}

export interface FrameSyncOptions {
  /** The host of the shell's current Well Wisher place, or undefined when the shell is not on Well Wisher. */
  desired: () => Host | undefined
  /** Move the shell to the place a frame (ws, view) belongs to. */
  follow: (ws: string, view: string | null) => void
}

export interface FrameSync {
  /** Shell -> frame: put the frame on the shell's place (a no-op when it is already there). */
  push: () => void
  /** Frame -> shell: start listening; returns the unsubscribe. */
  connect: () => () => void
  /** Shell requests still in flight. */
  readonly pending: number
}

/** Does the frame at (ws, view) show this host? A frame view of null (the season default) shows any view. */
export function frameShows(h: Host | undefined, ws: string, view: string | null): boolean {
  return !!h && h.kind === 'ww' && h.ws === ws && (h.view === null || view === null || h.view === view)
}

/** One retry per key: enough to undo one stale commit, never a ping-pong with a frame that refuses a place. */
const RETRIES = 1

export function createFrameSync(port: FramePort, opts: FrameSyncOptions): FrameSync {
  let pending = 0
  let retries = 0

  const send = (h: Extract<Host, { kind: 'ww' }>) => {
    pending++
    const done = () => {
      pending--
      if (pending === 0) reconcile()
    }
    port.switchTo(h.ws, h.view).then(done, done)
  }

  const reconcile = () => {
    const h = opts.desired()
    if (!h || h.kind !== 'ww') return
    const cur = port.current()
    if (frameShows(h, cur.ws, cur.view) && (h.view === null || cur.view === h.view)) return
    if (retries >= RETRIES) return
    retries++
    send(h)
  }

  return {
    get pending() {
      return pending
    },
    push() {
      const h = opts.desired()
      if (!h || h.kind !== 'ww') return
      retries = 0
      const cur = port.current()
      if (cur.ws === h.ws && (h.view === null || cur.view === h.view)) return
      send(h)
    },
    connect() {
      return port.subscribe((ws, view) => {
        // a place the shell did not ask for, reported while its own request is in flight: ignore it
        if (pending > 0) return
        const h = opts.desired()
        if (!h || frameShows(h, ws, view)) return
        opts.follow(ws, view)
      })
    },
  }
}
