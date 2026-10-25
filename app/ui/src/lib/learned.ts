/**
 * What JARVIS learned from his own chats, waiting for Aman's Keep / Wrong
 * (yaadash/chat_memory.py review_queue / review, via /api/memory/learned).
 * Pure helpers, unit-tested (src/__tests__/learned.test.ts).
 */
export type LearnedKind = 'fact' | 'preference' | 'correction' | 'instruction' | 'dont' | 'callback'
export type Verdict = 'keep' | 'wrong'

export interface LearnedItem {
  id: string
  kind: LearnedKind
  text: string
  confidence: number
  support: number
  first_seen: number
  last_seen: number
  by: string | null
  evidence: number
}

export interface LearnedQueue { items: LearnedItem[]; pending: number; kept: number; wrong: number }

const KIND_LABEL: Record<string, string> = {
  fact: 'fact', preference: 'preference', correction: 'correction', instruction: 'standing instruction',
  dont: "don't", callback: 'callback',
}
export const kindLabel = (k: string) => KIND_LABEL[k] ?? k

/** 'just now', '40 min ago', '5 h ago', 'yesterday', '3 days ago'. */
export function ago(ts: number, nowTs: number): string {
  const s = Math.max(0, nowTs - ts)
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  const d = Math.round(s / 86400)
  return d <= 1 ? 'yesterday' : `${d} days ago`
}

/** The queue after a verdict, before the server is asked again: the item leaves, the counts move. */
export function afterVerdict(q: LearnedQueue, id: string, verdict: Verdict): LearnedQueue {
  if (!q.items.some((i) => i.id === id)) return q
  return {
    items: q.items.filter((i) => i.id !== id),
    pending: Math.max(0, q.pending - 1),
    kept: q.kept + (verdict === 'keep' ? 1 : 0),
    wrong: q.wrong + (verdict === 'wrong' ? 1 : 0),
  }
}

/** The toast after a verdict, said plainly. */
export const verdictSay = (v: Verdict) =>
  v === 'keep' ? 'Kept: JARVIS goes on using it.' : 'Marked wrong: JARVIS will not use it again.'
