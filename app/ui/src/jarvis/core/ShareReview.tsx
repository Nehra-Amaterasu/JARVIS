// "Share a review" on Core Talk (parity ledger O1, spec decision D-V3-29). The classic Core page had a "Review for Claude"
// key that writes the last 7 days of conversation, flagged turns first, to a Markdown file the owner can hand to Claude.
// Under the new shell that key had no home (the spec moved it to memory.keep, which is not built yet), so this is the
// stop-gap the ledger asked for: one quiet key in the transcript header, the same route as the classic key
// (POST /api/transcripts/export {days: 7}), and a status line under the rows that tells what really happened.
//
// Honesty: the line says WAITING while the route runs, LIVE with the file name the route returned when it answered, and
// FAULT with the route's own error when it did not. It never says "written" before the answer. The app itself sends the
// file nowhere: the owner opens the folder and decides (spec 3.1.2).
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, post } from '../../lib/api'
import { Lamp, type LampState } from '../../shared/lamp'

export const REVIEW_DAYS = 7

export interface ReviewSummary { turns: number; flags: Record<string, number> }
export interface ReviewPort {
  summary(days: number): Promise<ReviewSummary>
  exportReview(days: number): Promise<{ name: string; path?: string; summary?: ReviewSummary }>
  openFolder(): Promise<unknown>
}

/** The real routes: the three calls pages/Core.tsx ReviewButton makes. */
export const LIVE_REVIEW: ReviewPort = {
  summary: (days) => api<ReviewSummary>(`/api/transcripts/summary?days=${days}`),
  exportReview: (days) => post<{ name: string; path?: string; summary?: ReviewSummary }>('/api/transcripts/export', { days }),
  openFolder: () => post('/api/open', { which: 'reviews' }),
}

export type ReviewPhase = 'idle' | 'waiting' | 'done' | 'fault' | 'empty'
export interface ReviewState {
  phase: ReviewPhase
  /** The file the route returned. */
  name: string | null
  /** The route's own error text. */
  error: string | null
  /** The summary the route returned with the file, or the one read before: null until one answered. */
  summary: ReviewSummary | null
}

export interface ReviewApi {
  state: ReviewState
  simulated: boolean
  /** Known to hold no turns in the window: the key is dimmed and says why when pressed. */
  nothingYet: boolean
  run(): Promise<void>
  openFolder(): Promise<void>
  dismiss(): void
}

const flagged = (s: ReviewSummary | null): number => Object.entries(s?.flags ?? {}).filter(([k]) => k !== 'good').reduce((a, [, v]) => a + v, 0)

export function useShareReview(port: ReviewPort, simulated = false): ReviewApi {
  const [state, setState] = useState<ReviewState>({ phase: 'idle', name: null, error: null, summary: null })
  const alive = useRef(true)
  const busy = useRef(false)
  useEffect(() => {
    alive.current = true
    // one read when the view opens, so the key knows whether there is anything to write; never on a timer
    port.summary(REVIEW_DAYS).then(
      (summary) => { if (alive.current) setState((s) => ({ ...s, summary })) },
      () => { /* unknown stays unknown: the key stays usable and the route answers for itself */ },
    )
    return () => { alive.current = false }
  }, [port])
  const nothingYet = state.summary !== null && state.summary.turns === 0
  const run = useCallback(async () => {
    if (busy.current) return
    if (nothingYet) {
      setState((s) => ({ ...s, phase: 'empty' }))
      return
    }
    busy.current = true
    setState((s) => ({ ...s, phase: 'waiting', error: null }))
    try {
      const r = await port.exportReview(REVIEW_DAYS)
      if (alive.current) setState((s) => ({ phase: 'done', name: r.name, error: null, summary: r.summary ?? s.summary }))
    } catch (e) {
      if (alive.current) setState((s) => ({ ...s, phase: 'fault', error: (e as Error).message || 'the export failed' }))
    } finally {
      busy.current = false
    }
  }, [port, nothingYet])
  const openFolder = useCallback(async () => {
    try {
      await port.openFolder()
    } catch (e) {
      if (alive.current) setState((s) => ({ ...s, phase: 'fault', error: `could not open the reviews folder: ${(e as Error).message}` }))
    }
  }, [port])
  const dismiss = useCallback(() => setState((s) => ({ ...s, phase: 'idle' })), [])
  return { state, simulated, nothingYet, run, openFolder, dismiss }
}

/** The quiet key in the conversation header. It stays a plain key while the export runs (aria-busy, not removed). */
export function ShareReviewKey({ review }: { review: ReviewApi }) {
  const waiting = review.state.phase === 'waiting'
  return (
    <button
      type="button" className="jc-key jc-key-sm jc-key-quiet jc-share" onClick={() => void review.run()}
      aria-busy={waiting || undefined} aria-disabled={waiting || review.nothingYet || undefined}
      data-testid="share-review"
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 2.5h6l4 4v7H3zM9 2.5v4h4M5.5 9.5h5M5.5 11.5h3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" /></svg>
      Share a review
      {review.nothingYet && <span className="jc-sr">Nothing to share yet: no turns in the last {REVIEW_DAYS} days.</span>}
    </button>
  )
}

/** What the last press did, under the transcript rows. Prints nothing before the first press. */
export function ReviewStatus({ review }: { review: ReviewApi }) {
  const { state, simulated } = review
  if (state.phase === 'idle') return null
  const lamp: LampState = state.phase === 'waiting' ? 'waiting'
    : state.phase === 'fault' ? 'fault'
      : state.phase === 'empty' ? 'waiting'
        : simulated ? 'simulated' : 'live'
  const n = state.summary
  const text = state.phase === 'waiting' ? `writing the review of the last ${REVIEW_DAYS} days`
    : state.phase === 'fault' ? `not written: ${state.error}`
      : state.phase === 'empty' ? `nothing to write yet: no turns were recorded in the last ${REVIEW_DAYS} days`
        : simulated ? `fixture: no file was written`
          : `written to the reviews folder as ${state.name}${n ? `: ${n.turns} turns, ${flagged(n)} flagged, flagged first` : ''}`
  return (
    <div className="jc-review" role="status" data-phase={state.phase}>
      <Lamp reading={{ state: lamp, since: null, reason: text }} subject="Review" />
      <span className="jc-review-text">{text}</span>
      {state.phase === 'done' && !simulated && (
        <button type="button" className="jc-key jc-key-sm jc-key-quiet" onClick={() => void review.openFolder()}>Open folder</button>
      )}
      {state.phase !== 'waiting' && <button type="button" className="jc-key jc-key-sm jc-key-quiet" onClick={review.dismiss}>Close</button>}
    </div>
  )
}
