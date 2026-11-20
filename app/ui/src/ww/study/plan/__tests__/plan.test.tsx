// Package Y03: the plan board and its drawings, rendered. Honest empty states, the sigil rule (dashed under 5 answers, same unit the same sigil),
// no digit in the retention bands, paging instead of scrolling, one warm action, the keys of the wheel and the landscape, and the forbidden
// words in every string of the package's folders.
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mount } from '../../../../__tests__/ww/_stubs'
import { PrimaryOwner } from '../../../kit'
import entries from '../../../../gallery/entries/Y03'
import { Y03_LABELS } from '../gallery'
import { CLOCK, EXAMS, ORBIT_TOPICS, TODAY, UNITS_BARE, UNITS_MEASURED } from '../fixtures'
import { ExamWheel } from '../ExamWheel'
import { PlanBoard, type PlanBoardProps } from '../PlanBoard'
import { RetentionOrbit } from '../RetentionOrbit'
import { SigilGauge, sigilPath } from '../SigilGauge'
import { SyllabusLandscape } from '../SyllabusLandscape'
import { MIN_N, chosenPaper, isMeasured, paged, unitsOfPaper, weakestUnit } from '../model'

let m: ReturnType<typeof mount> | null = null
afterEach(() => { m?.unmount(); m = null })
const q = (sel: string) => m!.container.querySelector(sel) as HTMLElement
const qa = (sel: string) => Array.from(m!.container.querySelectorAll<HTMLElement>(sel))
const key = (el: Element, k: string) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })) })
const noop = () => undefined

const BASE: PlanBoardProps = {
  today: TODAY, exams: EXAMS, paperId: 'p1', onPaper: noop, units: UNITS_MEASURED, unitsReading: { state: 'simulated', reason: 'invented' }, clock: CLOCK, planLamp: { state: 'simulated', reason: 'invented' },
  retention: { state: 'waiting', reason: 'review cards need the paper engine', dueCount: null, topics: [], dueIds: [] },
  onStart: noop, onRebuild: () => Promise.resolve(), onSwap: () => Promise.resolve('ok'), onLog: noop, onDrill: noop,
}
const board = (p: Partial<PlanBoardProps> = {}) => mount(<PrimaryOwner><PlanBoard {...BASE} {...p} /></PrimaryOwner>)

describe('the model', () => {
  it('a unit is measured only with MIN_N answers and a proficiency; the weakest is the shortest arc among those', () => {
    expect(MIN_N).toBe(5)
    expect(UNITS_MEASURED.map(isMeasured)).toEqual([true, true, false, false])
    expect(weakestUnit(UNITS_MEASURED)?.num).toBe(2)
    expect(weakestUnit(UNITS_BARE)).toBeNull()
  })
  it('units are drawn from the paper topics; nothing is measured until the engine says so', () => {
    const u = unitsOfPaper(EXAMS.papers[0])
    expect(u.map((x) => x.num)).toEqual([1, 2, 3, 4])
    expect(u.every((x) => x.proficiency === null && x.n === 0)).toBe(true)
    expect(u[0].trees).toBe(2)
    expect(Math.round(u.reduce((a, x) => a + x.share, 0) * 1000)).toBe(1000)
  })
  it('the chosen paper is the one asked for, else the nearest that has not happened yet', () => {
    expect(chosenPaper(EXAMS.papers, null)?.id).toBe('p1')
    expect(chosenPaper(EXAMS.papers, 'p3')?.id).toBe('p3')
    expect(chosenPaper([], null)).toBeNull()
  })
  it('paging clamps, so a list that shrinks never lands on an empty page', () => {
    expect(paged([1, 2, 3, 4, 5], 2, 9)).toEqual({ items: [5], page: 2, pages: 3 })
    expect(paged([], 3, 1)).toEqual({ items: [], page: 0, pages: 1 })
  })
})

describe('SigilGauge', () => {
  it('under 5 answers the arc is dashed and the label says too few answers', () => {
    m = mount(<SigilGauge unitId="u" proficiency={0.9} n={3} label="Unit 3" />)
    expect(q('.y3-sg-arc').getAttribute('data-dashed')).toBe('true')
    expect(m.container.textContent).toContain('too few answers')
  })
  it('with enough answers the arc is solid and n is printed', () => {
    m = mount(<SigilGauge unitId="u" proficiency={0.5} n={8} label="Unit 2" />)
    expect(q('.y3-sg-arc').getAttribute('data-dashed')).toBeNull()
    expect(m.container.textContent).toContain('n = 8')
  })
  it('the same unit id is the same sigil, and a unit with more answers has no more strokes', () => {
    expect(sigilPath('p1:u1')).toBe(sigilPath('p1:u1'))
    expect(sigilPath('p1:u1')).not.toBe(sigilPath('p1:u2'))
    const strokes = (d: string) => (d.match(/M/g) ?? []).length
    expect(strokes(sigilPath('a'))).toBe(strokes(sigilPath('zzz')))
  })
})

describe('SyllabusLandscape', () => {
  it('draws one plateau per unit; unmeasured ones carry a dashed rim', () => {
    m = mount(<SyllabusLandscape units={UNITS_MEASURED} caption="c" />)
    expect(qa('.y3-pl')).toHaveLength(4)
    expect(qa('.y3-pl[data-measured="false"] .y3-pl-rim')).toHaveLength(2)
  })
  it('with no units it is a flat slab and says where to add them', () => {
    m = mount(<SyllabusLandscape units={[]} caption="" />)
    expect(qa('.y3-pl')).toHaveLength(0)
    expect(m.container.textContent).toContain('No syllabus units yet. Add them in Subjects.')
  })
  it('one tab stop; arrows step around the block; Enter chooses', () => {
    const chose: string[] = []
    m = mount(<SyllabusLandscape units={UNITS_MEASURED} caption="c" onSelect={(id) => chose.push(id)} />)
    expect(qa('.y3-pl[tabindex="0"]')).toHaveLength(1)
    const first = qa('.y3-pl')[0]
    act(() => first.focus())
    key(first, 'ArrowRight')
    expect(document.activeElement).toBe(qa('.y3-pl')[1])
    key(document.activeElement!, 'Enter')
    expect(chose).toEqual([UNITS_MEASURED[1].id])
  })
})

describe('ExamWheel', () => {
  const papers = EXAMS.papers.map((p) => ({ id: p.id, label: p.title, date: p.date, approx: p.approx }))
  it('one spoke per paper on file, each names its paper and its date; a tentative date is marked', () => {
    m = mount(<ExamWheel papers={papers} today={CLOCK} />)
    expect(qa('.y3-spoke')).toHaveLength(4)
    expect(qa('.y3-spoke')[1].getAttribute('aria-label')).toMatch(/Subject A, 2027-03-04/)
    expect(qa('.y3-spoke-dot[data-approx="true"]')).toHaveLength(1)
  })
  it('the spokes are one roving tab stop; Enter chooses a paper', () => {
    const chose: string[] = []
    m = mount(<ExamWheel papers={papers} today={CLOCK} onSelect={(id) => chose.push(id)} />)
    expect(qa('.y3-spoke[tabindex="0"]')).toHaveLength(1)
    const s = qa('.y3-spoke')[0]
    act(() => s.focus())
    key(s, 'ArrowRight')
    key(document.activeElement!, 'Enter')
    expect(chose).toEqual([qa('.y3-spoke')[1].getAttribute('data-paper')])
  })
  it('with no papers it says so and draws no spoke', () => {
    m = mount(<ExamWheel papers={[]} today={CLOCK} />)
    expect(qa('.y3-spoke')).toHaveLength(0)
  })
})

describe('RetentionOrbit', () => {
  it('without an engine it draws four empty rings, a hollow count and WAITING with the reason', () => {
    m = mount(<RetentionOrbit topics={[]} dueIds={[]} dueCount={null} state="waiting" reason="review cards need the paper engine" />)
    expect(qa('.y3-orbit-ring')).toHaveLength(4)
    expect(q('.y3-orbit-num').textContent).toBe('--')
    expect(m.container.textContent).toContain('Waiting: review cards need the paper engine')
    expect(qa('.ww-chip')).toHaveLength(0)
  })
  it('with cards it draws four bands, hollow due planets, the DEFAULT chip, and no decimal anywhere', () => {
    m = mount(<RetentionOrbit topics={ORBIT_TOPICS} dueIds={['t7', 't8']} dueCount={2} state="simulated" reason="invented" retention={90} onRetention={noop} />)
    expect(qa('.y3-planet')).toHaveLength(8)
    expect(qa('.y3-planet[data-hollow="true"]')).toHaveLength(2)
    expect(m.container.textContent).toContain('DEFAULT')
    expect(m.container.textContent).not.toMatch(/\d\.\d/)
    expect(m.container.textContent).not.toMatch(/\d+\s*%/)
  })
  it('a WAITING orbit never shows a number even when given one', () => {
    m = mount(<RetentionOrbit topics={ORBIT_TOPICS} dueIds={[]} dueCount={9} state="waiting" reason="paused" />)
    expect(q('.y3-orbit-num').textContent).toBe('--')
  })
})

describe('PlanBoard', () => {
  it('draws the six plates, one warm action and the footer line that says it predicts nothing', () => {
    m = board()
    expect(qa('.y3-card')).toHaveLength(6)
    expect(q('[data-card="study-plan"]')).toBeTruthy()
    expect(q('[data-card="study-exam-blocks"]')).toBeTruthy()
    expect(qa('[data-primary="true"]')).toHaveLength(1)
    expect(m.container.textContent).toContain('does not predict a paper or a result')
  })
  it('every lamp prints its word', () => {
    m = board()
    expect(qa('.y3-lamp .k-lamp-word').length).toBeGreaterThanOrEqual(5)
    expect(qa('.y3-lamp .k-lamp-word').map((e) => e.textContent)).toContain('SIMULATED')
  })
  it('a block rail says which block is chosen; the rows are three a page and paged, never scrolled', () => {
    m = board()
    const blocks = qa('.y3-blk')
    expect(blocks).toHaveLength(3)
    expect(blocks.filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
    expect(qa('[data-card="study-plan"] .y3-rows > .y3-row').length).toBeLessThanOrEqual(3)
    act(() => blocks[1].click())
    expect(blocks[1].getAttribute('aria-pressed')).toBe('true')
    expect(m.container.textContent).toContain('Protected rest. The plan never puts work here.')
  })
  it('the next action carries its hint and Swap offers the other options in an opaque sheet that closes on Escape', () => {
    m = board({ sheet: null })
    const swap = qa('button').find((b) => /^Swap /.test(b.getAttribute('aria-label') ?? ''))!
    act(() => swap.click())
    const sheet = q('.y3-sheet')
    expect(sheet.getAttribute('role')).toBe('dialog')
    expect(sheet.textContent).toContain('A shorter set on the same topic')
    key(sheet, 'Escape')
    expect(q('.y3-sheet')).toBeNull()
  })
  it('Rebuild asks first; Keep the plan puts the footer back', () => {
    m = board()
    act(() => qa('button').find((b) => b.textContent === "Rebuild today's plan")!.click())
    expect(q('[role="group"][aria-label="Confirm rebuild"]')).toBeTruthy()
    act(() => qa('button').find((b) => b.textContent === 'Keep the plan')!.click())
    expect(q('[role="group"][aria-label="Confirm rebuild"]')).toBeNull()
  })
  it('exam study offers Log 30 and Log 60 minutes on the paper of the block', () => {
    const logged: [string, number][] = []
    m = board({ onLog: (s, mm) => logged.push([s, mm]) })
    act(() => qa('button').find((b) => b.getAttribute('aria-label')?.startsWith('Log 30 minutes'))!.click())
    expect(logged).toEqual([['s-p1', 30]])
  })
  it('with no papers and no engine it is hollow and says why; no arc is drawn as measured', () => {
    m = board({ exams: null, paperId: null, units: [], unitsReading: { state: 'waiting', reason: 'marks per unit need the paper engine' } })
    expect(q('.y3-wheel').getAttribute('data-empty')).toBe('true')
    expect(qa('.y3-spoke')).toHaveLength(0)
    expect(m.container.textContent).toContain('No syllabus units yet. Add them in Subjects.')
    expect(qa('.y3-sg')).toHaveLength(0)
  })
  it('the weak unit is named in words, not colour', () => {
    m = board()
    expect(m.container.textContent).toContain('Unit 2, Methods has the shortest arc, n = 8.')
  })
  it('a unit gauge opens Drill on that unit', () => {
    const drilled: string[] = []
    m = board({ onDrill: (u) => drilled.push(u) })
    act(() => qa('.y3-sg')[0].click())
    expect(drilled).toEqual([UNITS_MEASURED[0].id])
  })
})

describe('honest copy', () => {
  it('the landscape caption promises no practice scope, and the gauge says it opens Drill without the unit', () => {
    m = mount(<SyllabusLandscape units={UNITS_MEASURED} caption="c" />)
    expect(m.container.textContent).toContain('Choose one to mark it below.')
    expect(m.container.textContent).not.toMatch(/scope/i)
    m.unmount()
    m = board()
    expect(qa('.y3-sg')[0].getAttribute('aria-label')).toMatch(/Opens Drill; the unit is not carried over/)
  })
  it('the wheel draws its month letters large enough to survive the scale of the board (11 px floor)', () => {
    const css = readFileSync(join(SRC, 'study/plan/y3.css'), 'utf8')
    const size = Number(/\.y3-wheel-m \{ font: 600 (\d+)px/.exec(css)?.[1])
    // drawn in a 280 unit box, shown about 190 px wide on the 1366 board
    expect(size * (190 / 280)).toBeGreaterThanOrEqual(11)
  })
  it('the orbit with cards due and no bands does not also say there are no cards, and offers no dead buttons', () => {
    m = mount(<RetentionOrbit topics={[]} dueIds={[]} dueCount={9} state="live" reason="read" />)
    expect(m.container.textContent).toContain('Bands arrive with the card engine.')
    expect(m.container.textContent).not.toContain('No cards yet')
    expect(m.container.textContent).not.toContain('Review today')
    m.unmount()
    m = mount(<RetentionOrbit topics={[]} dueIds={[]} dueCount={0} state="live" reason="read" />)
    expect(m.container.textContent).toContain('No cards yet')
  })
  it('the exam plate does not claim there are no papers while it is still reading them', () => {
    m = board({ exams: null })
    expect(m.container.textContent).toContain('Reading the papers on file.')
    expect(m.container.textContent).not.toContain('No papers on file yet')
    m.unmount()
    m = board({ exams: { ...EXAMS, papers: [] } })
    expect(m.container.textContent).toContain('No papers on file yet')
  })
})

describe('the gallery entry', () => {
  it('lists the same labels as the lazy states', () => {
    expect(entries[0].states.map((s) => s.label)).toEqual(Y03_LABELS)
  })
})

// ---------------------------------------------------------------------------------------------------- forbidden words
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? (n === '__tests__' ? [] : walk(p)) : /\.(tsx?|css)$/.test(n) ? [p] : [] })
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
const WORDS = /\b(important|likely|expected|streak)\b/i

describe('forbidden words', () => {
  it('no source line of the plan, dMAT or gallery files says important, likely, expected or streak', () => {
    const files = [...walk(join(SRC, 'study/plan')), ...walk(join(SRC, 'study/dmat')), ...walk(join(SRC, 'study/library')), join(SRC, 'study/Library.tsx'), join(SRC, 'study/Dmat.tsx'), join(SRC, 'study/Plan.tsx'), join(SRC, '../shell/views/study-plan.view.ts'), join(SRC, '../shell/views/study-dmat.view.ts'), join(SRC, '../gallery/entries/Y03.tsx')]
    expect(files.length).toBeGreaterThan(14)
    for (const f of files) expect(stripComments(readFileSync(f, 'utf8')), f).not.toMatch(WORDS)
  })
  it('no rendered board says them, and none predicts a paper or a result', () => {
    m = board({ retention: { state: 'simulated', reason: 'invented', dueCount: 2, topics: ORBIT_TOPICS, dueIds: ['t7'] } })
    expect(m.container.textContent).not.toMatch(WORDS)
    expect(m.container.textContent).not.toMatch(/\b(will be asked|will score|chance of|probability)\b/i)
  })
})
