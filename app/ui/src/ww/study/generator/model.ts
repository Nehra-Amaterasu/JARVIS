// The pure side of the generator screens (package X03): the blueprint as the student edits it, the three invariants the
// engine checks before it will generate (docs/design/well-wisher-engine-plan.md 9.1.5, `validate_blueprint`), the generated paper
// as the slots screen and the print sheet read it, and the seed. Nothing here touches a route, the clock or a random source, so a
// test can state every figure on the screen.
//
// The port types are narrower than the route payloads (ports.ts is frozen and owned by Y01). `PortBlueprint` and `PaperView` are
// the port's own types plus OPTIONAL fields, so a reply typed as `Blueprint` or `GeneratedPaper` is assignable unchanged and a
// later adapter fills the extra fields without a change here. A field the adapter did not send is drawn as absent, never invented.
import type { Blueprint, GenerateRequest, GeneratedPaper, PortReply, QType, TagSource, TextStatus } from '../ports'

export type Choice = 'all' | 'any' | 'or-pairs'
export const CHOICES: readonly Choice[] = ['all', 'any', 'or-pairs']
export const CHOICE_LABEL: Record<Choice, string> = { all: 'attempt all', any: 'any k of n', 'or-pairs': 'OR pairs' }
export const QTYPES: readonly QType[] = ['numerical', 'derivation', 'short', 'mcq']
export const QTYPE_LABEL: Record<QType, string> = { numerical: 'numerical', derivation: 'derivation', short: 'short answer', mcq: 'multiple choice' }
export const QTYPE_SHORT: Record<QType, string> = { numerical: 'numerical', derivation: 'derivation', short: 'short', mcq: 'choice' }

/** At most seven sections on screen (spec 20: no group shows more than seven choices). */
export const MAX_SECTIONS = 7
export const MAX_SET = 30
export const MAX_MARKS = 50
export const HEADER = 'Practice paper from your bank. Not an official paper.'

export interface GenSection {
  name: string
  /** Questions set in the section. */
  set: number
  /** Questions to attempt. */
  attempt: number
  /** Marks each. */
  marks: number
  choice: Choice
  /** At most this many questions from one unit; null for no limit. */
  unitLimit: number | null
  /** Allowed question types; empty means all. */
  types: QType[]
}

export interface GenBlueprint {
  id: string
  label: string
  /** The exam's length in minutes, or null when it is not known (then minutes per mark is not drawn). */
  durationMin: number | null
  /** The total the paper prints, or null when none was stated (then the sum of the sections is the total). */
  total: number | null
  origin: TagSource
  sourcePaper: string | null
  sections: GenSection[]
}

export interface Issue { code: string; section: string | null; text: string }

type PortSection = Blueprint['sections'][number] & { choice?: Choice; unitLimit?: number | null; types?: QType[] }
/** What a Blueprint reply may carry beyond the port's four section fields. */
export type PortBlueprint = Omit<Blueprint, 'sections'> & { durationMin?: number | null; total?: number | null; sourcePaper?: string | null; sections: PortSection[] }

export const toGen = (b: PortBlueprint): GenBlueprint => ({
  id: b.id,
  label: b.label,
  durationMin: b.durationMin ?? null,
  total: b.total ?? null,
  origin: b.origin,
  sourcePaper: b.sourcePaper ?? null,
  sections: b.sections.map((s) => ({
    name: s.label,
    set: s.set,
    attempt: s.attempt,
    marks: s.marksEach,
    choice: s.choice ?? (s.attempt >= s.set ? 'all' : 'any'),
    unitLimit: s.unitLimit ?? null,
    types: s.types ?? [],
  })),
})

/** The sum the invariant compares with the total: attempt times marks each, over the sections. */
export const marksOf = (bp: Pick<GenBlueprint, 'sections'>): number => bp.sections.reduce((n, s) => n + s.attempt * s.marks, 0)
/** The total the paper prints: the stated total, else the sum. */
export const totalOf = (bp: GenBlueprint): number => bp.total ?? marksOf(bp)
export const questionsToAttempt = (bp: Pick<GenBlueprint, 'sections'>): number => bp.sections.reduce((n, s) => n + s.attempt, 0)
export const questionsToSet = (bp: Pick<GenBlueprint, 'sections'>): number => bp.sections.reduce((n, s) => n + s.set, 0)

/** Minutes per mark, or null when the duration or the total is missing: a figure is never made up from a default. */
export function minutesPerMark(bp: GenBlueprint): number | null {
  const t = totalOf(bp)
  return bp.durationMin && t > 0 ? bp.durationMin / t : null
}
export const minutesText = (n: number | null): string => (n === null ? '--' : n.toFixed(1))

/**
 * The three rules of the engine's `validate_blueprint`, in the words a student reads: the sum of attempt times marks each equals the
 * total; the set count is at least the attempt count; OR choices come in pairs (an even set count, attempt half of it). The first
 * issue is the one the generator quotes when it refuses.
 */
export function validate(bp: GenBlueprint): Issue[] {
  const out: Issue[] = []
  if (bp.sections.length === 0) return [{ code: 'empty', section: null, text: 'A blueprint needs at least one section.' }]
  const sum = marksOf(bp)
  if (bp.total !== null && sum !== bp.total) {
    const d = bp.total - sum
    out.push({ code: 'total', section: null, text: `The sections add up to ${sum} marks, the total says ${bp.total} (${Math.abs(d)} ${d > 0 ? 'short' : 'over'}).` })
  }
  for (const s of bp.sections) {
    if (s.set < s.attempt) out.push({ code: 'set-below-attempt', section: s.name, text: `${s.name}: ${s.set} set is fewer than ${s.attempt} to attempt.` })
    if (s.choice === 'or-pairs' && (s.set % 2 !== 0 || s.attempt * 2 !== s.set)) out.push({ code: 'or-pairs', section: s.name, text: `${s.name}: OR pairs need an even set count and attempt half of it.` })
  }
  return out
}

/** The editor keeps a section self-consistent where it can: "attempt all" follows the set count, "OR pairs" the half rule. */
export function settle(s: GenSection): GenSection {
  if (s.choice === 'all') return { ...s, attempt: s.set }
  if (s.choice === 'or-pairs') return { ...s, set: s.set % 2 === 0 ? s.set : s.set + 1, attempt: (s.set % 2 === 0 ? s.set : s.set + 1) / 2 }
  return { ...s, attempt: Math.min(s.attempt, s.set) }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)))
export const clampSet = (n: number) => clamp(n, 1, MAX_SET)
export const clampMarks = (n: number) => clamp(n, 1, MAX_MARKS)

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
/** The next free "Section X" name. */
export function nextName(sections: readonly GenSection[]): string {
  const used = new Set(sections.map((s) => s.name))
  for (const c of LETTERS) if (!used.has(`Section ${c}`)) return `Section ${c}`
  return `Section ${sections.length + 1}`
}
export const newSection = (sections: readonly GenSection[]): GenSection => ({ name: nextName(sections), set: 5, attempt: 5, marks: 2, choice: 'all', unitLimit: null, types: [] })

export function moveSection<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return [...list]
  const out = [...list]
  const [x] = out.splice(from, 1)
  out.splice(to, 0, x)
  return out
}

export const sameBlueprint = (a: GenBlueprint | null, b: GenBlueprint | null): boolean => JSON.stringify(a) === JSON.stringify(b)

// ------------------------------------------------------------------------------------------------ the A4 skeleton

export interface SkeletonRow { kind: 'head' | 'slot'; y: number; h: number; w: number; section: number }
/** Rows of the live A4 skeleton in page units (794 x 1123): a heading per section and one bar per question set, sized by marks and squeezed to fit. */
export function skeletonRows(bp: Pick<GenBlueprint, 'sections'>, page = { w: 794, h: 1123 }): SkeletonRow[] {
  const top = 150
  const avail = page.h - top - 90
  const raw: { kind: 'head' | 'slot'; h: number; w: number; section: number }[] = []
  bp.sections.forEach((s, i) => {
    raw.push({ kind: 'head', h: 30, w: 360, section: i })
    for (let k = 0; k < s.set; k++) raw.push({ kind: 'slot', h: 16 + s.marks * 3, w: page.w - 190 - ((i + k) % 3) * 70, section: i })
  })
  const sum = raw.reduce((n, r) => n + r.h + 10, 0)
  const f = sum > avail ? avail / sum : 1
  let y = top
  return raw.map((r) => {
    const row = { ...r, y, h: Math.max(4, r.h * f) }
    y += (r.h + 10) * f
    return row
  })
}

// ------------------------------------------------------------------------------------------------ the generated paper

export type SlotSource = 'hand' | 'rule' | 'template' | 'model' | 'hollow'
export interface Slot {
  n: number
  source: SlotSource
  questionId: string | null
  /** The question as text. Empty for a hollow slot. */
  text: string
  /** `verified` prints as text; anything else prints as the crop, because the crop is the source of truth. */
  textStatus: TextStatus
  /** A URL or data URI of the page crop. */
  crop?: string
  marks: number
  unit: string
  topic: string
  type: QType | null
  /** Why this question is here, or why the slot is hollow. */
  reason: string
  /** The answer key line, when the bank has one. */
  key?: string
}
export interface PaperSection { name: string; marks: number; attempt: number; set: number; choice?: Choice; slots: Slot[] }
export type PaperView = GeneratedPaper & {
  id?: string
  title?: string
  header?: string
  totalMarks?: number
  durationMin?: number | null
  sections?: PaperSection[]
  shortfall?: string[]
}

export const isHollow = (s: Slot): boolean => s.source === 'hollow'
export const printsAsCrop = (s: Slot): boolean => !isHollow(s) && s.textStatus !== 'verified'

export interface PaperStats { sections: number; slots: number; filled: number; hollow: number; asCrop: number; marks: number }
export function paperStats(p: PaperView | null): PaperStats {
  const secs = p?.sections ?? []
  const all = secs.flatMap((s) => s.slots)
  return {
    sections: secs.length,
    slots: all.length,
    filled: all.filter((s) => !isHollow(s)).length,
    hollow: all.filter(isHollow).length,
    asCrop: all.filter(printsAsCrop).length,
    marks: p?.totalMarks ?? secs.reduce((n, s) => n + s.attempt * s.marks, 0),
  }
}

/** What a section's instruction line says: "Attempt any 3 of 5, 5 marks each". */
export function instruction(s: { set: number; attempt: number; marks: number; choice?: Choice }): string {
  const how = s.choice === 'or-pairs' ? `Attempt one of each of ${s.set / 2} pairs` : s.attempt >= s.set ? `Attempt all ${s.set}` : `Attempt any ${s.attempt} of ${s.set}`
  return `${how}, ${s.marks} mark${s.marks === 1 ? '' : 's'} each`
}

/** The two members of StudyPort the desk reads through; StudyPort itself is assignable to it, so the desk's default is STUDY_PORT. */
export interface GeneratorPort {
  blueprints(): Promise<PortReply<PortBlueprint[]>>
  generate(req: GenerateRequest): Promise<PortReply<PaperView>>
}

// ------------------------------------------------------------------------------------------------ the seed

export const SEED_MAX = 2_147_483_646
/** A seed from typed text: a whole number from 1 to SEED_MAX, else null. */
export function parseSeed(text: string): number | null {
  const t = text.trim()
  if (!/^\d{1,10}$/.test(t)) return null
  const n = Number(t)
  return n >= 1 && n <= SEED_MAX ? n : null
}
/** Reseed without a random source: the Park-Miller step, so a seed is printed and a paper can be drawn again. */
export const nextSeed = (seed: number): number => ((Math.max(1, seed) * 48271) % 2_147_483_647) || 1
