// The Review Desk's rules as pure functions (package Y01, spec 20.7.2): what Accept, Edit, Merge, Split and Reject do to a
// list of questions, which of them are "certain", and where "Next uncertain" lands. The component draws this state and calls
// these functions; a test drives them without a screen. Nothing enters the bank without a decision here: a question is
// `pending` until Accept (or "Accept all certain") makes it `accepted`, and a model's tag never accepts anything by itself.
import type { CropInfo, QType, QuestionRow, ReviewStatus, RubricPoint, TagSource } from '../ports'

/** A question being reviewed: the row, a rubric the student may build, and the ids it was merged from. */
export interface ReviewItem {
  id: string
  paperId: string
  number: string
  year: number | null
  topicId: string
  type: QType
  marks: number | null
  tag: TagSource
  margin: number
  status: ReviewStatus
  stem: string
  crop: CropInfo
  rubric: RubricPoint[]
  mergedFrom?: string[]
  /** OCR read the text: the engine's mean line confidence (0 to 1). Absent for a text layer. The text stays unverified until he checks it. */
  ocrConfidence?: number | null
  /** One draft for a whole page, to split by hand. */
  wholePage?: boolean
  /** The fields the student set by hand ("stem", "marks", "topic", "type"): each shows a HAND chip. */
  hand?: string[]
}

export interface ReviewState {
  items: ReviewItem[]
  /** The question under the cursor (an id), or null when the list is empty. */
  cursorId: string | null
  /** A reject that can still be undone: which question and until when (epoch ms). */
  undo: { id: string; until: number } | null
}

/** How long a reject can be taken back. */
export const UNDO_MS = 10_000
/** "Accept all certain" takes only a RULE tag at this margin or more, with the marks found. */
export const CERTAIN_MARGIN = 0.5

export const toItem = (q: QuestionRow): ReviewItem => ({
  id: q.id, paperId: q.paperId, number: q.number, year: q.year, topicId: q.topicId, type: q.type, marks: q.marks,
  tag: q.tag, margin: q.margin, status: q.status, stem: q.stem, crop: q.crop, rubric: q.rubric ?? [],
  ...(q.ocrConfidence != null ? { ocrConfidence: q.ocrConfidence } : {}),
  ...(q.wholePage ? { wholePage: true } : {}),
})

export function initialReview(rows: readonly QuestionRow[]): ReviewState {
  const items = rows.map(toItem)
  const first = items.find((i) => i.status === 'pending') ?? items[0]
  return { items, cursorId: first?.id ?? null, undo: null }
}

export const isCertain = (i: ReviewItem): boolean => i.status === 'pending' && i.tag === 'RULE' && i.margin >= CERTAIN_MARGIN && i.marks !== null

export const pending = (s: ReviewState): ReviewItem[] => s.items.filter((i) => i.status === 'pending')
export const certain = (s: ReviewState): ReviewItem[] => s.items.filter(isCertain)

/** The pending question with the lowest margin other than the one under the cursor (ties by list order); null when there is none. */
export function nextUncertain(s: ReviewState): string | null {
  const rest = pending(s).filter((i) => i.id !== s.cursorId)
  if (rest.length === 0) return null
  return rest.reduce((a, b) => (b.margin < a.margin ? b : a)).id
}

/** The pending question after `id` in list order, wrapping once; null when none is pending. */
function nextPendingAfter(items: readonly ReviewItem[], id: string | null): string | null {
  const at = items.findIndex((i) => i.id === id)
  for (let k = 1; k <= items.length; k++) {
    const i = items[(at + k + items.length) % items.length]
    if (i && i.status === 'pending' && i.id !== id) return i.id
  }
  return null
}

export type ReviewAction =
  | { type: 'go'; id: string }
  | { type: 'step'; by: 1 | -1 }
  | { type: 'accept'; id?: string }
  | { type: 'acceptCertain' }
  | { type: 'reject'; id?: string; now: number }
  | { type: 'undo'; now: number }
  | { type: 'expire'; now: number }
  | { type: 'edit'; id?: string; patch: Partial<Pick<ReviewItem, 'stem' | 'marks' | 'topicId' | 'type'>> }
  | { type: 'verify'; id?: string; verified: boolean }
  | { type: 'merge'; id?: string }
  | { type: 'split'; id?: string; at?: number }
  | { type: 'nextUncertain' }
  | { type: 'addPoint'; id?: string; text: string; marks: number }

const patchItem = (items: ReviewItem[], id: string, f: (i: ReviewItem) => ReviewItem) => items.map((i) => (i.id === id ? f(i) : i))

/** Where the cursor goes after the item under it was decided: the next pending question, else it stays. */
const afterDecision = (items: ReviewItem[], id: string, cursor: string | null) => (cursor === id ? nextPendingAfter(items, id) ?? cursor : cursor)

export function reduceReview(s: ReviewState, a: ReviewAction): ReviewState {
  const target = (id?: string) => id ?? s.cursorId
  switch (a.type) {
    case 'go':
      return s.items.some((i) => i.id === a.id) ? { ...s, cursorId: a.id } : s
    case 'step': {
      const at = s.items.findIndex((i) => i.id === s.cursorId)
      const to = s.items[Math.min(s.items.length - 1, Math.max(0, at + a.by))]
      return to ? { ...s, cursorId: to.id } : s
    }
    case 'accept': {
      const id = target(a.id)
      const cur = s.items.find((i) => i.id === id)
      if (!id || !cur || cur.status === 'accepted') return s
      const items = patchItem(s.items, id, (i) => ({ ...i, status: 'accepted' }))
      return { ...s, items, cursorId: afterDecision(items, id, s.cursorId) }
    }
    case 'acceptCertain': {
      const ok = new Set(certain(s).map((i) => i.id))
      if (ok.size === 0) return s
      const items = s.items.map((i) => (ok.has(i.id) ? { ...i, status: 'accepted' as const } : i))
      const next = { ...s, items }
      return { ...next, cursorId: nextUncertain({ ...next, cursorId: null }) ?? s.cursorId }
    }
    case 'reject': {
      const id = target(a.id)
      const cur = s.items.find((i) => i.id === id)
      if (!id || !cur || cur.status === 'rejected') return s
      const items = patchItem(s.items, id, (i) => ({ ...i, status: 'rejected' }))
      return { ...s, items, cursorId: afterDecision(items, id, s.cursorId), undo: { id, until: a.now + UNDO_MS } }
    }
    case 'undo': {
      if (!s.undo || a.now > s.undo.until) return { ...s, undo: null }
      const id = s.undo.id
      return { ...s, items: patchItem(s.items, id, (i) => ({ ...i, status: 'pending' })), cursorId: id, undo: null }
    }
    case 'expire':
      return s.undo && a.now > s.undo.until ? { ...s, undo: null } : s
    case 'edit': {
      const id = target(a.id)
      if (!id) return s
      const items = patchItem(s.items, id, (i) => {
        const topicChanged = a.patch.topicId !== undefined && a.patch.topicId !== i.topicId
        const next = { ...i, ...a.patch }
        // a topic the student chose is a HAND tag at full margin; a recognised text the student retyped is still unverified
        if (topicChanged) { next.tag = 'HAND'; next.margin = 1 }
        next.hand = [...new Set([...(i.hand ?? []), ...Object.keys(a.patch).map((k) => (k === 'topicId' ? 'topic' : k))])]
        if (a.patch.stem !== undefined) next.crop = { ...i.crop, text: a.patch.stem, textStatus: i.crop.textStatus === 'crop-only' ? 'unverified' : i.crop.textStatus }
        return next
      })
      return { ...s, items }
    }
    case 'verify': {
      const id = target(a.id)
      if (!id) return s
      return { ...s, items: patchItem(s.items, id, (i) => ({ ...i, crop: { ...i.crop, textStatus: a.verified ? 'verified' : 'unverified' } })) }
    }
    case 'merge': {
      const id = target(a.id)
      const at = s.items.findIndex((i) => i.id === id)
      const prev = at > 0 ? s.items[at - 1] : undefined
      const cur = s.items[at]
      // a split question is put back together with the one before it, on the same paper
      if (!prev || !cur || prev.paperId !== cur.paperId) return s
      const bbox = prev.crop.bbox && cur.crop.bbox
        ? ([prev.crop.bbox[0], prev.crop.bbox[1], Math.max(prev.crop.bbox[2], cur.crop.bbox[2]), prev.crop.bbox[3] + cur.crop.bbox[3]] as const)
        : prev.crop.bbox
      const stem = `${prev.stem} ${cur.stem}`.trim()
      const merged: ReviewItem = {
        ...prev, stem, status: 'pending', margin: Math.min(prev.margin, cur.margin),
        marks: prev.marks !== null && cur.marks !== null ? prev.marks + cur.marks : null,
        crop: { ...prev.crop, bbox, text: stem, textStatus: 'unverified' }, mergedFrom: [...(prev.mergedFrom ?? [prev.id]), cur.id],
      }
      const items = s.items.filter((i) => i.id !== cur.id).map((i) => (i.id === prev.id ? merged : i))
      return { ...s, items, cursorId: prev.id }
    }
    case 'split': {
      const id = target(a.id)
      const cur = s.items.find((i) => i.id === id)
      if (!id || !cur || cur.stem.length < 2) return s
      // the cut is the end of the sentence nearest the middle unless the caller gives an index
      const mid = Math.floor(cur.stem.length / 2)
      const cuts = [...cur.stem.matchAll(/[.?)]\s/g)].map((m) => (m.index ?? 0) + 1)
      const cut = Math.min(cur.stem.length - 1, Math.max(1, a.at ?? (cuts.length ? cuts.reduce((x, y) => (Math.abs(y - mid) < Math.abs(x - mid) ? y : x)) : mid)))
      const first = cur.stem.slice(0, cut).trim()
      const rest = cur.stem.slice(cut).trim()
      if (!first || !rest) return s
      // the marks of a split question are not known: both parts ask for them, so neither counts as certain
      const a1: ReviewItem = { ...cur, stem: first, marks: null, crop: { ...cur.crop, text: first, textStatus: 'unverified' } }
      const b1: ReviewItem = { ...cur, id: `${cur.id}b`, number: `${cur.number}b`, stem: rest, marks: null, status: 'pending', crop: { ...cur.crop, text: rest, textStatus: 'unverified' }, mergedFrom: undefined, rubric: [] }
      const at = s.items.findIndex((i) => i.id === id)
      const items = [...s.items.slice(0, at), a1, b1, ...s.items.slice(at + 1)]
      return { ...s, items, cursorId: a1.id }
    }
    case 'nextUncertain': {
      const id = nextUncertain(s)
      return id ? { ...s, cursorId: id } : s
    }
    case 'addPoint': {
      const id = target(a.id)
      if (!id || !a.text.trim() || !(a.marks > 0)) return s
      return { ...s, items: patchItem(s.items, id, (i) => ({ ...i, rubric: [...i.rubric, { id: `${i.id}-r${i.rubric.length + 1}`, text: a.text.trim(), marks: a.marks, origin: 'HAND', accepted: true }] })) }
    }
  }
}

/** The rubric's marks against the question's: points must sum to the marks, so a mismatch is said in words, never fixed silently. */
export function rubricSum(i: ReviewItem): { sum: number; total: number | null; ok: boolean } {
  const sum = i.rubric.reduce((x, p) => x + p.marks, 0)
  return { sum, total: i.marks, ok: i.marks !== null && sum === i.marks }
}
