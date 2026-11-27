// The two notes under the grid (package O, 27 Nov): R-16's provisional counts as a plain note that draws no pattern, and R-17's picks
// with the engine's terms in words. Both against a scripted port, so the desk's own loadDesk decides what reaches the screen.
import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '../../../../__tests__/ww/_stubs'
import { nullStudyPort } from '../../adapters/null.register'
import { termsText } from '../../adapters/pyqMap'
import type { PatternSet, PortReply, StudyPort } from '../../ports'
import { PAPERS } from '../fixtures'
import { PractiseNext, ProvisionalNote, provisionalText } from '../PatternNotes'
import { loadDesk } from '../PaperDesk'

let m: ReturnType<typeof mount> | null = null
afterEach(() => { m?.unmount(); m = null })
const text = () => (m!.container.textContent ?? '').replace(/\s+/g, ' ')
const reply = <T,>(state: PortReply<T>['state'], reason: string, data: T | null): PortReply<T> => ({ state, reason, since: 1, data })

describe('R-16 provisional counts', () => {
  it('say the counts in words and name no pattern', () => {
    expect(provisionalText({ papers: 2, questions: 3 })).toBe('3 questions in 2 papers so far: too few to call a pattern.')
    expect(provisionalText({ papers: 1, questions: 1 })).toBe('1 question in 1 paper so far: too few to call a pattern.')
    m = mount(<ProvisionalNote counts={{ papers: 2, questions: 3, reason: 'Too few papers to show a pattern: 1 more paper, 17 more reviewed questions.' }} />)
    expect(text()).toContain('3 questions in 2 papers so far: too few to call a pattern.')
    expect(text()).toContain('1 more paper, 17 more reviewed questions')
  })
  it('loadDesk keeps the desk its own state, hands over the counts as a note, and gives the grid no topic', async () => {
    const port: StudyPort = {
      ...nullStudyPort,
      papers: async () => reply('live', '2 papers on file.', PAPERS.slice(0, 2)),
      questions: async () => reply('live', 'ok', []),
      patterns: async () => reply('waiting', 'Too few papers to show a pattern: 1 more paper.', { topics: [], papers: 2, topicCounts: {}, provisional: true, questions: 3 }),
    }
    const d = await loadDesk(port)
    expect(d.state).toBe('live')
    expect(d.topics).toEqual([])
    expect(d.provisional).toEqual({ papers: 2, questions: 3, reason: 'Too few papers to show a pattern: 1 more paper.' })
  })
  it('a WAITING pattern that is not provisional still hollows the desk with its reason', async () => {
    const port: StudyPort = { ...nullStudyPort, papers: async () => reply('live', 'ok', PAPERS), questions: async () => reply('live', 'ok', []), patterns: async () => reply<PatternSet>('waiting', 'the engine is paused', null) }
    const d = await loadDesk(port)
    expect(d.state).toBe('waiting')
    expect(d.provisional).toBeNull()
  })
})

describe('R-17 terms in words', () => {
  it('prints every term the engine sent, with the syllabus weight, and nothing it did not', () => {
    expect(termsText({ marks_weight: 0.3125, seen_share: 0.8, proficiency: 0.5, measured: true, minutes: 12.4, syllabus_weight: 3 }))
      .toBe('marks weight 0.31; set in 80 % of papers; proficiency 0.50 from your marks; syllabus weight 3 of 3 (high); about 12 min')
    expect(termsText({ proficiency: 0.5, measured: false, syllabus_weight: 1 })).toBe('proficiency 0.50, not measured yet; syllabus weight 1 of 3 (low)')
    expect(termsText({ syllabus_weight: 2 })).toContain('syllabus weight 2 of 3 (medium)')
    expect(termsText(undefined)).toBe('')
    expect(termsText({})).toBe('')
  })
  it('the note lists the engine order with the terms under each topic', () => {
    m = mount(<PractiseNext items={[{ topicId: '2|Sampling', reason: 'set in 2 of 3 papers on file; no marked attempts', terms: 'marks weight 0.31; syllabus weight 3 of 3 (high)' }]} topics={[{ id: '2|Sampling', label: 'Sampling', unit: 'Unit 2' }]} />)
    expect(text()).toContain('Practise next, in the engine')
    expect(text()).toContain('Sampling')
    expect(text()).toContain('set in 2 of 3 papers on file; no marked attempts')
    expect(text()).toContain('syllabus weight 3 of 3 (high)')
  })
  it('draws nothing when there are no picks', () => {
    m = mount(<PractiseNext items={[]} topics={[]} />)
    expect(m.container.querySelector('[data-component="practise-next"]')).toBeNull()
  })
})
