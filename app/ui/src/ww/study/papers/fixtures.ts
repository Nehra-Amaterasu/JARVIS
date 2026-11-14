// Invented papers for the gallery and the tests (package Y01). Nothing here is a real paper, course or institution: the
// topics are generic words, the stems are made up from a template, the years are labels. Every reading built from these is
// stamped SIMULATED by the screens that draw it, and the null adapter never returns any of it.
import type { CropInfo, PaperRow, QType, QuestionRow, TagSource, Topic, TraceEvent } from '../ports'

/** One fixed clock, so age text and the ledger's "last run" read the same in every render and screenshot. */
export const NOW = 1_700_000_000_000

export const TOPICS: Topic[] = [
  { id: 't1', label: 'Kinematics', unit: 'Unit 1' },
  { id: 't2', label: 'Forces', unit: 'Unit 1' },
  { id: 't3', label: 'Work and energy', unit: 'Unit 1' },
  { id: 't4', label: 'Waves', unit: 'Unit 2' },
  { id: 't5', label: 'Sound', unit: 'Unit 2' },
  { id: 't6', label: 'Optics', unit: 'Unit 2' },
  { id: 't7', label: 'Interference', unit: 'Unit 2' },
  { id: 't8', label: 'Heat', unit: 'Unit 3' },
  { id: 't9', label: 'Gases', unit: 'Unit 3' },
  { id: 't10', label: 'Entropy', unit: 'Unit 3' },
  { id: 't11', label: 'Fields', unit: 'Unit 4' },
  { id: 't12', label: 'Circuits', unit: 'Unit 4' },
]

type Row = [topic: number, type: QType, marks: number]
/** Year to its questions: each year's marks sum to 100, so a share is marks over 100. */
const TABLE: Record<number, Row[]> = {
  2019: [[0, 'numerical', 10], [1, 'derivation', 20], [3, 'short', 10], [7, 'numerical', 15], [10, 'mcq', 10], [11, 'derivation', 20], [4, 'short', 15]],
  2020: [[0, 'numerical', 10], [2, 'derivation', 20], [3, 'numerical', 15], [5, 'short', 10], [8, 'mcq', 10], [11, 'derivation', 20], [6, 'short', 15]],
  2021: [[1, 'numerical', 10], [2, 'derivation', 15], [3, 'short', 10], [7, 'numerical', 15], [9, 'mcq', 10], [10, 'derivation', 20], [4, 'short', 20]],
  2022: [[0, 'numerical', 15], [1, 'derivation', 20], [4, 'short', 10], [7, 'derivation', 15], [8, 'mcq', 10], [11, 'numerical', 15], [5, 'short', 15]],
  2023: [[0, 'numerical', 10], [2, 'derivation', 20], [3, 'numerical', 15], [6, 'short', 10], [9, 'mcq', 10], [11, 'derivation', 20], [7, 'short', 15]],
  2024: [[1, 'numerical', 15], [2, 'derivation', 15], [3, 'short', 10], [7, 'numerical', 20], [10, 'mcq', 10], [11, 'derivation', 15], [5, 'short', 15]],
}
export const YEARS = Object.keys(TABLE).map(Number)

const STEM: Record<QType, (t: string, y: number) => string> = {
  numerical: (t, y) => `A trolley of mass ${y % 5 + 2} kg is used to study ${t.toLowerCase()}. Find the quantity asked in part (a) and state its unit.`,
  derivation: (t) => `Starting from the definitions, derive the relation used in ${t.toLowerCase()} and state the assumptions you make.`,
  short: (t) => `Explain in three or four lines why ${t.toLowerCase()} matters for the set-up shown.`,
  mcq: (t) => `Which statement about ${t.toLowerCase()} is correct? (a) first option (b) second option (c) third option (d) fourth option`,
}

/** A margin per question that looks like a real run: mostly clear, a few close calls. Deterministic from year and index. */
const marginOf = (y: number, i: number) => [0.64, 0.58, 0.31, 0.72, 0.09, 0.55, 0.41][(i + (y === 2024 ? 0 : y % 3)) % 7]
const tagOf = (m: number, y: number, i: number): TagSource => (m < 0.2 ? 'MODEL' : y !== 2024 && (y + i) % 11 === 0 ? 'HAND' : 'RULE')

/** A drawn crop of a printed question: a white sheet with grey text bars, as a data URI. It is a fixture, labelled so by the screens. */
export function fixtureCrop(seed: number, lines = 4): string {
  const bars = Array.from({ length: lines }, (_, i) => {
    const w = 150 + ((seed * 31 + i * 47) % 90)
    return `<rect x="14" y="${16 + i * 17}" width="${w}" height="7" rx="3" fill="#8a8f93"/>`
  }).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 120" width="280" height="120"><rect width="280" height="120" fill="#f4f3ef"/>${bars}<rect x="14" y="${16 + lines * 17}" width="60" height="7" rx="3" fill="#b1b4b6"/></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export const PAPERS: PaperRow[] = YEARS.map((y) => {
  const rows = TABLE[y]
  return { id: `p${y}`, year: y, label: `Paper ${y}`, examAt: NOW - (2025 - y) * 365 * 86_400_000, questions: rows.length, reviewed: y === 2024 ? 0 : rows.length, pages: 4 }
})

/** The newest paper's questions arrive pending (the Review Desk's work); the others were accepted earlier. */
export const QUESTIONS: QuestionRow[] = YEARS.flatMap((y) =>
  TABLE[y].map(([ti, type, marks], i) => {
    const margin = marginOf(y, i)
    const tag = tagOf(margin, y, i)
    const pending = y === 2024
    const topic = TOPICS[ti]
    const noMarks = pending && i === 5
    const cropOnly = pending && i === 4
    const crop: CropInfo = {
      img: fixtureCrop(y * 10 + i, 3 + (i % 3)),
      bbox: [20, 12 + i * 66, 460, 56],
      text: cropOnly ? undefined : STEM[type](topic.label, y),
      textStatus: cropOnly ? 'crop-only' : pending ? 'unverified' : 'verified',
    }
    return {
      id: `q${y}-${i + 1}`, paperId: `p${y}`, number: `Q${i + 1}`, year: y, topicId: topic.id, type,
      marks: noMarks ? null : marks, share: noMarks ? null : marks / 100,
      tag, margin, status: pending ? 'pending' : 'accepted', stem: STEM[type](topic.label, y), crop,
    } satisfies QuestionRow
  }),
)

export const PENDING = QUESTIONS.filter((q) => q.status === 'pending')

/** The real-looking event list of one run over the newest paper. Fixture events: SIMULATED, except the one waiting on the model. */
export const TRACE: TraceEvent[] = [
  { id: 'e1', at: NOW - 180_000, kind: 'read', text: 'read p1 text-layer ok', state: 'simulated' },
  { id: 'e2', at: NOW - 176_000, kind: 'read', text: 'read p2 text-layer ok', state: 'simulated' },
  { id: 'e3', at: NOW - 170_000, kind: 'ocr', text: 'p3 no text-layer: OCR (local) 41 words/line 0.88', state: 'simulated' },
  { id: 'e4', at: NOW - 160_000, kind: 'marks', text: 'Q4 marks [20] found', state: 'simulated' },
  { id: 'e5', at: NOW - 158_000, kind: 'topic', text: 'Q4 topic: RULE 0.72, next 0.18', state: 'simulated' },
  { id: 'e6', at: NOW - 150_000, kind: 'model', text: 'Q5 topic: model asked (margin 0.09)', state: 'waiting' },
]

/** Cells of the Strata for the first `n` papers of the fixture: one per topic and year, sized by the share of marks. */
export function cellsFor(years: number[]) {
  return QUESTIONS.filter((q) => years.includes(q.year)).map((q) => ({
    year: q.year, topicId: q.topicId, share: q.share ?? 0, type: q.type, qid: q.id, tag: q.tag, margin: q.margin, crop: q.crop,
  }))
}
