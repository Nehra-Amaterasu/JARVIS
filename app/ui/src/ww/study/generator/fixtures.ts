// INVENTED data for the gallery, the tests and the Playwright bench of X03. No real paper, course or institution appears here:
// the blueprint is a made-up 60-mark shape, the topics are generic words and the questions are templates with numbers drawn
// from the seed. Every reply built from it carries the lamp state `simulated`, so the screens stamp it SIMULATED.
//
// `fixtureGenerate` is deterministic in (blueprint, seed): the same seed draws the same paper, a different seed draws another one,
// which is what the Reseed key and the printed seed promise. One section is short of reviewed questions on purpose, so the
// hollow slot is always shown by the bench.
import type { PortReply, QType } from '../ports'
import type { GeneratorExtras } from './extras'
import { nextSeed, toGen, type GenBlueprint, type Issue, type PaperSection, type PaperView, type PortBlueprint, type Slot, type SlotSource, validate } from './model'

export const NOW = Date.UTC(2026, 10, 15, 9, 0, 0)

const sim = <T,>(reason: string, data: T): PortReply<T> => ({ state: 'simulated', reason, since: NOW, data })

export const BLUEPRINT_BALANCED: PortBlueprint = {
  id: 'bp-a',
  label: 'Paper A (invented)',
  durationMin: 120,
  total: 60,
  sourcePaper: null,
  origin: 'HAND',
  sections: [
    { label: 'Section A', set: 10, attempt: 10, marksEach: 2, choice: 'all', unitLimit: 3, types: ['mcq', 'short'] },
    { label: 'Section B', set: 5, attempt: 4, marksEach: 5, choice: 'any', unitLimit: 2, types: ['numerical', 'short'] },
    { label: 'Section C', set: 3, attempt: 2, marksEach: 10, choice: 'any', unitLimit: null, types: ['derivation', 'numerical'] },
  ],
}

/** The same shape with Section B attempted 3 of 5: the sections add up to 55 against a total of 60. */
export const BLUEPRINT_UNBALANCED: PortBlueprint = {
  ...BLUEPRINT_BALANCED,
  id: 'bp-b',
  label: 'Paper B (invented, unbalanced)',
  sections: BLUEPRINT_BALANCED.sections.map((s, i) => (i === 1 ? { ...s, attempt: 3 } : s)),
}

/** Seven sections: the most the table draws, in 48 px rows. 7 x 2 marks x 5 = 70. */
export const BLUEPRINT_SEVEN: PortBlueprint = {
  id: 'bp-g',
  label: 'Paper G (invented, seven sections)',
  durationMin: 140,
  total: 70,
  sourcePaper: null,
  origin: 'HAND',
  sections: ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((c) => ({ label: `Section ${c}`, set: 5, attempt: 5, marksEach: 2, choice: 'all' as const, unitLimit: null, types: [] })),
}

export const FIXTURE_BLUEPRINTS: PortBlueprint[] = [BLUEPRINT_BALANCED, BLUEPRINT_UNBALANCED]

const TOPICS: { unit: string; topic: string; type: QType }[] = [
  { unit: 'Unit 1', topic: 'Heat flow', type: 'numerical' },
  { unit: 'Unit 1', topic: 'Lever systems', type: 'short' },
  { unit: 'Unit 2', topic: 'Light paths', type: 'mcq' },
  { unit: 'Unit 2', topic: 'Circuit loops', type: 'numerical' },
  { unit: 'Unit 3', topic: 'Wave speed', type: 'derivation' },
  { unit: 'Unit 3', topic: 'Gas laws', type: 'short' },
  { unit: 'Unit 4', topic: 'Sound pitch', type: 'mcq' },
  { unit: 'Unit 4', topic: 'Ratio tables', type: 'numerical' },
]

const STEMS: Record<QType, (a: number, b: number) => { text: string; key?: string }> = {
  numerical: (a, b) => ({ text: `A trolley of mass ${a}.0 kg is pushed with a steady force of ${a * b} N. Find its acceleration.`, key: `${b}.0 m/s^2` }),
  short: (a) => ({ text: `State what changes, and what stays the same, when the setting is raised by ${a} steps.` }),
  mcq: (a, b) => ({ text: `Which statement about the ${a + b}-step arrangement is correct? (a) it doubles (b) it halves (c) it is unchanged (d) it reverses`, key: ['(a)', '(b)', '(c)', '(d)'][(a + b) % 4] }),
  derivation: (a) => ({ text: `Derive the relation between the two quantities for a system of ${a} identical parts, stating each assumption.` }),
}

const REASONS = [
  'highest gain in {u}; not attempted for 18 days',
  'set in 4 of 6 papers on file',
  'a topic you have not marked yet',
  'a repeat family: one question from it only',
  'balances the units of this section',
]

/** A tiny page crop as a data URI: grey bars on white with the word crop, drawn so an unchecked question has something to print. */
export function fixtureCrop(seed: number): string {
  const bars = [0, 1, 2, 3].map((i) => `<rect x="14" y="${18 + i * 18}" width="${190 + ((seed * 37 + i * 53) % 120)}" height="6" rx="3" fill="#bdbdbd"/>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="100" viewBox="0 0 360 100"><rect width="360" height="100" fill="#fff"/>${bars}<text x="346" y="92" font-family="monospace" font-size="9" text-anchor="end" fill="#6b6b6b">invented crop</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function slotFor(bp: GenBlueprint, si: number, n: number, seed: number, hollowFrom: number | null): Slot {
  const s = bp.sections[si]
  const r = nextSeed(seed + si * 7919 + n * 104729)
  const pool = TOPICS.filter((t) => s.types.length === 0 || s.types.includes(t.type))
  const pick = (pool.length ? pool : TOPICS)[r % (pool.length || TOPICS.length)]
  if (hollowFrom !== null && n >= hollowFrom) {
    const need = s.set - hollowFrom
    return { n, source: 'hollow', questionId: null, text: '', textStatus: 'crop-only', marks: s.marks, unit: '', topic: '', type: null, reason: `needs ${need === 1 ? '1 more' : `${need} more`} ${s.marks}-mark question${need === 1 ? '' : 's'}: too few reviewed questions` }
  }
  const stem = STEMS[pick.type](2 + (r % 5), 2 + ((r >> 3) % 6))
  const source: SlotSource = pick.type === 'numerical' && r % 4 === 0 ? 'template' : r % 3 === 0 ? 'hand' : 'rule'
  const unverified = r % 7 === 0
  return {
    n,
    source,
    questionId: `fx-${si}-${n}-${r % 1000}`,
    text: stem.text,
    textStatus: unverified ? 'unverified' : 'verified',
    crop: unverified ? fixtureCrop(r) : undefined,
    marks: s.marks,
    unit: pick.unit,
    topic: pick.topic,
    type: pick.type,
    reason: source === 'template' ? 'a numerical filled from a template; the numbers differ from the original' : REASONS[r % REASONS.length].replace('{u}', pick.unit),
    key: stem.key,
  }
}

/** Draw a paper from a (balanced) invented blueprint. The last section is short of reviewed questions by one. */
export function fixtureDraw(bp: GenBlueprint, seed: number, opts: { withModel?: boolean } = {}): PaperView {
  const last = bp.sections.length - 1
  const sections: PaperSection[] = bp.sections.map((s, si) => {
    const hollowFrom = si === last && s.set > 1 ? s.set - 1 : null
    const slots = Array.from({ length: s.set }, (_, i) => slotFor(bp, si, i + 1, seed, hollowFrom))
    if (opts.withModel && si === 1 && slots[1]) slots[1] = { ...slots[1], source: 'model', reason: 'a model draft of an earlier question: not yet your decision', textStatus: 'unverified', crop: fixtureCrop(seed) }
    return { name: s.name, marks: s.marks, attempt: s.attempt, set: s.set, choice: s.choice, slots }
  })
  const hollow = sections.flatMap((s) => s.slots).filter((x) => x.source === 'hollow')
  return {
    id: `gen-${bp.id}-${seed}`,
    title: bp.label,
    blueprintId: bp.id,
    seed,
    questionIds: sections.flatMap((s) => s.slots).filter((x) => x.questionId).map((x) => x.questionId as string),
    gaps: hollow.map((h) => h.reason),
    header: 'Practice paper from your bank. Not an official paper.',
    totalMarks: bp.total ?? bp.sections.reduce((n, s) => n + s.attempt * s.marks, 0),
    durationMin: bp.durationMin,
    sections,
    shortfall: hollow.map((h) => h.reason),
  }
}

/** The port the gallery and the bench use: invented blueprints and a seeded draw, every reply SIMULATED. */
export function fixturePort(list: PortBlueprint[] = FIXTURE_BLUEPRINTS, opts: { withModel?: boolean } = {}) {
  return {
    blueprints: async () => sim('invented blueprints for the gallery', list),
    generate: async (req: { blueprintId: string; seed: number }): Promise<PortReply<PaperView>> => {
      const found = list.find((b) => b.id === req.blueprintId)
      if (!found) return { state: 'fault', reason: 'no blueprint with that id', since: NOW, data: null }
      const bp = toGen(found)
      const issues = validate(bp)
      if (issues.length) return { state: 'fault', reason: `The blueprint does not balance: ${issues[0].text}`, since: NOW, data: null }
      return sim('invented questions drawn from the seed', fixtureDraw(bp, req.seed, opts))
    },
  }
}

/** The optional members a real adapter will supply (save, infer); here they answer from the invented data. */
export const fixtureExtras: GeneratorExtras = {
  save: async (bp) => {
    const issues: Issue[] = validate(bp)
    return sim(issues.length ? 'saved with issues: the generator will refuse it' : 'saved', { blueprint: { ...bp }, issues })
  },
  infer: async () => {
    const bp = { ...toGen(BLUEPRINT_BALANCED), origin: 'RULE' as const, sourcePaper: 'paper-1' }
    return sim('inferred by a rule from an invented paper; not saved', { blueprint: bp, issues: [], trace: ['read 3 section headings', 'marks each: modal value per section', 'attempt counts from "attempt any" phrases'] })
  },
}
