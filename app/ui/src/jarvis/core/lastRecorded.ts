// The last real exchange, for an empty Talk view (jury, 15 Nov: "the conversation pane is mostly empty in the first
// frame"). When the core is asleep the store holds no turns of this run, but the transcript store on disk still holds
// earlier ones (GET /api/transcripts/recent, a route that already exists). The view shows the last exchange from there,
// marked as an earlier run, so a first frame says something true instead of nothing.
//
// One read when the view opens and the run has no turns; never on a timer. Nothing is invented: if the route answers
// with no turns, or fails, the view keeps its honest "no turns in this run yet".
import { useEffect, useRef, useState } from 'react'
import { api, type Turn } from '../../lib/api'

/** A line of data/transcripts/*.jsonl as GET /api/transcripts/recent returns it. */
export interface RecordedEntry { kind?: string; session?: string; id: number; role: 'you' | 'jarvis'; text?: string; ts: number; seconds?: number | null }

export type RecordedTurn = Turn & { session?: string }

/** How far back the view looks for one exchange, and how many lines it asks for. */
export const RECORDED_DAYS = 30
export const RECORDED_LIMIT = 12

/**
 * The last exchange: the newest reply and the question just before it in the same session, or the newest line alone when
 * it is a question nobody answered. Oldest first. Empty when there is nothing recorded.
 */
export function lastExchange(entries: readonly RecordedEntry[]): RecordedTurn[] {
  const turns = entries.filter((e) => (e.kind ?? 'turn') === 'turn' && (e.role === 'you' || e.role === 'jarvis') && typeof e.text === 'string' && e.text.trim())
  const last = turns[turns.length - 1]
  if (!last) return []
  const toTurn = (e: RecordedEntry): RecordedTurn => ({
    id: e.id, role: e.role, text: e.text ?? '', t: e.ts, done: true, session: e.session,
    ...(typeof e.seconds === 'number' ? { seconds: e.seconds } : {}),
  })
  if (last.role === 'jarvis') {
    for (let i = turns.length - 2; i >= 0; i--) {
      if (turns[i].role === 'you' && turns[i].session === last.session) return [toTurn(turns[i]), toTurn(last)]
      if (turns[i].session !== last.session) break
    }
  }
  return [toTurn(last)]
}

/** Reads the recorded exchange once while `wanted` (the run has no turns). Returns [] until it answers or when it cannot. */
export function useLastRecorded(wanted: boolean, read: () => Promise<RecordedEntry[]> = defaultRead): RecordedTurn[] {
  const [turns, setTurns] = useState<RecordedTurn[]>([])
  const asked = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    if (!wanted || asked.current) return
    asked.current = true
    read().then((e) => { if (mounted.current) setTurns(lastExchange(Array.isArray(e) ? e : [])) }, () => { /* no record: the view says so itself */ })
  }, [wanted, read])
  return turns
}

const defaultRead = () => api<RecordedEntry[]>(`/api/transcripts/recent?days=${RECORDED_DAYS}&limit=${RECORDED_LIMIT}`)
