/**
 * Study's state, in one module store so the paper chosen in the list is the paper the Countdown card
 * (chunk 6) shows, and both survive a tab round trip (the page remounts, this store does not).
 *
 * `practice` is keyed by the paper it was made for: choosing another paper drops it, and a reply that
 * arrives for a paper that is no longer chosen is ignored, so the cell never shows paper B's questions
 * under paper A's name.
 */
import { create } from 'zustand'
import {
  getBank, getDisk, getExams, getHarvest, getPaper, postMarks, postMinutes, postTopic,
  type BankListing, type ExamsAnswer, type HarvestQueue, type MarksResult, type PracticePaper, type Tier,
} from './api'
import { changes, savedLine } from './marksLoop'

export interface Practice {
  paperId: string
  tier: Tier
  seed: number
  paper: PracticePaper | null
  busy: boolean
  error: string | null
  /** The line after Save marks: "Saved. Tomorrow's blocks changed: ..." or "Saved. No change ...". */
  saved: string | null
  score: { score: number; max: number } | null
}

type TopicState = 'none' | 'learned' | 'solid'

interface StudyState {
  exams: ExamsAnswer | null
  examsFailed: boolean
  selected: string | null
  practice: Practice | null
  bank: BankListing | null
  bankFor: string | null
  harvest: HarvestQueue | null
  /** Questions on disk (harvested) per subject; absent = not read, which is not the same as 0. */
  disk: Record<string, number>

  loadExams: () => Promise<ExamsAnswer | null>
  select: (id: string) => void
  loadBank: (subject: string) => Promise<void>
  loadHarvest: () => Promise<void>
  loadDisk: (subject: string) => Promise<void>
  tapTopic: (subject: string, key: string, next: TopicState) => Promise<boolean>
  logMinutes: (subject: string, minutes: number) => Promise<boolean>
  makePaper: (paperId: string, tier: Tier, seed: number) => Promise<PracticePaper | null>
  saveMarks: (items: { id: string; got: number; max: number }[]) => Promise<MarksResult | null>
}

const patchTopic = (x: ExamsAnswer, subject: string, key: string, state: TopicState): ExamsAnswer => ({
  ...x,
  papers: x.papers.map((p) => {
    if (p.subject !== subject) return p
    const topics = p.topics.map((t) => (t.key === key ? { ...t, state } : t))
    const counts = { none: 0, learned: 0, solid: 0 }
    topics.forEach((t) => { counts[t.state]++ })
    return { ...p, topics, counts }
  }),
})

export const useStudy = create<StudyState>((set, get) => ({
  exams: null,
  examsFailed: false,
  selected: null,
  practice: null,
  bank: null,
  bankFor: null,
  harvest: null,
  disk: {},

  // The next paper is preselected: the first one ahead, unless the choice is still on the list.
  loadExams: async () => {
    try {
      const x = await getExams()
      const ids = x.papers.map((p) => p.id)
      const keep = get().selected && ids.includes(get().selected!) ? get().selected : (ids[0] ?? null)
      set({ exams: x, examsFailed: false, selected: keep })
      return x
    } catch {
      set({ examsFailed: true })
      return null
    }
  },

  select: (id) => {
    if (get().selected === id) return
    set({ selected: id, practice: null, bank: null, bankFor: null })
  },

  loadBank: async (subject) => {
    try {
      const bank = await getBank(subject)
      // a reply for a subject that is no longer on screen is dropped
      const cur = get().exams?.papers.find((p) => p.id === get().selected)
      if (cur && cur.subject === subject) set({ bank, bankFor: subject })
    } catch {
      set({ bank: null, bankFor: null })
    }
  },

  // Off the page entirely when the route is absent: the queue line then simply does not render.
  loadHarvest: async () => {
    try { set({ harvest: await getHarvest() }) } catch { set({ harvest: null }) }
  },

  loadDisk: async (subject) => {
    try {
      const d = await getDisk(subject)
      set({ disk: { ...get().disk, [subject]: d.on_disk } })
    } catch { /* absent route: the bank line simply shows the typed count */ }
  },

  tapTopic: async (subject, key, next) => {
    const before = get().exams
    if (before) set({ exams: patchTopic(before, subject, key, next) })
    try {
      set({ exams: await postTopic(subject, key, next) })
      return true
    } catch {
      if (before) set({ exams: before })   // put the chip back where the server has it
      return false
    }
  },

  logMinutes: async (subject, minutes) => {
    try { set({ exams: await postMinutes(subject, minutes) }); return true } catch { return false }
  },

  makePaper: async (paperId, tier, seed) => {
    const base: Practice = { paperId, tier, seed, paper: null, busy: true, error: null, saved: null, score: null }
    set({ practice: base })
    try {
      const paper = await getPaper(paperId, seed, tier)
      if (get().selected !== paperId) return null
      set({ practice: { ...base, paper, busy: false } })
      return paper
    } catch (e) {
      if (get().selected === paperId) set({ practice: { ...base, busy: false, error: (e as Error).message || 'Could not build a paper.' } })
      return null
    }
  },

  saveMarks: async (items) => {
    const p = get().practice
    if (!p?.paper || !items.length) return null
    let before: ExamsAnswer | null = get().exams
    try { before = await getExams() } catch { /* the cached answer is the best "before" there is */ }
    try {
      const r = await postMarks(p.paperId, items, p.paper.seed)   // the seed the server built the paper from, not the one asked for
      let after: ExamsAnswer | null = null
      try { after = await getExams() } catch { /* the marks are saved; only the comparison is lost */ }
      if (get().practice?.paperId !== p.paperId) return r
      set({
        exams: after ?? get().exams,
        practice: { ...get().practice!, saved: after ? savedLine(changes(before, after)) : 'Saved. The plan could not be re-read, so tomorrow is not compared.', score: { score: r.score, max: r.max } },
      })
      return r
    } catch {
      return null
    }
  },
}))

export const selectPaper = (id: string) => useStudy.getState().select(id)

/** Tests only. */
export function resetStudyStore(): void {
  useStudy.setState({ exams: null, examsFailed: false, selected: null, practice: null, bank: null, bankFor: null, harvest: null, disk: {} })
}
