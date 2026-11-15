// The pure side of X03: the three invariants of the engine's `validate_blueprint` in a student's words, the settle rules of the editor,
// minutes per mark that is never made up, the A4 skeleton, the seed (parse and Park-Miller reseed), and the invented draw: deterministic,
// one hollow slot never padded, and every sentence free of the forbidden words.
import { describe, expect, it } from 'vitest'
import { BLUEPRINT_BALANCED, BLUEPRINT_SEVEN, BLUEPRINT_UNBALANCED, fixtureDraw } from '../fixtures'
import {
  CHOICES, SEED_MAX, instruction, isHollow, marksOf, minutesPerMark, minutesText, moveSection, newSection, nextName, nextSeed, paperStats, parseSeed,
  printsAsCrop, settle, skeletonRows, toGen, totalOf, validate, type GenSection,
} from '../model'
import { COPY, FORBIDDEN_WORDS } from '../copy'
import { numbered } from '../PrintSheet'

const bp = toGen(BLUEPRINT_BALANCED)

describe('the invariants', () => {
  it('the invented 60-mark blueprint balances: 10 x 2, 4 x 5, 2 x 10', () => {
    expect(marksOf(bp)).toBe(60)
    expect(totalOf(bp)).toBe(60)
    expect(validate(bp)).toEqual([])
  })
  it('an unbalanced blueprint says by how much, in words, and quotes the total first', () => {
    const issues = validate(toGen(BLUEPRINT_UNBALANCED))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ code: 'total', section: null })
    expect(issues[0].text).toBe('The sections add up to 55 marks, the total says 60 (5 short).')
    const over = validate({ ...bp, total: 50 })
    expect(over[0].text).toContain('(10 over)')
  })
  it('no stated total means the sum is the total, so the rule cannot fail by itself', () => {
    const free = { ...bp, total: null }
    expect(totalOf(free)).toBe(60)
    expect(validate(free)).toEqual([])
  })
  it('the set count must be at least the attempt count', () => {
    const s = bp.sections.map((x, i) => (i === 1 ? { ...x, set: 3, attempt: 4 } : x))
    const issues = validate({ ...bp, total: null, sections: s })
    expect(issues.map((i) => i.code)).toEqual(['set-below-attempt'])
    expect(issues[0].section).toBe('Section B')
  })
  it('OR pairs need an even set count and attempt half of it', () => {
    const ok: GenSection = { name: 'Section Q', set: 6, attempt: 3, marks: 4, choice: 'or-pairs', unitLimit: null, types: [] }
    expect(validate({ ...bp, total: null, sections: [ok] })).toEqual([])
    expect(validate({ ...bp, total: null, sections: [{ ...ok, set: 5 }] }).map((i) => i.code)).toContain('or-pairs')
    expect(validate({ ...bp, total: null, sections: [{ ...ok, attempt: 2 }] }).map((i) => i.code)).toContain('or-pairs')
  })
  it('a blueprint with no section is one issue', () => {
    expect(validate({ ...bp, sections: [] }).map((i) => i.code)).toEqual(['empty'])
  })
})

describe('the editor keeps a section consistent', () => {
  const s: GenSection = { name: 'Section A', set: 5, attempt: 3, marks: 2, choice: 'any', unitLimit: null, types: [] }
  it('"attempt all" follows the set count', () => expect(settle({ ...s, choice: 'all' }).attempt).toBe(5))
  it('"OR pairs" rounds the set count up to even and attempts half', () => expect(settle({ ...s, choice: 'or-pairs' })).toMatchObject({ set: 6, attempt: 3 }))
  it('"any k of n" never attempts more than is set', () => expect(settle({ ...s, set: 2 }).attempt).toBe(2))
  it('every choice rule has a word', () => expect(CHOICES).toEqual(['all', 'any', 'or-pairs']))
  it('names the next free section and moves sections without losing one', () => {
    expect(nextName(bp.sections)).toBe('Section D')
    expect(newSection(bp.sections).name).toBe('Section D')
    expect(moveSection([1, 2, 3], 0, 2)).toEqual([2, 3, 1])
    expect(moveSection([1, 2, 3], 0, 5)).toEqual([1, 2, 3])
  })
})

describe('minutes per mark', () => {
  it('is duration over total, to one place', () => {
    expect(minutesPerMark(bp)).toBe(2)
    expect(minutesText(2)).toBe('2.0')
  })
  it('is absent, not a default, when no duration was given', () => {
    expect(minutesPerMark({ ...bp, durationMin: null })).toBeNull()
    expect(minutesText(null)).toBe('--')
  })
})

describe('the A4 skeleton', () => {
  it('has a heading per section and a bar per question set, all inside the page', () => {
    const rows = skeletonRows(bp)
    expect(rows.filter((r) => r.kind === 'head')).toHaveLength(3)
    expect(rows.filter((r) => r.kind === 'slot')).toHaveLength(18)
    for (const r of rows) expect(r.y + r.h).toBeLessThanOrEqual(1123 - 80)
  })
  it('squeezes seven sections to fit instead of running off the page', () => {
    const rows = skeletonRows(toGen(BLUEPRINT_SEVEN))
    expect(rows.filter((r) => r.kind === 'head')).toHaveLength(7)
    const last = rows[rows.length - 1]
    expect(last.y + last.h).toBeLessThanOrEqual(1123 - 80)
  })
})

describe('the seed', () => {
  it('parses a whole number from 1 to 2147483646 and nothing else', () => {
    expect(parseSeed('48271')).toBe(48271)
    expect(parseSeed(' 7 ')).toBe(7)
    for (const bad of ['', '0', '-3', '1.5', 'abc', '2147483647', '12345678901']) expect(parseSeed(bad), bad).toBeNull()
  })
  it('reseeds without a random source: the same seed always gives the same next seed, inside the range', () => {
    expect(nextSeed(48271)).toBe(nextSeed(48271))
    expect(nextSeed(48271)).not.toBe(48271)
    let s = 1
    for (let i = 0; i < 50; i++) { s = nextSeed(s); expect(s).toBeGreaterThanOrEqual(1); expect(s).toBeLessThanOrEqual(SEED_MAX) }
  })
})

describe('the invented draw', () => {
  it('is deterministic in the seed and different for another seed', () => {
    const a = fixtureDraw(bp, 48271)
    const b = fixtureDraw(bp, 48271)
    const c = fixtureDraw(bp, nextSeed(48271))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(JSON.stringify(a.sections)).not.toBe(JSON.stringify(c.sections))
    expect(a.seed).toBe(48271)
  })
  it('sets as many slots as the blueprint asks for and leaves one hollow, never padded', () => {
    const p = fixtureDraw(bp, 48271)
    const st = paperStats(p)
    expect(st).toMatchObject({ sections: 3, slots: 18, hollow: 1, filled: 17, marks: 60 })
    const hollow = p.sections!.flatMap((s) => s.slots).filter(isHollow)
    expect(hollow).toHaveLength(1)
    expect(hollow[0]).toMatchObject({ questionId: null, text: '', type: null })
    expect(hollow[0].reason).toMatch(/needs 1 more 10-mark question: too few reviewed questions/)
    expect(p.shortfall).toEqual([hollow[0].reason])
    expect(p.questionIds).toHaveLength(17)
  })
  it('an unchecked question prints as its crop, a checked one as text, a hollow one as neither', () => {
    const slots = fixtureDraw(bp, 48271).sections!.flatMap((s) => s.slots)
    const crops = slots.filter(printsAsCrop)
    expect(crops.length).toBeGreaterThan(0)
    for (const s of crops) { expect(s.textStatus).not.toBe('verified'); expect(s.crop).toBeTruthy() }
    expect(slots.filter(isHollow).some(printsAsCrop)).toBe(false)
  })
  it('numbers the questions 1 to 18 across the sections, the same on the paper, the key and the marking sheet', () => {
    const n = numbered(fixtureDraw(bp, 48271))
    expect(n.map((x) => x.q)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1))
    expect(n[10].section.name).toBe('Section B')
  })
  it('the section instruction reads as an exam would', () => {
    expect(instruction({ set: 10, attempt: 10, marks: 2 })).toBe('Attempt all 10, 2 marks each')
    expect(instruction({ set: 5, attempt: 3, marks: 1 })).toBe('Attempt any 3 of 5, 1 mark each')
    expect(instruction({ set: 6, attempt: 3, marks: 4, choice: 'or-pairs' })).toBe('Attempt one of each of 3 pairs, 4 marks each')
  })
})

describe('the words', () => {
  const strings = (o: unknown): string[] => (typeof o === 'string' ? [o] : typeof o === 'function' ? [String((o as (n: number) => string)(2))] : o && typeof o === 'object' ? Object.values(o).flatMap(strings) : [])
  it('no sentence the student reads promises what a count cannot', () => {
    const all = strings(COPY).join(' ').toLowerCase()
    for (const w of FORBIDDEN_WORDS) expect(all).not.toContain(w)
    for (const w of ['probability', 'pass chance', 'streak']) expect(all).not.toContain(w)
  })
})
